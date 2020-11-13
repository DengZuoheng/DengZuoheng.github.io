---
layout: post
title: C++并发型模式#13&#58; 动态任务分解 - fork/join
description: 在某些程序中, 并发任务的数量随程序执行而变化, 这种动态性使得简单的控制结构(如简单的线程池)无法实现良好的并行化. 那么如何围绕复杂动态任务集构造并行程序呢?
category: blog
---

## Introduction

将一个复杂的任务分解成更简单的任务再一一解决, 使得每一个子程序更加易于理解并确保其正确, 这是我们常用的方法. 虽然给函数起名是一件痛苦的事情, 但大多数时候我们都乐于做这样的分解.

非递归的场景下, 我们可能有这样的代码:

~~~c++
void foobar(int k) {
    if (k % 2) {
        foo();
        bar();
    } else {
        foo();
    }
}
~~~

递归的情况下, 我们常以斐波那契数列为例:

~~~c++
int fib(int n) {
    if (n == 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        return fib(n-1) + fib(n-2);
    }
}
~~~

现在我们有多线程了, 有executor框架了, 我们很自然就希望那些不直接依赖的子问题可以并行的解决, 而且有充分的并发性, 比如说:

~~~c++

void foobar(int k) {
    if (k % 2) {
        boost::future<void> f1 = boost::async(foo);
        boost::future<void> f2 = boost::async(bar);
        f1.wait();
        f2.wait();
    } else {
        foo();
    }
}

int fib(int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = boost::async(fib, n-1);
        boost::future<int> f2 = boost::async(fib, n-2);
        return f1.get() + f2.get();
    }
}

template<typename Ex>
int fib(Ex& ex, int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = boost::async(ex, fib, n-1);
        boost::future<int> f2 = boost::async(ex, fib, n-2);
        return f1.get() + f2.get();
    }
}

~~~

任务在执行过程中视情况动态地创建(派生)子任务, 然后聚合子任务的结果, 这种并发地处理子问题的方法就是`fork/join`(派生/聚合)模式了[6]. 这里的`boost::async`就是`fork`, `get`并将结果相加就是`join`. 虽然看起来很简单, 但是这样简单的写法会碰到许多问题, 比如:

- 如果executor不是固定线程数的线程池, 比如说我们用`boost::thread_executor`, 你会产生很多线程
- 如果executor是固定线程数的线程池, 有很多的任务在等待子任务导致没有线程去执行子任务了
- 没等子任务完成, 父任务就返回了
- 子任务相互依赖, 导致奇怪的死锁

下面, 我们来一个个解决这些问题.

## fork/join in fixed thread pool

相对于不限线程数的`fork/join`, 我们更期待固定线程数的线程池的`fork/join`, 但这样会死锁. 

固定线程池为什么会死锁呢? 这是一个很容易重现的问题, 假设我们现在计算`fib`, `n=3`, 线程池只有两个线程. 主线程提交了t0`fib(3)`.

开始时, 线程1拿到t0`fib(3)`, 线程2空着; 然后线程1`fork`了两个任务: t1`fib(2)`, t2`fib(1)`, 线程1阻塞; 然后线程2拿到`fib(2)`, 又`fork`了两个任务: t3`fib(1)`, t4`fib(0)`, 线程2阻塞; 这时任务队列里面有3个任务: 线程1提交的t0`fib(3)`的第二个子任务t2`fib(1)`, 线程2提交的t3`fib(1)`和t4`fib(0)`, 但是, 两线程均阻塞, 已经没有空闲的线程去执行它们了.

这个问题主要是因为我们`join`的时候把当前线程阻塞了, 那有没有办法不阻塞呢? `reschedule_until`是一种办法. `reschedule_until`的意思时, 从executor的任务队列中取一个任务出来在当前线程执行, 直到某一条件达成或者任务队列空, 我们可以拿`basic_thread_pool`的`reschedule_until`复习一下:

~~~c++

template <typename Pred>
bool basic_thread_pool::reschedule_until(const Pred& pred) {
    do {
        if (!try_executing_one()) {
            return false;
        }
    } while (!pred());
    return true;
}
bool basic_thread_pool::try_executing_one() {
    try {
        work task;
        if (m_tasks.try_pull(task) == queue_op_status::success) {
            task();
            return true;
        }
        return false;
    } catch (...) {
        std::terminate();
    }
}
~~~

这样我们可以改造一下`fib`:

~~~c++
int fib(Ex& ex, int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = boost::async(ex, fib, n-1);
        boost::future<int> f2 = boost::async(ex, fib, n-2);
        ex.reschedule_until([&]()->bool{
            return f1.is_ready() && f2.is_ready();
        });
        return f1.get() + f2.get();
    }
}
~~~

现在, 我们再来分析一下`fib(3)`, 简单起见, 我们先讨论只有一个线程的情况:

线程1提交了两个任务之后, 会进入`reschedule_until`, 这时候任务队列有两个刚刚提交的任务: t1`fib(2)`, t2`fib(1)`. `f1`和`f2`均没有`ready`, 所以`reschedule_until`会取出t1`fib(2)`出来执行.

执行t1`fib(2)`又提交t3`fib(1)`和t4`fib(0)`, 此时的队列是:t2`fib(1)`, t3`fib(1)`, t4`fib(0)`; 然后进入新的`reschedule_until`(t1`fib(2)`也是需要等两个子任务的), 取出队首的t2`fib(1)`, 直接解决, 但是等的子任务还没完成, 继续取出下一个任务t3`fib(1)`直接解决, 继续取出t4`fib(0)`直接解决. 这时t1`fib(2)`等的两个子任务完成, 退出自己的`reschedule_until`, t1`fib(2)`完成, 因为t0`fib(3)`提交的t2`fib(1)`已经被t1`fib(2)`等待子任务时的`reschedule_until`解决了, 所以t0`fib(3)`等的子任务也已经完成, 所以t0`fib(3)`也就完成了.

这样的改良存在两个问题:

- 如果是有多个工作线程的情况, `fib(3)`提交的子任务可能被其他线程拿掉而导致`reschedule_until`拿不到任务而退出, 此时任务队列是空的, 当前线程仍会进入阻塞等待, 但是没关系, 此时等待的子任务已经在执行了, 不会导致死锁.

- 一般executor是先进先出的, 那么`reschedule_until`不一定先执行自己提交的子任务, 也可能是执行任务队列中茫茫多的别人的任务, 那就冤了, 那得猴年马月才轮到自己的子任务, 这样cache也不友好. 而且, 别人的任务大概也有子任务, 这样无限制地`reschedule_until`, 调用栈会堆得很高, 高到可能爆栈.[5]

所以, `fork/join`一般采用双端队列[4], 提交子任务的时候提交到队首, 保证无论哪个线程拿了队首任务, 都保证了子任务先被执行, 减少`reschedule_until`的发生, 调用栈很高得情况会比单端队列少一些.

## using deque for tasks

为了使用双端队列, 我们boost的executor concept只有一个submit就不够用了, 我们需要用deque重写`basic_thread_pool`, 好在boost有`sync_deque`, 我们暂时不需要自己去实现一个双端任务队列.

~~~c++
class deque_thread_pool {
public:
    void submit(work& w) { submit_back(w); }
    void submit_back(work& w);
    void submit_front(work& w);
};

template<typename T, typename F, typename Ex>
boost::future<T> fork(Ex& ex, F&& func) {
    boost::promise<T> pr;
    boost::future<T> ft = pr.get_future();
    ex.submit_front([p = std::move(pr), f = std::move(func)]() {
        try {
            p.set_value(f());
        } catch (std::exception& e) {
            p.set_exception(e);
        }
    });
    return ft;
}
~~~

这样我们可以得到新版本的`fib`:

~~~c++
int fib(Ex& ex, int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = fork(ex, fib, n-1);
        boost::future<int> f2 = fork(ex, fib, n-2);
        ex.reschedule_until([&]()->bool{
            return f1.is_ready() && f2.is_ready();
        });
        return f1.get() + f2.get();
    }
}
~~~

但即使如此, cache不友好得情况仍然还在, 因为你提交两个子任务可能瞬间就被其他线程拿掉了. 你`reschedule_until`的可能还是茫茫多的别人的任务.

如果想尽量在本线程完成自己提交的子任务, 工作线程就需要维护一个自己的任务队列, 然后双端队列保证自己提交得子任务后进先出, `reschedule_until`就先取本线程的任务队列的任务来执行. (这里用双端队列而不是栈是为了未来允许其他线程过来work stealing)

取本线程的任务队列, 我们上面写的`reschedule_until`就不行了, 我们得写一个新的`fork_join_thread_pool`.

## deque per worker thread

对于每个工作线程都有一个双端任务队列的情况, 我们可以列出如下接口:

~~~c++
class fork_join_thread_pool {
    std::map<boost::thread::id, boost::shared_ptr<boost::thread> > m_threads;
    std::map<boost::thread::id, booost::shared_ptr<sync_deque<work> > > m_per_thread_tasks;
    sync_queue<work> m_tasks;

public:
    fork_join_thread_pool(size_t thread_count = boost::thread::hardware_concurrency() + 1);
    ~fork_join_thread_pool();

public:
    bool try_executing_one();
    void close();
    bool closed();
    template<typename Pred>
    bool reschedule_until(const Pred&);
    void submit(work& w);
    void submit_front(work& w);
    void submit_back(work& w);
    void run();
};

~~~

使用`std::map`来存, 是为了`submit`和`reschedule_until`的时候可以根据当前线程id来进行. 这个map会很小, 所以我们相信其性能不会太差, 当然我们也可以根据需要用别的数据结构代替.

~~~c++
fork_join_thread_pool::fork_join_thread_pool(size_t thread_count) {
    try {
        boost::latch lt(thread_count);
        for (size_t i = 0; i < thread_count; ++i) {
            boost::shared_ptr<boost::thread> tr(new boost::thread([&]{
                lt.wait();
                this->run();
            }));
            m_per_thread_tasks[tr->id()].reset(new sync_deque<work>);
            m_threads[tr->id()] = tr;
            lt.cound_down();
        }
    } catch(...) {
        close();
        throw;
    }
}
~~~

因为我们需要线程id做key, 所以线程对象会先于任务队列构造出来. 为了保证线程安全, 构造函数用了`boost::latch`, 这限制了`run`函数不会在所有工作线程和任务队列构造完之前被执行.

~~~c++
void fork_join_thread_pool::run() {
    try {
        assert(m_per_thread_tasks.find(boost::this_thread::get_id()) != m_per_thread_tasks.end());
        sync_deque<work>& local_task = *m_per_thread_tasks.at(boost::this_thread::get_id());
        for (;;) {
            work task;
            try {
                boost::concurrent::queue_op_status st = local_tasks.try_pull(task);
                if (st == boost::concurrent::queue_op_status::success) {
                    task();
                    continue;
                }

                boost::concurrent::queue_op_status st = m_tasks.wait_pull(task);
                if (st == boost::concurrent::queue_op_status::closed) {
                    return;
                }
                task();
            } catch (boost::thread_interrupted&) {
                return;
            }
        } // for
    } catch (...) {
        std::terminate();
        return;
    }
}
~~~

在`run`函数中, 首先我们先尝试从此线程的任务队列中取任务执行, 直到线程的任务队列为空, 再从线程池的公共任务队列取任务.

~~~c++
void fork_join_thread_pool::submit_front(work& w) {
    const boost::thread::id this_id = boost::this_thread::get_id();
    auto it = m_per_thread_tasks.find(this_id);
    if (it != m_per_thread_tasks.end()) {
        booost::shared_ptr<sync_deque<work> > q = it->second;
        if (q) {
            q->push_front(w);
            return;
        }
    }
    m_tasks.push_front(w);
}

void fork_join_thread_pool::submit_back(work& w) {
    const boost::thread::id this_id = boost::this_thread::get_id();
    auto it = m_per_thread_tasks.find(this_id);
    if (it != m_per_thread_tasks.end()) {
        booost::shared_ptr<sync_deque<work> > q = it->second;
        if (q) {
            q->push_back(w);
            return;
        }
    }
    m_tasks.push_back(w);
}
~~~

`submit_front`和`submit_back`都先找一下有没有当前线程对应的任务队列, 没有才提交到线程池的任务队列中.

~~~c++
bool fork_join_thread_pool::reschedule_until(const Pred& pred) {
    const boost::thread::id this_id = boost::this_thread::get_id();
    auto it = m_per_thread_tasks.find(this_id);
    if (it != m_per_thread_tasks.end()) {
        booost::shared_ptr<sync_deque<work> > q = it->second;
        if (q) {
            return reschedule_until(pred, q);
        }
    }
    do {
        if (!try_executing_one(m_tasks)) {
            return false;
        }
    } while (!pred());
    return true;
}

bool fork_join_thread_pool::reschedule_until(const Pred& pred, booost::shared_ptr<sync_deque<work> > local_tasks) {
    do {
        if (!try_executing_one(*local_tasks)) {
            if (!try_executing_one(m_tasks)) {
                return false;
            }
        }
    } while (!pred());
    return true;

}

bool fork_join_thread_pool::try_executing_one(sync_deque<work>& queue) {
    try {
        work task;
        if (queue.try_pull(task) == queue_op_status::success) {
            task();
            return true;
        }
        return false;
    } catch (...) {
        std::terminate();
    }
}
~~~

`reschedule_until`会复杂一些, 因为可能有当前线程对应的任务队列, 但是此任务队列可能没有任务, 于是我们又要看线程池的公共任务队列有没有任务.

当我们不在工作线程调用`reschedule_until`时, `try_executing_one`执行任务中提交的子任务都会提交到线程池的任务队列中.

至此, 我们实现了`fork_join_thread_pool`, 方便起见, 我们可以写一个`join`函数:

~~~c++

template<typename T, typename Ex>
void join(Ex& e, future<T>& f) {
    const bool ret = ex.reschedule_until([&]() {
        return f.is_ready();
    });
    if (!ret) {
        f.wait();
    }
}

template<typename T1, typename T2, typename Ex>
void join(Ex& e, future<T1>& f1, future<T2>& f2) {
    const bool ret = ex.reschedule_until([&]() {
        return f1.is_ready() && f2.is_ready();
    });
    if (!ret) {
        boost::wait_for_all(f1, f2);
    }
}
~~~

这样我们得到了新版本的`fib`:

~~~c++
int fib(Ex& ex, int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        boost::future<int> f1 = fork(ex, fib, n-1);
        boost::future<int> f2 = fork(ex, fib, n-2);
        join(f1, f2);
        return f1.get() + f2.get();
    }
}
~~~

当然, 这还不是最终极的版本. 任务有大有小, 自己的大任务分解后很久都做不完怎么办? 其它线程闲着了这么办? 然后人们又让线程没任务的时候去帮其他线程, 这种玩法叫`work stealing`[1][4][6], 有点复杂, 我们需要单列一篇讨论, 这里不详谈.

## fork/join future task

future是可以作为参数或者返回值传递的, 但作为返回值时我们自然不会返回executor, 然而我们上面的`join`是需要executor的, 所以我们需要给future增加一个接口或者修改`wait`的行为, 方便起见, 我们增加一个`join`方法.

我们的future支持executor和then的时候, 在`shared_state_base`中保存了一个`executor_ptr`, 它是executor的指针包装. 所以我们的`shared_state_base::join`可以通过这个来`reschedule_until`.

~~~c++

void shared_state_base::join() {
    if (policy == launch_policy::policy_executor && ex) {
        const bool ret = ex->reschedule_until([&](){
            return this->is_ready();
        });
        if (ret) {
            return;
        }
    }
    wait();
}
~~~

同样我们可以有不带executor的free function `join`:

~~~c++
template<typename T1, typename T2>
void join(future<T1>& f1, future<T2>& f2) {
    f1.join();
    f2.join();
}
~~~

带executor的版本也可稍加改造:

~~~c++
template<typename T1, typename T2, typename Ex>
void join(Ex& e, future<T1>& f1, future<T2>& f2) {
    const bool ret = ex.reschedule_until([&]() {
        return f1.is_ready() && f2.is_ready();
    });
    if (!ret) {
        join(f1, f2);
    }
}
~~~

## task_region / task_block

使用free function来fork/join虽然很方便, 但却没有什么机制去限制当前任务必须等待子任务完成才退出. 虽然说逻辑上确实也可能存在不需要等待子任务的任务, 但这样的灵活性同样带来更多的心智负担和调试困难. 另一方面, 抛异常或者仅仅是程序员写错代码而导致子任务没有被join也可能带来一系列问题. 再者, 更严格的限制可能使得编译器做更多的针对性优化. 所以, C++社区选择了`fully-strict`的规则, 即子任务须在直接父任务完成前完成. (不fully的规则叫`terminally-strict`, 放宽到了祖先任务而不是直接父任务).[2]

`task_region`就是这样拿出来的提案, `join`不是程序员自己去写, 而是`task_regon`结束的时候自动`join`.

~~~c++
int fib(Ex& ex, int n) {
    if (n = 0) {
        return 0;
    } else if (n == 1) {
        return 1;
    } else {
        int f1 = 0;
        int f2 = 0;
        task_region(ex, [&](task_region_handle_gen<Ex>& trh) {
            trh.run([&]() { f1 = fib(n-1); });
            trh.run([&]() { f2 = fin(n-2); });
        }
        return f1 + f2;
    }
}
~~~

(也许你看`boost::experimental::parallel::task_region`的文档实例会发现跟上面这个写法有些许不同, boost中并没有为`f2`提交任务, 这是因为目前(boost1.7)的`task_region`实现仍然是没有在`wait`中调用`reschedule_until`或者其他调度策略的, 所以为了避免多余的等待, `f2`的计算就留在当前线程了)

`task_regon`是一个free function, 一般有两个版本, 一个只接受可调用对象, 另一个接受executor和可调用对象, 但其实没什么区别, 前者只是给了一个默认的executor而已.

接受的可调用对象是规定的, 它必须以`task_region_handle_gen<Ex>&`为参数, `task_region`内提交任务都必须通过这个参数. 回忆`task_region`的目的, 我们很容易想到, `task_region_handle_gen<Ex>`析构前会等待我们提交给它的子任务.

这样一来, 我们可以猜到`task_region`的实现:

~~~c++
tempate<typename Ex, typename F>
void task_region(Ex& ex, F&& f) {
    task_region_handle_gen<Ex> trh(ex);
    try {
        f(trh);
    } catch (...) {
        // handle task region exception
    }
    thr.wait_all();
}
~~~

`wait_all`即是等待所有子任务.

因为`wait_all`只会在`task_region_handle_gen<Ex>`析构或者`task_region`结束前被显示调用, 所以一个`task_region`内, 提交的子任务是不应捕获`trh`并在子任务中继续向其提交任务的. 如果我们要继续分割任务, 就再来一个`task_region`:

~~~c++
task_region(ex, [&](auto& trh) {
     trh.run([&]{
         task_region(ex, [&](auto& inner_trh) {
             inner_trh.run(f);
         });
         // ...
     });
     // ...
 }));
~~~

不考虑异常处理, 我们可以以如下方式实现`task_region_handle_gen<Ex>`:

~~~c++

template<typename Ex>
class task_region_handle_gen {
    Ex& m_ex;
    std::vector<boost::future<void> > m_futures;
public:
    task_region_handle_gen(Ex& ex): m_ex(ex) {}
    template<typename F>
    void run(F&& f) {
        m_futures.push_back(boost::async(m_ex, std::forward(f));
    }
    void wait_all() {
        boost::wait_for_all(m_futures.begin(), m_futures.end());
        // handle excetions if you need
    }
};
~~~

可以看到由于提案并没有要求`wait_all`的时候用什么策略`join`, 所以基本的实现中只是单纯地调用了`wait_for_all`. 如果我们要引入前几节的成果, 我们也容易写出另一个实现:

~~~C++
template<typename Ex>
class task_region_handle_gen {
    Ex& m_ex;
    std::vector<boost::future<void> > m_futures;
public:
    task_region_handle_gen(Ex& ex): m_ex(ex) {}
    template<typename F>
    void run(F&& f) {
        m_futures.push_back(fork(m_ex, std::forward(f));
    }
    void wait_all() {
        join(ex, m_futures.begin(), m_futures.end());
        // handle excetions if you need
    }
};
~~~

(迭代器版本的`join`的实现就留作练习吧)

`task_region`并不是一个好名字, 所以后来的提案(N4411)做出了修改, 以`define_task_block`替换`task_region`, 以`task_block`替换`task_region_handle_gen`[3]:

~~~c++
define_task_block(ex, [&](task_block& tb) {
     tb.run([&]{
         define_task_block(ex, [&](auto& inner_tb) {
             inner_tb.run(f);
         });
         // ...
     });
     // ...
 }));
~~~

看起来是不是更加清晰了呢(确信.jpg)?

## directed acyclic graph

我们可以写出子任务间有依赖的代码:

~~~c++
void foobar() {
    future<int> f1 = fork(ex, foo);
    future<int> f2 = fork(ex, [&]() {
        join(ex, f1);
        bar();
    });
    join(ex, f1, f2);
}
~~~

假设`foo`和`bar`都不会再`fork`, 这里可能死锁吗? 我们来分析一下.

`join`的时候, 任务队列可能有几种情况:

- `foo`和`bar`都在;
- `foo`被其他线程执行, `bar`还在;
- `foo`和`bar`分别被两个线程执行;
- `foo`和`bar`被同一个线程执行:

假如`foo`和`bar`都在, `join`首先会取出`foo`来执行, 此后又有两种可能: 继续取出`bar`执行, 这样对`f1`的依赖没有问题; `bar`被其他线程执行, 这个线程会`join` `f1`, 但`bar`已经被执行了, 不会死锁. 所以, 这种情况都不会死锁.

假如`foo`被其他线程执行, `bar`还在, `join`会取出`bar`执行, `foo`被其他线程执行, 只要等一下, `f1`就`ready`了, 也不会死锁.

假如`foo`和`bar`被同一个线程或不同线程执行, 显然没法死锁.

所以即使有一定程度的依赖, 也不会死锁; 事实上, 这个依赖图是有向无环图(DAG)就可以了[4], 甚至不要求是有向树. 为什么呢?

类似拓扑排序的卡恩算法, 我们设被依赖的任务有一个出度, 依赖的别人的任务有一个入度, 因为我们是有向无环图, 所以我们至少能找到一个入度为0的节点. 如果我们将这个节点及其出边移除掉, 我们要么得到一个新的有向无环图, 要么得到一个空图. 如此类推, 只要没有回路, 我们能把整个图的点移除掉.

那问题就在于, 我们的`join`时的`reschedule_until`能否保证能找到这样入度为0的点? 答案是可以的, 后进先出的fork是深度优先, 先进先出的fork是广度优先, 它们都是能遍历图的. 当`reschedule_until`找到了一个不依赖其他任务的任务, 就会完成这个任务, 这样这个任务的出边就相当于移除掉了.

同样我们可以得到, 有回路的图必然死锁.

当然, 以上讨论是建立在我们的图是从任务队列的某一个任务fork展开的. 那我们可以构造一些更邪恶的case, 比如说, 我们有n个线程, n+1个任务, 前n个任务依赖于最后一个任务, 如果我们不提交最后一个任务, 所有线程都会`reschedule_until`失败进入阻塞等待. 这时候再提交最后一个任务, 却没有线程去执行它, 然后真死锁了.

这不是一个容易解决的问题. 一种可能的方法是改成busy wait可以避免新任务没人执行, 浪费CPU. 另一种可能的解决方法是, `join`时注册条件变量到任务队列或线程池中, 使得新任务提交时`notify`一堆条件变量, 这样你注册和移除又增加竞争. 具体使用什么方法需要看实际需求, 如果任务很多很密集, busy wait就不错, 如果任务比较零散, 那注册条件变量增加的竞争就不算明显.

## 总结

综上所述, 线程数固定的线程池的fork/join, 有以下要求:

- `reschedule_until`
- 每个工作线程维护一个deque
- work stealing负载均衡
- 任务集是有向无环图
- (根据需要)新提交的任务唤醒阻塞的join

对于`reschedule_until`可能导致的调用栈过深的问题, 虽然通过让`fork`后进先出可以有一定程度的减轻, 但是更根本的解决方法是"直接切换调用栈", 这便是n:m有栈协程的方案, 比如go语言的协程调度. 很久之后我们讨论协程的章节再详细讨论.

work stealing(工作窃取)帮助我们达成负载均衡后, 对于很多算法, 我们会递归地进行并发分解, 直到问题的"大小"小于某个阈值而不继续分解, 能充分地利用并发性. work stealing本身也有很多玩法[2], 下一篇我们将详细讨论这个话题.

**Reference:**  

- {:.ref} \[1] Daug Lea, [A Java Fork/Join Framework](http://gee.cs.oswego.edu/dl/papers/fj.pdf), June. 2000  
- {:.ref} \[2] Pablo Halpern, Arch Robison, Hong Hong, Artur Laksberg, Gor Nishanov, Herb Sutter, [Task Region R3 \| N4088](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2014/n4088.pdf), June. 2014  
- {:.ref} \[3] Pablo Halpern, Arch Robison, Hong Hong, Artur Laksberg, Gor Nishanov, Herb Sutter, [N4411 \| Task Block (formerly Task Region) R4](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2015/n4411.pdf), June. 2014  
- {:.ref} \[4] IPCC, [Fork-Join Pattern](http://ipcc.cs.uoregon.edu/lectures/lecture-9-fork-join.pdf), UO CIS, 2014  
- {:.ref} \[5] James Reinders著, 聂雪军译, *Intel Threading Building Blocks编程指南*. 北京, 机械工业出版社, 第1版, Jan. 2009  
- {:.ref} \[6] Timothy G. Mattson, Beverly A. Sanders, Berna L. Massingill著, 张云泉, 贾海鹏, 袁良译, 并行编程模式. 北京, 机械出版社. 2014.11, p120~p124
 