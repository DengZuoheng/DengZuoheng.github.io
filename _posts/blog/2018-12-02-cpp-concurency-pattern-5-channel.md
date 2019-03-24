---
layout: post
title: C++并发型模式#5&#58; 线程间多次通信 - channel
description: future是适用于一次性事件的同步模式, 如果需要多次通信, channel是个不错的选择, C++标准和Boost都没有提供面向线程的channel, 这里我们将讨论如何实现一个带select的channel.
category: blog
---

## channel的引入

许多资料都指出[1], future适用于一次性事件(one-off event), 但在许多场景里, 工作线程间的通信是持续的, 多次的, 比如我们熟悉的生产者-消费者模型. 这种场景下, future就不那么好用了. 

于是, 很自然地, 我们会想到....线程安全队列! 生产者把产品放到队尾而消费者从队首取出产品消费掉. 事实上, 人们甚至根据生产者一个还是多个, 消费者有一个还是多个, 排列组合一下, 将线程安全队列分成很多种, 然后根据有界(bounded)无界(unbounded). Go语言中的buffered channel也可以认为是一种有界多生产者多消费者线程安全队列(Bounded MPMC queue)[5]. 

如果有channel, 生产者消费者模型可以这么写:

~~~
// 好久没写Go了, 不知道写对了没
type Production struct {
  
}

func Producer(c chan Production) {
    for {
        c <- ProduceItem()
    }
}

func Consumer(c chan Production) {
    for {
        item := <- c
        ConsumeItem(item)
    }
}

func main() {
    const N int
    c := make(chan Production, N)
    go Producer(c)
    go Consumer(c)  
}

~~~

幸运的是, boost1.62引入了fiber库, fiber库里面也有一个channel:

~~~
class production;
void producer(boost::fibers::bounded_channel<production>& chan) {
    production item;
    for (;;;) {
        item = produce_item();
        chan.push(item);
    }    
}

void consumer(boost::fibers::bounded_channel<production>& chan) {
    production item;
    for (;;;) {
        chan.pop(item);
        consume_item(item);
    }
}
~~~

当然, 让工人永恒地劳作是邪恶的, 所以channel是可以close的, 比如fiber里面的channel, push和pop都是有返回值, 返回当前channel的状态, 以便判断是否已经close.

悲惨的是, boost1.62的channel只能用于fiber而无法用于thread; 而且没有select, 这就像future没了wait_for_any和when_any, 很是不爽; 

所以, 下面我们来动手写一个<del>玩具</del>channel吧~

## 如何实现channel

<del>警告! 以下实现是真.玩具性质的, 在生产环境爆炸了可不要找我;-)</del>

一如既往地, 我们先声明channel的接口:

~~~

class select;

template <typename T>
class channel {
    friend select;
public:
    explicit channel(size_t bound);

    void recv(T& val);
    bool try_recv(T& val);

    void send(const T& val);
    bool try_send(const T& val);
};

~~~

这里我们只提供了`send`和`recv`接口, `close`没有了; 因为要加上`close`, 大多代码片段都将加上相应的判断逻辑, 繁琐又影响理解. 相反, 如果理解了没有`close`的实现, 想加个close也就不困难了.

另外, 为了使用channel的时候, 可以愉快地传值, 我们并不打算就这样把具体实现放在channel上, 而是用pimpl idioms:

~~~

class select;

template <typename T>
class channel_impl;

template <typename T>
class channel {
    friend select;
public:
    explicit channel(size_t bound) : m_impl(new channel_impl<T>(bound)) {}
    void recv(T& val) {
        m_impl->recv(val);
    }
    bool try_recv(T& val) {
        return m_impl->try_recv(val);
    }

    void send(const T& val) {
        m_impl->send(val);
    }
    bool try_send(const T& val) {
        return m_impl->try_send(val);
    }

private:
    boost::shared_ptr<channel_impl<T> > m_impl;
};
~~~

之前提到, buffer channel其实是bounded MPMC queue, 简单起见, 我们就不去实现一个bounded buffer了, 直接`boost::circular_buffer`:

~~~
class select;

template <typename T>
class channel_impl : boost::noncopyable {
    friend select;
    boost::circular_buffer<T> m_data;
    boost::mutex m_mutex;
}
~~~

`m_mutex`是用来保护`m_data`的. 

也许你发现了, 这里还没加条件变量; 因为send和recv应当都是阻塞的, 所以这里确实需要两个提供`wait/signal`的机制, 一个给send, 一个给recv, 就像经典的生产者-消费者模型一样.

但是, 我们想实现select, 就会有两种想法, 一是将select case 注册到channel中, 另一种是select case中等待channel实例内部的condition_variable; 然而很遗憾, select中我们只能等一个条件变量, 而select中有许多channel实例. 所以之后我们会选择将注册select case到channel的方法, 就像我们实现future时一样.

但是, future的唤醒是`notify_all`的, channel是`notify_one`的, 所以不能像future一样有两个管理条件变量的成员, 一个自己的, 一个注册进来的. channel需要把它们都放入同一个成员中, 为了尽量先等待先唤醒, 这个成员应该还是个队列, 我们将之称为`waitq`, 于是channel_impl的成员是这样的:

~~~
class select;

template <typename T>
class channel_impl : boost::noncopyable {
    friend select;
    boost::circular_buffer<T> m_data;
    boost::mutex m_mutex;
    waitq m_waiting_consumers;
    waitq m_waiting_producers;

public:
    explicit channel_impl(size_t bound) : m_data(bound) {}
    void recv(T& val);
    bool try_recv(T& val);
    void send(const T& val);
    bool try_send(const T& val);
};
~~~


我们先来实现一下`waitq`, `waitq`本身不带锁, 由`channel_impl`的锁保护:

~~~
class waitq {
    std::list<boost::condition_variable_any*> m_q;

public:
    waitq() {}
    void enqueue(boost::condition_variable_any* cond) {
        assert(cond);
        m_q.push_back(cond);
    }
    boost::condition_variable_any* dequeue() {
        boost::condition_variable_any* ret = NULL;
        if (!m_q.empty()) {
            ret = m_q.front();
            m_q.pop_front();
        }
        return ret;
    }
    void remove(boost::condition_variable_any* cond) {
        m_q.remove(cond);
    }
    void notify_one() {
        boost::condition_variable_any* cond = dequeue();
        assert(cond);
        if (cond) {
            cond->notify_one();
        }
    }
};

~~~

这里waitq的notify_one就是从等待队列中取队首来notify_one, 因为select的时候我们还会使用自定义的锁, 所以这里也需要用`boost::condition_variable_any`. 至于为什么要写remove, 我们稍后会提到.

有了waitq, 我们就可以实现一下recv:

~~~
void recv(T& val) {
    boost::condition_variable_any cond;

    boost::unique_lock<boost::mutex> lk(m_mutex);
    while (m_data.empty()) {
        m_waiting_consumers.enqueue(&cond);
        cond.wait(lk);
        m_waiting_consumers.remove(&cond);
    }
    val = m_data.front();
    m_data.pop_front();
    m_waiting_producers.notify_one();
}
~~~

当`m_data`为空的时候, 需要将当前线程的条件变量加到等待队列里面去, 这个应该好理解; 

被唤醒时, 也许是伪唤醒, 碰巧`m_data`又不为空, 当前线程就"以外地"把data拿掉了, 但当前线程的条件变量还在等待队列中, 所以要remove掉, 避免notify一个没在等的条件变量, 造成死锁, 这个应该也好理解.

但是, 为什么在while循环里面enqueue又remove呢?

假设我们只在while外面写了一对enqueue和remove, 会怎么样呢? 比如这样:

~~~
m_waiting_consumers.enqueue(&cond);
while (m_data.empty()) {
    cond.wait(lk);
}
m_waiting_consumers.remove(&cond);
~~~

考虑有3个线程, 线程1,2在recv等待, 线程3在send; 某时刻, 线程1被正常唤醒, 但是还没醒过来, 在等锁, 但是此时线程1的条件变量已经不在waitq里面了. 很不幸地, 这时线程2被伪唤醒, 先拿到了锁, 把data抢了, 于是线程1就重新进入wait, 但再也不会被唤醒了. 所以enqueue得写在while里面.

另外, 因为remove的时候我们是根据条件变量的地址来remove的, 所以这里的条件变量都没有写成channel的成员, 而是函数体内的临时变量.

同理我们可以实现剩下的成员函数:

~~~
bool try_recv(T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    if (m_data.empty()) {
        return false;
    }
    val = m_data.front();
    m_data.pop_front();

    m_waiting_producers.notify_one();
    return true;
}
void send(const T& val) {
    boost::condition_variable_any cond;
    
    boost::unique_lock<boost::mutex> lk(m_mutex);
    while (m_data.full()) {
        m_waiting_producers.enqueue(&cond);
        cond.wait(lk);
        m_waiting_producers.remove(&cond);
    }
    m_data.push_back(val);

    m_waiting_consumers.notify_one();
}
bool try_send(const T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    if (m_data.full()) {
        return false;
    }
    m_data.push_back(val);

    m_waiting_consumers.notify_one();
    return true;
}
~~~

至此, channel的send和recv就实现出来了. 下面, 我们接着去实现select.

## 如何实现select

golang的select使得我们可以再一个语句里等待多个channel, 典型的例子如下:

~~~
package main
import "fmt"
func main() {
    c1 := make(chan string)
    c2 := make(chan string)
    go func() {
        c1 <- "one"
    }()
    go func() {
        c2 <- "two"
    }()
    for i := 0; i < 2; i++ {
        select {
        case msg1 := <-c1:
            fmt.Println("received", msg1)
        case msg2 := <-c2:
            fmt.Println("received", msg2)
        }
    }
}
~~~

C++中我们没有语句级别的select, default关键词还被占了, 我们可能得写成链式操作的样子, case下的语句只能写成回调(当然, 这样就没有办法break, continue, return了)[6], 比如:

~~~
#include <iostream>
#include <string>
#include <boost/thread.hpp>

int main() {
    channel<std::string> c1(1);
    channel<std::string> c2(1);
    boost::thread tr1([&]() {
        c1.send("one");
    });
    boost::thread tr2([&]() {
        c2.send("two");
    });
    for (int i = 0; i < 2; ++i) {
        std::string msg1, msg2;
        select(). recv(c1, msg1, [&](){
            std::cout << "received" << msg1 << std::endl;
        }).recv(c2, msg2, [&]() {
            std::cout << "received" << msg2 << std::endl;
        }).wait();
    }
    tr1.join();
    tr2.join();
    return 0;
}
~~~

这样的select其实是一个类, 所以我们可以声明select的接口如下:

~~~

class select : boost::noncopyable {
public:
    select() {}
    
    template <typename T>
    select& recv(channel<T>& chan, T& val, boost::function<void()> callback);
    
    template <typename T>
    select& send(channel<T>& chan, const T& val, boost::function<void()> callback);

    select& fall(boost::function<void()> callback);
    
    void wait();
};

~~~
其中`fall`是相当于`default`. 另外我们这里`callback`是没有参数和返回值的, 这要求如果想在`callback`中使用`val`的话, 就得用捕获.

然后参考golang中的select, 我们设计一个`select_case`结构体, 储存`val`和`callback`:

~~~
struct select_case {
    select_case() : m_mutex(NULL), m_type(INVALID_CASE), m_send_q(NULL), m_recv_q(NULL) {}
    boost::mutex* m_mutex;
    enum {
        INVALID_CASE = -1,
        SEND_CASE,
        RECV_CASE,
        DEFAULT_CASE
    } m_type;
    waitq* m_send_q;
    waitq* m_recv_q;
    boost::function<bool()> m_try_send;
    boost::function<bool()> m_try_recv;
    boost::function<void()> m_callback;

    bool try_send() {
        assert(m_type == SEND_CASE);
        if (m_try_send) {
            return m_try_send();
        }
        return false;
    }

    bool try_recv() {
        assert(m_type == RECV_CASE);
        if (m_try_recv) {
            return m_try_recv();
        }
        return false;
    }

    void callback() {
        if (m_callback) {
            m_callback();
        }
    }

    void reg(boost::condition_variable_any* cond) {
        if (m_type == SEND_CASE && m_send_q) {
            m_send_q->enqueue(cond);
        }
        else if (m_type == RECV_CASE && m_recv_q) {
            m_recv_q->enqueue(cond);
        }
    }
    void unreg(boost::condition_variable_any* cond) {
        if (m_type == SEND_CASE && m_send_q) {
            m_send_q->remove(cond);
        }
        else if (m_type == RECV_CASE && m_recv_q) {
            m_recv_q->remove(cond);
        }
    }
};
~~~

在解释为什么这么写之前, 我们得先说明一下select是怎么work的, golang中, select可以分成以下几个主要步骤[2]:

1. 乱序所有select case
2. 所有channel锁起来
3. 遍历一遍case的channel, 看看有没有可send或可recv的, 有就send或recv然后返回
4. 看看case中有没default, 有就返回
5. 将当前goroutine加到等待队列, 然后挂起
6. 当前goroutine被唤醒, 遍历一遍case的channel, 看看有没有可send或可recv的, 找到的第一个send或recv然后返回, 没有就返回上一步.

这些步骤就使得我们的select_case需要满足一些要求: 比如可以访问到channel的锁和等待队列; 比如要有类型(send, recv, default); 

另外, 因为channel是模板, select中可能有几种类型不同的channel, 而select_case需要保存在select中, 所以我们不希望select_case是模板. 这样select_case就不能直接持有channel的引用或指针; 那要访问channel的锁和等待队列, 就只能直接持有channel的锁和等待队列的指针了.

因为select_case中没有channel实例, select执行wait的时候, 自然也没法直接访问到channel, 那么, 我们只好将send和recv包装成boost::function, 这就是`m_try_send`和`m_try_recv`. 

这么一来, 我们就很容易实现select的send, recv和fall了:

~~~
template <typename T>
select& recv(channel<T>& chan, T& val, boost::function<void()> callback) {
    boost::shared_ptr<select_case> c(new select_case);
    c->m_mutex = &chan.m_impl->m_mutex;
    c->m_type = select_case::RECV_CASE;
    c->m_recv_q = &chan.m_impl->m_waiting_consumers;
    c->m_send_q = &chan.m_impl->m_waiting_producers;
    c->m_try_recv = boost::bind(&channel<T>::try_recv_internal, &chan, boost::ref(val));
    c->m_callback = callback;
    m_cases.push_back(c);
    return *this;
}
template <typename T>

select& send(channel<T>& chan, const T& val, boost::function<void()> callback) {
    boost::shared_ptr<select_case> c(new select_case);
    c->m_mutex = &chan.m_impl->m_mutex;
    c->m_type = select_case::RECV_CASE;
    c->m_recv_q = &chan.m_impl->m_waiting_consumers;
    c->m_send_q = &chan.m_impl->m_waiting_producers;
    c->m_try_send = boost::bind(&channel<T>::try_send_internal, &chan, boost::ref(val));
    c->m_callback = callback;
    m_cases.push_back(c);
    return *this;
}

select& fall(boost::function<void()> callback) {
    boost::shared_ptr<select_case> c(new select_case);
    c->m_type = select_case::DEFAULT_CASE;
    c->m_callback = callback;
    m_cases.push_back(c);
    return *this;
}
~~~

这里的try_send需要解释一下, 因为`select::wait`中, 执行send时, channel是被锁住的, 所以不能直接用`channel::try_send`, 所以特地写了一个`channel::try_send_internal`, 其实就是不加锁的try_send和try_recv, 其实现如下:

~~~
bool try_recv_internal(T& val) {
    if (m_data.empty()) {
        return false;
    }
    val = m_data.front();
    m_data.pop_front();
    m_waiting_producers.notify_one();
    return true;
}

bool try_send_internal(const T& val) {
    if (is_full()) {
        return false;
    }
    m_data.push_back(val);
    m_waiting_consumers.notify_one();
    return true;
}
~~~

那剩下的其实就把`select::wait`写出来, 其步骤我们上面已经交代过了:

~~~
bool try_case(all_case_lock& lk, select_case& c);
void wait() {
    // 1. shuffle cases
    boost::range::random_shuffle(m_cases);

    // 2. lock all channels
    all_case_lock lk(m_cases);

    // 3. check if any channel has ready
    int default_case_idx = -1;
    for (size_t i = 0; i < m_cases.size(); ++i) {
        boost::shared_ptr<select_case>& c = m_cases[i];
        if (c->m_type == select_case::DEFAULT_CASE) {
            if (default_case_idx < 0) {
                default_case_idx = i;
            }
        }
        if (try_case(lk, *m_cases[i])) {
            return;
        }
    }

    // 4. if default case exist
    if (default_case_idx >= 0) {
        lk.unlock();
        m_cases[default_case_idx]->m_callback();
        return;
    }

    // 5. register and wait
    boost::condition_variable_any cond;

    while (true) {

        for (size_t i = 0; i < m_cases.size(); ++i) {
            m_cases[i]->reg(&cond);
        }
        cond.wait(lk);
        for (size_t i = 0; i < m_cases.size(); ++i) {
            m_cases[i]->unreg(&cond);
        }

        for (size_t i = 0; i < m_cases.size(); ++i) {
            if (try_case(lk, *m_cases[i])) {
                return;
            }
        }
    }
}
bool try_case(all_case_lock& lk, select_case& c) {
    if (c.m_type == select_case::RECV_CASE) {
        if (c.try_recv()) {
            lk.unlock();
            c.callback();
            return true;
        }
    } else if (c.m_type == select_case::SEND_CASE) {
        if (c.try_send()) {
            lk.unlock();
            c.callback();
            return true;
        }
    }
    return false;
}
~~~

而`all_case_lock`的实现类似于future的`wait_for_any`的`all_future_entity_lock`, 核心在于`boost::unique`的defer_lock和`boost::lock`函数, 注意同一channel可以存在于多个case, 所以要排重:

~~~
struct all_case_lock {
    std::set<boost::mutex*> dupefilter;
    std::vector<boost::unique_lock<boost::mutex> > locks;

    all_case_lock(std::vector<boost::shared_ptr<select_case> >& cases) {
        for (size_t i = 0; i < cases.size(); ++i) {
            boost::shared_ptr<select_case>& c = cases[i];
            if (c->m_mutex && dupefilter.find(c->m_mutex) == dupefilter.end()) {
                locks.push_back(boost::unique_lock<boost::mutex>(*(c->m_mutex), boost::defer_lock));
                dupefilter.insert(c->m_mutex);
            }
        }
        lock();
    }
    void lock() {
        boost::lock(locks.begin(), locks.end());
    }
    void unlock() {
        for (size_t i = 0; i < locks.size(); ++i) {
            locks[i].unlock();
        }
    }
};
~~~

## channel与semaphore

channel是golang中的主要协程间通信模型, 这意味着同步通常也是用channel做的, 而golang通常也不建议使用mutex, condition_variable等经典的同步方式. 另外我们知道, channel是CSP(communicating sequential processes)的核心实践[3][4], golang推广channel的话, 是不是可以说CSP模型等效于信号量模型和Monitor模型?

我们讨论信号量和Monitor等效的时候, [用信号量实现了互斥量和条件变量](/cpp-concurency-pattern-3-semaphore), 如果我们用channel实现信号量, 哪么就意味这三种同步模型是等效的.

简单起见, 我们先来用channel实现一个互斥量试试:

~~~
class mutex : boost::noncopyable {
    struct token;

public:
    mutex() : m_chan(1) { 
        m_chan.send(NULL); 
    }
    void lock() {
        token* tk = NULL;
        m_chan.recv(tk);
    }
    bool try_lock() {
        token* tk = NULL;
        return m_chan.try_recv(tk);
    }

    void unlock() {
        m_chan.try_send(NULL);
    }

    channel<token*> m_chan;
};
~~~

因为`m_chan`的buffer只有1, 所以, lock只能读出一个token来, 那么就只有一个线程可以锁这个mutex, 互斥达成. unlock用的是try_shend, 否则就阻塞在unlock里了.

推广一下我们就能写一个semaphore了:

~~~
class semaphore {
    struct token;

public:
    semaphore(size_t limit, size_t count) : m_chan(limit) {
        while (count--) {
            m_chan.send(NULL);
        }
    }
    void count_down_and_wait() {
        token* tk = NULL;
        m_chan.recv(tk);
    }
    void increase_and_notify() {
        m_chan.try_send(NULL);
    }

private:
    channel<token*> m_chan;
};
~~~

综上, 我们用mutex+condition实现了channel, 又用channel实现了semaphore, 可以说CSP和Monitor以及semaphore等效的.

## 总结

一般来说, buffered channel是bounded MPMC queue, 是CSP的实践之一, 与Monitor或semaphore有同等表达能力. 

select语句是channel的重要特性, 其他支持channel的语言通常也有select类似物, 比如clojure的`alt!`宏, rust的`select!`宏.

而select语句因为要锁全部channel, 可能性能不高. 

另外, select的实现也是侵入式的, 所以我们没办法另外给boost.fiber的channel写一个select, 只能指望boost哪天加上黑魔法select. <del>什么? 你说什么时候进标准? 指望C++标准委员会那效率还不如早日改用rust!</del>

所以, 不指望select的话, 用folly的MPMCQueue也是可以的.


**Reference:**  

* {:.ref} \[1]  John Bandela, [“Channels - An alternative to callbacks and futures"](https://www.youtube.com/watch?v=N3CkQu39j5I), CppCon 2016. [Presentation](https://github.com/CppCon/CppCon2016/tree/master/Presentations/Channels%20-%20An%20Alternative%20to%20Callbacks%20and%20Futures).  
* {:.ref} \[2]  nino, [Go Select的实现](https://ninokop.github.io/2017/11/07/Go-Select%E7%9A%84%E5%AE%9E%E7%8E%B0/), Nov.2017.  
* {:.ref} \[3]  Wikipedia, [Communicating sequential processes](https://en.wikipedia.org/wiki/Communicating_sequential_processes).  
* {:.ref} \[4]  Hoare, C. A. R. [Communicating sequential processes](https://spinroot.com/courses/summer/Papers/hoare_1978.pdf), 1978.  
* {:.ref} \[5]  Dmitry Vyukov. [Producer-Consumer Queues](http://www.1024cores.net/home/lock-free-algorithms/queues).   
* {:.ref} \[6]  ahorn. [cpp-channel, a Go-style concurrency for C++11](https://github.com/ahorn/cpp-channel).  

