---
layout: post
title: C++并发型模式#12&#58; condition_variable_any
description: condition_variable在C++中通常是配合mutex使用, 但是condition_variable通常是系统API的封装, 所以也只接受同样是系统API封装的mutex; condition_variable_any则没有这个要求, 那这个奇怪的东西是怎么实现的呢?
category: blog
---

## 从condition_variable开始

如果我们去看`boost::condition_variable`源码, 我们会发现是pthread api的封装, 比如`condition_variable::wait`调用的其实是`pthread_cond_wait`.  `pthread_cond_wait`自然只接受`pthread_mutex_t`, 进而, `condition_variable::wait`只接受`unique_lock<mutex>`.

之所以接受`unique_lock`而不是`mutex`, 是因为C++里面`Lock`和`Mutex`是不同的concept, 由于篇幅关系我们不详细讨论, 这里简单地认为`Lock`比`Mutex`多一个`owns_lock`, 而`condition_variable`的语义要求企图通过`condition_variable`等待的线程持有这个锁. 

这样, `condition_variable::wait`可以简单地写成:

~~~c++
inline void condition_variable::wait(unique_lock<mutex>& m) {
    if (!m.owns_lock()) {
        boost::throw_excpetion(condition_error(-1, "mutex not owned"));
    }
    int res = 0;
    pthread_mutex_t* the_mutex = m.mutex()->native_handle();
    pthread_cond_t* this_cond = this->native_handle();
    res = pthread_cond_wait(this_cond, the_mutex);
    if (res != 0) {
        boost::throw_excpetion(condition_error(res, "failed in pthread_cond_wait"));
    }
}
~~~

这种要求在日常使用中自然是没有什么问题的. 但是, 当我们想实现`boost::wait_for_any`以及其他奇奇怪怪的东西, 我们就需要自定义奇怪的锁比如同时锁定多个对象(比如多个mutex). 然而`condition_variable`不接受这样自定义的锁.

好在boost和stl都提供了`condition_variable_any`, 它接受任何符合Lock concept的对象. 很显然, 这样的`condition_variable_any`不可能是api的简单封装, 那么, 它是怎么实现的呢?

## 实现condition_variable_any

`condition_variable_any`接受任意类型的锁, 它的接口看起来像:

~~~c++
class condition_variable_any
{
public:
    condition_variable_any();
    ~condition_variable_any();

public:
    template<typename Lock>
    void wait(Lock& m);
    
    void notify_one();
    void notify_all();
};

~~~

要实现这个奇怪的`wait`, 首先我们得知道`condition_variable`的wait做了什么. 

语义上, wait有三个步骤: 解锁, 等待, 再加锁. 听起来很简单对不对, 我们随手就能写出一个来:

~~~c++
// buggy version 1
class condition_variable_any
{
public:
    condition_variable_any();
    ~condition_variable_any();

public:
    template<typename Lock>
    void wait(Lock& external) {
        boost::unique_lock lk(m_mutex);
        external.unlock();
        m_cond.wait(lk);
        external.lock();
    }

    void notify_one() {
        m_cond.notify_one();
    }
    void notify_all() {
        m_cond.notify_all();
    }

private:
    boost::mutex m_mutex;
    boost::condition_variable m_cond;
};
~~~

这有什么问题呢? 我们上一章节实现的`condition_variable::wait`就是可能抛异常的, 如果`condition_variable::wait`异常的, 我们的`external`就会保持解锁的状态退出`condition_variable_any::wait`, 这是不好的.

为了解决这个问题,我们可以去写一个RAII, 构造的时候解锁, 析构的时候加锁:

~~~c++
template<typename Lock>
struct relock_guard {
    Lock& lk;
    relock_guard(Lock& _lk) : lk(_lk) {
        lk.unlock();
    } 
    ~relock_guard() {
        lk.lock();
    }
};
~~~

这样我们就异常安全多了:

~~~c++
// buggy version 2
template<typename Lock>
void condition_variable_any::wait(Lock& external) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    relock_guard<Lock> guard(external);
    m_cond.wait(lk);
}
~~~

然而, 这还是有问题, 条件变量的语义要求调用`wait`的时候, unlock和wait两个步骤是不可分割的, 虽然我们上面的`wait`确实有一个保护`condition_variable_any`内部状态的锁, 但是, 我们的`notify_one/notify_all`并没有去获取这个锁, 这会导致一种竞争条件.

考虑线程a, 线程b; 某一时刻, 线程a进到了`condition_variable_any::wait`, 锁了`m_mutex`, 解锁了`external`, 然后挂起了. 此时线程b调度上了cpu, 调用了`notify_one`, 因为没锁, 一切顺利地跑完了`notify_one`; 这时候线程a再调度回来, 再进入`m_cond.wait`的话, 就错过了这次notify. 过程参考:

| thread a                                      | thread b                                     |
| ---                                           | ---                                          |
| `external.lock()`                             |                                              |
| check predicate, decide to wait               |                                              |
| enter `condition_variable_any::wait`          |                                              |
| `boost::unique_lock<boost::mutex> lk(m_mutex)`|                                              |
| `external.unlock()`                           |                                              |
|                                               | `external.lock()`                            |
|                                               | change predicate, decide to wake thred a     |
|                                               | enter `condition_variable_any::notify_one()` |
|                                               | `m_cond.notify_one()`                        |
|                                               | exit `condition_variable_any::notify_one()`  |
|                                               | `external.unlock()`                          |
| `m_cond.wait()`                               |                                              |

条件变量要求进到`wait`后, 至少解锁`external`之后的notify不会错过, 所以这个问题是需要解决的. 解决也很简单, `notify_one/notify_all`加个锁就是了:

~~~c++
// buggy version 3
void condition_variable_any::notify_one() {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    m_cond.notify_one();
}
void condition_variable_any::notify_all() {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    m_cond.notify_all();
}
~~~

这样我们的原子性就好了.

然而, 滚动条出卖了一切, 这个实现依然是有问题的.

在buggy version 2中, 我们为了原子性, 先锁`m_mutex`, 后解锁`external`, 这没问题, 但是为了异常安全我们用的是RAII呀, 这意味着先构造`lk`, 后构造`guard`; 按照C++局部变量析构的顺序, 先构造的后析构, 就会使得`guard`比`lk`先析构, 也就是说, 先重新锁`externl`, 后解锁`m_mutex`.

听起来是不是就要死锁了? 是的, 这里会死锁!

考虑线程a, 线程b; 某时刻, 线程a进到`m_cond.wait`里面, 然后被唤醒, 然后过了`m_cond.wait`, 然后又被挂起了, 此时`external`是解锁的而线程a锁了`m_mutex`; 然后线程a挂起等待. 此时线程b调度到cpu上, 锁了`external`, 然后进到`condition_variable_any::wait`或`condition_variable_any::notify`, 企图获得`m_mutex`, 但是线程a已经占据了`m_mutex`, 线程b肯定是拿不到锁了, 但是, 因为线程b占据了`external`, 线程a无法再锁`external`, `wait`过程无法结束, `lk`无法析构, `m_mutex`无法解锁, 于是就愉快地死锁了. 过程参考:

| thread a                                      | thread b                                     |
| ---                                           | ---                                          |
| `external.lock()`                             |                                              |
| check predicate, decide to wait               |                                              |
| enter `condition_variable_any::wait`          |                                              |
| `boost::unique_lock<boost::mutex> lk(m_mutex)`|                                              |
| `external.unlock()`                           |                                              |
| enter `m_cond.wait()`                         |                                              |
| `m_mutex.unlock()` for system cond wait       |                                              |
| **`m_mutex.lock()` for system cond wake**     | **`external.lock()`**                        |
|                                               | change predicate, decide to wake thread a    |
|                                               | enter `condition_variable_any::notify_one()` |
|                                               | **going to `m_mutex.lock()`**                |
|  **going to `external.lock()`**               |                                              |

所以我们要提前`m_mutex`的解锁, 先解锁`m_mutex`, 后再锁`external`:

~~~c++
// good
template<typename Lock>
void condition_variable_any::wait(Lock& external) {
    boost::unique_lock<boost::mutex> lk(m_mutex);
    relock_guard<Lock> guard(external);
    boost::lock_guard<boost::unique_lock<boost::mutex> > unlocker(lk, boost::already_locked);
    m_cond.wait(lk);
}
~~~

这样才是一个安全可靠的`condition_variable_any`.

## 总结

到这里也许我们已经明白为什么标准库和boost都提供了`condition_variable_any`而不是让用户去自己实现, 因为写出正确的`condition_variable_any`确实不是一件容易的事情, 你需要考虑异常安全性, `unlock/wait`的原子性语义, 以及避免退出`wait`时可能的死锁; 虽然总共就没几行代码, 但即使是专业人士也很容易出现疏漏.

顺带一提, 因为其内部增加了一个mutex, 性能大概有所损失, 所以虽然`condition_variable_any`很方便, 什么类型的锁都能用, 但在只需要配合`unique_lock<mutex>`使用的情况下, 用`condition_variable`可能会有更好的性能[2].

**Reference:**  

* {:.ref} \[1] Howard E. Hinnant, [Mutex, Lock, Condition Variable Rationale](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2007/n2406.html), Sept. 2007  
* {:.ref} \[2] cppreference, [std::condition_variable_any](https://en.cppreference.com/w/cpp/thread/condition_variable_any),  Jan. 2019  
