---
layout: post
title: C++并发型模式#14&#58; 负载均衡 - work stealing
description: 为了减少线程池的工作线程在任务队列上的竞争, 人们给每一个工作对象创建任务队列, 然而这却可能导致工作线程的任务负载失衡, 工作窃取是解决这个问题的常见方法.
category: blog
---

## Introduction

Work stealing 通常翻译为工作窃取, 也有翻译为工作密取, 是指工作线程本身的任务队列为空时, 从其他工作线程的任务队列从窃取任务来执行.

在fork/join篇中, 我们提到, 假如我们要线程池做一些比较大的任务, 做的过程中会把这个人物分割为多个较小的任务(较小的任务也可能分割成更小的任务), 为了减少工作线程对公共任务队列的竞争, 我们让每个工作线程持有一个任务队列, 自己做任务时分割出来的小任务就放到自己的工作队列中. 

但是这样会存在一个问题, 初始的任务有大有小, 有的工作线程自己的任务做完了, 其他线程还在忙碌, 从而产生负载不均衡的问题. 为了解决这个问题, 人们发明了工作窃取算法, 这个算法的核心很简单, 就是当前工作线程的任务队列为空时, 去其他还有任务的工作线程的任务队列取一个(或多个)任务回来.

![Work Stealing](/images/work_stealing.png)

## Design and Behavior

为了实现一个工作窃取的线程池, 我们需要解决以下问题:

- 需要一个公共队列吗
- 为什么需要双端队列
- 从哪个任务队列窃取
- 一次窃取多少个任务
- 什么时候唤醒

### 需要一个公共队列吗?

外部任务提交进公共队列还是直接散列到工作线程的任务队列主要看需求, 从竞争激烈程度来看, 散列的竞争应该比公共队列少. 但是如果散列的话, 窃取从队尾取任务, 可能导致后进的任务反而先完成, 不符合整个线程池先进先出的预期. java的`ForkJoinPool`是有公共队列的, 所以这里我们也使用公共队列缓存外部提交的任务.

### 为什么使用双端队列?

在fork/join篇中我们已经了解过"per-thead deque"的方案, 即每个工作线程有独立的任务队列. 为什么使用双端队列, 我们需要从两个方面来分析.

一方面, 我们两端都需要提交任务. 如果用散列的话, 我们就需要从外部提交到任务队列队尾(先进先出). 而fork/join提交子任务是提交到队首的(后进先出).

另一方面, 我们两端都需要取任务. 队首不用说, 工作线程是从队首取任务的. 工作窃取一般是从队尾窃取任务的, 因为双端队列两端可以分别被两个锁保护, 减少竞争. 而且fork/join情况下, 队尾的任务更大, 我们倾向于窃取大的任务. 

### 从哪个任务队列窃取?

提交时就散列到各任务队列的话这个问题很好回答, 那就是随机选一个, 然后从这个开始遍历其他.

有公共队列的情况需要特别考虑, 就是, 我们先窃取其他队列的, 还是先从公共队列取? 先从公共队列取很符合自觉, 但实际上不符合整个线程池先进先出的预期, 因为其他任务队列的任务必定的先进任务分割出来的. 但是如果先窃取, 那窃取的频率又会大幅上升, 可能每次都需要遍历一遍其他工作队列以搜索可窃取的任务, 这可能要加锁解锁很多次.  java的`ForkJoinPool` 是先窃取的, 所以这里我们也采用先窃取的方案.

### 一次窃取多少个任务?

一次窃取多少个任务主要是考虑锁的竞争, 每次窃取一个, 窃取很多次就可能有很多次锁竞争. 一次窃取多个又可能窃取者自己又做不完了要等别人窃取了, 毕竟队尾的任务比较大. java的`ForkJoinPool`是一次窃取一个的. 但笔者也用过一次窃取多个的实现, 不过这个实现并不是用于fork/join的, 而是大量提交任务, 提交时散列到各个队列的, 这时候我们可以假设每个任务差不多大, 所以可以按一定比例窃取. 我们这里是fork/join篇的续篇, 所以还是考虑fork/join的场景下任务大小比较不一的情况, 每次窃取一个.

### 什么时候唤醒?

没有任务的时候工作线程需要进入阻塞等待, 问题是什么时候唤醒呢? 主要考虑两点,窃取的时候和fork的时候. 

很自然我们说唤醒是唤醒一个而不是多个. 窃取的时候发现队列里面有好多任务, 那肯定是要唤醒的, 但如果任务队列就剩一个任务了, 那还要唤醒吗? 从java的`ForkJoinPool`的实现看确实是要唤醒的, 毕竟不能眼见着有任务却不去执行.

工作线程fork了子任务, 考虑到fork之后通常是要join的, 我们得留一个任务给join的时候`try_execute_one`, 所以fork的时候应该是任务队列有多于1个任务的时候唤醒. 

## Basic Implementation

### blocking_deque

为了实现工作窃取线程池, 我们首先得有一个线程安全双端队列, 我们可以叫它`sync_deque`或`blocking_deque`, 其接口如下:

~~~c++
template<typename T>
class blocking_deque : boost::noncopyable {
public:
    blocking_deque();
    queue_op_status push_back(const T& val);
    queue_op_status pop_back(T& val);
    queue_op_status try_pop_back(T& val);
    queue_op_status push_front(const T& val);
    queue_op_status pop_front(T& val);
    queue_op_status try_pop_front(T& val);
    size_t size() const;
    bool empty() const;
    bool closed() const;
    void close(); 
};
~~~

我们可以简单地模仿阻塞队列blocking queue实现, 这里不赘述.

### 接口与成员

我们这里继续使用`boost::function<void()>`作为task, 参考上一篇fork/join中的讨论, 我们需要为`work_stealing_thead_pool`提供`submit_front`和`submit_back`接口, 其中`submit_front`是给`fork`函数用的.

~~~c++
class work_stealing_thread_pool : boost::noncopyable {
public:
    work_stealing_thread_pool();
    ~work_stealing_thread_pool();
public:
    void close();
    bool closed();
    void join();
    void submit(const work& w);
    void submit_front(const work& w);
    void submit_back(const work& w);
    bool try_executing_one();
    template<typename Pred>
    bool reschedule_until(const Pred& pred);
};
~~~

因为每个工作线程都有一个任务队列, 我们可以用`std::vector`存线程对象和任务队列, 另外我们希望`submit_front`的时候如果是工作线程提交的, 应该提交到工作线程对应的工作队列去, 所以还得有个map去保存线程id到vector索引, 于是我们有以下数据成员:

~~~c++
class work_stealing_thread_pool : boost::noncopyable {
    typedef blocking_deque<work> taskq_t;
    typedef boost::shared_ptr<taskq_t> taskq_ptr;
    std::vector<boost::thread> m_threads;
    boost::unordered_map<boost::thread::id, size_t> m_thm;
    taskq_ptr m_comm_q;
    std::vector<taskq_ptr> m_perth_q;
    boost::mutex m_mtx;
    boost::condition_variable m_cond;
    // ...
};
~~~

这里的`m_mtx`和`m_cond`可能会引人迷惑, 这里有什么需要保护吗? 其实没有, `blocking_deque`是线程安全的, 而运行过程中我们不会去改变这些vector和map. 这里放一个条件变量是因为`work_stealing_thread_pool`从任务队列取任务的操作不能是阻塞的, 详细原因我们后面再讲, 但因为取任务非阻塞, 所有队列为空的时候, 工作线程应该如何进入休眠又如何被唤醒是个问题, 所以这里给了个条件变量, 让工作线程可以在这个条件变量上wait.

理清数据成员后, 我们可以写出构造函数:

~~~c++
work_stealing_thread_pool(size_t thread_count = boost::thread::hardware_concurrency() + 1) {
    try {
        m_comm_q.reset(new taskq_t());
        std::srand(std::time(NULL));
        for (size_t i = 0; i < thread_count; ++i) {
            m_perth_q.emplace_back(new taskq_t());
            m_threads.emplace_back(boost::bind(&work_stealing_thread_pool::worker_thread, boost::ref(*this), i));
            m_thm[m_threads.back().get_id()] = i;
        }
    }
    catch (...) {
        close();
        throw;
    }
}
~~~

需要注意的是, 因为之后窃取时需要访问其他工作队列, 所以我们`worker_thread`函数会接受线程池的指针`this`以及当前工作线程的索引`i`.

### 工作线程执行体

~~~c++
static void worker_thread(work_stealing_thread_pool& self, size_t current_thread_idx) {
    try {
        for (;;) {
            work task;
            try { 
                // 1. try execute one
                if (self.try_executing_one(current_thread_idx)) {
                    continue;
                }
                // 2. check closed
                if (self.all_closed() && self.all_empty()) {
                    return;
                }
                // 3. wait for task
                boost::unique_lock<boost::mutex> lk(self.m_mtx);
                self.m_cond.wait(lk);

            }
            catch (boost::thread_interrupted&) {
                return;
            }
        } // for
    }
    catch (...) {
        std::terminate();
        return;
    }
}
~~~

`worker_thead`是比较核心的函数, 与普通线程池每轮循环会阻塞在任务队列上不同, work stealing取任务是非阻塞的, 其有三个步骤:

1. 取任务, 包括尝试从当前工作线程的任务队列取, 尝试窃取其他任务队列的任务, 以及尝试从公共队列取, 因为之后我们还需要实现`try_executing_one()`, 我们将其提取到了`try_executing_one(size_t current_thread_idx)`.
2. 检查是否可以退出, 退出条件有两个, 一是队列全部关闭, 二是队列全部清空
3. 如果我们没拿到任务, 也不符合退出条件, 只好进入阻塞等待

我们先来实现`try_executing_one(size_t current_thread_idx)`:

~~~c++
bool try_executing_one(size_t current_thread_idx) {
    work task;
    auto& local_q = m_perth_q[current_thread_idx];
    // 1. try local_q first
    auto st = local_q->try_pop_front(task);
    if (st == queue_op_status::success) {
        task();
        return true;
    }
    // 2. try steal others
    st = try_steal_one(current_thread_idx, task);
    if (st == queue_op_status::success) {
        task();
        return true;
    }
    // 3. try comm_q
    st = m_comm_q->try_pop_front(task);
    if (st == queue_op_status::success) {
        task();
        return true;
    }
    return false;
}
~~~

在这个函数中我们要实现我们上一章节曾讨论的先考虑窃取后考虑公共队列. 另外我们可以看到取任务非阻塞的理由, 因为如果在某一步阻塞了, 就无法进行下一步尝试.

### 窃取

窃取函数`try_steal_one`需要注意两点, 一是随机窃取, 二是窃取的队列如果还有任务, 则应该notify其他可能正在阻塞的工作线程:

~~~c++
queue_op_status try_steal_one(size_t skip_index, work& w) {
    size_t offset = std::rand() % m_perth_q.size();
    for (size_t i = 0; i < m_perth_q.size(); ++i) {
        size_t idx = (i + offset) % m_perth_q.size();
        if (idx == skip_index) {
            continue;
        }
        auto& q = m_perth_q[idx];
        queue_op_status st = q->try_pop_front(w);
        if (st == queue_op_status::success) {
            if (q->size() > 0) {
                m_cond.notify_one();
            }
            return st;
        }
    }
    return queue_op_status::empty;
}
~~~

然后我们补充一下`all_closed`和`all_empty`, `worker_thread`就算完成了:

~~~c++
bool all_closed() const {
    if (!m_comm_q->closed()) {
        return false;
    }
    for (auto& q : m_perth_q) {
        if (!q->closed()) {
            return false;
        }
    }
    return true;
}
bool all_empty() const {
    if (!m_comm_q->empty()) {
        return false;
    }
    for (auto& q : m_perth_q) {
        if (!q->empty()) {
            return false;
        }
    }
    return true;
}
~~~

### reschedule_until

`reschedule_until`也会发生窃取, 所以要调用我们刚刚实现`try_executing_one(size_t current_thread_idx)`, 但因为`reschedule_until`不一定发生在工作线程, 所以我们还得写一个`try_executing_one()`进行适配:

~~~c++
template<typename Pred>
bool reschedule_until(const Pred& pred) {
    do {
        if (!try_executing_one()) {
            return false;
        }
    } while (!pred());
    return true;
}

bool try_executing_one() {
    try {
        auto id = boost::this_thread::get_id();
        auto it = m_thm.find(id);
        // 1. worker thread, try execute its task
        if (it != m_thm.end()) {
            size_t idx = it->second;
            return try_executing_one(idx);
        } else {
            // 2. main thread or other, try execute comm task
            work task;
            if (m_comm_q->try_pop_front(task) == queue_op_status::success) {
                task();
                return true;
            } else {
                // 3. no task in comm, random try execute one
                size_t idx = std::rand() % m_perth_q.size();
                return try_executing_one(idx);
            }
        }
    }
    catch (...) {
        std::terminate();
    }
    
}
~~~

在这个`try_executing_one()`中, 我们首先检查当前线程是否工作线程, 如果是就走`try_executing_one(idx)`把该尝试的都尝试一遍; 如果不是工作线程, 比如主线程什么的, 就先尝试公共队列, 没有任务在随机一个idx, 再走`try_executing_one(idx)`.

### 任务提交

任务提交时, 首先我们得查看提交者是否是工作线程, 如果是, 则提交到工作线程的任务队列, 否则提交到公共队列, 无论哪种, 都应该`notify_one`.

也许有人会有疑问, 工作线程提交到自己的任务队列, 是否应该`notify_one`? 被其他工作线程取走了不是cache不友好吗? 这是个好问题, 我们可以考虑工作线程提交子任务之后不一定立刻开始等待, 也许还会做其他事情, 所以为了子任务及时处理, 还是唤醒其他工作线程比较好. 我们也可以考虑提价子任务后立刻进入等待, 我们应该留一个任务去`reschedule_until`. 这两种方案都可以, 但我们上面章节有提到Java的实现是留了一个任务, 这里我们也留一个任务:

~~~c++
void submit(const work& w) {
    m_comm_q->push_back(w);
    m_cond.notify_one();
}
void submit_front(const work& w) {
    auto id = boost::this_thread::get_id();
    auto it = m_thm.find(id);
    if (it != m_thm.end()) {
        size_t idx = it->second;
        m_perth_q[idx]->push_front(w);
        if (m_perth_q[idx]->size() > 1) {
            m_cond.notify_one();
        }
    } else {
        m_comm_q->push_front(w);
        m_cond.notify_one();
    }
    

}

void submit_back(const work& w) {
    auto id = boost::this_thread::get_id();
    auto it = m_thm.find(id);
    if (it != m_thm.end()) {
        size_t idx = it->second;
        m_perth_q[idx]->push_back(w);
        if (m_perth_q[idx]->size() > 1) {
            m_cond.notify_one();
        }
    } else {
        m_comm_q->push_back(w);
        m_cond.notify_one();
    }
}
~~~

至此, `work_stealing_thread_pool`的核心函数均已实现, 其他必要函数留作练习.

### 实验

参考fork/join篇的例子, 为了在GCC7.3中编译做了一些修改:

~~~c++

#define BOOST_THREAD_PROVIDES_FUTURE
#include "blocking_deque.h"
#include "work_stealing_thread_pool.h"

#include <iostream>
#include <memory>
#include <type_traits>
#include <boost/thread.hpp>
#include <boost/thread/future.hpp>

template<typename T, typename F, typename Ex>
boost::future<T> fork(Ex& ex, F&& func) {
    std::shared_ptr<boost::promise<T>> pr(new boost::promise<T>());
    boost::future<T> ft = pr->get_future();
    auto task = [pr, f=std::move(func)] () {
        try {
            pr->set_value(f());
        } catch (std::exception& e) {
            pr->set_exception(e);
        }
    };
    ex.submit_front(task);
    return ft;
}

template<typename Ex>
int fib(Ex& ex, int n) {
    if (n == 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = fork<int>(ex, boost::bind(fib<Ex>, boost::ref(ex), n-1));
        boost::future<int> f2 = fork<int>(ex, boost::bind(fib<Ex>, boost::ref(ex), n-2));
        ex.reschedule_until([&]()->bool{
            return f1.is_ready() && f2.is_ready();
        });
        return f1.get() + f2.get();
    }
}

int main() {
    work_stealing_thread_pool pool;
    int ret = fib(pool, 32);
    std::cout << ret << std::endl;
    pool.close();
    pool.join();
    return 0;
}
~~~

## 总结

本文讨论了work stealing thread pool的实现, 参考java, 我们实现了以下特性:

- 有公共队列
- 任务队列都是双端队列
- 先从其他工作线程的任务队列窃取
- 一次窃取1个任务
- 提交任务和窃取的时候都可能唤醒睡眠的工作线程

**Reference:**  

- {:.ref} \[1] Robert D. Blumofe , Charles E. Leiserson, [Scheduling Multithreaded Computations by Work Stealing](https://www.csd.uwo.ca/~mmorenom/CS433-CS9624/Resources/Scheduling_multithreaded_computations_by_work_stealing.pdf), Journal of the ACM, Vol. 46, No.5, Spet. 1999, pp. 720-748
- {:.ref} \[2] houbb, [JCIP-39-Fork/Join 框架、工作窃取算法](https://houbb.github.io/2019/01/18/jcip-39-fork-join), Jan. 2019  
- {:.ref} \[3] Doug Lea, [A Java Fork/Join Framework](http://gee.cs.oswego.edu/dl/papers/fj.pdf), [中译版](https://www.cnblogs.com/suxuan/p/4970498.html), 素轩(译), Nov. 2015
- {:.ref} \[4] rakyll, [Go's work-stealing scheduler](https://rakyll.org/scheduler/), July, 2017

