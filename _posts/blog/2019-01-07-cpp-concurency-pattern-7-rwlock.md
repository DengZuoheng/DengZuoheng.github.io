---
layout: post
title: C++并发型模式#7&#58; 读写锁 - shared_mutex
description: 
category: blog
---

## 读者-写者问题

考虑有一块共享内存, 外加好些个线程需要访问这块共享内存, 虽然我们可以直接上mutex, 把访问全部互斥, 但是, 如果写入很少的情况写把读取也互斥了, 又感觉没什么必要, 并发读不好吗?  怎么让多个读者同时访问共享资源, 就是所谓的读者-写者问题.

读写锁, 又称"共享-互斥锁", 便是试图解决这个问题, 使得读操作可以并发重入, 写操作则互斥.

读写锁有不同的优先策略, 一种是读者优先, 即只有全部读操作都完成, 写操作才可以进行, 但是这样如果一直都有读操作的话, 写操作会饿死--等很久很久, 等到天荒地老, 都没等到没读者的时候.

另一种是写者优先, 等待已经开始的读操作, 在完成写操作前不增加新读者.

读者优先的读写锁可以用两个mutex和一个counter简单实现一下[2]:

~~~
class shared_mutex {
    int m_shared_count;
    boost::mutex m_mutex_count;
    boost::mutex m_mutex_write;

public:
    shared_mutex() : m_shared_count(0) {}
    void lock() {
        m_mutex_write.lock();
    }
    void unlock() {
        m_mutex_write.unlock();
    }
    void lock_shared() {
        m_mutex_count.lock();
        m_shared_count++;
        if (m_shared_count == 1) {
            m_mutex_write.lock();
        }
        m_mutex_count.unlock();
    }
    void unlock_shared() {
        m_mutex_count.lock();
        m_shared_count--;
        if (m_shared_count == 0) {
            m_mutex_write.unlock();
        }
        m_mutex_count.unlock();
    }

};
~~~

因为boost及c++17中将读写锁称为shared_mutex, 所以这里的接口皆依boost, 读锁为`lock_shared()`, 写锁为`lock()`.

这里`m_mutex_count`是用来保护`m_shared_count`的; 第一个读锁时把`m_mutex_write`锁了, 最后一个读锁解时才解`m_mutex_write`, 所以只要还有读者, `lock()`就无法获得`m_mutex_write`. 所以, 如果读者源源不断, 写锁就一直锁不到.

## boost实现

boost的shared_mutex基于Alexander Terekhov提出的算法[1], <del>虽然我一直没找到来源</de>.

### shared_lock_guard 和 shared_lock

对普通的mutex, 我们有raii的lock_guard, 对shared_mutex, 自然也会有shared_lock_guard:

~~~
template<typename SharedMutex>
class shared_lock_guard : boost::noncopyable {
    SharedMutex& m_shared_mutex;
public:
    explicit shared_lock_guard(SharedMutex& m) : m_shared_mutex(m) {
        m_shared_mutex.lock_shared();
    }
    ~shared_lock_guard() {
        m_shared_mutex.unlock_shared();
    } 
};
~~~

对于普通的mutex, 我们有raii的更灵活的unique_lock, 对shared_mutex, 自然也会有shared_lock<del>其实还有upgrade_lock以及相互转换的各种lock, 能把名字记住已经不容易了</del>:

~~~

struct defer_lock_t{};
struct try_to_lock_t{};
struct adopt_lock_t{};

const defer_lock_t defer_lock={};
const try_to_lock_t try_to_lock={};
const adopt_lock_t adopt_lock={};

template<typename SharedMutex>
class shared_lock : boost::noncopyable {
    SharedMutex* m_shared_mutex;
    bool m_is_locked;
public:
    shared_lock() : m_shared_mutex(NULL), m_is_locked(false) {}
    explicit shared_lock(SharedMutex& m) : m_shared_mutex(&m), m_is_locked(true) {
        lock();
    }
    shared_lock(SharedMutex& m, adopt_lock_t) : m_shared_mutex(&m), m_is_locked(true) {

    }
    shared_lock(SharedMutex& m, defer_lock_t) : m_shared_mutex(&m), m_is_locked(false) {

    }
    shared_lock(SharedMutex& m, try_to_lock_t) : m_shared_mutex(&m), m_is_locked(false) {
        try_lock();
    }
    ~shared_lock() {
        if (owns_lock()) {
            m_shared_mutex->unlock_shared();
        }
    }
    void lock() {
        if(owns_lock()) {
            throw boost::lock_error();
        }
        m_shared_mutex->lock_shared();
        m_is_locked = true;
        
    }
    bool try_lock() {
        if(owns_lock()) {
            throw boost::lock_error();
        }
        m_is_locked = m_shared_mutex->try_lock_shared();
        return m_is_locked;
    }
    void unlock() {
        if(!owns_lock()) {
            throw boost::lock_error();
        }
        m_shared_mutex->unlock_shared();
        m_is_locked = false;;
    }
    bool owns_lock() {
        return m_is_locked;
    }

};
~~~

因为`unique_lock`和`shared_lock`一般要求可以移动的, 所以用的是`SharedMutex*`, 而不是引用.

### shared_mutex

boost的读写锁并没有使用ptherad_rwlock, 而是用mutex和condition_variable实现, 一方面可能是跨平台的考虑, 一方面可能是因为boost提供读锁升级到写锁, 而pthread不提供. boost中的锁升级称为upgrade, `shared_mutex`也有`lock_upgrade`得到可升级的读锁, 但是简单起见, 我们下面先不考虑upgrade. (下面代码片段可能来自boost1.41, 也可能来自1.68, 但这两版本除了简单重构, 没有太大区别).

boost的shared_mutex中, 没有明确的优先级; 既然不是读者优先, 就得加写锁的时候, 先置一flag, 标记要即将加写锁, 阻塞其他新读者. 但是, 对于已经有的读锁, 写者是要等的; 这样, 我们需要两个条件变量, 一个给读者, 一个给写者. 另外, 写锁的互斥不是用mutex实现的, 而是又置了另一flag, 标记已经加了写锁, 其他写锁等着.

boost.shared_mutex将这些flags, 加上读者的计数, 集中成一个内部结构体, 称之为`state_data`:

~~~
class shared_mutex {
    struct state_data {
        unsigned shared_count;
        bool exclusived;
        bool exclusive_entered;
    };
    state_data m_state;
    boost::mutex m_mutex_state;
    boost::condition_variable m_shared_cond;
    boost::condition_variable m_exclusive_cond;

public:
    shared_mutex(){}
    ~shared_mutex(){}

    void lock_shared();
    bool try_lock_shared();
    void unlock_shared();

    void lock();
    bool try_lock();
    void unlock();
};
~~~

其中`m_mutex_state`是保护`m_state`的. `exclusive_entered`表示即将加写锁, `exclusive_entered`为真时, 不能再加读锁. `exclusived`表示已经加了写锁, 进入互斥状态. `shared_count`则是读者数量.

因为之后还得加上upgrade相关的标记, `shared_state`还会变得更复杂, 所以, shared_mutex的实现中, 就给state_data加了些方法, 以便调用:

~~~

class shared_mutex {
    struct state_data {
        unsigned shared_count;
        bool exclusived;
        bool exclusive_entered;

        state_data() : 
            shared_count(0),
            exclusived(false),
            exclusive_entered(false) {}

        bool can_lock_shared() const { return !(exclusived || exclusive_entered);}
        bool no_shared() const { return shared_count == 0;}
        bool one_shared() const { return shared_count == 1;}
        bool can_lock() const { return no_shared() && !exclusived;}

        void lock() {
            exclusived = true;
        }
        void unlock() {
            exclusived = false;
            exclusive_entered = false;
        }
        void lock_shared() {
            ++shared_count;
        }
        void unlock_shared() {
            --shared_count;
        }

    };
    
};
~~~ 

我们先来看写锁`shared_mutex::lock()`, 因为这是我们先前最清楚的:

~~~
void shared_mutex::lock() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    while (!m_state.can_lock()) {
        m_state.exclusive_entered = true;
        m_exclusive_cond.wait(lk);
    }
    m_state.exclusived = true;
}
~~~

首先将`exclusive_entered`设为`true`, 然后等待已经有的读锁完成, 再把`exclusived`设为`true`. 

为什么`exclusive_entered`在while循环中? 因为boost的shared_mutex没有谁优先, 所以最后一个读锁解锁的时候, 得让正在等待的读写者公平竞争(就是把他们都唤醒, 谁抢到就是谁的),  于是最后一个读锁解锁的时候, 会将`exclusive_entered`置为false, 让读者有机会竞争. 这样一来, 写者可能被唤醒后发现机会被读者抢了, 然后就继续等, 为保公平, 就得再把`exclusive_entered`设为`true`, 否则可能再也竞争不过读者了.
 

`shared_mutex::try_lock()`有所不同, 因为它不会去等已有的读锁(其实`lk`也可以用`try_to_lock`):

~~~
bool shared_mutex::try_lock() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    if (!m_state.can_lock()) {
        return false;
    }
    m_state.exclusived = true;
    return true;
}
~~~

`shared_mutex::unlock`除了改变`m_state`之外, 还需要通知正在等待的读者和写者, 因为写者优先, 所以先通知写者:

~~~
void shared_mutex::unlock() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    m_state.exclusived = false;
    m_state.exclusive_entered = false;
    m_exclusive_cond.notify_one();
    m_shared_cond.notify_all();
}
~~~

因为通知正在等待的读者和写者这个操作以后还会有许多次, 我们就将之提取成`shared_mutex`的一个私有方法:

~~~
void shared_mutex::notify_waiters() {
    m_exclusive_cond.notify_one();
    m_shared_cond.notify_all();
}
~~~

`shared_mutex::lock_shared()`其实也很简单, 只是改个计数而已:

~~~
void shared_mutex::lock_shared() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    while (!m_state.can_lock_shared()) {
        m_shared_cond.wait(lk);
    }
    m_state.lock_shared();
}

bool try_lock_shared() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    if (m_state.can_lock_shared()) {
        m_state.lock_shared();
        return true;
    }
    return false;
}
~~~

`shared_mutex::unlock_shared()` 的要点我们在解释`shared_mutex::lock()`便已指出, 最后一个读者解锁时要特殊处理一下:

~~~
void shared_mutex::unlock_shared() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    m_state.unlock_shared();
    if (m_state.no_shared()) {
        m_state.exclusive_entered = false;
        notify_waiters();
    }
}
~~~

### 升级

boost的shared_mutex提供了升级, 即从读锁升级为写锁, 叫`upgrade_lock`, 也可能叫`upgrade_mutex`; 这个升级并不是把读锁解了然后加个写锁这么简单, shared_mutex的升级隐含了一个目标, 就是升级后, 数据没被修改. 这使得只能有一个读锁是可升级的, 否则可能竞争, 如果可能竞争, 升级后就不知道有没有被别的线程修改. [1]

为了实现这个目标, 锁升级便有最高优先级, 即最后一个读锁解锁时, 先通知正在升级的锁, 然后再通知其他, 这得多一个条件变量.

下面我们开始实现, 首先给`state_data`加个flag, 保证只有一个可升级锁, 然后给shared_mutex加些新接口:

~~~
class shared_mutex {
    struct state_data {
        // ...
        state_data() : /*...,*/ upgrade(false) */ {}
        bool upgrade;
        bool can_lock_upgrade() const { return can_lock_shared() && !upgrade;}
        void lock_upgrade() {
            ++shared_count;
            upgrade = true;
        }
        void unlock_upgrade() { 
            upgrade = false;
            --shared_count;
        }

        // ...
    };
    boost::condition_variable m_upgrade_cond;
    // ...
    void lock_upgrade();
    bool try_lock_upgrade();
    void unlock_upgrade();
    void unlock_upgrade_and_lock();
};
~~~

`shared_mutex::lock_upgrade()`跟`shared_mutex::lock_shared()`差不多, 只是多考虑新加的`upgrade`flag而已:

~~~
void shared_mutex::lock_upgrade() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    while (!m_state.can_lock_upgrade()) {
        m_shared_cond.wait(lk);
    }
    m_state.lock_upgrade();
}

bool shared_mutex::try_lock_upgrade() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    if (!m_state.can_lock_upgrade()) {
        return false;
    }
    m_state.lock_upgrade();
    return true;
}
~~~

`shared_mutex::unlock_upgrade()`需要注意如果还有读锁, 可以通知一下可能正在`lock_upgrade()`等的读者:

~~~
void shared_mutex::unlock_upgrade() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    m_state.unlock_upgrade();
    if (m_state.no_shared()) {
        m_state.exclusive_entered = false;
        notify_waiters();
    } else {
        m_shared_cond.notify_all();
    }
}
~~~

`shared_mutex::unlock_upgrade_and_lock()`其实也是解读锁然后加写锁, 因为优先upgrade并不是这里保证的, 而是一会儿要修改的`unlock_shared()`:

~~~
void shared_mutex::unlock_upgrade_and_lock() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    m_state.unlock_shared();
    while (!m_state.no_shared()) {
        m_upgrade_cond.wait(lk);
    }
    m_state.lock();
    m_state.upgrade = false;
}
~~~

注意这里等的是`m_state.no_shared()`而不是`can_lock()`, 这是有理由的, 稍后解释.

`shared_mutex::unlock_shared()`需要改一下:

~~~
void shared_mutex::unlock_shared() {
    boost::unique_lock<boost::mutex> lk(m_mutex_state);
    m_state.unlock_shared();
    if (m_state.no_shared()) {
        if(m_state.upgrade) {
            // As there is a thread doing a unlock_upgrade_and_lock that is waiting for state.no_shared()
            // avoid other threads to lock, lock_upgrade or lock_shared, so only this thread is notified.
            m_state.upgrade = false;
            m_state.exclusived = true;
            m_upgrade_cond.notify_one();
        } else {
            m_state.exclusive_entered = false;
        }
        
        notify_waiters();
    }
}
~~~

这里需要注意, 如果是最后一个读锁了, `m_state.upgrade`仍然为true, 说明有upgrade_lock在升级, 
需要将`m_state.exclusived`设为true, 所以其他`lock`, `lock_upgrade`, `lock_shared`都无法进行了, 只有即将被notify的`unlock_upgrade_and_lock`; 因为`m_state.exclusive`现在是`true`, 所以`unlock_upgrade_and_lock`只能等`no_shared()`, 不能等`can_lock()`.

另外, 为什么将`m_state.upgrade`设为false, 其实我不是很明白, 十多年前最开始的版本就有了, 但似乎没有什么地方需要它是false, 因为`exclusive`就能保证其他锁加不上了. 为此我去so上提了个[问题](https://stackoverflow.com/questions/54105754/why-boost-shared-mutex-unlock-shared-need-to-set-state-upgrade-to-false-in-the-l), 有人指出, 从状态机的视角考虑, `exclusive`和`upgrade`不该同时为`true`.

我们喜欢raii, 所以, `lock_upgrade()`也有对应的`upgrade_lock`, 而`unlock_upgrade_and_lock()`则是从`upgrade_lock`移动到`unique_lock`的时候使用的, 假如我们有移动构造:

~~~
template<typename Mutex>
unique_lock<Mutex>::unique_lock(upgrade_lock<Mutex>&& other):
    m(other.m),is_locked(other.is_locked)
{
    other.is_locked=false;
    other.m = NULL;
    if(is_locked)
    {
        m->unlock_upgrade_and_lock();
    }
}
~~~

## STL实现

标准库中的shared_mutex是基于Howard E. Hinnant的提案[3], 但是C++17标准中没有支持升级, 所以下面也不讨论upgrade的情况.

简单地说, 这个实现中, 以两个条件变量作为两道"门", 第一道门表示没有正在写, 第二道门表示没有正在读; 对于读者, 能过第一道门便可加读锁; 对于写者, 先过第一道门, 然后将第一道关了, 在过第二道门, 过了便是加上了写锁. 

用一个`unsigned`储存所有状态, 第1位表示`exclusive_entered`, 其余位存读者数目, 一堆操作皆是位运算; 之所以只用一个`unsigned`, 是希望以后可以改成原子变量, 也算是一种优化读写锁性能的期望.

我们先声明一下接口:

~~~

class shared_mutex {
    std::mutex mut_;
    std::condition_variable gate1_;
    std::condition_variable gate2_;
    unsigned state_;

    /* example:
     *  sizeof(unsigned) == 4;
     *  CHART_BIT == 8;
     *  EXCLUSIVE_WAITING_BLOCKED_MASK == 0x80000000;
     *  MAX_SHARED_COUNT_MASK == 0x7fffffff;
     *  NO_EXCLUSIVE_NO_SHARED == 0x00000000;
     */
    static const unsigned EXCLUSIVE_ENTERED_MASK = 1U << (sizeof(unsigned) * CHAR_BIT - 1);
    static const unsigned MAX_SHARED_COUNT_MASK = ~EXCLUSIVE_ENTERED_MASK;
    static const unsigned NO_EXCLUSIVE_NO_SHARED = 0;

public:
    shared_mutex() : state_(NO_EXCLUSIVE_NO_SHARED) {}

    // Exclusive ownership
    void lock();
    bool try_lock();
    void unlock();

    // Shared ownership
    void lock_shared();
    bool try_lock_shared();
    void unlock_shared();
};
~~~

直接看位运算的代码怪眼花的, 于是这里整理一下, 以私有函数代替原来的位运算语句, 与上面的讨论一样, 这些私有函数都是对`state_`的操作, 调用前都假设已经获取到`mut_`了:

~~~
class shared_mutex {
    // ...
private:
    bool _exclusive_entered() const { return (state_ & EXCLUSIVE_ENTERED_MASK); }
    unsigned _shared_count() const { return (state_ & MAX_SHARED_COUNT_MASK); }
    bool _no_shared() const { return _shared_count() == 0;}
    bool _full_shared() const { return _shared_count() == MAX_SHARED_COUNT_MASK; }
    bool _can_lock() const { return state_ == NO_EXCLUSIVE_NO_SHARED; }
    bool _can_lock_shared() const { return (!_exclusive_entered() && !_full_shared());}
    void _lock_shared() {
        const unsigned num = _shared_count() + 1;
        state_ &= ~MAX_SHARED_COUNT_MASK;
        state_ |= num;
    }
    void _unlock_shared() {
        const unsigned num = _shared_count() - 1;
        state_ &= ~MAX_SHARED_COUNT_MASK;
        state_ |= num;
    }

    void _lock() {
        state_ = EXCLUSIVE_ENTERED_MASK;
        assert(_no_shared() && _exclusive_entered());
    }

    void _unlock() {
        state_ = NO_EXCLUSIVE_NO_SHARED;
        assert(_no_shared() && !_exclusive_entered());
    }

    void _enter_exclusive() {
        state_ |= EXCLUSIVE_ENTERED_MASK;
    }
    // ...
};
~~~

毕竟`unsigned`是有限的, 读者数量也是有上限的, 满了就不给加了, 所以有`_full_shared()`表示已满, `_can_lock_shared()`也要求未满.

下面我们直接看`shared_mutex::lock()` 和 `shared_mutex::try_lock()`:

~~~
void shared_mutex::lock()
{
    std::unique_lock<std::mutex> lk(mut_);
    while (_exclusive_entered()) {
        gate1_.wait(lk);
    }
    _enter_exclusive();
    while (!_no_shared()) {
        gate2_.wait(lk);
    }
    _lock(); // unnecessary

}

bool shared_mutex::try_lock()
{
    std::unique_lock<std::mutex> lk(mut_, std::try_to_lock);
    if (lk.owns_lock() && _can_lock()) {
        _lock();
        return true;
    }
    return false;
}
~~~

第一道门, 如果没其他写者进入, 则当前写者进入, 进入后关了门(`_enter_exclusive()`), 这样其他读者和写者都不能进了. 然后在第二道门前等所有读者出去, 自己进去, 这写锁便是加上了. 所以那句`_lock()`其实没有必要, 因为此时必然是互斥的.

对于`try_lock`, 连`mut_`都是try的, `_can_lock()`表示既没有读者, 也没有写者在第一道门内, 所以可直接过二道门, 完成加锁, 这时`_lock()`就是必须的了.

`shared_mutex::unlock()`则会让`state_`回到没有读者, 也没有写者的状态:

~~~
void shared_mutex::unlock()
{
    {
        std::lock_guard<std::mutex> _(mut_);
        _unlock();
    }
    gate1_.notify_all();
}
~~~

如果有写锁, 读者都会被阻在第一道门外, 所以这里notify的是`gate1_`.

那么, `shared_mutex::lock_shared()`就是读者等在第一道门的故事:

~~~
void shared_mutex::lock_shared()
{
    std::unique_lock<std::mutex> lk(mut_);
    while (!_can_lock_shared()) {
        gate1_.wait(lk);
    }
    _lock_shared();
}

bool shared_mutex::try_lock_shared()
{
    std::unique_lock<std::mutex> lk(mut_, std::try_to_lock);
    if (lk.owns_lock() && _can_lock_shared()) {
        _lock_shared();
        return true;
    }
    return false;
}
~~~

`shared_mutex::unlock()`稍复杂, 我们之前说过, `std::shared_mutex`考虑了读者满了的情况, 所以解锁时, 如果解锁前是满的, 解锁后自然不满了, 就得通知在门外等候的其他读者. 另外, 如果有写者在第一道门内, 最后一个读者离开时, 需通知该写者可以进第二道门了:

~~~
void shared_mutex::unlock_shared()
{
    std::lock_guard<std::mutex> lk(mut_);
    const bool full_shared_before = _full_shared();
    _unlock_shared();
    if (_exclusive_entered()) {
        if (_no_shared()) {
            gate2_.notify_one();
        }
    } else {
        if (full_shared_before) {
            gate1_.notify_one();
        }
    }
}
~~~

因为不用考虑升级, 所以代码还是稍稍简洁易懂一些, 看明白了上面这被我"整理"过的代码, 再去看文献[3,4]中的版本, 想必会更容易一些.

这个实现比boost的实现更偏向写者, boost中最后一个读者解锁时, 即通知在等的读者, 也通知在等的写者, 让他们都参与竞争. Hinnant觉得这样写者有饥饿嫌疑, 毕竟读者比写者多, 错失良机的话可能就是等很久了. 所以, stl的实现中, 如果有写者进到二道门, 则只通知该写者.

## 被批判的读写锁

人们没少批判读写锁的性能问题[5,6,7].

从上面两个版本的实现便可看出, 无论boost还是stl, shared_mutex总得有个状态和计数, 那么, 为了保护这个状态, 自然有mutex, 这意味着, 无论我们加读锁还是加写锁, shared_mutex自己都得锁个mutex, 开销不可能比我们锁个mutex小[8]. 

所以, 临界区很小的时候, 读写锁可能不会比直接粗暴的mutex快; 临界区很大又说明代码写得不好, 缩小临界区是我等毕生心愿. 所以用不用读写锁还是测过才知道.

如果需要很高的性能, RCU(Read-Copy Update)是一种可行的选择[9], 不过需要系统支持. 我们以后讨论RCU的时候, 再具体评测读写锁和RCU的性能差异.

另外, 从正确性来说, 拿着读锁进行写操作也不是不可能, 这样就跟无保护并发写一样了; 实现上, 读锁是可重入的, 而写锁会阻塞其他读锁, 这可能造成读锁重入时死锁[8].

我自己工作中倒是没有碰到需要读写锁的时候, 自然也没被坑过, 所以这里就不作评价了.

**Reference:**  

* {:.ref} \[1]  Anthony Williams.  [Synchronization - Boost 1.69](https://www.boost.org/doc/libs/1_69_0/doc/html/thread/synchronization.html#thread.synchronization.mutex_types.shared_mutex), Dec.2018  
* {:.ref} \[2]  Raynal, Michel, *Concurrent Programming: Algorithms, Principles, and Foundations*. Springer. 2012  
* {:.ref} \[3]  Howard E. Hinnant, [Mutex, Lock, Condition Variable Rationale](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2007/n2406.html#shared_mutex), Sept.2007  
* {:.ref} \[4]  Howard E. Hinnant, [How to make a multiple-read/single-write lock from more basic synchronization primitives?](https://stackoverflow.com/a/28140784/5570232), Jan.2015  
* {:.ref} \[5]  viboes, [Implementation of boost::shared_mutex on POSIX is suboptimal](https://svn.boost.org/trac10/ticket/11798), Nov.2015  
* {:.ref} \[6]  AlexeyAB, [We make a std::shared_mutex 10 times faster](https://www.codeproject.com/Articles/1183423/%2FArticles%2F1183423%2FWe-make-a-std-shared-mutex-times-faster), Jun. 2017  
* {:.ref} \[7] Bryan Cantrill, Jeff Bonwick, [Real-world Concurrency](https://queue.acm.org/detail.cfm?id=1454462), [PDF](http://delivery.acm.org/10.1145/1460000/1454462/p16-cantrill.pdf?ip=202.79.203.99&id=1454462&acc=OPEN&key=4D4702B0C3E38B35%2E4D4702B0C3E38B35%2E4D4702B0C3E38B35%2E6D218144511F3437&__acm__=1547107640_5649aab2cc6362093d444b794ca3c087),  Oct. 2008  
* {:.ref} \[8] 陈硕, *Linux多线程服务端编程: 使用muduo C++网络库*. 北京, 电子工业出版社, 2013, p43 ~ 44  
* {:.ref} \[9] 杨燚, [Linux 2.6内核中新的锁机制--RCU](https://www.ibm.com/developerworks/cn/linux/l-rcu/), July. 2005  



