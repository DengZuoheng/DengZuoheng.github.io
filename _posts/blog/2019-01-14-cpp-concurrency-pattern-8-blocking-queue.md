---
layout: post
title: C++并发型模式#8&#58; Blocking Queue
description: 在介绍Scheduler和Executor前, 有必要介绍一下阻塞队列和boost的sync_queue
category: blog
---

## 前言

我想写future的async和then, 这需要executor; 为了写executor, 我需要thread pool; 在thread pool之前, 又想把scheduler写了. 

然而在boost的计划[2]中, scheduler, thread pool, executor都在一个话题里讨论, 篇幅颇大,  所以我觉得还是先把`boost/thread/concurrent_queue`里的组件的解释一下, 比如sync_queue, 后面讲scheduler, thread pool, executor需要用到.

## Blocking Queue

线程安全队列的话题非常庞大, 可谓千里之行. 千里之行始于足下, 以Blocking Queue为第一步应该够简单了. 

`boost::concurrent::sync_queue`也是Blocking Queue的实现, 我们在直面sync_queue的繁复接口前, 还是先直接实现一个简单的Blocking Queue吧.

首先声明一下接口:

~~~
template<typename T>
class blocking_queue : boost::noncopyable {
    std::queue<T> m_queue;
    boost::condition_variable m_cond;
    mutable boost::mutex m_mutex;

public:
    blocking_queue() {}
    void push(const T& val);

    void pop(T& val);
    bool try_pop(const T& val);

    size_t size() const;
    bool empty() const;
};
~~~

事实上, `size()`和`empty()`的意义不是特别大, 因为在线程安全对象外部, 需要调两个方法的操作都可能有竟态(有些地方就干脆把它们命名为`size_unsafe`, `empty_unsafe`了). 所以这里`pop(T& val)`就会拿到队首并出队, 而不是像`std::queue`通过`front()`拿队首然后通过`pop()`出队.

push是简单的, 加锁入队就行, 然后notify_one:

~~~
void blocking_queue::push(const T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    m_queue.push(val);
    m_cond.notify_one();
}
~~~

pop则因为队列可能为空, 故而得等队列不为空:

~~~
void blocking_queue::pop(T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    while (m_queue.empty()) {
        m_cond.wait(lk);
    }
    val = m_queue.front();
    m_queue.pop();
}

void blocking_queue::try_pop(T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    if (!m_queue.empty()) {
        val = m_queue.front();
        m_queue.pop();
        return true;
    }
    return false;
}
~~~

`size()`和`empty()`:

~~~
size_t size() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.size();
}

bool empty() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.empty();
}

~~~

因为锁的粒度大, 锁了整个`m_queue`, 这个实现并不能一个线程`push`的同时, 另一个线程`pop`. 但胜在简单, 事实上, muduo库的`BlockingQueue`也是这么写的[1].

## Bounded Blocking Queue

有界阻塞队列和无界阻塞队列, 最大的区别在于, 有界的它会满, 满了就阻塞后面的push. 一般来说, 有界的上限是初始化就给定的, 所以可以先分配好这么多内存, 这就省了写分配内存的开销.

接口有些许不同, push也有try版本了; 因为`push`和`pop`都会阻塞, 所以需要两个条件变量:

~~~
template<typename T>
class bounded_blocking_queue : boost::noncopyable {
    boost::circular_buffer<T> m_queue;
    boost::condition_variable m_cond_not_full;
    boost::condition_variable m_cond_not_empty;
    mutable boost::mutex m_mutex;

public:
    bounded_blocking_queue(size_t max_size);
    void push(const T& val);
    bool try_push(const T& val);

    void pop(T& val);
    bool try_pop(const T& val);

    size_t size() const;
    size_t capacity() const
    bool empty() const;
    bool full() const;
};
~~~

通常可以用`boost::circular_buffer`作为底层容器. 所以`bounded_blocking_queue`实现也比较简单:


~~~

bounded_blocking_queue(size_t max_size) : m_queue(max_size) {}

void bounded_blocking_queue::push(const T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    while (m_queue.full()) {
        m_cond_not_full.wait(lk);
    }
    m_queue.push_back(val);
    m_cond_not_empty.notify_one();
}

bool bounded_blocking_queue::try_push(const T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    if (!m_queue.full()) {
        m_queue.push_back(val);
        m_cond_not_empty.notify_one();
        return true;
    }
    return false;
}

void bounded_blocking_queue::pop(T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    while (m_queue.empty()) {
        m_cond_not_empty.wait(lk);
    }
    val = m_queue.front();
    m_queue.pop_front();
    m_cond_not_full.notify_one();
}

bool bounded_blocking_queue::try_pop(const T& val) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    if (!m_queue.empty()) {
        val = m_queue.front();
        m_queue.pop_front();
        m_cond_not_full.notify_one();
        return true;
    }
    return false;

}

size_t bounded_blocking_queue::size() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.size();
}
size_t bounded_blocking_queue::capacity() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.capacity();
}
bool bounded_blocking_queue::empty() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.empty();
}
bool bounded_blocking_queue::full() const {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    return m_queue.full();
}

~~~

那几个const方法其实就`capacity()`是可靠的, 其他都只能得到调用瞬间的状态. 可以看出, bound_blocking_queue跟我们之前写的channel是差不多的, 除了没有select. 

## boost.sync_queue

sync_queue虽说本质上也是blocking queue, 但毕竟boost家出品, 接口和实现都复杂许多. 最大的区别在于, sync_queue它支持close.

close的时候, 所有阻塞的调用都会唤醒并返回, 所以各版本的push/pop方法都有返回值, 返回是真push/pop了, 还是close了, 还是try失败了. 这返回值得是个enum, 其声明如下:

~~~
// boost/thread/concurrent_queues/queue_op_status.hpp
enum queue_op_status {
    success = 0, 
    empty, 
    full, 
    closed, 
    busy, 
    timeout, 
    not_ready
};
~~~

boost里面确实有这么多, 虽然我并不打算讨论timeout.

然后我们声明一下接口:

~~~
template <typename T>
class sync_queue: public sync_queue_base<T> {
public:
    typedef T value_type;
    sync_queue();
    ~sync_queue();
public:
    void push(const value_type& x);
    queue_op_status try_push(const value_type& x);
    queue_op_status nonblocking_push(const value_type& x);
    queue_op_status wait_push(const value_type& x);
    // 我们愉快地忽略右值版本

    void pull(value_type& elem);
    value_type pull();
    queue_op_status try_pull(value_type& elem);
    queue_op_status nonblocking_pull(value_type& elem);
    queue_op_status wait_pull(value_type& elem);

};
~~~

有`queue_op_status`作为返回值的好说, 如果queue被关闭了也会返回. try_xx和nonblocking_xx的区别, 在于try_xx会获取保护数据的锁, nonblocking_xx则连锁都是try的. void返回值的那两个, 如果queue被关闭了, 则会抛异常.

`sync_queue_base`则提供了一些获取状态的接口, close, 以及数据成员:

~~~
template <typename T>
class sync_queue_base {
public:
    typedef T value_type;
    typedef std::queue<T> underlying_queue_type;
    typedef typename std::queue<T>::size_type size_type;

    sync_queue_base();
    ~sync_queue_base();

public:
    bool empty() const;
    bool full() const;
    size_type size() const;
    bool closed() const;
    void close();

protected:
    mutable boost::mutex m_mtx;
    boost::condition_variable m_cond_not_empty;
    underlying_queue_type m_data;
    bool m_closed;
};

~~~

boost中, `underlying_queue_type`实际上是通过模板参数决定的, 这里只是偷懒直接用了`std::queue`.

另外还有许多接受锁(`unique_lock`, `lock_guard`)为参数的保护成员, 这里方便起见, 只写`unique_lock`的版本:

~~~
template <typename T>
class sync_queue_base {
    // ...
protected:
    bool empty(boost::unique_lock<std::mutex>&) const {
        return m_data.empty();
    }
    size_type size(boost::unique_lock<std::mutex>&) const {
        return m_data.size();
    }
    bool closed(boost::unique_lock<std::mutex>&) const {
        return m_closed;
    }
    bool full(boost::unique_lock<std::mutex>&) const {
        return false;
    }

    // 有一些是给派生类准备的
    void throw_if_closed(boost::unique_lock<std::mutex>& lk) {
        if (closed(lk)) {
            BOOST_THROW_EXCEPTION( sync_queue_is_closed() );
        }
    }
    bool not_empty_or_closed(boost::unique_lock<std::mutex>& lk) {
        return !m_data.empty() || m_closed;
    }
    bool wait_until_not_empty_or_closed(boost::unique_lock<std::mutex>& lk) {
        while (empty(lk) && !closed(lk)) {
            m_cond_not_empty.wait(lk);
        }
        if (!empty(lk)) {
            return false; // success
        }
        return true; // closed;
    }
    void notify_not_empty_if_needed(boost::unique_lock<std::mutex>& lk) {
        m_cond_not_empty.notify_all();
    }
    // ...
};
~~~

其中`close`是要notify所有等待者的:

~~~
void close() {
    {
        boost::unique_lock<boost::mutex> lk(m_mtx);
        m_closed = true;
    }
    m_cond_not_empty.notify_all();
}
~~~

剩下的`bool empty() const`几个应该是很好写的, 这里不赘述. 

下面我们先来实现`push`:

~~~
template<typename T>
void sync_queue<T>::push(const T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx);
    sync_queue_base<T>::throw_if_closed(lk);
    push(elem, lk);
}

template<typename T>
void sync_queue<T>::push(const T& elem, boost::unique_lock<boost::mutex>& lk) {
    m_data.push_back(elem);
    sync_queue_base<T>::notify_not_empty_if_needed(lk);
}
~~~

如果发现closed了, 就抛异常, 否则入队, notify. 抛异常和notify都是基类`sync_queue_base`就写好的, 所以说简洁也简洁. 

`pull`也是这样的, 只是判断closed就抛异常:

~~~
template<typename T>
void sync_queue<T>::pull(T& elem) {
    boost::unique_lock<boost::mutex> lk(m_mtx);
    const bool has_been_closed = sync_queue_base<T>::wait_until_not_empty_or_closed(lk);
    if (has_beed_closed) {
        sync_queue_base<T>::throw_if_closed(lk);
    }
    pull(elem, lk);
}

template<typename T>
void sync_queue<T>::pull(T& elem, boost::unique_lock<boost::mutex>& lk) {
    elem = sync_queue_base<T>::m_data.front(); // 这里应该用move
    sync_queue_base<T>::m_data.pop_front();
}
}
~~~

`try_push`则需要返回status, 其实也只有`closed`和`success`两种而已:

~~~
template<typename T>
queue_op_status sync_queue<T>::try_push(const T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx);
    return try_push(elem, lk);
}

template<typename T>
queue_op_status sync_queue<T>::try_push(const T& elem, boost::unique_lock<boost::mutex>& lk) {
    if (sync_queue_base<T>::closed(lk)) {
        return queue_op_status::closed;
    }
    push(elem, lk);
    return queue_op_status::success;
}
~~~

`wait_push`跟`push`类似, 但close时会返回, 因为没有容量限制, 所以实际上不需要等待什么:

~~~
template<typename T>
queue_op_status sync_queue<T>::wait_push(const T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx);
    return wait_push(elem, lk);
}

template<typename T>
queue_op_status sync_queue<T>::wait_push(const T& elem, boost::unique_lock<boost::mutex>& lk) {
    if (sync_queue_base<T>::closed(lk)) {
        return queue_op_status::closed;
    }
    push(elem, lk);
}
~~~

`nonblocking_push`多一种状态, 就是`busy`, `busy`意味其他线程占用了锁, 所以`lk`构造时用了`try_to_lock`:

~~~
template<typename T>
queue_op_status sync_queue<T>::nonblocking_push(const T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx, boost::try_to_lock);
    if (!lk.owns_lock()) {
        return queue_op_status::busy;
    }
    return try_push(elem, lk);
}
~~~

类似地, `pull`系列也可以写出来, 但是`pull`是需要等待队列非空的, 所以复杂一些:

~~~
template<typename T>
queue_op_status sync_queue<T>::try_pull(T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx);
    return try_pull(elem, lk);
}

template<typename T>
queue_op_status sync_queue<T>::try_pull(T& elem, boost::unique_lock<boost::mutex>& lk) {
    if (sync_queue_base<T>::empty(lk)) {
        if (sync_queue_base<T>::closed(lk)) {
            return queue_op_status::closed;
        }
        return queue_op_status::empty;
    }
    pull(elem, lk);
    return queue_op_status::success;
}

template<typename T>
queue_op_status sync_queue<T>::nonblocking_pull(T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx, boost::try_to_lock);
    if (!lk.owns_lock()) {
        return queue_op_status::busy;
    }
    return try_pull(elem, lk);
}

template<typename T>
queue_op_status sync_queue<T>::wait_pull(T& elem) {
    boost::unique_lock<boost::mutex> lk(sync_queue_base<T>::m_mtx);
    return wait_pull(elem, lk);
}

template<typename T>
queue_op_status sync_queue<T>::wait_pull(T& elem, boost::unique_lock<boost::mutex>& lk) {
    const bool has_been_closed = sync_queue_base<T>::wait_until_not_empty_or_closed(lk);
    if (has_been_closed) {
        return queue_op_status::closed;
    }
    pull(elem, lk);
    return queue_op_status::success;
}

template<typename T>
sync_queue<T>::value_type sync_queue<T>::pull() {
    boost::unique_lock<boost::mutex> lk(m_mtx);
    const bool has_been_closed = sync_queue_base<T>::wait_until_not_empty_or_closed(lk);
    if (has_beed_closed) {
        sync_queue_base<T>::throw_if_closed(lk);
    }
}

template<typename T>
T sync_queue<T>::pull(boost::unique_lock<boost::mutex>& lk) {
    // 还是有move的时候才提供这个版本比较好
    typename T ret = std::move(sync_queue_base<T>::m_data.front()); 
    sync_queue_base<T>::m_data.pop_front();
    return ret;
}

~~~

`wait_pull`只能返回`closed`或`success`.

## boost.sync_bounded_queue

虽然说就是有界版本的sync_queue, 也是一个mutex, 两个condition_variable. 不过boost的`sync_bounded_queue`并没有使用`boost::circular_buffer`, 而是自己分配一块连续内存作环形队列. 

与`sync_queue`不同的是, 它有`shared_ptr`版本的pull, 其实现如下(需要移动) :

~~~
inline boost::shared_ptr<value_type> ptr_pull(unique_lock<mutex>& lk)
{
    boost::shared_ptr<value_type> res = 
        boost::make_shared<value_type>(boost::move(data_[out_]));
    out_ = inc(out_);
    notify_not_full_if_needed(lk);
    return res;
}
~~~

这里的xxx_if_needed是因为`sync_bounded_queue`记录了入队和等待出队数量. 

然而却没有`shared_ptr`版本的push, 好吧, 他们开心就好.

## 性能测试

为了对比我们之前写的channel, 我们这里用一下代码(传递一个`shared_ptr`)测量一下性能:

~~~
int test(const int concurrency) {
    const int num = 1000 * 1000;
    typedef boost::shared_ptr<int> data_type;
    blocking_queue<data_type> queue;
    boost::thread_group thg;

    const auto begin = boost::chrono::steady_clock::now();
    for (int tr = 0; tr < concurrency; ++tr) {
        thg.create_thread([&]() {
            data_type dat;
            for (int i = 0; i < num; ++i) {
                queue.wait_pull_front(dat);
            }
        });
    }
    for (int tr = 0; tr < concurrency; ++tr) {
        thg.create_thread([&]() {
            data_type dat(new int(42));
            for (int i = 0; i < num; ++i) {
                queue.wait_push_back(dat);
            }
        });
    }
    thg.join_all();
    const auto end = boost::chrono::steady_clock::now();
    return boost::chrono::duration_cast<boost::chrono::milliseconds>(end - begin).count();
}
~~~

`concurrency`表示起多少读写线程, `concurrency`等于1时, 一个读线程, 一个写线程. 得到以下结果, xxx(n)表示buffer size是n:


| (ms) | 1 | 2 | 4 | 6| 8 | 16 | 32 |
| --- | --- | --- | --- | --- | --- | --- |
| blocking queue | 149 | 282 | 606 | 842 | 1145 | 2355 | 4700 |
| sync_queue | 130 | 350 | 733 | 1109 | 1470 | 3056 | 6246 |
| channel(100) | 340 | 1484 | 5194 | 8812 | 12687 | - | - |
| bounded blocking queue(100) | 140 | 344 | 677 | 1038 | 1423 | 2902 | 6084 |
| boost.sync_bounded_queue(100)| 268 | 1467 | 3432 | 6556 | 11642 | - | - |
| channel(1000) | 198 | 460 | 1025 | 1602 | 2113 | 4743 | 10864 |
| bounded blocking queue(1000) | 178 | 326 | 664 | 993 | 1351 | 2836 | 5894 |
| boost.sync_bounded_queue(1000) | 120 | 431 | 826 | 1463 | 2465 | 9696 | - |
| channel(10000) | 152 | 343 | 677 | 1013 | 1372 | 2740 | 5591 |
| bounded blocking queue(10000) | 155 | 308 | 672 | 1039 | 1393 | 2896 | 5831 |
| boost.sync_bounded_queue(10000) | 98 | 284 | 580 | 798 | 1152 | 3006 | 19308 |

测试平台: VS 2017, Intel i3 7100(双核四线程, 请原谅我如此贫穷), Windows 10, 开优化, 50次取平均.

可以看到, buffer size比较小的时候, channel和boost.sync_bounded_queue的性能明显不及其他, 但buffer大了以后, 差距就不明显了

## 总结

Blocking Queue是我们经常使用的线程安全数据结构, 比如放线程池里做任务队列. 它的实现也可以很简单, 如上所述. boost的`sync_queue`和`sync_bounded_queue`就是Blocking Queue和Bounded Blocking Queue的实现, 虽然boost里面看着一堆代码, 实际上还是经典的实现, 没什么黑科技, 就是重载多而已(boost1.68). 也可以实现成入队出队分别加锁, 性能会好一些[3];

**Reference:**  

* {:.ref} \[1] 陈硕, *Linux多线程服务端编程: 使用muduo C++网络库*. 北京, 电子工业出版社, 2013, p64  
* {:.ref} \[2] boost, [Executors and Schedulers -- EXPERIMENTAL](https://www.boost.org/doc/libs/1_69_0/doc/html/thread/synchronization.html#thread.synchronization.executors), 1.69.0 
* {:.ref} \[3] Anthony Williams, *C++并发编程实战*. 北京, 人民邮电出版社, 2015, p149~p160  