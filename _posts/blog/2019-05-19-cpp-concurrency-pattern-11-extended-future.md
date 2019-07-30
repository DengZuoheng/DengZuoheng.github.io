---
layout: post
title: C++并发型模式#11&#58; 扩展future - async/then/when_any/when_all
description: 有了executor的概念, future库通常会提供async/then等扩展操作使得我们更舒适地使用future. 然而原本简单的future实现不能支持这一切, 我们需要重写future
category: blog
---

## 从boost::async开始

我们之前有个使用future的例子:

~~~ c++
boost::promise<int> pr;
boost::future<int> f = pr.get_future();
boost::thread tr([&]() {
    pr.set_value(42);
};
assert(f.get() == 42);
~~~

与这个例子类似, 我们通常在工作线程只会用future返回个结果, 而得到这个结果后, 工作线程就完成工作了. 所以, 我们其实希望有个函数(或者别的什么)可以帮我们建好promise, 起好线程, 然后直接给我future就好了. 比如说:

~~~ c++
template<typename T, typename F>
boost::future<T> async(F&& func) {
    boost::promise<T> pr;
    boost::future<T> f = pr.get_future();
    boost::thread tr([p = std::move(pr), &func]() mutable {
        try {
            p.set_value(func());
        } catch (std::exception& e) {
            p.set_exception(e);
        }
    });
    tr.detach();
    return f;
}

int main()
{
    boost::future<int> f = async<int>([](){ return 42;});
    std::cout << f.get() << std::endl;
    return 0;
}
~~~

这里的`async`只是个名字, 并不是C#里的async/await, 你比如Qt里类似的函数就叫`QConcurrent::run`.

当然, boost的`async`没有这么简单, 一是boost不能用这么高版本的lambda表达式, 二是boost的`async`需要forward异步函数的参数, 三是, 有launch policy.

launch policy是个复杂的东西, boost中有好几个, 主要是`boost::launch::async`和`boost::launch::deferred`, 其中`boost::launch::async`是立即起一线程执行异步函数, 而`boost::launch::deferred`则是等待或获取结果的时候再在当前线程执行异步函数(boost1.62). 这些个policy是位或的关系, 同时存在的话会有一个优先级, 具体可查看文档[1].

~~~ c++
boost::future<int> f = boost::async(boost::launch::defered, [](){ return 42;});
~~~

到了高版本的boost, 需要考虑的就不只是launch policy了, 我们还可以指定executor实例(这里将executor也认为是一种policy):

~~~ c++
boost::executors::basic_thread_pool pool;
boost::future<int> f = boost::async(pool, [](){ return 42;});
assert(42 == f.get());
~~~

为了支持这么复杂的`boost::async`, 我们原本的future实现就不够用了, 我们需要加许多特性, boost历史上还顺便重构了一下future[2], 改善一下命名什么的, 我们下面就来写一遍新版本的future.

## async with policy

### 重构future

基本的结构其实跟原来一样的, 比如说, 还是有一个维护future状态的, 我们之前的博客中称为`future_object_base`, 现在boost给了个更好的名字`shared_state_base`, 有一个储存结果的, 之前叫`future_object`, 现在重命名为`shared_state`, 至于他们的数据成员, 我们可以先保持不变:

~~~ c++

struct shared_state_base : boost::enable_shared_from_this<shared_state_base> {
    typedef std::list<boost::condition_variable_any*> waiter_list;
    typedef waiter_list::iterator notify_when_ready_handle;

    boost::exception_ptr exception;
    bool done;

    mutable boost::mutex mutex;
    boost::condition_variable cond;
    waiter_list external_waiters;

    // ...
};

template <typename T>
struct shared_state: shared_state_base {
    typedef boost::unique_ptr<T> storage_type;

    storage_type result;
    // ...
}
~~~

在新版本的future中, `unique_future`重命名为`future`; 但`future`本身却没有持有`shared_state`的实例, 而是其父类`basic_future`, 而`basic_future`甚至有一个擦除了类型的父类`base_future`, 但这个`base_future`没有任何卵用:

~~~ c++
class base_future {}

template <typename T>
class basic_future : public base_future {
public:
    typedef boost::shared_ptr<shared_state<T> > future_ptr;
    future_ptr m_future;
    basic_future(future_ptr shared_state): m_future(shared_state) {}
    // ...
};

template <typename T>
class future : public basic_future<T> {
    friend class promise<T>;
    friend class shared_future<T>;
    // ...
};

template <typename T>
class promise {
    typedef boost::shared_ptr<shared_state<T> > future_ptr;
    future_ptr m_future;
}
~~~

### async函数

boost支持很多的policy, 我们后面会逐个实现. 简单起见, 我们先从`policy_async`和`policy_defered`开始, 讨论为了支持launch policy的`async`需要给future增加怎样的接口.

~~~c++
enum launch_policy {
    policy_none = 0,
    policy_async = 1,
    policy_defered = 2,
    policy_executor = 4,
    policy_inherit = 8,
    policy_sync = 16,
    policy_any = policy_async | policy_deferred
};
~~~

如果我们再限制一下, 只接收`boost::function<T()>`, 那会使得`async`函数更加简单:

~~~c++
template<typename T>
future<T> async(launch_policy policy, boost::function<T()> func) {
    if (policy & policy_async) {
        return make_future_async_shared_state<T>(func);
    } else if (policy & policy_deferred) {
        return make_future_deferred_shared_state<T>(func);
    } else {
        std::terminate();
    }
}

~~~

可以看到就是根据policy用不同的工厂方法创建不同的实例. 我们可以去看一下这两个工厂方法是怎么样的.

~~~c++
template<typename T>
future<T> make_future_async_shared_state(boost::function<T()> func) {
    boost::shared_ptr<future_async_shared_state<T> > h(new future_async_shared_state<T>());
    h->init(f);
    return future<T>(h);
}

template<typename T>
future<T> make_future_deferred_shared_state(boost::function<T()> func) {
    boost::shared_ptr<future_deferred_shared_state<T> > h(new future_deferred_shared_state(func));
    return future<T>(h);
}
~~~

其中`future_async_shared_state`和`future_deferred_shared_state`是`shared_state`的派生. 可以看到, 这两个工厂方法的差别不大, `async_policy`是先构造智能指针, 然后二步初始化, (init不是虚函数, 分成两步可能是为了异常安全, 在boost中这里的`func`是右值引用); 而`deferred_policy`是直接用`func`构造. 二者都是用`shared_state`的智能指针构造`future`.

再深入`future_async_shared_state`的实现:

~~~c++
template<typename T>
struct future_async_shared_state: shared_state<T> {
    typedef shared_state<T> super;
    future_async_shared_state() : super() {}

    void init(boost::function<T()> func) {
        boost::shared_ptr<future_async_shared_state<T> > self;
        self = boost::static_pointer_cast<future_async_shared_state<T> >(this->shared_from_this());
        boost::function<void()> task = boost::bind(&future_async_shared_state::run, self, func);
        boost::thread(task).detach();
    }
    static void run(boost::shared_ptr<future_async_shared_state<T> > that, boost::function<T()> func) {
        try {
            that->mark_finished_with_result(func());
        } catch (...) {
            that->mark_execptional_finish();
        }
    }
};

~~~
其核心方法是`init`和`run`, 其中`init`是起一个线程, 这个线程的执行体就是`run`, 而`run`中做的事情也很简单, 执行`func`并将其结果置入`shared_state`中. `mark_finished_with_result`就像`promise`的`set_value`一样:

~~~c++
template<typename T>
void shared_state::mark_finished_with_result(const T& res) {
    boost::unique_lock<boost::mutex> lock(this->mutex);
    this->mark_finished_with_result_internal(res, lock);
}

template<typename T>
void shared_state::mark_finished_with_result_internal(const T& res, boost::unique<boost::mutex>& lock> {
    result.reset(new T(res));
    this->mark_finished_internal(lock);
}
template<typename T>
void mark_finished_internal(boost::unique<boost::mutex>& lock) {
    done = true;
    cond.notify_all();
    for (waiter_list::const_iterator it = external_waiters.begin();
      it != external_waiters.end();
      ++it) {
      (*it)->notify_all();
    }
    // TODO: do_continuation(lock);
}
~~~

`mark_finished_internal`是我们之前实现过的, 只是后面我们实现`then`的时候, 还需要实现`do_continuation`, 所以这里标记了TODO.

我们再来看`future_defered_shared_state`, 于`policy_async`不同, `policy_deferred`的意思是, 等到用户调`future::get()`或`future::wait()`的时候再执行`func`. 

为了实现这样的行为, `shared_state`或其基类就需要在`wait`和`get`做特殊的处理, 而作为判断, 我们还需要加一个属性或者flag. 而这时候才执行的`func`就需要用回调或者虚函数去执行, boost中用的是虚函数:

~~~c++
template<typename T>
struct shared_state : shared_state_base {
    // ...
    virtual void execute(boost::unique_lock<boost::mutex>&) {}
    // ...
};

template<typename T>
struct future_deferred_shared_state : shared_state<T> {
    boost::function<T()> m_func;
    explicit future_deferred_shared_state(boost::function<T()> func) : m_func(func) {
        this->shared_state_base::set_defered();
    }
    virtual void execute(boost::unique_lock<boost::mutex>& lock) {
        try {
            lock.unlock();
            T res = m_func();
            lock.lock();
            this->mark_finished_with_result_internal(res, lock);
        } catch (...) {
            this->mark_execptional_finish_internal(current_exception(), lock);
        }
    }
};
~~~

需要注意, `execute`是从`wait`调过来的, 所以是带锁的, 调用的是`xxx_internal`等自备锁的接口. 而且, 我们还需要让`m_func`的执行在锁外, 所以执行时要解锁.

如何调到`execute`? 这个行为我们可以从`wait`开始看:

~~~
template <typename T>
class basic_future : public base_future {
public:
    typedef boost::shared_ptr<shared_state<T> > future_ptr;
    future_ptr m_future;

    // ...
    void wait() const {
        if (!m_future) {
            boost::throw_exception(...);
        }
        m_future->wait(false);
    }
};

struct shared_state_base : boost::enable_shared_from_this<shared_state_base> {
    // ...
    bool is_deferred;
    launch_policy policy;
    // ...
    void wait(bool rethrow = true) {
        boost::unique_lock<boost::mutex> lock(this->mutex);
        wait_internal(lock, rethorw);
    }
    void wait_internal(boost::unique_lock<boost::mutex>& lock, 
                       bool rethrow=true) {
        if (is_defered) {
            is_defered = false;
            this->execute(lock);
        }
        while(!done) {
            cond.wait(lock);
        }
        if (rethow && exception) {
            boost::rethrow_exception(exception);
        }
    }
    void set_deferred() {
        is_defered = true;
        policy = launch_policy::polocy_defered;
    }
};
~~~

`wait_internal`在锁下把`is_defered`置为`false`了, 保证了`execute`只会被执行一次.

## then continuation

趁现在我们的future还不复杂, 先去把只支持policy的`then`实现了. 从上面的讨论我们可以看出, `then`操作叫continuation. 简单起见, 我们这里只讨论三种policy, `policy_inhert`就是从`this`的policy继承, `policy_executor`我们稍后再讨论.

~~~c++
template <typename T>
class future : public basic_future<T> {
    friend class promise<T>;
    friend class shared_future<T>;
    // ...
    template<typename R>
    future<R> then(launch policy, boost::function<R(future<T>)> func) {
        assert(m_future);
        boost::shared_ptr<shared_state_base> sentinel(m_future);
        boost::unique_lock<boost::mutex> lock(sentinel->mutex);
        if (policy & launch_policy::policy_async) {
            return make_future_async_continuation_shared_state<R, T>(lock, *this, func);
        } else if (policy & launch_policy::policy_deferred) {
            return make_future_deferred_continuation_shared_state<R, T>(lock, *this, func);
        } else if (policy & launch_policy::policy_sync) {
            return make_future_sync_continuation_shared_state<R, T>(lock, *this, func);
        }
    }
};

~~~

虽然看起来很吓人, 实际上就是个工厂函数而已. 因为continuation必然会给当事future注册点什么, 所以这里将`*this`传到更具体的工厂去了. 

这些工厂实际上也是构造`shared_state`的派生, 先来看一下`make_future_async_continuation_shared_state`:

~~~c++

template<typename R, typename T>
future<R> make_future_async_continuation_shared_state(
        boost::unique_lock<boost::mutex>& lock,
        future<T> parent,
        boost::function<T(future<T>)> cont) {
    shared_ptr<future_async_continuation_shared_state<R, T> h(
        new future_async_continuation_shared_state<R, T>(parent, cont));
    h->init(lock);
    return future<R>(h);
}

~~~

因为我们有几种称为xx_continuation_shared_state的派生(一个policy一个, 之后还有executor), 所以很自然地, 我们有一个基类叫`continuation_shared_state`:

~~~c++
template<typename R, typename T>
struct continuation_shared_state: shared_state<R> {
    future<T> m_parent;
    boost::function<R(future<T>)> m_continuation;

public:
    continuation_shared_state(future<T> parent, boost::function<R(future<T>)> func)
        : m_parent(parent), m_continuation(func) {
        // pass
    }
    void init(boost::unique_lock<boost::mutex>& lock) {
        m_parent.m_future->add_continuation_ptr(this->shared_from_this(), lock);
    }
}
~~~

其中, `init`是将自己注册到parent的continuation列表中了, 被改变的是parent的内容, 所以工厂函数也要传入parnet的锁.

那parent拿continuation做了什么呢? 我们回到`mark_finished_internal`:

~~~c++
void shared_state_base::mark_finished_internal(boost::unique<boost::mutex>& lock) {
    done = true;
    cond.notify_all();
    for (waiter_list::const_iterator it = external_waiters.begin();
      it != external_waiters.end();
      ++it) {
      (*it)->notify_all();
    }
    do_continuation(lock); // !!!
}
~~~

`do_continuation`做了什么呢? 很显然就是一个个去执行对吧:

~~~c++
struct shared_state_base : enable_shared_from_this<shared_state_base> {
    // ...
    typedef boost::shared_ptr<shared_state_base> continuation_ptr;
    std::vector<continuation_ptr> continuations;
    // ...
    void do_continuation(boost::unique_lock<boost::mutex>& lock) {
        if (!this->continuations.empty()) {
            std::vector<continuation_ptr> to_launch = this->continuations;
            this->continuations.clear();
            lock.unlock();
            for (auto it = to_launch.begin(); it != to_launch.end(); ++it) {
                (*it)->launch_continuation();
            }
            lock.lock();
        }
    }
    void add_continuation_ptr(continuation_ptr cont, boost::unique_lock<boost::mutex>& lock) {
        continuations.push_back(cont);
        if (done) {
            do_continuation(lock);
        }
    }
    virtual void launch_continuation() {
        // pass
    }
}

~~~

因为continuation的执行不在锁内, 所以执行时先把continuation取出来, 这是实现线程安全Observer的一种手法.

如果加入新的continuation时该future已经完成了, 就直接执行`do_continuation`, 注意, 上一次执行`do_continuation`时已经清空`continuation`, 所以不会重复执行.

而`launch_continutation`是虚函数, 会重写这个函数的都是`continuation_shared_state`的派生, 需要根据`launch_policy`来决定具体怎么处理, 比如`policy_async`就起了个线程:

~~~c++
template<typename R, typename T>
struct future_async_continuation_shared_state: continuation_shared_state<R, T> {
    typedef continuation_shared_state<R, T> super;
public:
    future_async_continuation_shared_state(future<T> parent, boost::function<R(future<T>)> func) 
        : super(parent, func) {
        // pass
    }
    virtual launch_continuation() {
        boost::shared_ptr<shared_state_base> self = this->shared_from_this();
        boost::thread(&super::run, self).detach();
    }
}
~~~

这里的`run`作为线程的执行体, 它会执行`m_continuation`并置入结果:

~~~c++

template<typename R, typename T>
struct continuation_shared_state: shared_state<R> {
    future<T> m_parent;
    boost::function<R(future<T>)> m_continuation;
    // ...
    static void run(boost::shared_ptr<shared_state_base> that) {
        continuation_shared_state* f = static_cast<continuation_shared_state*>(that.get());
        if (f) {
            f->call();
        }
    }

    void call() {
        try {
            mark_finished_with_result(m_continuation(m_parent));
        } catch (...) {
            this->mark_exceptional_finish();
        }
        m_parent.reset();
    }
};
~~~

`policy_deferred`有所不同, 如同`async(policy_deferred, ...)`得到的deferred的future只有在`wait`或`get`时才会回调`execute`一样, `then(policy_deferrred, ...)`得到的future也是这样. 这意味着, parent future在`do_continuation`时调用派生的`launch_continuation`也不会做什么, 一切还得等到你`wait`或`get`你得到的新future. 所以, `future_deferred_continuation_shared_state`需要重载是其实是`execute`方法:

~~~c++
template<typename R, typename T>
struct future_deferred_continuation_shared_state: continuation_shared_state<R, T> {
    typedef continuation_shared_state<R, T> super;
public:
    future_deferred_continuation_shared_state(future<T> parent, boost::function<R(future<T>)> func) 
        : super(parent, func) {
        super::set_deferred();
    }
    virtual void execute(boost::unique_lock<boost::mutex>& lk) {
        this->m_parent.wait();
        this->call(lk);
    }
    virtual void launch_continuation() {
        // pass
    }
};

template<typename R, typename T>
struct continuation_shared_state: shared_state<R> {
    future<T> m_parent;
    boost::function<R(future<T>)> m_continuation;
    // ...

    void call(boost::unique_lock<boost::mutex>& lk) {
        try {
            lk.unlock();
            R res = m_continuation(m_parent);
            m_parent.reset();
            lk.lock();
            mark_finished_with_result_internal(res, lk);
        } catch (...) {
            this->mark_exceptional_finish_internal(current_exception(), lk);
            lk.unlock();
            m_parent.reset();
            lk.lock();
        }
        m_parent.reset();
    }
~~~

这里调的`call`是带锁版本, 注意事项上面已经提及, 要保持`m_continuation`的调用在锁外, 具体实现留作习题.

现在我们再来补充一下`make_future_deferred_continuation_shared_state`工厂函数:

~~~c++
template<typename R, typename T>
future<R> make_future_deferred_continuation_shared_state(
        boost::unique_lock<boost::mutex>& lock,
        future<T> parent,
        boost::function<T(future<T>)> cont ) {
    boost::shared_ptr<future_defrred_continuation_shared_state<R, T> > h(
        new future_defereed_continuation_shared_state(parent, cont);
    )
    h->init(lock);
    return future<R>(h);
}

那新跑出来的`policy_sync`是怎么回事呢? 其工厂方法没有什么变化:

~~~c++

template<typename R, typename T>
future<R> make_future_sync_continuation_shared_state(
        boost::unique_lock<boost::mutex>& lock,
        future<T> parent,
        boost::function<T(future<T>)> cont) {
    boost::shared_ptr<future_sync_continuation_shared_state<R, T> > h(
        new future_sync_continuation_shared_state(parent, cont);
    )
    h->init(lock);
    return future<R>(h);
}
~~~

但是看其实现, 我们会发现它直接就调`call`了, 没有新开线程, 就是说, parent在哪个线程, 它就在哪个线程:

~~~c++
template<typename R, typename T>
struct future_sync_continuation_shared_state: continuation_shared_state<R, T> {
    typedef continuation_shared_state<R, T> super;
public:
    future_sync_continuation_shared_state(future<T> parent, boost::function<R(future<T>)> func)
            : super(parent, func) {
        // pass
    }
    virtual void launch_continuation() {
        this->call();
    }
};
~~~

## when_any/when_all

在引入executor前, 我们先来实现when_all, when_any.

之前我们已经实现过wait_for_all, wait_for_any, 这两个函数是阻塞等待的, 但在已经有`then`的情况下, 我们希望有非阻塞的版本, 这就是when_all, when_any, 他们返回的是新的future, 而不会阻塞.

其实when_all, when_any的原理很简单, 就是另起以线程, 执行wait_for_all, wait_for_any. 但是我们上面讨论了很久的`deferred`, 这种future在`wait_for_any`中又是如何处理的呢? 我们从`when_any`开始, 方便起见, 我们用一个vector的类型的future:

~~~c++
template<typename T>
future<std::vector<future<T> > when_any(const std::vector<future<T> >& those) {
    boost::shared_ptr<future_when_any_vector_shared_state<T> > h(
        new future_when_any_vector_shared_state<T>(those);
    );
    h->init();
    return future<std::vector<future<T> >;
}
~~~

这里我们接受的是`future<T>`的vector, 返回的是`std::vector<future<T> >`的future, 就是说, 返回值是一个future, 这个future的结果就是你传进来的那个vector. 而且这里没有指示具体哪个future完成了, 使用时需要自己遍历一下.

说回正题, 我们观察其结构, 跟我们上面讨论的各个工厂方法时非常类似的, 我们又要实现一个`future_when_any_vector_shared_state`(boost1.59中可以找`future_when_all_tuple_shared_state`):

~~~c++
template<typename T>
struct future_when_any_vector_shared_state : shared_state<std::vector<future<T> > {
    std::vector<std::vector<future<T> > m_futures;
public:
    future_when_any_vector_shared_state(const std::vector<std::vector<future<T> >& futures)
        : m_futures(futures) {
            // pass
    }
    void init() {
        if (run_deferred()) {
            future_when_any_vector_shared_state::run(this->shared_from_this());
        } else {
            boost::thread(
                &future_when_any_vector_shared_state::run, this->shared_from_this()
            ).detach();
        }
    }
    static void run(boost::shared_ptr<shared_state_base> that_);
    bool run_deferred();
};
~~~

可以看到, 对于`deferred`的问题, 这里是根据`run_deferred()`的返回值, 如果返回`true`, 就直接调`run`, `run`完了`when_any`就完成了; 如果返回`false`, 则开另一个线程继续.

`run_deferred`在boost中的行为是, 遍历`m_futures`, 如果有`deferred`, 就执行之, 于是, `run_deferred`返回的时候自然是"存在一个future已经完成"的状态, `when_any`自然也完成了. 但boost是执行第一个没完成且是`deferred`的future, 我们可以改进一下, 先遍历一遍, 发现没有已经完成的, 再执行第一个发现的`deferred`future:

~~~c++
bool run_defereed() {
    int idx_deferred_not_ready = -1;
    for (int i = 0; i < m_futures.size(); ++i) {
        future<T> f = m_futures[i];
        if (f.is_ready()) {
            return true;
        } else if (f.is_deferred()) {
            idx_deferred_not_ready = i;
            break;
        }
    }
    if (idx_deferred_not_ready != -1) {
        future<T> f = m_futures[idx_deferred_not_ready];
        return f.run_if_is_deferred_or_ready();
    }
    return false;
}
~~~

这个给`shared_state_base`新加的`run_if_is_deferred_or_ready`方法是什么意思呢? 首先, 如果已经ready了, 也返回`true`, 使得`when_any`不用新开线程; 另外, 如果是`deferred`, 就执行并返回`true`. 所以, 这个函数返回`false`的情况只有"不是`deferred`且没ready":

~~~c++
bool shared_state_base::run_if_is_deferred_or_ready() {
    boost::unique_lock<boost::mutex> lk(this->mutex);
    if (this->is_deferred) {
        this->is_deferred = false;
        this->execute(lk);
        return true;
    } else {
        return this->done;
    }
}
~~~

现在我们倒回去实现`future_when_any_vector_shared_state::run`:

~~~c++
template<typename T>
struct future_when_any_vector_shared_state : shared_state<std::vector<future<T> > {
    std::vector<std::vector<future<T> > m_futures;
public:
    // ...
    static void run(boost::shared_ptr<shared_state_base> that_) {
        future_when_any_vector_shared_state<T>* that = static_cast<future_when_any_vector_shared_state<T>*>(that_.get());
        try {
            wait_for_any(that->m_futures);
            that->make_finished_with_result(that->m_futures);
        } catch (...) {
            that->mark_execeptional_finished();
        }
    }
};
~~~

其中`wait_for_any`就是我们之前实现的, 只是加了vector的重载而(其实用迭代器区间更好), 其实现留作习题.

既然实现了`when_any`, `when_all`就更不在话下了, 只是把`deferred`全部执行了而已, 其实现也留作习题.

## via executor

### async via executor

现在我们可以来考虑executor的问题了.

首先来看executor版本的async, 依旧是创建一个`shared_state`的派生:

~~~
template<typename Ex, typename T>
future<T> async(Ex& ex, boost::function<T()> func) {
    return make_future_executor_shared_state<T>(ex, func);
}

template<typename Ex, typename T>
future<T> make_future_executor_shared_state(Ex& ex, boost::function<T()> func) {
    boost::shared_ptr<future_executor_shared_state<T> > h(
        new future_executor_shared_state<T>()
    );
    h->init(ex, func);
    return future<T>(h);
}
~~~

虽然这里我们的executor是模板参数, 但是future本身是没有executor这个模板参数的. 我们可以在`init`提交完task就算了, 但是我们的`then`有`policy_inherit`, 所以future需要保存executor以便继承.  所以, 这个executor类型会想办法擦除掉, 现在假设我们已经知道怎么擦除了, 来看看`future_executor_shared_state`的实现:

~~~c++
template<typename T>
struct future_executor_shared_state: shared_state<T> {
    typedef shared_state<T> super;
public:
    future_executor_shared_state() {}

    template<typename Ex>
    void init(Ex& ex, boost::function<T()> func) {
        this->set_executor_policy(executor_ptr(new executor_ref<Ex>(ex)));

        boost::function<void()> task = [self_ = this->shared_from_this(), func]() {
            auto self = static_pointer_cast<shared_state<T> >(self_);
            try {
                self->mark_finished_with_result(func());
            } catch (...) {
                self->mark_exceptional_finished();
            }
        }
        ex.submit(task);
    }
};
~~~

简单起见, 这里用lambda表达式. 首先将`ex`类型擦除后存到future中去, 然后将打包一个task, 这个task的工作就是执行`func`, 然后将结果置入future. 然后将task提交到executor, 至于executor怎么执行的, 就不管了.

然后我们来看类型擦除的部分. 首先看到`executor_ref`, 这玩意是boost.executor框架的工具, boost.executor框架实际上也提供了基于运行时多态的executor抽象基类, 那`executor_ref`就是将符合编译期Executor concept的类型包装成多态executor的派生:


~~~ c++
typedef boost::function<void()> work;
class executor {
public:
    executor(){}
    virtual ~executor(){}

public:
    virtual void close() = 0;
    virtual bool closed() = 0;
    virtual void submit(work& w) = 0;
    virtual bool try_executing_one() = 0;
};

typedef boost::shared_ptr<executor> executor_ptr;

template<typename Ex>
class executor_ref : public executor {
    Ex& m_ex;

public:
    executor_ref(Ex& ex) : m_ex(ex) {}
    ~executor_ref(){}

public:
    virtual void close() {
        m_ex.close();
    }
    virtual bool closed() {
        return m_ex.closed();
    }
    virtual void submmit(work& w) {
        m_ex.submit(w)
    }
    virtual bool try_executing_one() {
        return m_ex.try_executing_one();
    }
};

~~~

因为executor有了抽象基类, future可以保存抽象基类的指针, 派生类`executor_ref<Ex>`的类型就被擦除了:

~~~c++
struct shared_state_base : enable_shared_from_this<shared_state_base> {
    // ...
    executor_ptr ex;
    void set_executor_policy(executor_ptr aex) {
        set_executor();
        ex = aex;
    }
    void set_executor_policy(executor_ptr aex, boost::unique_lock<boost::mutex>&) {
        set_executor();
        ex = aex;
    }
    void set_executor() {
        is_deferred = false;
        policy = launch_policy::policy_executor;
    }
    executor_ptr get_executor() {
        return ex;
    }
};
~~~

### then via executor

现在我们可以来写executor版本的`then`了:

~~~c++

template<typename Ex, typename R, typename T>
future<R> future<T>::then(Ex& ex, boost::function<R(future<T> > cont)) {
    boost::shared_ptr<shared_state_base> sentinel(m_future);
    boost::unique_lock<boost::mutex> lock(sentinel->mutex);
    return make_future_executor_continuation_shared_state<Ex, R, T>(ex, lock, this, cont);
}

~~~

这个个工厂函数也与我们上面写的几个差不多:

~~~c++
template<typename Ex, typename R, typename T>
future<R> make_future_executor_continuation_shared_state(
        Ex& ex,
        boost::unique_lock<boost::mutex>& lock,
        future<T> parent,
        boost::function<R(future<T>)> cont) {
    boost::shared_ptr<future_executor_continuation_shared_state<R, T> > h(
        new future_executor_continuation_shared_state<R, T>(parent, cont)
    );
    h->init(lock, ex);
    return future<R>(h);
}

~~~

`future_executor_continuation_shared_state`就是在`launch_continuation`中提交task:

~~~c++
template<typename R, typename T>
struct future_executor_continuation_shared_state: continuation_shared_state<R, T> {
    typedef continuation_shared_state<R, T> super;
public:
    future_executor_continuation_shared_state(future<T> parent, boost::function<R(future<T>)> cont)
        : super(parent, cont) {
            // pass
    }
    ~future_executor_continuation_shared_state(){}

public:
    template<typename Ex>
    void init(boost::unique_lock<boost::mutex>& lk, Ex& ex) {
        this->set_executor_policy(executor_ptr(new executor_ref<Ex>(ex)));
        super::init(lk);
    }
    virtual void launch_continuation() {
        boost::function<void()> task = [self_ = shared_from_this()]() {
            continuation_shared_state<R, T>* self = static_cast<continuation_shared_state<R, T>*>(self_.get());
            self->call();
        }
        get_executor()->submit(task);
    }
}
~~~

## 总结

无论是`async`还是`then`, 都是根据条件构造不同的`shared_state`派生, 这个条件可以是policy也可以是executor. 对于`async`函数, `policy_async`是构造`shared_state`时立即起一线程执行异步函数, `policy_deferred`通过重载`execute`虚函数, 等用户调用`wait`或`get`时再执行其异步函数. 而executor则是向executor提交包装有异步函数的任务.

对于`then`函数, 与`async`函数类似, 构造不同的`shared_state`派生, 然后注册到parent future. parent future会在完成时调用其`launch_continuation`虚函数. 对于`policy_async`, 其`launch_continuation`也是立即起一线程执行cont函数. `policy_deferred`仍然时特别的, 它的`launch_continuation`什么也不做, 依旧是用户调用`wait`或`get`的时候才执行其异步函数. executor则是向executor提交包装有cont函数的任务.

**Reference:**  

* {:.ref} \[1] boost, [Futures](https://www.boost.org/doc/libs/1_61_0/doc/html/thread/synchronization.html#thread.synchronization.futures), 1.70  
* {:.ref} \[2] Vicente J. Botet Escriba, [Refactor futures by adding a basic_future common class](https://github.com/boostorg/thread/commit/45c87d392f78f5e123107c17a675fee4e2b19f5b), Nov.2012  
* {:.ref} \[3] N. Gustafsson, A. Laksberg, H. Sutter, S. Mithani, [ N3634 - Improvements to std::future<T> and related APIs](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2013/n3634.pdf), May. 2013  