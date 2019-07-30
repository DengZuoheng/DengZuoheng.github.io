---
layout: post
title: C++并发型模式#4&#58; 等待异步操作结果 - future/promise
description: 如何获得工作线程的结果? 早期的boost中如何实现future/promise? wait_for_any又是什么原理?
category: blog
---

## future/promise的引入

刚开始学习线程库时, 我们也许都会吐槽为什么线程没有个返回值让我返回结果, 后来我们知道可以用条件变量来做:

~~~
boost::mutex g_mtx;
boost::condition_variable g_cond;
int result = 233;

void calculate_the_answer_to_life_the_universe_and_everything() {
     boost::unique_lock<boost::mutex> lock(g_mtx);
     result = 42;
     g_cond.notify_all();
}

int main() {
     boost::thread tr1(calculate_the_answer_to_life_the_universe_and_everything);
     // do something
     boost::unique_lock<boost::mutex> lock(g_mtx);
     g_cond.wait(lock);
     assert(result == 42);
     // do something else
     tr1.join();
     return 0;
}
~~~

这种写法当然是能拿到结果的, 但是有几个问题:

1. 不容易应付异常, notify之前给抛异常了, 另一边就会一直等.
2. 每个"返回值"都需要一个mutex, 一个变量用于储存, 一个条件变量, 用的多了, 传参数就很麻烦, 也容易有重复代码.
3. 没处理意外唤醒, 要处理还得加个flag, 问题2更严重了.
4. notify错了, 忘记notify了, 忘记加锁了...不熟悉条件变量使用引发的问题就更一言难尽了, 上面这代码说不定还是错的.

所以说为了一个"返回值"做这么多事情真的很不值得, 于是很自然的, 我们会想把上面这些事情封装起来, 当然, 封装什么的前人已经做了, 比如C++标准库中使用future/promise对这一类事情建模, 前者给消费者用(wait), 后者给生产者用(notify). 在成为标准前, boost1.41最早引入了future/promise[1], 使用future/promise的话, 我们可以简化上述代码:

~~~
void calculate_the_answer_to_life_the_universe_and_everything(boost::promise<int>& ret) {
     ret.set_value(42);
}

int main() {
     boost::promise<int> pr;
     boost::unique_future<int> f = pr.get_future();
     boost::thread tr1(thread_func, boost::ref(pr));
     // do something
     assert(f.get() == 42);
     // do something else
     tr1.join();
     return 0;
}
~~~

好多了, 问题2,3,4看起来是解决了, 但是异常还是没处理, 当然promise也没神奇到可以帮你捕获异常, 它只是给你`set_exception`把异常保存起来, 然后另一边你调用future.get()的时候再抛出. `try...catch`还是得自己写的. 要不想自己`try_catch`也行, 我们后面讲.

## boost中的future/promise实现

future/promise的最早在1970年代就已经提出, <del>C++还不知道在哪呢</del>, 不同语言中的实现多少有不一样, C++中是通过库实现的, boost是1.41引入的第一版, 基于mutex/condition_variable, 代码比较简洁, 下面我们也是根据这个版本来重复造轮子. STL的实现可能会与平台有关, 比如GCC的STL里的实现就是基于futex的, 而MSVC却又是基于mutex/condition_variable.

boost中`shared_future`和`unique_future`都是对`future_object`的包装, 而这个`future_object`则是mutex/condition_variable/flag的持有者, 真正的实现主体. 既然实现主体在`future_object`, 我们就暂且将之放到后面, 先看promise.

### promise 

promise一般不可复制, `get_future`, `set_value`是其主要接口, 异常处理方面, 有`set_exception`, 特别地, promise析构的时候, 如果没有set过value, 那么就会设一个`broken_promise`的异常. 忽略移动语义, promise的接口可以如下:

~~~
template<typename T>
class unique_future;

template<typename T>
class promise {
private:
       promise(const promise& rhs); // = delete
       promise& operator=(promise& rhs) // = delete
public:
       promise();
       ~promise();
       unique_future<T> get_future();
       void set_value(const T& value);
       void set_exception(boost::exceptional_ptr p);
};
~~~

`boost::exceptional_ptr`是一个类似智能指针的东西, 用来跨线程转发异常的, 可参考文献[3]. 

然后, 成员变量的话, 因为`get_future`按设定只能调用一次, 所以我们需要一个flag来维持, 下面称其为`m_future_obtained`. 除此之外, 就是一个`future_object`的智能指针了, 下面称其为`m_future_entity`. 也因为`get_future`只能调一次, boost中, `future_object`的智能指针是延迟初始化的, 所以boost的实现中会有`lazy_init`这个私有函数. 但是, promise本身没有锁, 而古老的boost 1.41又还没有atomic库, 所以老版本boost的`lazy_init`是不安全的, 这个问题后来版本的boost用atomic库解决, 但我们的系列文章还没有讨论到atomic, 所以这里我们就不用`lazy_init`了, 直接在构造函数中初始化`future_object`:

~~~

class future_already_retrieved;
class promise_already_satisfied;
class broken_promise;

namespace detail {
template<typename T>
class future_object;
} // namespace detail

template<typename T>
class unique_future;

class promise {
private:
    promise(const promise& rhs); // = delete
    promise& operator=(promise& rhs); // = delete
public:
    promise() : m_future_entity(new detail::future_object<T>), m_future_obtained(false) {
        // pass
    }
    ~promise() {
        if (m_future_entity) {
            boost::lock_guard<boost::mutex> lock(m_future_entity->mutex);

            if (!m_future_entity->done) {
                m_future_entity->mark_exceptional_finish_internal(
                    boost::copy_exception(broken_promise()));
            }
        }
    }

    unique_future<T> get_future() {
        if (m_future_obtained) {
            throw future_already_retrieved();
        }
        m_future_obtained = true;
        return unique_future<T>(m_future_entity);
    }

    void set_value(const T& value) {
        boost::lock_guard<boost::mutex> lock(m_future_entity->mutex);
        if (m_future_entity->done) {
            throw promise_already_satisfied();
        }
        m_future_entity->mark_result_finish_internal(value);
    }

    void set_exception(boost::exceptional_ptr p) {
        boost::lock_guard<boost::mutex> lock(m_future_entity->mutex);
        if (m_future_entity->done) {
            throw promise_already_satisfied();
        }
        m_future_entity->mark_exceptional_finish_internal(p);
    }

private:
    boost::shared_ptr<detail::future_object<T> > m_future_entity;
    bool m_future_obtained;
};
~~~

很明显这里的`get_future`只能调用一次的设定也不是线程安全的, 会出现`get_future`被成功调用多次的情况, 但是调多了其实也没啥关系, 毕竟`shared_ptr`的复制是线程安全的, 所以直到boost1.66, 这个可能调多次的问题也没解决.

`set_value`和`set_expection`都需要改变`future_object`的状态, 所以需要将`future_object`的锁暴露出来, 即`m_future_entity->mutex`. 另外, `set_value`或`set_expection`只能调一次, 所以`future_object`得把flag暴露出来, 即`m_future_entity->done`.

几个异常也是派生自`std::logic_error`:

~~~
class future_already_retrieved : public std::logic_error {
public:
    future_already_retrieved() : std::logic_error("Future already retrieved") {}
};

class promise_already_satisfied : public std::logic_error {
public:
    promise_already_satisfied() : std::logic_error("Promise already satisfied") {}
};

class broken_promise : public std::logic_error {
public:
    broken_promise() : std::logic_error("Broken promise") {}
};
~~~

### unique_future

下面我们看`unique_future`, 顾名思义, `unique_future`是不可复制的, 考虑移动的话则是可移动的, boost中使用了`boost::detail::thread_move_t`来模仿移动, 方便起见, 我们就用复制构造函数来移动. 

其余主要接口为: 获取结果(`get`), 等待(`wait`), 判断状态(`get_state`, `is_ready`, `has_exception`, `has_value`). 于是, 简单地, 可以声明`unique_future`如下:

~~~
template<typename T> class promise;
template<typename T> class shared_future;

template<typename T>
class unique_future {
     friend class shared_future<T>;
     friend class promise<T>;
private:
     unique_future(unique_future& rhs); // = delete
     unique_future(boost::shared_ptr<detail::future_object<T> > future_entity)
          : m_future_entity(future_entity) {}
public:
     unique_future(){}
     ~unique_future() {}
     unique_future(const unique_future<T>& rhs) 
        : m_future_entity(rhs.m_future_entity) {
        rhs.m_future_entity->reset();
     }

     T get();
     bool is_ready() const;
     bool has_exception() const;
     bool has_value() const;
     void wait() const;
private:
     boost::shared_ptr<detail::future_object<T> > m_future_entity;
};
~~~

`unique_future`只有一个成员变量`m_future_entity`, 而且这个成员变量只能从`promise`来, 所以接受`future_object`的构造函数是私有的, `unique_future`只能从`promise`那获取, 所以需要声明`promise`为友元; 另一方面, `shared_future`也只能从`unique_future`构造, 需要访问`m_future_entity`, 故也为友元.

也因为只有一个成员变量, 实际上这些方法的实现都委托给`m_future_entity`:

~~~

class future_uninitialized : public std::logic_error {
public:
    future_uninitialized() : std::logic_error("Future Uninitialized") {}
};

template<typename T>
T unique_future::get() {
     if (!m_future_entity) {
          throw future_uninitialized();
     }
     return m_future_entity->get();
}

bool unique_future::is_ready() const {
     return m_future_entity && m_future_entity->is_ready();
}

bool unique_future::has_exception() const {
     return m_future_entity && m_future_entity->has_exception();
}

bool unique_future::has_value() const {
     return m_future_entity && m_future_entity->has_value();
}

void unique_future::wait() const {
     if (!m_future_entity) {
          throw future_uninitialized();
     }
     m_future_entity->wait(false);
}
~~~

boost1.41中, `shared_future`与`unique_future`几近相同, 不同的是, 用`unique_future`构造`shared_future`时, 会使`unique_future`失效(`m_future_entity`被reset). 故而, 这里不赘述shared_future的实现.

### future_object & future_object_base

boost1.41中, `future_object`派生自`future_object_base`, `future_object`持有结果, 而`future_object_base`则持有mutex, condition_variable等状态, 与结果的类型无关.

~~~
namespace detail {
struct future_object_base {
     boost::exception_ptr exception;
     bool done;
     boost::mutex mutex;
     boost::condition_variable cond;

     future_object_base() : done(false) {}
     virtual ~future_object_base() {}

     bool is_ready();
     bool has_exception();
     bool has_value();
     void wait(bool rethrow = true);

     void mark_execptional_finish_internal(const boost::exception_ptr& e);
     void mark_finished_internal();
private:
     future_object_base(const future_object_base&); // = delete
     future_object_base& operator=(const future_object_base&); // = delete
};

template<typename T>
struct future_object : public future_object_base {
     boost::scoped_ptr<T> result;
     
     future_object() : future_object_base() {}
     
     void mark_result_finish_internal(const T& res);
     T get();
     
private:
     future_object(const future_object&); // = delete
     future_object& operator=(const future_object&); // = delete
};
~~~

先看`future_object`会简单一些, 因为没几个方法:

~~~
void future_object::mark_result_finish_internal(const T& res) {
  result.reset(new T(res));
  future_object_base::mark_finished_internal();
}

T future_object::get() {
  future_object_base::wait();
  return *result;
}
~~~

`future_object` 的结果存在scoped_ptr中, `set_value`的时候会复制.

`mark_result_finish_internal`没有加锁, 是因为只有`promise::set_value`会调, 而`promise::set_value`是锁了`future_object_base::mutex`的, 相当于加好锁才调用`mark_result_finish_internal`. 同理, `mark_execptional_finish_internal`和`mark_finished_internal`内也没有加锁.

~~~
bool future_object_base::is_ready() {
  boost::unique_lock<boost::mutex> lock(mutex);
  return done;
}
bool future_object_base::has_exception() {
  boost::unique_lock<boost::mutex> lock(mutex);
  return done && exception;
}
bool future_object_base::has_value() {
  boost::unique_lock<boost::mutex> lock(mutex);
  return done && !exception;
}
void future_object_base::wait(bool rethrow = true) {
  boost::unique_lock<boost::mutex> lock(mutex);
  while (!done) {
    cond.wait(lock);
  }
  if (rethrow && exception) {
    boost::rethrow_exception(exception);
  }
}
void future_object_base::mark_exceptional_finish_internal(const boost::exception_ptr& e) {
  exception = e;
  mark_finished_internal();
}
void future_object_base::mark_finished_internal() {
  done = true;
  cond.notify_all();
}
~~~

`future_object_base::wait`是有参数的, 如果rethrow, 会重新抛出其保存的异常; 上层调用中, `unique_future::wait`是不抛出的, 而`unique_future::get`是抛出的.

至此, 一个基本能滚的future/promise轮子就给造出来了.

## wait_for_all/wait_for_any

假设你有好些个future, 需要这些future全部ready或任意一个future ready的时候继续往下走, 你就可能需要`wait_for_all`和`wait_for_any`. `wait_for_all` 好理解, 你要合并两个工作线程的结果什么的. `wait_for_any`的话, 需要对结果进一步处理, 处理还比较耗时所以需要来一个处理一个? 好吧, 其实我也没想到什么特别典型的场景.

`wait_for_all`的实现还是很简单的, 一个个等就是了, 比如说等3个future的版本:

~~~
template<typename F1, typename F2, typename F3>
void wait_for_all(F1& f1, F2& f2, F3& f3) {
     f1.wait();
     f2.wait();
     f3.wait();
}
~~~

非侵入, 简单粗暴, C++11和boost.thread的future混合着等待都行. 不过`wait_for_all`更适合等一个迭代器区间的future<del>两三个future手动wait一下就好了</del>, 迭代器区间有不同库的future混合的情况...想必比较少吧...

但是, `wait_for_any`在现有接口下就没有非侵入的实现了, 需要在future实现里面加callback, waiter list什么的, 就意味着`wait_for_any`只能用来wait同一库中的future了, 比如, boost的`wait_for_any`只能用来等boost的future, <del>好吧, 标准库没有wait_for_any</del>.

boost1.41实现了`future_waiter`去执行`wait_for_any`的等待, 而`future_waiter`做的事情, 实际上是向`future_object_base`注册了一个条件变量, `mark_finished_internal`的时候顺便notify一下注册进来的条件变量. 有notify自然是有future完成了, 然后就返回个整数, 指出是第几个future完成了.

~~~
template<typename F1, typename F2, typename F3>
unsigned wait_for_any(F1& f1, F2& f2, F3& f3) {
     detail::future_waiter waiter;
     waiter.add(f1);
     waiter.add(f2);
     waiter.add(f3);
     return waiter.wait();
}
~~~

`future_waiter`的接口比较少:
~~~
namespace detail {
class future_waiter {
public:
     future_waiter() : m_future_count(0) {}
     ~future_waiter();
public:
     template<typename F>
     void add(F& f);
     unsigned wait();

private:
     boost::condition_variable_any m_cond;
     std::vector<detail::registered_waiter> m_waiting_futures;
     unsigned m_future_count;
};
} // namespace future_waiter
~~~

其中, `m_waiting_futures`表示正在等待的future.

那么,  `registered_waiter`需要什么保存什么信息呢? 首先`future`或`future_object`, 这里可以用`future_object`的智能指针, 直接从future中拿就行; 其次, 某个标记, 以便`future_waiter`析构的时候, 从`future_object_base`中注销, 如果不注销, 就可能会notify一个已经销毁的条件变量; 最后就是future的顺序信息了, 毕竟得返回是第几个future ready了:

~~~
namespace detail {
struct registered_waiter {
  boost::shared_ptr<detail::future_object_base> future_entity;
  detail::future_object_base::waiter_list::iterator wait_iterator;
  unsigned index;

  registered_waiter(
      const boost::shared_ptr<detail::future_object_base>& future_entity_,
      detail::future_object_base::waiter_list::iterator wait_iterator_,
      unsigned index_) :
    future_entity(future_entity_),
    wait_iterator(wait_iterator_),
    index(index_) { }
};
} // namespace detail
~~~

这里用的标记是`future_object_base`的`waiter_list`的迭代器, 而`waiter_list`可以是一个condition_variable_any指针的list:

~~~
namespace detail {
struct future_object_base {
     //...
     typedef std::list<boost::condition_variable_any*> waiter_list;
     waiter_list external_waiters;
     //...
};
} // namespace detail
~~~

这样我们去写`future_waiter::add`函数了:

~~~
namespace detail {
template<typename F>
void future_waiter::add(F& f) {
    if (f.m_future_entity) {
    m_waiting_futures.push_back(
        registered_waiter(f.m_future_entity,
                          f.m_future_entity->register_external_waiter(&m_cond),
                          m_future_count));
    }
    ++m_future_count;
}
} // namespace detail
~~~

这里需要调用`future_object_base`的`register_external_waiter`将`m_cond`的指针注册到`future_object_base`的`external_waiters`中, 并返回其迭代器, 这个迭代器需要保证其他元素删除后仍然有效, 所以`future_object_base::waiter_list`用的是`std::list`:

~~~
namespace detail {
struct future_object_base {
  //...
  typedef std::list<boost::condition_variable*> waiter_list;
  waiter_list external_waiters;
  waiter_list::iterator register_external_waiter(boost::condition_variable_any* cv) {
    boost::unique_lock<boost::mutex> lock(mutex);
    return external_waiters.insert(external_waiters.end(), cv);
  }
  //...
};
} // namespace detail
~~~

然后`future_waiter`析构函数中注销之前注册的条件变量指针, 就是从`external_waiters`中erase掉:

~~~
future_waiter::~future_waiter() {
  for (size_t i = 0; i < m_waiting_futures.size(); ++i) {
    registered_waiter& waiter = m_waiting_futures[i];
    waiter.future_entity->remove_external_waiter(waiter.wait_iterator);
  }
}

namespace detail {
struct future_object_base {
  //...
  typedef std::list<boost::condition_variable_any*> waiter_list;
  waiter_list external_waiters;
  void remove_external_waiter(waiter_list::iterator it) {
    boost::lock_guard<boost::mutex> lock(mutex);
    external_waiters.erase(it);
  }
  //...
};
} // namespace detail
~~~

剩下的是最复杂的`future_waiter::wait`, 为什么说最复杂呢? 因为我们把`future_waiter::m_cond`注册到`future_object_base`去了, 之后自然是要wait这个`m_cond`对吧, 但是`condition_variable_any::wait`需要一个锁作为参数呀! 被notify之后, 我们需要检查`m_waiter_futures`中的所有future, 所以这个锁等价于`m_waiting_futures`中的所有future的锁, 这个就需要一次锁一vector的mutex且避免死锁, 幸运的是, `boost::lock`已经提供了这个算法. 于是, 我们可以实现一个特别的锁结构`all_future_entity_lock` :

~~~
namespace detail {
struct all_future_entity_lock {
     all_future_entity_lock(std::vector<detail::registered_waiter>& futures);
     void lock();
     void unlock();
};

unsigned future_waiter::wait() {
    all_future_entity_lock lk(m_waiting_futures);
    for (;;) {
      for (size_t i = 0; i < m_waiting_futures.size(); ++i) {
        detail::registered_waiter& waiter = m_waiting_futures[i];
        if (waiter.future_entity->done) {
          return waiter.index;
        }
      }
      m_cond.wait(lk);
    }
}
} // namespace detail
~~~

由于`boost::lock`函数接受的是可锁对象, 我们没法弄一个mutex指针的容器传到`boost::lock`去, 所以我们得构造别的可锁对象的容器, `boost::unique_lock`因为其允许延迟锁定的特性正好符合我们的需求:

~~~
namespace detail {
struct all_future_entity_lock {
  unsigned count;
  boost::scoped_array<boost::unique_lock<boost::mutex> > locks;

  all_future_entity_lock(std::vector<detail::registered_waiter>& futures) :
    count(futures.size()), locks(new boost::unique_lock<boost::mutex>[futures.size()]) {
    for (size_t i = 0; i < count; ++i) {
      locks[i] = boost::unique_lock<boost::mutex>(futures[i].future_entity->mutex, boost::defer_lock);
    }
    lock();
  }
  void lock() {
    boost::lock(locks.get(), locks.get() + count);
  }
  void unlock() {
    for (unsigned i = 0; i< count; ++i) {
      locks[i].unlock();
    }
  }
};
} // namespace detail
~~~
 
构造`boost::unique_lock`的时候, `boost::defer_lock`这个参数是需要的, 否则构造的时候就会锁定, 可能造成死锁. 另外这里用scoped_array的原因其实笔者也不知道, 按说用vector也应该可以, vector与scoped_array不同的也许就是scoped_array是不可复制的, 也许是为了保证不可复制?

另外, 因为`boost::condition_variable::wait`只接受boost内定义的锁, 如果想接受任意类型的锁, 得用`boost::condition_variable_any`.
 
最后, 我们需要修改一下`future_object_base::mark_finished_internal`:

~~~
namespace detail {

void mark_finished_internal() {
    done = true;
    cond.notify_all();
    for (waiter_list::const_iterator it = external_waiters.begin();
      it != external_waiters.end();
      ++it) {
      (*it)->notify_all();
    }
}

} // namespace detail
~~~

综合上述代码, 我们的`wait_for_any`应该就完成了, 它能否保证得到第一个ready的future的呢?

首先, `future_waiter::wait`中, 如果有多于一个future已经ready了, 那返回的其实不是第一个ready的, 因为谁是第一个ready这个信号已经丢失了.

如果走到`m_cond.wait(lk)`的时候仍没有future是ready的, 也就是, 该线程会被挂起后被唤醒, 比如, 两个线程t1和t2在很相近的时间notify同一个condition_variable: 

t1 notify了之后, 因为还没有解锁, wait_for_any被唤醒后重新获得锁的过程还在阻塞, 但这时, `t2`的promise的future的锁可能没谁占有, 这就使得`t2`可以`set_value`, 于是又触发了一次notify, 然而, 因为condition_variable内部状态是有锁保护的, 所以这次notify是可以完成的, 虽然没有线程被唤醒. 于是乎, `t2`的promise的future被`mark_finished_internal`, 解了自己的锁. 再然后, `t1`可能现在才解锁, `wait_for_any`才重新所有锁, 这时去遍历`future`, 会发现有两个都ready了.

虽然`wait_for_any`不能保证得到的是第一个ready的`future`, 但是, `wait_for_any`结束的时候, 可以保证至少一个future是ready的.

另外, 从实现可以看出, 将同一`future`的两个`shared_future`传到`wait_for_any`是要死锁的, 因为`all_future_entity_lock`中并没有排重, <del>实现排重的wait_for_any留作作业</del>.

## 总结

上面我们分析了boost1.41中`future/promise`的主线代码, 当然, 还有一些功能没有分析, 比如`packaged_task`.

文章开始的时候我们说道, `promise`也没神奇到可以帮你捕获异常, 但是如果我的线程只需要提供一个结果, 也就是说我就想起个线程跑个有单一返回值的函数, boost提供了`packaged_task`:

~~~
int calculate_the_answer_to_life_the_universe_and_everything() {
    return 42;
}

int main() {
     boost::packaged_task<int> task(calculate_the_answer_to_life_the_universe_and_everything);
     boost::future<int> f = task.get_future();
     boost::thread tr1(boost::move(task));
     // do something
     assert(f.get() == 42);
     // do something else
     tr1.join();
     return 0;
}
~~~

如果理解了`future/promise`的实现, `packaged_task`的实现也很好理解, 这里就不赘述了.

至于说`packaged_task`和`thread`都不想用, 想要更简洁的, boost1.52后也提供了`boost::async`, 不过1.52都2012年末了, `std::async`也早已经进入C++11标准.

async的实现复杂一些, 一方面需要考虑launch policy, 另一方面, 需考虑用线程池还是说总是起新线程等等, 但考虑简单粗暴的实现话, 可以是对`packaged_task`的封装.

boost1.54后, 加入了`future::then`, 以提供future间的串联操作:

~~~
int main() {
     boost::future<int> f1 = boost::async([](){return 42;});
     boost::future<std::string> f2 = f1.then([](boost::future<int> f) {
          return boost::str(boost::format("%d") % f.get()); 
     }); // 这里不会阻塞
     assert("42" == f2.get()); // 这里才会阻塞
     return 0;
}
~~~

而在使用then的场合下, `wait_for_all/wait_for_any`的阻塞等待就不合适了, 于是boost1.56加入了`when_all/when_any`, 与`wait_for_any`不同, `when_any`是立即返回又一个`future`,  这使得我们在then串联中可以达到类似`wait_for_any`的效果, 但却是非阻塞的:

~~~
int main() {
     boost::future<int> f1 = boost::async([]() { return 42;});
     boost::future<int> f2 = boost::async([]() { return 233;});
     auto f3 = boost::when_any(f1, f2); // 这里不会阻塞
     auto f4 = f3.then([](auto& f) {
          f.get();
          return 1234;
     });
     assert(1234 == f4.get()); // 这里才会阻塞
}
~~~

boost1.56的发布时间虽然只是来到2015年后半, 然而then/when_any并没有进入C++17<del>C++17毛都没有!C++日常药丸!</del>. 不过从参考文献[2]可以看出, 以后应该是很有希望进标准的.

至于async, then, when_any/when_all的实现, 需要一些篇幅, 我们还是另开一篇博客再叙吧<del>此坑有缘再填系列</del>~

**Reference:**  

* {:.ref} \[1]  Anthony Williams. boost1.41, thread, [Synchronization](https://www.boost.org/doc/libs/1_41_0/doc/html/thread/synchronization.html#thread.synchronization.futures). Aug, 2007. 
* {:.ref} \[2]  Niklas Gustafsson, Artur Laksberg, Herb Sutter, Sana Mithani. [A Standardized Representation of Asynchronous Operations](http://www.open-std.org/jtc1/sc22/wg21/docs/papers/2012/n3428.pdf). Sept.21, 2012.  
* {:.ref} \[3]  Emil Dotchevski, Reverge Studios,Inc. [Transporting of Exceptions Between Threads](https://www.boost.org/doc/libs/1_42_0/libs/exception/doc/tutorial_exception_ptr.html). 2009.  

