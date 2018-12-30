---
layout: post
title: C++并发型模式#3&#58; 被"抛弃"的同步模型 - 信号量Semaphores
description: 无论哪本操作系统教材, 都会花大篇幅讲述基于信号量的同步模型, 但是boost乃至C++11的线程库都没有提供这个组件, 这是为什么呢?
category: blog
---

## 定义信号量

信号量是E.W.Dijkstra在1965年提出的一种方法<del>没错, 就是那个最短路径算法的Dijkstra, 银行家算法的Dijkstra, "goto必须死"的Dijkstra</del>.

一个信号量有一个整数`count`和两个操作"P"和"V"组成:

* "P"操作检查信号量的`count`是否大于0, 若大于0, 这将`count`减1, 并继续; 若`count`为0, 则进程睡眠, 而且此时"P"操作仍未完成, 待该进程被"V"操作唤醒, "P"才算完成.

* "V"操作将`count`加1, 如果一个或多个进程在该信号量上睡眠, 则唤醒其中一个.

* "P"和"V"操作都是原子的, 不可分割, 故也称为"PV"原语.

以上描述对线程也是适用的, 下面我们也在线程语境下讨论.

P和V是荷兰语Proberen(测试)和Verhogen(增加)的首字母, 看着比较眼生, 方便起见, 我们定义信号量Semaphore的接口时用count_down_and_wait表示"P", increase_and_notify表示"V":

~~~

class semaphore {
public:
    semaphore(unsigned int limit, unsigned int count); 
    void count_down_and_wait();
    void increase_and_notify();    
}

~~~

特别的, limit等于1的信号量保证了只有一个线程能进入临界区, 这种信号量被称为binary semaphore, 跟mutex是等价的, 我们可以用semaphore定于出mutex来:

~~~
class mutex {
public:
    mutex() : m_sem(1, 1) { }
    void lock() {
        m_sem.count_down_and_wait();
    }
    void unlock() {
        m_sem.increase_and_notify();
    }
private:
    semaphore m_sem;
}
~~~

当然, 这里的mutex跟我们用的std::mutex或boost::mutex语义上虽然很接近, 但是std::mutex和boost::mutex基于的pthread要求加锁和解锁是同一个线程(解铃还须系铃人), 而信号量没有这个要求.

## 生产者-消费者问题

假设你有一群生产者线程, 一群消费者线程, 一个大小为N的缓冲区, 生产者将生产的产品放入缓冲区, 消费者则从缓冲区取走产品. 自然我们无法从空的缓冲区取走产品, 也无法向满的缓冲区放入产品, 所以我们得想一个同步方法. 

经典地, 我们可以用信号量来解决生产者-消费者问题:

~~~
static const int N = 100;                       // 缓冲区的最大槽数目
mutex g_mtx;                                    // 互斥锁, 用于保护缓冲区的读写
semaphore g_sem_slot(N, N);                     // 表示可用槽的数目, 初始为N
semaphore g_sem_product(N, 0);                  // 表示可用产品数目, 初始为0

class production;

void producer() {
    production item;
    while (true) {
        item = produce_item();
        g_sem_slot.count_down_and_wait();        // 先将空槽减1
        g_mtx.lock();                            // 再获取互斥锁, 进入临界区
        insert_item(item);                       // 将产品放入缓冲区
        g_mtx.unlock();                          // 解锁互斥锁, 离开临界区 
        g_sem_product.increase_and_notify();     // 将可用产品数目加1, 唤醒正在等待的consumer
    }    
}

void consumer() {
    production item;
    while (true) {
        g_sem_product.count_down_and_wait();      // 先将可用产品数目减1
        g_mtx.lock();                             // 然后获取互斥锁, 进入临界区
        item = remove_item();                     // 从缓冲区取出产品
        g_mtx.unlock();                           // 解锁互斥锁, 离开临界区
        g_sem_slot.increase_and_notify();         // 将可用槽的数目加1
        consume_item(item);                       // 实际处理产品
    }
}
~~~

这里的mutex也是上文中用semaphore实现的mutex, 所以单用信号量就能解决生产者-消费者问题了, 甚至会觉得, 这种写法足够优雅, 以至于让我用条件变量来做这个问题的话, 我会先用条件变量实现一个semaphore, 然后再用semaphore来做...

## 用条件变量实现信号量

boost和C++11没有提供semaphore组件, C++20也没听说有提案, 个中原因我们稍后再述. 

上面说到, semaphore解决生产者-消费者问题是如此优雅, 如果boost和C++11有mutex和condition_variable来解决会怎么样呢? 首先你得有两个condition_variale来notify生产者和消费者从睡眠中恢复, 也得有两个count来记录空槽数目和产品数目, 还得有两个mutex来保护这两个count. 问题确实能解决, 但总感觉不甚优雅. <del>好吧, 其实实现一个线程安全的cycle_buffer把细节藏起来的话, 也很优雅的</del>

既然说condition_bariable加count加mutex可以达到semaphore的效果, 那么我们能不能就用这些来实现一个semaphore呢? 从语义上看是可以的:

~~~
#include <boost/thread/condition_variable.hpp>
#include <boost/thread/mutex.hpp>
#include <boost/thread/lock_guard.hpp>


class semaphore {
public:
    semaphore(unsigned int limit, unsigned int count) :
        m_limit(limit), m_count(count) {
        assert(m_limit >= m_count);
    }

    void count_down_and_wait() {
        boost::unique_lock<boost::mutex> lock(m_mutex);
        while (!m_count) { // 处理spurious wake-ups
            m_cond.wait(lock);
        }
        --m_count;
    }
    void increase_and_notify() {
        boost::unique_lock<boost::mutex> lock(m_mutex);
        ++m_count;
        if (m_count > m_limit) {
            m_count = m_limit;
        }
        m_cond.notify_one();

    }
    bool try_count_down() {
        boost::unique_lock<boost::mutex> lock(m_mutex);
        if (m_count) {
            --m_count;
            return true;
        }
        return false;
    }
    

private:
    boost::mutex m_mutex;
    boost::condition_variable m_cond;
    unsigned int m_count;
    unsigned int m_limit;
};
~~~

`m_limit`的作用是, 即使过多地调用`increase_and_notify`, 也不会让`m_count`继续增加. 这使得用semaphore实现的mutex无论unlock多少次, 也只能有一个线程lock. 

`try_count_down`也算是比较重要的接口, 某些死锁避免的算法中非常依赖mutex的try_lock, semaphore也是这个道理, pthread的接口同样有`sem_trywait`.

## 用信号量实现条件变量

既然我们可以用mutex加condition_variable来实现semaphore, 而mutex我们上面已经用semaphore实现过, 那么, 很自然地会想到, 能不能用semaphore来实现condition_variable呢? 毕竟semaphore也是有等待和唤醒的行为的.

condition_variable应该是Brinch Hansen(1973)和Hoare(1974)提出管程(Monitor)时引入的. Hoare证明了管程和信号量是等价的. 我感觉管程和mutex加condition_variable差不多, 所以我觉得, 信号量模型和mutex/condition_variable模型应该是等价.

虽然没有去找形式上的证明, 但是找到了前人用信号量实现condition_variable的努力. 文献[3]中用信号量实现了一个语义上没毛病, 但是性能不太理想的condition_variable. 下面我们再讲一遍这个故事. 

前方tricky警告, 前方tricky警告, 前方tricky警告!

也许你会觉得, 不就是`wait`的时候调`count_down_and_wait`, notify的时候调`increase_and_notify`, 需要什么tricky的东西? 道理确实是这样, 但解决完一些这样那样的问题之后...反正我觉得挺tricky的, 我们先从最符合直觉的版本开始, 看看有什么这样那样的问题.

~~~
class condition_variable {
public:
    condition_variable() : m_sem(1, 0) {}

public:
    void wait(mutex& mtx) {
        mtx.unlock();
        // (1)
        m_sem.count_down_and_wait();
        mtx.lock();
    }

    void notify() {
        m_sem.increase_and_notify();
    }
private:
    semaphore m_sem;
};
~~~

虽然很符合直觉, 但这个实现有个问题.  比如, 某时刻, 没有其他线程在等待, 某个线程调了`notify()`, 将`m_sem.m_count`设为1, 此时线程A调了`wait(...)`, 会发现`m_sem.m_count`是1, 径直过去了. 

wait受到了之前的nofity的影响, 这可不符合condition_variable的语义, 但这个问题倒是好解决, 我们可以加一个计数, 只有计数不为0的时候, `notify`才调`increase_and_notify()`, 而且我们也可以据此实现`notify_all`. 我们将这个计数称为`m_waiter_count`, 并用`m_mutex`保护之:

~~~
class condition_variable {
public:
    condition_variable() 
        : m_sem(1, 0), m_waiter_count(0) {}

public:
    void wait(mutex& mtx) {
        m_mutex.lock(); { 
            m_waiter_count++;
        } m_mutex.unlock();

        mtx.unlock();
        // (1)
        m_sem.count_down_and_wait();
        mtx.lock();
    }

    void notify() {
        m_mutex.lock(); {
            if (m_waiter_count > 0) {
                m_sem.increase_and_notify();
            }
        } m_mutex.unlock();
    }

    void notify_all() {
        m_mutex.lock(); {
            while (m_waiter_count > 0) {
                m_waiter_count--;
                m_sem.increase_and_notify();
            }
        } m_mutex.unlock();
    }
private:
    semaphore m_sem;
    int m_waiter_count;
    mutex m_mutex;
};
~~~

看起来似乎挺好的, 然而进度条已经出卖了一切, 事情没有这么简单, 这个实现还是有问题.

考虑有5个线程调了wait, 然后执行到了(1)处, 调度挂起, 此时`m_waiter_count`为5; 随即, 第6个线程`notify_all`了, `m_sem`确实`increase_and_notify()`了5次, 然而`m_sem`最大才1, 那5个线程调度回来继续执行的时候, 只需一个线程`count_down_and_wait`就降回0了, 其他4个线程还会等着.

也许我们可以把limit设大一点, 最大整数什么的, 相对于线程数来说就是无穷大了, 这样`notify_all`的时候, `m_sem`的值为5, 顺利的话, 那5个线程确实可以通过.

但是事情总是不顺利, 假如那5个线程调度回来之前, 第7个线程调了wait, 把`m_sem`的值减了1, 那个5个线程中就会有一个线程就此等待了, 这又不符合condition_variable的语义了.

要解决这个问题, 我们需要`notify_all`期间, 正在wait的线程可以唤醒或径直通过, 而其他调用wait的线程不参与此次`notify_all`. 最简单的方式就是, `notify_all`会等待正在wait的线程通过. `notify_all`能够等, 而线程通过能告诉`notify_all`说有线程已经通过了...另一个信号量呼之欲出! 对, 我们可以再加一个信号量:

~~~
class condition_variable {
public:
    condition_variable() 
        : m_sem(INT_MAX, 0), m_sem_passed(INT_MAX, 0), m_waiter_count(0) {}

public:
    void wait(mutex& mtx) {
        {
            m_mutex.lock();
            m_waiter_count++;
            m_mutex.unlock();
        }
        mtx.unlock();
        // (1)
        m_sem.count_down_and_wait();
        m_sem_passed.increase_and_notify();
        mtx.lock();
    }

    void notify() {
        m_mutex.lock();
        if (m_waiter_count > 0) {
            m_sem.increase_and_notify();
            m_sem_passed.count_down_and_wait();
        }
        m_mutex.unlock();
    }

    void notify_all() {
        m_mutex.lock();
        for (int i = 0; i < m_waiter_count; ++i) {
            m_sem.increase_and_notify();
        }
        while (m_waiter_count > 0) {
            m_waiter_count--;
            m_sem_passed.count_down_and_wait();
        }
        m_mutex.unlock();
    }
private:
    semaphore m_sem;
    semaphore m_sem_passed;
    int m_waiter_count;
    mutex m_mutex;
};
~~~

因为`notify_all`占据着`m_mutex`, 正在`notify_all`的时候, 其他线程进了wait就只能等`m_mutex`, 而不会跟正在(1)处或者`m_sem.count_down_and_wait()`的线程抢信号量.

这个实现虽然语义上终于没问题了, 但是看起来就比我们预想的要重量级得多. 而且, 每次notify都得切换两次上下文, 这代价确实有点高.

我们已经很靠近真相了, 为了解决这个两次上下文的问题, 我们的notify_all不能依赖一个两个semaphore, 那么, 我们能不能每个等待的线程都在等各自的semaphore? 这意味着, 我们的线程进入`wait`的时候, 创建一个自己的semaphore, 放入condition_variable的等待队列中, 然后等待这个semaphore; `notify`则从队列中取出一个semaphore来`increase_and_notify()`:

~~~

class condition_variable {
public:
    condition_variable() {}

public:
    typedef semaphore waiter;
    void wait(mutex& mtx) {
        semaphore* waiter = new semaphore(1, 0);
        assert(waiter);

        m_mutex.lock();
        m_waiters.push(waiter);
        m_mutex.unlock();

        mtx.unlock();
        waiter->count_down_and_wait();
        mtx.lock();

        delete waiter;
    }

    void notify() {
        m_mutex.lock();
        if (!m_waiters.empty()) {
            semaphore* waiter = m_waiters.front();
            assert(waiter);
            m_waiters.pop();
            waiter->increase_and_notify();
        }
        m_mutex.unlock();
    }

    void notify_all() {
        m_mutex.lock();
        while (!m_waiters.empty()) {
            semaphore* waiter = m_waiters.front();
            assert(waiter);
            m_waiters.pop();
            waiter->increase_and_notify();
        }
        m_mutex.unlock();
    }
private:
    std::queue<semaphore*> m_waiters;
    mutex m_mutex;
};
~~~

因为队列是有mutex保护的, notify_all的时候其他线程的wait无法入队, 所以不会抢走正在等待线程的信号. 这个版本的性能比上一个版本好得多, 但是wait结束重新获取mtx时又会再次阻塞, 所以性能还是比不上系统内置或虚拟机内置的实现.

经过了漫长的讨论, 我们用semaphore实现了mutex和condition_variable. 两种模型等价的说法应该没问题, 那么, 为什么boost和C++11都没有semaphore呢?

## 被"抛弃"的信号量

我们翻看boost.thread的历史[4], 我们会发现

> 10. Why has class semaphore disappeared?  
> Semaphore was removed as too error prone. The same effect can be achieved with greater safety by the combination of a mutex and a condition variable. Dijkstra (the semaphore's inventor), Hoare, and Brinch Hansen all depreciated semaphores and advocated more structured alternatives. In a 1969 letter to Brinch Hansen, Wirth said "semaphores ... are not suitable for higher level languages." [Andrews-83] summarizes typical errors as "omitting a P or a V, or accidentally coding a P on one semaphore and a V on on another", forgetting to include all references to shared objects in critical sections, and confusion caused by using the same primitive for "both condition synchronization and mutual exclusion".

其实什么PV调错对象啦, P了忘记V啦, 共享数据的访问代码忘记放在临界区啦, 都是小问题, 这里参考的文献[2]是1983年的, 那会C++还不知道在哪呢? 更别说RAII这个idioms. 但是因为semaphore同时具备了互斥和条件同步的语义, 就是说, semaphore同时具有了mutex和condition_variable的功能, 这使得人们使用semaphore的时候很难区分某个semaphore是用来互斥的, 还是用来同步的.

而大部分情况下, semaphore都是用来互斥的, 而一个binary semaphore可以另一个线程加锁, 在另一个线程解锁的行为, 很容易导致错误. mutex则规定了在哪个线程加锁, 就得在哪个线程解锁, 否则未定义行为, 用错就挂, 至少容易发现错误. 这使得linux kernel也大范围弃用semaphore[6].

而条件同步, 完成通知等唤醒操作, 则有condition_variable等组件可以提供, 这样写出来的代码是比较简单的, 但如果用semaphore来做条件同步, 你看看上面我们实现condition_variable的种种问题, 想写对真是不容易.

所以C++11弃用semaphore也不无道理, 而且用mutex+condition_variable很容易实现一个semaphore, 反过来却困难得多; 

## 总结

mutex+condition_variable与semaphore有同等表达能力, 甚至能相互实现, 完全可以替代对方, 但是semaphore同时具备了互斥和同步的作用, 更难使用, 更容易出错, 所以人们不建议使用了, C++干脆不提供组件了.

**Reference:**  

* {:.ref} \[1]  Andrew S. Tanenbaum. 陈向群, 马洪兵等译. 现代操作系统(第三版). 机械工业出版社. 2012. p72~p74
* {:.ref} \[2]  Gregory R. Andrews, Fred B. Schneider, [Concepts and Notations for Concurrent Programming](http://babel.ls.fi.upm.es/teaching/concurrencia/material/concepts_and_notations.pdf), ACM Computing Surveys, Vol. 15, No. 1, March, 1983. 
* {:.ref} \[3]  Andrew D. Birrell, [Implementing Condition Variables with Semaphores](https://birrell.org/andrew/papers/ImplementingCVs.pdf). Jane. 2003.  
* {:.ref} \[4]  William E. Kempf. [Boost.Threads - FAQs #10: Why has class semaphore disappeared?](https://www.boost.org/doc/libs/1_31_0/libs/thread/doc/faq.html#question10). July, 2003  
* {:.ref} \[5]  Maxim Egorushkin. [stackoverflow - C++0x has no semaphores? How to synchronize threads?](https://stackoverflow.com/questions/4792449/c0x-has-no-semaphores-how-to-synchronize-threads#answer-4793662)  
* {:.ref} \[6]  corbet. [Goodbye semaphores?](https://lwn.net/Articles/166195/). Jan. 2006.  

