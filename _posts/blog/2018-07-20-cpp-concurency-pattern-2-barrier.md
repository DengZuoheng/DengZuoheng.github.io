---
layout: post
title: C++并发型模式#2&#58; 同步屏障 - Barrier
description: 同步屏障是一种同步方法, 要求线程到达某一点后等待, 直到其他线程都到达这点才能继续执行. 
category: blog
---

假如有一个很复杂需要很长时间的计算, 但幸运的是, 这个计算可以拆分成几个部分给几个工作线程去计算, 然后再合并结果, 比如多线程版本的排序. 

问题是, 主线程怎么知道工作线程已经完成计算了? `boost::thread::join()`? 这需要这些个工作线程对象是你管理的, 而通常我们都是把任务丢到线程池了, 连线程对象都访问不到, join就更没希望了.

也许我们可以弄一个count, 再用条件变量联系起来, 主线程初始化了工作线程(或者把worker加入线程池)就去wait这个条件变量, 工作线程完成了就去`count--`, 减到0就`notify`. 就是说, 所有工作线程都完成工作的时候, 主线程会被唤醒来合并结果. 这种操作可以说比较模式化了, 于是人们就将其称为barrier, 通常翻译为"同步屏障".

barrier指所有线程都到这个节点, 才能继续往下走. 举个例子, 某公司大门得所有员工打完卡才能开, 这个大门就是一个同步屏障, 大家都等在那. barrier的问题也很明显, 如果有一个员工在上班路上遭遇不幸, 这门就永远打不开了.

## boost.barrier

为什么先说boost.barrier? 因为barrier根本没进C++11, 也没进C++17, 倒是C++20有提案, 我们稍后再讨论.

早期版本的boost.barrier是很简单的一个东西, 全部代码也就这么多:

~~~
class barrier
    {
    public:
        barrier(unsigned int count)
            : m_threshold(count), m_count(count), m_generation(0)
        {
            if (count == 0)
                throw std::invalid_argument("count cannot be zero.");
        }

        bool wait()
        {
            boost::mutex::scoped_lock lock(m_mutex);
            unsigned int gen = m_generation;

            if (--m_count == 0)
            {
                m_generation++;
                m_count = m_threshold;
                m_cond.notify_all();
                return true;
            }

            while (gen == m_generation)
                m_cond.wait(lock);
            return false;
        }

    private:
        mutex m_mutex;
        condition_variable m_cond;
        unsigned int m_threshold;
        unsigned int m_count;
        unsigned int m_generation;
    };

~~~

`mutex`和`condition_variable`没什么好讨论的. `m_count`用来记录到达的线程的, m_count减到0就会唤醒所有等待这个barrier的线程, 没错, 所有到达这个barrier的线程都会等待.

`m_threshold`和`m_generation`得一起讲. boost.barrier被设计成可以玩好多轮, `m_generation`就是这个轮数, 而`m_threshold`是用来重置`m_count`的. 知道这个设定之后, wait函数就很好理解了: 对于先到的线程, 记录当前是第几轮, 如果被唤醒时, 还在那一轮, 说明是意外唤醒, 继续等[2]; 对于最后到的线程, `m_count`会减到0, `m_generation`增加, 使得其他线程唤醒时可以跳出循环. 另外`m_count`也会被重置, 唤醒所有等待的线程.

上面这个代码是boost1.37的, 后来barrier被设置成不可复制的, 使其更难发生误用而导致死锁. 另外, 构造函数也增加了一个参数, 使用户可以注入一个函数, 用于定制重置`m_count`的行为.

## std::latch

`std::latch`看起来就像一个只能玩一轮的barrier, boost里面也有一个`boost::latch`, 只是接口比`std::latch`稍多. 与上面的barrier不同的是, latch的count_down和wait是可以分开的, 比如一些线程只`count_down`, 另一些线程只wait, 当然也可以`count_down_and_wait`. 另外latch是一次性的, 不能像barrier一样重置, 用起来大概像这样:

~~~
// 等待线程池里面的几个任务完成
void do_work(threadpool* pool) {
     std::latch completion_latch(NTASK);
     for (int i = 0; i < NTASK; ++i) {
          pool->add_task([&] {
               // do some work
               ...
               completion_latch.count_down();
          });
     }
     // block until work is done
     completion_latch.wait();
}
~~~

可以根据experimental[4]的接口模仿`boost::barrier`写一个latch出来:

~~~
class latch : private boost::noncopyable {
public:
    latch(unsigned int count) : m_count(count) { }

public:
    void count_down_and_wait() {
        boost::mutex::scoped_lock lock(m_mutex);
        if (--m_count ==0 ) {
            m_cond.notify_all();
        }
        while (m_count > 0) {
            m_cond.wait(lock);
        }
    }
    void count_down(unsigned int n = 1) {
        boost::mutex::scoped_lock lock(m_mutex);
        if (m_count == 0) {
            return;
        } else if (m_count <= n) {
            m_count = 0;
            m_cond.notify_all();
        } else {
            m_count -= n;
        }
    }
    void wait() {
        boost::mutex::scoped_lock lock(m_mutex);
        while (m_count > 0) {
            m_cond.wait(lock);
        }
    }
    bool is_ready() const {
        boost::mutex::scoped_lock lock(m_mutex);
        return (m_count == 0);
    }
private:
    mutex m_mutex;
    condition_variable m_cond;
    unsigned int m_count;

};
~~~

提案说`count_down`可以接受一个正整数来决定减多少, 但似乎没有说这个正整数很大会怎么样, 所以这里如果`n`大于`m_count`就将`m_count`设为0.

## std::barrier和std::flex_barrier

`std::barrier`和`std::flex_barrier`接口基本一样, 只是`std::flex_barrier`可以一轮完成后调用一个函数对象,决定下一轮有几个线程参与, 跟高版本的`boost::barrier`类似. 

除开构造析构等, `std::barrier`只有两个接口:

~~~
class barrier {
public:
  explicit barrier(ptrdiff_t num_threads);
  barrier(const barrier&) = delete;

  barrier& operator=(const barrier&) = delete;
  ~barrier();

  void arrive_and_wait();
  void arrive_and_drop();
};
~~~

arrive_and_wait比较好理解, 跟boost::barrier::wait应该是一样的语义. 但arrive_and_drop就有趣了, 提案里面是这么说的:

> Removes the current thread from the set of participating threads. Arrives
> at the barrier's synchronization point. It is unspecified whether the function blocks
> until the completion phase has ended. [ Note: If the function blocks, the calling
> thread may be chosen to execute the completion phase. — end note ]

没有指定会不会阻塞等待本轮同步结束, 这已经够迷了, 更迷的是, 什么叫"current thread"? 难道还把线程id记住了不成? 如果是记线程id, 可能就意味着std::barrier不能用于线程池了. 巧的是, 参考文献中的例子也是用在自己new出来的线程对象上.

毕竟C++20还比较遥远, 我们暂时还不知道`std::barrier`会怎么表示"current thread", 至于在生产环境用上更是有生之年. 综上所述, 还是用boost比较有希望.

## barrier的用途

不得不说, 要突然想一个日常开发会用上barrier的场景还是挺让人为难的. 查阅过的参考文献主要有以下几种例子:

- 合并结果, 比如开头的排序, 文献[5]中的矩阵运算, 用于唤醒主线程以合并结果.
- 前趋关系, 比如语句S1必须在语句S2前执行, 但是语句S1在线程1, 而语句S2在线程2, 就可以再S1后及S2前插barrier[6]
- 构建测试, 比如想测试某些接口, 就起好一堆线程, 都等在barrier那, 最后一个线程wait时, 一堆线程都恢复执行去调你要测的接口.[7]

**Reference:**  
* {:.ref} \[1]  wikipedia. [Barrier](https://en.wikipedia.org/wiki/Barrier)  
* {:.ref} \[2]  Rainer Grimm. [Latches And Barriers](http://www.modernescpp.com/index.php/latches-and-barriers). Feb. 2017.  
* {:.ref} \[3]  Anthony Williams. [Condition Variable Spurious Wakes](https://www.justsoftwaresolutions.co.uk/threading/condition-variable-spurious-wakes.html). June.2008.  
* {:.ref} \[4]  cpprefernece. [std::barrier](https://en.cppreference.com/w/cpp/experimental/barrier)  
* {:.ref} \[5]  Andrew S. Tanenbaum. 陈向群, 马洪兵等译. 现代操作系统(第三版). 机械工业出版社. 2012. p81~p82    
* {:.ref} \[6]  汤小丹, 梁红兵, 哲凤屏, 汤之瀛. 计算机操作系统(第三版). 西安限制科技大学出版社. 2007. p56~p57  
* {:.ref} \[7]  Lokesh Gupta. [Java concurrency – CountDownLatch Example](https://howtodoinjava.com/core-java/multi-threading/when-to-use-countdownlatch-java-concurrency-example-tutorial/). July. 2013.  

