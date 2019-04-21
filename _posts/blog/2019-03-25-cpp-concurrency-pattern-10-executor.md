---
layout: post
title: C++并发型模式#10&#58; 任务执行策略 - Executor
description: 大多数并发程序都是围绕"任务执行"来构造的, 人们通常使用Executor框架来抽象任务执行策略, 线程池是典型的Executor.
category: blog
---

## Introduction

多线程编程中, 我们常常把任务分解成离散的工作单元(每个工作单元也许很小), 以期并行处理. 但是, 为每个工作单元创建线程(比如`boost::async`), 尤其是大量创建, 会存在一些不足:

- 线程生命周期的开销非常高. 线程的创建和销毁都是需要时间的.
- 资源消耗. 活跃的线程会消耗系统资源, 尤其是内存. 根据平台不同, 可创建线程的数量也是有限的.
- 频繁的资源竞争和上下文切换, 降低CPU的使用效率.

所以, 工作单元小而多的时候, 我们并不希望总是创建新线程. 似乎我们需要某种机制来控制什么线程执行什么工作单元. 这就是我们说的Executor框架, 它抽象了任务的执行策略.

这个策略可能是多种多样的, 也许是线程池, 也许是为每个单元创建新线程, 也许我们就希望单线程串行执行...

~~~
template<typename Executor>
void do_some_work(Executor& ex) {
    ex.submit([]() {
        std::cout << "hello world" << std::endl;
    });
}

int main() {
    boost::executor::basic_thread_pool ex1(4);
    booost::executor::thread_executor ex2;
    do_some_work(ex1);
    do_some_work(ex2);
    // wait for finished
    return 0;
}

~~~
{:.lang-cpp}

通过模板(或者接口), 我们可以灵活地指定executor, 或者为不同性质的任务指定不同的executor.

实际上, 根据不同的线程数(number of execution contexts), 不同的任务排序策略(how they are prioritized), 不同的选择策略(how they are selected), executor分为几大类, 好多种[1]:

1. 线程池(Thread Pools)
   
   - **simple unbounded thread pool**: 将工作单元放到任务队列中, 然后维护一堆线程, 每个线程去任务队列取工作单元, 然后执行, 如此往复. 
   - **bounded thread pool**: 跟无界线程池很类似, 但是它的任务队列是有界的, 这限制了线程是中排队的工作单元的数量. 
   - **thread-spawning executor**: 总是为新任务创建新线程.
   - **prioritized thread pool**: 任务队列是个优先队列.
   - **work stealing thread pool**: 线程池本身有个主任务队列, 每个工作线程也维护了自己的任务队列. 当工作线程自己的任务队列没有任务时, 就会去主任务队列取任务或者别的工作线程那"偷"任务. 适用于任务比较小的情况, 可以避免在主任务队列上的频繁竞争.
   - **fork-join thread pool**: 允许在任务中继续(递归地)分解(fork)并提交任务, 提交后进入等待时, 不是干等, 而是执行所在工作线程的任务队列的任务或者"偷"个任务回来执行. 等子任务完成后, 合并(join)得到任务自身的结果. 通常基于work stealing thread pool实现, 比如Java的ForkJoin框架.

2. 互斥执行(Mutual exclusion executors)

    - **serial executor**:  串行地执行, 也许在另一个线程, 但任务间是不会并发的, 所以不需要额外的互斥.
    - **loop executor**: 跟serial executor类似, 但是执行的线程不是executor创建的, 而是别的调用者"给(donate)"的. 常用于测试.
    - **GUI thread executor**: boost说的, 我也不知道什么意思.

3. Inline Executor: submit的时候就把任务执行了(在提交者的线程), 故不需要队列, 也不起线程. 常用于任务很小, 没必要放别的线程执行, 或者出于性能考虑, 直接执行比较好, 但接口非得executor的情况.

boost就列了这么多, 事实上我们还能列出好多来(比如folly, java.util.concurrent). 不过本文并不打算全部一次讲清楚~~我没这么厉害~~, 而是讲boost已经有的`basic_thread_pool`, `serial_executor`, `loop_executor`, `inline_executor`, 以及`thread_executor`(thread-spwaning executor).

work stealing 和 fork-join我们会分别单列一篇的讨论.

## boost.executor

boost的executor以闭包(closure)表示工作单元, 这里的闭包指无参数返回void的可调用对象, 接口上, 这个closure通常是模板的, 但executor内部储存的是`boost::function<void()>`.

接受executor的接口要求executor是一个具备以下接口的concept:

~~~
typedef boost::function<void()> work;
class executor {
public:
    template<typename Closure> void submit(Closure&& closure);
    template<typename Closure> void submit(Closure& closure);
    void close();
    bool closed();
    bool try_executing_one();
    template <typename Pred> bool reschedule_until(const Pred& pred);
}
~~~

其中`try_executing_one`和`reschedule_util`会在调用者的线程执行.

最典型的接受executor作为参数的是`boost::async`和`boost::future::then`:

~~~
boost::executors::basic_thread_pool pool(4);
boost::executors::inline_executor iex;
boost::executors::serial_executor ser(pool);
auto f = boost::async(ser, []() {
    std::cout << boost::this_thread::get_id() << std::endl;
}).then(iex, [](boost::future<void> f) {
    std::cout << boost::this_thread::get_id() << std::endl;
}).then(pool, [](boost::future<void> f) {
    std::cout << boost::this_thread::get_id() << std::endl;
});
f.wait();
~~~

首先`async`向`ser`提交了一个任务, 然后这个任务完成时, 回调把`then`的闭包`submit`到`iex`中, `iex`是在`submit`的时候执行, 所以输出的thread id应该与前面一致, 然后又回调, 把第二个`then`的闭包提交到pool, 所以第三个thread id与前两个不同.

如果不指定executor, 这个链式操作应当每一个都在新线程执行:

~~~
auto f2 = boost::async([](){
    std::cout << boost::this_thread::get_id() << std::endl;
}).then([](boost::future<void> f) {
    std::cout << boost::this_thread::get_id() << std::endl;
}).then([](boost::future<void> f) {
    std::cout << boost::this_thread::get_id() << std::endl;
});
f2.wait();
~~~

### boost.inline_executor 

我们先来看一下最简单的`inline_executor`, 提交即执行:

~~~
class inline_executor {
    bool m_closed;
    mutable boost::mutex m_mtx;

public:
    inline_executor() : m_closed(false) {}
    ~inline_executor() { close(); }
    void close() {
        boost::lock_guard<boost::mutex> lk(m_mtx);
        m_closed = true;
    }
    bool closed() {
        boost::lock_guard<boost::mutex> lk(m_mtx);
        return closed(lk);
    }
    bool closed(boost::lock_guard<boost::mutex>&) {
        return m_closed;
    }
    template<typename Pred>
    bool reschedule_until(const Pred&) {
        return false;
    }
    bool try_executing_one() {
      return false;
    }
public:
    void submit(work& w);
    
};
~~~

因为提交即执行, `try_executing_one`和`reschedule_until`都总是返回`false`. 你也许会问这两是做什么用的, 别急, 我们后面讲.

`submit`我们还没写, 因为我们需要明确一点, 就是闭包执行的时候, boost.executor是要求不抛异常的, 如果抛了, 就`std::terminate()`, 另外, 为了符合`close`和`closed`语义, 即使是`inline_executor`也要考虑是否已经关闭, 已经关闭的话会抛异常, 抛的什么异常就看实现了, 比如boost的`inline_executor`在关闭时提交闭包就会跑`sync_queue_is_closed`异常, 其实它根本没有任务队列(摊手.jpg):

~~~
void inline_executor::submit(work& w) {
    {
        boost::lock_guard<boost::mutex> lk(m_mtx);
        if (closed(lk)) {
            BOOST_THROW_EXCEPTION( boost::sync_queue_is_closed() );
        }
    }
    try {
        w();
    } catch(...) {
        std::terminate();
        return;
    }
}
~~~

### boost.thread_executor

然后我们可以来实现一下稍为复杂一点的`thread_executor`, 提交即创建线程, 事实上, 除了submit, 其他成员跟`inline_executor`是一样的:

~~~
class thread_executor {
    typedef boost::scoped_thread<> thread_t;
    std::vector<thread_t> m_threads;
    bool m_closed;
    mutable boost::mutex m_mtx;

public:
    void submit(work& w) {
        boost::lock_guard<boost::mutex> lk(m_mtx);
        if (closed(lk)) {
            BOOST_THROW_EXCEPTION( boost::sync_queue_is_closed() );
        }
        m_threads.reserve(m_threads.size() + 1); //确保有内存, 再创建thread
        boost::thread th(w);
        m_threads.push_back(thread_t(boost::move(th)));
    }
}
~~~

`scoped_thread<>`是让`m_threads`析构的时候`join`线程. 也就是说, `thread_executor`的析构会等待所有线程完成, 即所有任务完成.

### boost.basic_thread_pool

boost的`basic_thread_pool`是比较简单的线程池实现, 构造时创建所有工作线程, 使用简单的`sync_queue`做任务队列, 析构时中断所有工作线程.

~~~
class basic_thread_pool {
    boost::thread_group m_threads;
    sync_queue<work> m_tasks;

public:
    basic_thread_pool(size_t thread_count = boost::thread::hardware_concurrency() + 1);
    ~basic_thread_pool();

public:
    bool try_executing_one();
    void close();
    bool closed();
    template<typename Pred>
    bool reschedule_until(const Pred&);
    void submit(work& w);
};
~~~

首先是构造函数创建工作线程:

~~~
basic_thread_pool::basic_thread_pool(size_t thread_count) {
    try {
        for (size_t i = 0; i < thread_count; ++i) {
            m_threads.create_thread(boost::bind(&basic_thread_pool::worker_thread, this));
        }
    } catch(...) {
        close();
        throw;
    }
}
~~~

其中`worker_thread`是工作线程的函数, 它实际上不断地从`m_task`取出任务并执行, 但要处理`thread_interrupted`异常:

~~~
void basic_thread_pool::worker_thread() {
    try {
        for (;;) {
            work task;
            try {
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

从对`wait_pull`返回的status判断, 我们可以知道`basic_thread_pool`的`close`和`closed`都是交由其任务队列完成的:

~~~
void basic_thread_pool::close() {
    m_tasks.close();
}
bool basic_thread_pool::closed() {
    return m_tasks.closed();
}
~~~

然后是`reschedule_util`和`try_executing_one`, 之前的executor这两个函数都直接返回, 没做什么事情, 但在basic_thread_pool这里就不能这样了.

对于`reschedule_until`, 文档上是说, 只能在work内调用("This must be called from a scheduled work"), 我一直没有看明白这什么意思. 看实现也许是让我们手动fork-join用的, 那我们先看一下实现:

~~~
template <typename Pred>
bool basic_thread_pool::reschedule_until(const Pred& pred) {
    do {
        if (!try_executing_one()) {
            return false;
        }
    } while (!pred());
    return true;
}

bool try_executing_one() {
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

`reschedule_until`一直都是调用`try_executing_one`自然谓词为真.  而这里的`try_executing_one`则是从任务队列中取出任务并执行. 任务队列为空时, `try_executing_one`会返回`false`, 这也会使`reschedule_until`返回. 所以`reschedule_until`的作用就是不断执行任务知道谓词为真或者任务队列为空.

为什么说我们可以用来手动fork_join呢? 平时我们在任务中继续给线程池添加任务并等待, 很容易造成死锁, 因为等待的时候你占着线程却不干活:

~~~
// will deadlock
basic_thread_pool pool;

for (int i = 0; i < 100; ++i) {
    pool.submit([&pool]() {
        std::vector<boost::future<int> > vec;
        for (int i = 0; i < 100; ++i) {
            vec.push_back(boost::async(pool, []()->int{
                return 42;
            }));
        }
        boost::wait_for_all(vec.begin(), vec.end());
    });
}
pool.join();
~~~

有了`reschedule_until`, 你就可以不直接等待, 而是将所有子任务完成作为谓词, 调用`reschedule_until`. 这样, 你占着线程的还不断干活, 不白等, 也就不会死锁了.

~~~

// won't deadlock
basic_thread_pool pool;
for (int i = 0; i < 100; ++i) {
    pool.submit([&pool]() {
        std::vector<boost::future<int> > vec;
        for (int i = 0; i < 100; ++i) {
            vec.push_back(boost::async(pool, []()->int {
                return 42;
            }));
        }
        pool.reschedule_until([&vec]()->bool {
            return boost::algorithm::all_of(vec, [](const auto& f){
                return f.is_ready();
            });
        });
    });
}
pool.join();
~~~

剩下的是析构函数, 它会关闭任务队列, 并中断然后等待所有工作线程:

~~~
basic_thread_pool::~basic_thread_pool() {
    close();
    join();
}

void basic_thread_pool::join() {
    m_threads.interrupt_all();
    m_threads.join_all();
}
~~~

`submit`的话, 只是简单地将任务加到任务队列而已:

~~~
void basic_thread_pool::submit(work& w) {
    m_tasks.push(w);
}
~~~

### boost.serial_executor

serial_executor保证了没有工作单元会并发执行, 但并不会保证工作单元就是在一个线程上执行的. 所以, serial_executor需要指定底层的executor, 比如底层的executor是basic_thread_pool的话, 工作单元可能会在不同的线程中执行, 但是仍然保证不会并发.

其内部保证不会并发的机制就是......用future/promise机制等到前一个task执行完再执行下一个. 

它的`try_executing_one`很好地体现了这一点:

~~~
bool serial_executor::try_executing_one() {
    work task;
    try {
        if (queue_op_status::success == m_tasks.try_pull(task)) {
            boost::promise<void> p;
            m_ex.submit([&](){
                try {
                    task();
                    p.set_value();
                } catch (...) {
                    p.set_exception(boost::current_exception());
                }
            });
            p.get_future().wait();
        } // if
    } catch (...) {
        std::terminate();
    }
}
~~~

其中m_ex是我们构造`serial_executor`时传进来的底层executor, 在boost中, 为了擦除这个底层executor的类型, 用`generic_executor_ref`包装了一下, 具体代码可参见`boost/thread/executor/generic_executor_ref.hpp`, 这里不赘述, 就假装我们只支持一种类型的executor, 并直接引用好了.

boost中当然没用lambda, 这里只是为了方便, 但行为是一样的. 这里虽然捕获了异常, 但等待future的时候会再抛出然后terminate.

它的`worker_thread`比较有特点, 它调用的是自己的`try_executing_one`:

~~~
void serial_executor::worker_thread() {
    while (!closed()) {
        schedule_one_or_yield();
    }
    while (try_executing_one()) {

    }
}
void serial_executor::schedule_one_or_yield() {
    if (!try_executing_one()) {
        boost::this_thread::yield();
    }
}
~~~

`schedule_one_or_yield`是尝试执行一个任务, 否则`yield`放弃CPU. 第一个while结束的时候, 任务队列肯定是关闭的:

~~~
bool serial_executor::closed() {
    return m_tasks.closed();
}
void serial_executor::close() {
    m_tasks.close();
}
~~~

但是关闭的`sync_queue`仍然可以`try_pull`, 这样我们可以继续把队列中的元素拿出来. 所以, 第二个loop是为了把剩下的任务执行完.

### boost.serial_executor_cont

与`serial_exector`类似, boost有个叫`serial_executor_cont`的奇怪的executor.

为什么叫cont呢, 因为它的串行是用过future的continuation来做的, 也就是用`then`, 这样他不需要任务队列, 也不需要线程. 只要持有一个future, 每次submit都then下去, 然后......就串行了. 

我们来看它神奇的`submit`:

~~~

void serial_executor_cont::submit(work& w) {
    boost::lock_guard<boost::mutex> lk(m_mtx);
    if (closed(lk)) {
        BOOST_THROW_EXCEPTION( boost::sync_queue_is_closed() );
    }
    m_future = m_future.then(m_ex, [task = std::move(w)](boost::future<void> f)) {
        try {
            task();
        } catch (...) {
            std::terminate();
        }
    });
}
~~~

别在意这里capture用的是什么语法, 反正boost也不用lambda, 总之就是将`w`又包成一个闭包再传给`then`. 为了保证`task`执行有异常的时候调`terminate`, 我们需要包装一下而不是把`w`直接给`then`.

我们知道~~我好像还没写来着~~, `then`本质上是回调, 指定了executor的`then`就是回调的时候将闭包提交到executor那. 那它本质上跟上面的`serial_executor`有区别吗?

另外, 因为没有任务队列, `reschedule_until`和`try_executing_one`也没有意义, 应该说, boost里面,`serial_executor_cont` 根本没写`reschedule_until`.

那最开始的`m_future`怎么来的呢? 是`serial_execuytor_cont`构造的时候, `boost::make_ready_future`来的.

### boost.loop_executor

`loop_executor`有任务队列, 却没有线程, 因为它要我们"donate"一个线程, 也就是说, 我们找个线程去跑它里面的任务:

~~~
boost::executor::loop_executor ex;
ex.submit([]() {
    std::cout << "hello world" << std::endl;
});
boost::thread tr(&boost::executor::loop_executor::loop, ex);
tr.join();
~~~

它提供了一个`loop`函数还给我们单独为之创建线程:

~~~
void loop_executor::loop() {
    while (execute_one(/*wait=*/true)) {

    }
    while (try_executing_one()) {

    }
}
bool loop_executor::execute_one(bool wait) {
    work task;
    try {
        queue_op_status st = wait ? m_tasks.wait_pull(task) : m_tasks.try_pull(task);
        if (st == queue_op_status::success) {
            task();
            return true;
        }
        return false;
    } catch (...) {
        std::terminate();
    }
}
~~~

`execute_one`是实际上执行的函数, `wait`参数只是决定pull的方式, 跟前面写的几种executor没什么区别. 而且很显然, 它会被用于实现`try_executing_one`:

~~~
bool loop_executor::try_executing_one() {
    executo_one(false);
}
~~~

除了`loop`函数, `loop_executor`还提供了`run_queued_closures`, 让用户在调用线程执行任务, 比如主线程:

~~~
void loop_executor::run_queued_closures() {
    sync_queue<work>::underlying_queue_type q = work_queue.underlying_queue();
    while (!q.empty()) {
        work& task = q.front();
        task();
        q.pop_front();
    }
}
~~~

这大概通常是用来测试的. 也许你有些奇怪它为什么要把underlying_queue拿出来, 嗯, 我也觉得挺奇怪的. 这是因为, `underlying_queue()`这个成员函数是线程安全的, 而且, 它是将内部数据"移动"出来了. 也就是说, 这一步把已有的任务全都拿出来了, 后面加的不管. 至于"移动"之后, 任务队列还能不能用了? 我试了一下. 是可以的.

~~~
boost::executors::loop_executor ex;
boost::mutex mtx;
work f = [&]() {
    mtx.lock();
    std::cout << boost::this_thread::get_id() << std::endl;
    mtx.unlock();
};
ex.submit(f);
ex.submit(f);
ex.run_queued_closures();
ex.submit(f);
ex.run_queued_closures();

~~~

## 总结

boost executor框架给我们提供了一系列executor实现, 其中包括比较简单的线程池. 而boost executor的设计, 特意提供了主动执行executor中滞留任务的方法, 即`try_executing_one`和`reschedule_until`, 这使得我们可以较为自然地在任务中继续分割任务.

但boost executor也是不完善的, 还没有提供java中比较成熟的, 比如work-stealing thread pool或者fork-join thread pool. 我们会在后面的文章中讨论他们. 


**Reference:**  

* {:.ref} \[1] boost, [Executors and Schedulers -- EXPERIMENTAL](https://www.boost.org/doc/libs/1_69_0/doc/html/thread/synchronization.html#thread.synchronization.executors), 1.69.0  
* {:.ref} \[2] Chris Mysen, Niklas Gustafsson, Matt Austern, Jeffrey Yasskin, [Executors and schedulers, revision 3](http://www.open-std.org/JTC1/SC22/WG21/docs/papers/2013/n3785.pdf), Qct. 2013  

