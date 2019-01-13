---
layout: post
title: C++并发型模式#6&#58; 管程 - monitor
description: 管程和线程安全对象什么关系? 和条件变量又是什么关系?
category: blog
---

## 管程是什么

从大学起我就有两个问题很不解, 为什么monitor会翻译成管程, 以及这玩意为什么叫monitor! 可能每一篇讨论monitor的文章, 都需要先介绍什么是monitor, 所以说, 起名字是编程活动中最困难的事情, 也许没有之一.

在遥远的过去(1970s), 人们没什么同步工具可以用, 只好用semaphore, 我们之前讨论过了, semaphore同时具备互斥和信号的语义, 使得人们使用semaphore时需要格外小心.  为了人们更容易写出正确的代码, Brinch Hansen(1973)和Hoare(1974)提出了一种高级的同步原语, 称为monitor[1].

~~~
-- An example from the Mesa language
StorageAllocator.MONITOR = 
    BEGIN
    StorageAvailable: CONDITION;
    FreeList: POINTER;

    Allocate: ENTRY PROCEDURE RETURNS [p: POINTER] = 
        BEGIN
        WHILE FreeList = NIL DO
            WAIT StorageAvailable
            ENDLOOP;
        p <- FreeList; FreeList <- p.next;
        END;

    Free: ENTRY PROCEDURE [p: POINTER] = 
        BEGIN
        p.next <- FreeList; FreeList <-p;
        NOTIFY StorageAvailable
        END;
    END.
~~~

为什么说高级呢? 因为管程是一个由过程, 变量及数据结构等组成的集合, 它们组成了一个特殊的模块或软件包[1]. 如同上面的例子中我们用`MONITOR`修饰类, 所以我们得说某某代码是管程, 某某自定义类是管程. 相对而言, semaphore就是低级的.

管程保证了同一时刻只能有一个线程在管程内, 这意味这管程提供了互斥访问. 这一切通常是编译器提供的, 也就是说管程是编程语言的组成部分. <del>很明显, C++没有</del>

因为其互斥性, 而且管程内既有数据也有过程, 所以没有语法级支持管程的语言中, 也会称为线程安全对象[4]. 比如我们写个线程安全队列, 我们就可以说这个是管程. 但线程安全对象不一定就是管程, 因为经典定义下管程的全部方法体都是互斥的, 而线程安全对象却没有这个要求.

那编程语言怎么支持的管程? 通常也是让对象内部包含semaphore, mutex, condition_variable. 所以, mutex+condition_varable是实现管程的手段之一, 而管程是高级的, 它不关心互斥和信号是怎么实现的.

## 管程的语义

假设我们有两个线程, 线程B在管程内, 线程A在等, 比如说等资源, 然后线程A notify了, 资源可用了, 这时候怎么办? 谁应该在管程内?

这个怎么办会产生三种不同的语义[2]. Mesa语义, Hoare语义和Brinch Hansen语义(是的! 这俩提出者的monitor语义不一样!).

Mesa是第一种支持管程的编程语言. 在Mesa中, monitor有wait queue和entry queue, 那么, 一个线程要么在wait queue中, 要么在entry queue中, 要么在管程中. 在管程中的线程出来之后, entry queue的队首就进入管程. 

Mesa语义就是线程A被signal后, 线程B继续在管程中, 线程A进入entry queue, 等线程B离开管程, 线程A再进入管程.

![Mesa](/images/monitor_mesa.jpg)

Brinch Hansen语义非常类似, 也是有wait queue和entry queue, 但是Brinch Hansen语义要求signal发生在线程A离开管程的时候, 也就是说, signal之后, 线程B就离开管程了, 线程A就自然进入管程了.

![Brinch Hansen](/images/monitor_bh.jpg)

Hoare语义最复杂, 因为它还有signal queue. Hoare语义中, 在等的线程A在wait queue, signal发生时, 线程B被从管程中移到signal queue中, 而线程A则从wait queue移到管程中, 等线程A离开管程后线程A再回来.

![Hoare](/images/monitor_hoare.jpg)

语义问题在参考文献[2]解释的很清楚, 大家可以看看; 许多语言实现的也是Mesa语义, 比如Java[3]; 但是, 对于C++用户来说, 使用条件变量来notify的话, Mesa还是Brinch Hansen取决于你什么时候把锁解了.

## C++中的管程

### 基于派生的管程

能不能把管程模型写成模板类之类的东西? 虽然很少, 但还是可以的. [ice库
](https://github.com/zeroc-ice/ice)就有一个通过继承monitor基类来让自己变成monitor的实现, 实现的是mesa语义[3].

我们用boost来抄袭一遍的话(这里参考的是ice3.7的[源码](https://github.com/zeroc-ice/ice/blob/3.7/cpp/include/IceUtil/Monitor.h), 会是这样的:

~~~
class mesa_monitor : boost::noncopyable {
public:
    typedef boost::unique_lock<mesa_monitor> lock_type;
    friend class lock_type;
    mesa_monitor() : m_notify(0) {}
public:
    void lock() const {
        m_mutex.lock();
        m_notify = 0;  // 进入管程时要把m_notify归0
    }
    void unlock() const {
        notify_impl(m_notify);
        m_mutex.unlock();
    }
    bool try_lock() const {
        bool ret = m_mutex.try_lock();
        if (ret) {
            m_notify = 0;
        }
        return ret;
    }
    void wait() const {
        notify_impl(m_notify);
        m_cond.wait(m_mutex);
        m_notify = 0;
    }
    void notify_one() {
        if (m_notify != -1) {
            ++m_notify;
        }
    }
    
    void notify_all() {
        m_notify = -1;
    }
    
private:
    void notify_impl(int nnotify) const {
        if (nnotify != 0) {
            if (nnotify = -1) {
                m_cond.notify_all();
                return;
            } else {
                while (nnotify > 0) {
                    m_cond.notify_one();
                    --nnotify;
                }
            }
        }
    }

private:
    mutable boost::condition_variable_any m_cond;
    mutable boost::mutex m_mutex;
    mutable int m_notify;
};
~~~

看起来有些奇怪, notify的时候只是记录了要notify多少下, 实际调用`condition_varaiable::notify_one`的是`wait`和`unlock`; 这里设定了wait和unlock是离开monitor的操作, 所以此时会唤醒正在等待的线程. 这也使得`notify_one`不会立刻唤醒其他线程.

一堆`const`和`mutable`是为了使用mesa_monitor的类可以在const的方法中可以调用. 使用mesa_monitor的threadsafe_queue如下:

~~~
template <typename T>
class threadsafe_queue : mesa_monitor {
    std::queue<T> m_data;

public:
    threadsafe_queue() {}
    void pop(T& val) {
        mesa_monitor::lock_type lk(*this);
        while (m_data.empty()) {
            wait();
        }
        val = m_data.front();
        m_data.pop();
    }
    bool try_pop(T& val) {
        mesa_monitor::lock_type lk(*this);
        if (m_data.empty()) {
            return false;
        }
        val = m_data.front();
        m_data.pop();
        return true;
    }
    void push(const T& val) {
        mesa_monitor::lock_type lk(*this);
        m_data.push(val);
        notify_one();
    }
};
~~~ 

### 管程包装器

基于派生的管程毕竟是侵入式的, 如果单纯的只是想实现互斥访问, 我们还可以用一些比较黑暗的魔法, 比如重载`operator->`(std::forward要求了C++11)[5]:

~~~
// test in vsc2017

template<class T>
class monitorized
{
public:
    template<typename ...Args>
    monitorized(Args&&... args) : m_obj(std::forward<Args>(args)...) {}

    struct monitorized_helper
    {
        monitorized_helper(monitorized* mon) : m_mon(mon), m_lk(mon->m_lock) {}
        T* operator->() { return &m_mon->m_obj; }
        monitorized* m_mon;
        std::unique_lock<std::mutex> m_lk;
    };

    monitorized_helper operator->() { return monitorized_helper(this); }
    monitorized_helper lock() { return monitorized_helper(this); }
    T& unsafe_ref() { return m_obj; }

private:
    T m_obj;
    std::mutex m_lock;
};
~~~

这里的思路是你调用`monitorized`的`operator->()`时, 返回的是一个`monitorized_helper`实例, 而`monitorized_helper`构造时会加锁, 而实际调成员函数的是`monitorized_helper`的`operator->()`, 这基于一个奇怪的[特性](https://stackoverflow.com/a/12365484), 当`operator->`被重载时, 它会折叠到最终结果[6], 所以下面这个例子, 包多少层都是可以的:

~~~
struct example {
    void foo() {}
};

struct first_wapper {
    explicit first_wapper(example* _e) : e(_e) {}
    first_wapper(const first_wapper& rhs) : e(rhs.e) {}
    example* operator->() { return e; }
    example* e;
};

struct second_wapper {
    explicit second_wapper(example* _e) : e(_e) {}
    second_wapper(const second_wapper& rhs) : e(rhs.e) {}
    first_wapper operator->() { return first_wapper(e); }
    example* e;
};

struct third_wapper {
    second_wapper operator->() { return second_wapper(&e);}
    example e;
};

int main() {
    third_wapper w;
    w->foo();
    return 0;
}
~~~

于是monitorized用起来是这样的:

~~~
monitorized<std::queue<int> > q;
boost::thread tr1([&]() {
    for (int i = 0; i < 100; ++i) {
        q->push(i);
    }
});
~~~

当然这样并不能真的实现线程安全的队列, 但确实每个成员函数都是加锁的.

## 总结

monitor应当是编程语言的支持, C++没有支持, 虽然我们可以用一些方法写得像monitor, 但并不比直接使用mutex和condition_variable靠谱. 至于其他特性, 我觉得参考文献[7]总结得挺好的, 不必赘述.

**Reference:**  

* {:.ref} \[1]  Andrew S. Tanenbaum. 陈向群, 马洪兵等译. 现代操作系统(第三版). 机械工业出版社. 2012.  
* {:.ref} \[2]  Gregory Kesden, [Monitors and Condition Variables](https://cseweb.ucsd.edu/classes/sp16/cse120-a/applications/ln/lecture9.html)  
* {:.ref} \[3]  Mark Spruiell, [The C++ Monitor Class](https://doc.zeroc.com/pages/viewpage.action?pageId=5048235). Apr.2011    
* {:.ref} \[4]  wikipedia, [Monitor (synchronization)](https://en.wikipedia.org/wiki/Monitor_(synchronization))  
* {:.ref} \[5]  Mike Vine, [Making a C++ class a Monitor (in the concurrent sense)](https://stackoverflow.com/a/48408987)  
* {:.ref} \[6]  David Rodríguez - dribeas, [How arrow-> operator overloading works internally in c++?](https://stackoverflow.com/a/10678920)  
* {:.ref} \[7]  Fruit_初, [Monitors](https://www.jianshu.com/p/8b3ed769bc9f), March, 2017.  

