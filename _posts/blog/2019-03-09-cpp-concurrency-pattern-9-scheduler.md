---
layout: post
title: C++并发型模式#9&#58; 定时任务 - Scheduler
description: 本文介绍Scheduler, 基于boost::chrono, 分析一下boost::executor::scheduler的源码.
category: blog
---

这里说的Scheduler是维基上所说的"Scheduled-task pattern"[1], 而不是系统资源调度的那个"Scheduling(computing)"[2]. 毕竟, 基于线程的讨论, 我们不会打算去控制系统怎么调度线程. (也许等到我们讲到fiber的时候, 就需要自己调度fiber了). 

所以这里的Scheduler就是定时任务(的调度), 比如1秒后做个什么事情, 8点20做个什么事情. 换成代码上的说法就是, 一个时间间隔(duration)后执行某项任务(task), 某个时间点(time point)执行某项任务(task).

## C++中的时间

之前我们一直避开时间的讨论, 是因为时间确实是个复杂的东西, 而且boost中时间相关的库更是复杂. 不过好在boost::chrono进标准成了std::chrono, 我们就只讨论boost::chrono好了.

### 时钟

时钟(Clock) 在chrono中是一个Concept或者说Requirement, 它要求时钟类提供以下信息:

- 当前时间(now)
- 从时钟获取到的时间值的类型(representation type, 通常是int, long之类的), 以及duration和time_point的typedef)
- 时钟的节拍周期(tick ratio)
- 时钟是否匀速(steady)计时

chrono至少提供`system_clock`, `steady_clock`, `high_resolution_clock`三种时钟, 每种都符合上面说的Concept或者说Requirement.

我们先来看匀速(steady)的概念. 如果一个时钟是匀速且不可调整的, 那么这个时钟(类)就是匀速的, 比如说`boost::chrono::steady_clock`. 好吧, 听起来像废话, 但问题是, 系统时间它通常都是不匀速的. 系统时间是可调整的. 因为本地时钟漂移, 系统甚至自动调整时间. 所以先后两次`boost::chrono::system_clock::now()`返回的时间不是单调递增的, 而`boost::chrono::steady_clock::now()`这是单调递增的. 在多线程编程中, 使用匀速时钟是有到处的, 至少不会因为系统时钟调整而出现什么惊喜.

节拍周期指时钟每秒走多少拍, 比如每秒走25拍, 我们可以定义出`boost::ratio<1,25>`, 显然, 这通常是编译期决定的, 而我们通常不会关心它(至少现在还不需要关心它).

### 时间间隔

duration, 它表示时间间隔, 时间段. 实现上它是个模板, 模板参数是上面说的节拍周期和时间值类型, 我们通常也不太关心具体怎么特化, 因为chrono已经帮我们定义好了一些typedef: nanosechonds, microseconds, milliseconds, seconds, minutes, hours. chrono还提供了他们之间算术运算符以及转换函数`boost::chrono::duration_cast`:

~~~
boost::chrono::milliseconds d1(2333);
boost::chrono::seconds d2 = boost::chrono::duration_cast<boost::seconds>(d1);
//d2应该是2秒
~~~

因为时间值类型是某种整形, 所以小的往大的转, 就会截断(不是四舍五入).

### 时间点

time_point, 表示时间点, 时刻. 实现上它也是个模板, 参数比duration还多, 不过我们通常也不用关心, 因为我们都是使用clock提供的typedef的.

虽然时间点经常用于表述绝对时间, 但是我们却很少真去定义一个明确的时间点, 比如"9102年3月12日20点37分00秒", 通常是从now开始, 加减一个duration出来的.

时间点经常用于条件变量的超时等待, 比如某场景下, 我们最多等500毫秒:

~~~
boost::condition_variable cond;
boost::mutex mtx;
bool done = false;

const auto timeout = boost::chrono::steady_clock::now() + boost::chrono::milliseconds(500);
boost::unique_lock<boost::mutex> lk(mtx);
while (!done) {
    if (cond.wait_until(lk, timeout) == boost::cv_status::timeout) {
        break;
    }
}
~~~

因为要处理伪唤醒, 所以这里要用while, 如果这里用时间段的`wait_for`, while循环中你还得把过去的时间减掉, 否则可能一直伪唤醒, 一直重复进入等待, 等到天荒地老. 所以还是用时间点好了, 即使伪唤醒了, 下次等还是那个时间点. 

## scheduler

boost的scheduler可以指定executor(executor我们下篇才讨论, 它决定任务在哪个线程(池)执行). 如果我们去掉指定executor的接口, scheduler只是使用一个线程执行task, 接口大概如下:

~~~
class work;
class scheduler {
public:
    typedef boost::chrono::steady_clock::time_point time_point;
    typedef boost::chrono::steady_clock::duration duration;
public:
    scheduler();
    ~scheduler();
public:
    void submit_at(work w, const time_point& tp);
    void submit_after(work w, const duration& dura);
};
~~~

`submit_at`就是在`tp`这个时间点执行`w`; `submit_after`就是`dura`这么多时间后执行`w`.

这里的`class work`是需要我们去定义和实现的任务类, 实际上它可以是这样的:

~~~
class work_base {
public:
    virtual void call() = 0;
};

class work : public work_base {
public:
    virtual void call() {
        //...
    }
};
~~~

派生类各种重载虚函数`call`, 然后要执行的任务就在`call`里面实现;

也可以是这样的:

~~~
typdef boost::function<void()> work;
~~~

当然boost跟倾向于后者, 以闭包做work, 这样更泛用一些, 相关讨论可以查参考[Closure](https://www.boost.org/doc/libs/1_69_0/doc/html/thread/synchronization.html#thread.synchronization.executors.rationale.closure).

用起来就像:

~~~
boost::executors::scheduler<boost::chrono::steady_clock> sc;
sc.submit_after([] {
    std::cout << "hello world" << std::endl;
}, boost::chrono::seconds(5));
~~~

所以, 综上所述, scheduler就是个可以指定时间执行任务的东西, 这个执行通常在别的线程, 所以它是并发编程模式的一种.

## scheduler的实现

boost的scheduler派生自`boost::executors::detail::scheduled_executor_base`, 它提供基本的`submit_at`, `submit_after`实现.

`boost::executor::detail::scheduled_executor_base`则派生自`boost::executor::priority_executor_base`, 它提供我们用来执行任务的线程的函数体(包括任务队列). 

`boost::executor::scheduler`本身这持有执行任务的线程(以及指定executor的一系列操作, 我们下篇在谈).

忽略模板, 派生结构如下:

~~~
class priority_executor_base {};
class scheduled_executor_base : public priority_executor_base {};
class scheduler : public scheduled_executor_base {};
~~~

我们先来看scheduler, 它在构造时新建线程, 而线程的执行体这来自`priority_executor_base`的成员函数, 假设这个成员函数就叫`loop`:

~~~
class priority_executor_base {
public:
    void loop();
    void close();
};
class scheduled_executor_base : public priority_executor_base {}

class scheduler : public scheduled_executor_base {
    boost::thread m_thread;
public:
    scheduler() : scheduled_executor_base(), m_thread(&priority_executor_base::loop, this) {}
    ~scheduler() {
        priority_executor_base::close();
        m_thread.interrupt();
        m_thread.join();
    }
};
~~~

`priority_executor_base::close()`会管理任务队列, 这里的任务队列也是我们上一篇讨论的阻塞队列的衍生, 关闭时会唤醒所有等待的线程. 这样`m_thread`就能顺利退出.

`scheduled_executor_base`实现的`submit_at`以及`submit_after`其实就是把任务放到任务队列里, 这里的任务队列是优先队列, 优先级由时间决定. 所以很自然的, 任务队列里储存的是时间点, `submit_after`也会把时间段加上`now()`变成时间点:

~~~
class sync_timed_queue;
class priority_executor_base {
public:
    sync_timed_queue m_workq;

    void close();
    bool closed() const;
    void loop();
};

class scheduled_executor_base : public priority_executor_base {
public:
    typedef boost::chrono::steady_clock clock;
    typedef typename clock::time_point time_point;
    typedef typename clock::duration duration;

public:
    scheduled_executor_base(){}
    ~scheduled_executor_base() {
        if (!priority_executor_base::closed()) {
            priority_executor_base::close();
        }
    }
    void submit_at(work w, const time_point& tp) {
        priority_executor_base::m_workq.push(w, tp);
    }
    void submit_after(work w, const duration& dura) {
        priority_executor_base::m_workq.push(w, clock::now() + dura);
    }
};
~~~

事实上, `priority_executor_base`的实现也不复杂, 因为排序, 超时等都封装到`sync_timed_queue`去了:

~~~
class sync_timed_queue;
class priority_executor_base {
public:
    sync_timed_queue m_workq;

    void close() {
        m_workq.close();
    }
    bool closed() const {
        return m_workq.closed();
    }
    void loop() {
        // maybe support thread interrupted here, so use try catch
        try {
            for (;;) {
                try {
                    work task;
                    queue_op_status st = m_workq.wait_pull(task);
                    if (st == queue_op_status::closed) {
                        return;
                    }
                    // execute task !
                    task();
                } catch (boost::thread_interrupted&) {
                    return;
                }
            } // end for
        } catch (...) { // task() may throw exeception
            std::terminate();
            return;
        } // try
    }
};
~~~

`loop`函数实际上就是不停地从任务队列里拿出任务, 然后执行, 时间问题全然交予任务队列处理. 如果任务队列close了, 线程也就完成返回了. 所以, 这里的实现难点, 其实在`sync_timed_queue`.

事实上这里跳过了许多讨论, 比如有些scheduler示例[5]就不只是在一个线程上执行, 而是每submit一个任务就创建一个线程, 然后sleep到定的时间. 这样的问题是显然的, 因为我们的任务可能很多, 而系统允许的线程数量确是有限的. 而且, 这种写法产生很多线程, 影响debug.

### sync_timed_queue

boost的sync_timed_queue当然是接口繁多, 不过我们上面其实就用到了其中一些接口, 所以我们可以简化一下:

~~~
struct scheduled_type;
class sync_timed_queue : sync_queue_base<scheduled_type> {
public:
    sync_timed_queue();
    ~sync_timed_queue();
public:
    void push(const work& w, const time_point& tp);
    queue_op_status wait_pull(work& w);
};
~~~

这里的`sync_queue_base`就是我们上篇分析多的`sync_queue_base`, 不过需要把`underlying_queue_type`改成`std::priority_queue`.

`scheduled_type`是把`work`和`time_point`包在一起的结构, 以作为`std::priority_queue`的数据类型. `scheduled_type`需要实现`operator<`, 这个`operator<`是要求偏序的, 不过好在`boost::chrono::steady_clock::time_point`因为是匀速时钟的时间点, 已经是偏序的:

~~~
struct scheduled_type {
    typdef boost::function<void()> work;
    typedef boost::chrono::steady_clock::time_point time_point;
    
    work data;
    time_point time;

    scheduled_type(const work& w, const time_point& tp);
    scheduled_type(const scheduled_type& other);
    scheduled_type& operator=(const scheduled_type& other);
};

bool operator < (const scheduled_type& lhs, const scheduled_type& rhs) {
    return lhs.time > rhs.time; // 时间小的排前面
}
~~~


现在我们最关心的应该是`wait_pull`怎么实现的:

~~~
queue_op_status sync_timed_queue::wait_pull(work& w) {
    boost::unique_lock<boost::mutex> lk(m_mtx);
    return wait_pull(lk, w);
}

queue_op_status sync_timed_queue::wait_pull(boost::unique_lock<boost::mutex>& lk, const work& w) {
    const bool has_been_closed = wait_until_not_empty_time_reached_or_closed(lk);
    if (has_been_closed) {
        return queue_op_status::closed;
    }
    pull(lk, w);
    return queue_op_status::success;
}

void sync_timed_queue::pull(boost::unique_lock<boost::mutex>& lk, work& w) {
    w = m_data.top().data;
    m_data.pop();
}
~~~

其中`wait_pull`是调用`wait_until_not_empty_time_reached_or_closed`来等待, 这个我们还没实现, 因为它比较复杂. 等到可以pull的时候, 就把`m_data`的`top`给`pop`出来. 一切就很明了, 就是这个`wait_to_pull`.

`wait_until_not_empty_time_reached_or_closed`要做什么呢? 看名字就挺多的, 首先, 跟简单的`sync_queue`一样, 要等待非空; 其次, 即使非空了, 但指定的时间还没到, 也得等. 新的任务进来了, 得看一下新任务会不会更快到时间...直到非空且队首时间已到.

~~~
// 这里返回true表示队列关闭, 返回false表示可以pull
bool sync_timed_queue::wait_until_not_empty_time_reached_or_closed(boost::unique_lock<boost::mutex>& lk) {
    for (;;) {
        if (sync_queue_base::closed(lk)) {
            return true;
        }
        while (!sync_queue_base::empty(lk)) {
            if (time_reached(lk)) {
                return false;
            }
            const time_point tp(m_data.top().time);
            m_cond_not_empty.wait_until(lk, tp);
            if (sync_queue_base::closed(lk)) {
                return true;
            }
        }
        if (sync_queue_base::closed(lk)) {
            return true;
        }
        m_cond_not_empty.wait(lk);
    }
}

~~~

我们看到它有个循环, 循环体中, 首先看一下队列有没有关闭. 然后如果队列非空, 则进超时等待, 等待的时长在内层的`while`循环中每次更新, 因为push会notify`m_cond_not_empty`, 所以有新任务进来的时候, 内层的`while`循环中的`wait_until`会唤醒, 然后(也许队首更新了)如果还是到时间, 就在此进入超时等待.

如果队列空的话, 则等待被`push`或`close`唤醒. 所以, 但此函数返回的时候, 要么队列关闭了, 要么就是队首的时间到了.


`time_reached`其实比较简单, 只是简单地查询一下状态:

~~~
bool sync_timed_queue::time_reached(boost::unique_lock<boost::mutex>& lk)  const {
    return clock::now() >= m_data.top().time;
}
~~~

然后我们来实现`push`, 大部分代码跟我们实现的`sync_queue`是一样的:

~~~
void sync_timed_queue::push(const work& w, const time_point& tp) {
    push(scheduled_type(w, tp));
}

void sync_timed_queue::push(const scheduled_type& elem) {
    boost::unique_lock<boost::mutex> lk(m_mtx);
    sync_queue_base::throw_if_closed(lk);
    push(elem, lk);
}

void sync_timed_queue::push(const scheduled_type& elem, boost::unique_lock<boost::mutex>& lk) {
    m_data.push(elem);
    sync_queue_base::notify_not_empty_if_needed(lk);
}

~~~

(这是boost 1.66的写法, 1.67~1.69可能有bug, 参考[issue 271](https://github.com/boostorg/thread/issues/271) )

### on executor

也许看到这里你已经发现了一个问题, 我们的task是让一个线程执行的, 如果我们的task执行时间很长, 后面的task就可能被耽误了.

那么很自然的想法是, 每个task新开一个线程执行, 这样延时是小了, 但是task多了又会说, 调度浪费过多系统资源啦, 之类的.  放到一个线程池里执行, 也许又觉得延迟大了.
 
所以, 很C++地, 让用户自己决定好了. 这个task怎么跑? 你传什么executor, 它就怎么跑.

当然, 实际上scheduler的那个线程还在, 我们只是包装了一下task, 包装过的给scheduler, 到时间就把实际上的task提交到executor.

boost中executor是一个concept, 方便起见我们只要求这个concept有`void submit(work w)`. `submit`接受的也是`boost::function<void()>`. 包装task的类我们称为`resubmitter`好了:

~~~
template <typename Executor>
class resubmitter {
    Executor& ex;
    work func;
public:
    resubmitter(Executor& ex, work w) : ex(ex), func(w) {}
    void operator()() {
        ex.submit(func);
    }
};

~~~

那resubmitter怎么用的? boost又双叒叕包装了一下, 反正用起来就像:

~~~
scheduler sc;
basic_thread_pool ex;

sc.on(ex).after(boost::chrono::milliseconds(500)).submit([](){
    std::cout << "hello world" << std::endl;
});
~~~

其中`on`返回的是`scheduler_executor_wrapper`, `after`返回的是`resubmit_at_executor`. 嗯......总之我们知道他们需要以下接口:

~~~
template <typename Executor>
class resubmit_at_executor {
    scheduler& sch;
    Executor& ex;
public:
    typedef typename scheduler::clock clock;
public:
    resubmit_at_executor(scheduler& sch, Executor& ex, const clock::time_point& tp);
    ~resubmit_at_executor();
public:
    void submit(work w);
};

template <typename Executor>
class scheduler_executor_wrapper {
    scheduler& sch;
    Executor& ex;
public:
    typedef typename scheduler::clock clock;
public:
    scheduler_executor_wrapper(scheduler& sch, Executor& ex);
    ~scheduler_executor_wrapper();
public:
    resubmit_at_executor<Executor> after(const clock::duration& dura);
    resubmit_at_executor<Executor> at(const clock::time_point& tp);
};

class scheduler {
public:
    template<typename Ex>
    scheduler_executor_wraper<Ex> on(Ex& ex);
};
~~~

我们从`on`开始, 首先`on`就是为了得到一个`scheduler_executor_wrapper`:

~~~
template<typename Ex>
scheduler_executor_wrapper<Ex> scheduler::on(Ex& ex) {
    return scheduler_executor_wrapper<Ex>(*this, ex);
}
~~~

`scheduler_executor_wrapper`的构造函数就是把`sch`和`ex`俩引用成员初始一下, 不赘述.

`after`和`at`则是为了得到一个`resubmit_at_executor`:

~~~
template<typename Ex>
resubmit_at_executor<Ex> scheduler_executor_wrapper<Ex>::after(const clock::duration& dura) {
    return at(clock::now() + dura);
}

template<typename Ex>
resubmit_at_executor<Ex> scheduler_executor_wrapper<Ex>::at(const clock::time_point& tp) {
    return resubmit_at_executor(sch, ex, tp);
}
~~~

最后是`resubmit_at_executor`, 其构造函数也是将引用成员初始一下, 不赘述. `submit`这是构造一个`resubmitter`, 然后提交到引用的scheduler去:

~~~
template<typename Ex>
void resubmit_at_executor<Ex>::submit(work w) {
    sch.submit_at(resubmitter(ex, w), tp);
}
~~~

实际上scheduler和executor都是可以close的, `submit`要考虑是否已经closed了, 不过这部分代码不难<del>留作习题</del>.

## 总结

scheduler使用优先队列, 把任务按时间排序, 无论接口上是时间点还是时间段, 储存在内部数据结构的都是时间点, 使得我们可以按顺序执行到时间的任务. scheduler内维护了一个线程, 用于执行任务, 但队首的时间点未到时, 会进入超时等待. 但是, 新任务入队会唤醒这个等待, 因为新任务可能会是新的队首.

由于任务的执行时间不定, 为了避免延迟, boost允许用户指定executor, 比如线程池. 到达指定的时间点时, 将任务提交到executor. 

在其他资料上也许能见到"定时器(Timer)", 这个概念, 它也是提交定时任务, 那它跟scheduler是不是一个东西呢? 先说结论: 我不知道! 可能的区别是, Timer允许提交周期性任务, 延迟太多则不执行之类的. 

executor的具体讨论我们留作下一篇. 它抽象了我们执行任务的方法, 它可能是单一的线程, 可能是线程池, 可能为每个任务开一个线程, 也可能是复杂的"work stealing fork join thread pool"(不过boost应该不会这样, fork-join已经有task_region提案).