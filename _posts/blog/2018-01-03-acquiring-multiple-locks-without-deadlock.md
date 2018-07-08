---
layout: post
title: 如何一次锁多个mutex且避免死锁
description: 上一篇博客中, 我们提到了无法保证加锁顺序的多个mutex, 需要一个全锁或全不锁的算法, 才能确保不会死锁, 当时我们用的是std::lock. 那么问题来了, std::lock是怎么做到不会死锁的呢?  
category: blog
---

上一篇[博客](/cpp-swap)中, 我们提到了无法保证加锁顺序的多个mutex, 需要一个全锁或全不锁的算法, 才能确保不会死锁.

考虑我们有两个mutex, m1和m2, 有时我们需要一起锁两个mutex来进行某些操作, 不按顺序加锁的话, 可能会导致死锁, 比如:

~~~
void thread1() {
  m1.lock();
  m2.lock();
}

void thread2() {
  m2.lock();
  m1.lock();
}
~~~

thread1把m1锁了之后, 时间片用完挂起了, 然后thread2把m2锁了, 等待m1, 然后thread1继续运行, 等待m2, 死锁了.

当然, 我们按顺序来, 比如都改成先锁m1, 后锁m2是可以避免死锁的, 但这种约定很难保证, 尤其是mutex很多的时候. 如果有一种顺序无关的加锁方法, 事情的简单了, std::lock正是这样一个工具:

~~~
void thread1() {
  std::lock(m1, m2);
}

void thread2() {
  std::lock(m2, m1);
}
~~~

std::lock保证了不会死锁, 那么问题来了, std::lock是怎么做到不会死锁的呢?

## boost.lock_algorithm的实现

毕竟c++11的线程模型来源于boost, 我们可以先看一下boost::lock是怎么实现的.

boost 1.60中, 与std::lock类似的boost::lock存在于`boost/thead/lock_algorithm.hpp`. 通过重载达到类似变长参数的效果, 就是形如:

~~~
template <typename MutexType1, typename MutexType2>
void lock(MutexType1& m1, MutexType2& m2);

template <typename MutexType1, typename MutexType2, typename MutexType3>
void lock(MutexType1& m1, MutexType2& m2, MutexType3& m3);

template <typename MutexType1, typename MutexType2, typename MutexType3, typename MutexType4>
void lock(MutexType1& m1, MutexType2& m2, MutexType3& m3, MutexType4& m4);

~~~

先看两个mutex的, 方便起见, 我们不用模板:

~~~
void lock(mutex& ma, mutex& mb)
{
      unsigned const lock_count = 2;
      unsigned lock_first = 0;
      for (;;)
      {
        switch (lock_first)
        {
        case 0:
          lock_first = detail::lock_helper(ma, mb);
          if (!lock_first) return;
          break;
        case 1:
          lock_first = detail::lock_helper(mb, ma);
          if (!lock_first) return;
          lock_first = (lock_first + 1) % lock_count;
          break;
        }
      }
}
~~~

其内部是一个死循环, 直到lock_first等于0, 循环才结束.

~~~
unsigned lock_helper(mutex& m1, mutex& m2)
{
  boost::unique_lock< mutex> l1(m1);
  if (!m2.try_lock())
  {
    return 1;
  }
  l1.release();
  return 0;
}
~~~

上面是lock_helper的实现, 首先锁上ma(m1), 然后尝试锁mb(m2); 如果成功了, unique_lock解绑ma(m1); ma(m1)仍然锁着, 只是l1析构时就不解锁了; 然后返回0, 此时lock中的死循环因为lock_first等于0, 结束循环, 两个锁都锁上了, 一切顺利;

如果尝试锁 mb(m2)没锁上, 则返回1, 此时l1析构, ma(m1)解锁, 两个锁都没锁上, lock_first等于1, 下一次循环中, 我们先去锁mb.

第二次循环中, 如果mb锁上了, 尝试ma, 如果锁上了, 返回0, 一切顺利; 如果碰巧ma没锁上, 则返回1, 回到循环, 经过`(lock_first + 1) % lock_count`, lock_first为0, 下次先锁ma;

如此循环, 直到有一次一切顺利, 把两个锁都锁上; 或者异常抛出, 两个锁都没锁上.

看起来似乎也不是很复杂, 我们再来看3个mutex的:

~~~
void lock( mutex& ma, mutex& mb, mutex& mc)
{
  unsigned const lock_count = 3;
  unsigned lock_first = 0;
  for (;;)
  {
    switch (lock_first)
    {
    case 0:
      lock_first = detail::lock_helper(ma, mb, mc);
      if (!lock_first) return;
      break;
    case 1:
      lock_first = detail::lock_helper(mb, mc, ma);
      if (!lock_first) return;
      lock_first = (lock_first + 1) % lock_count;
      break;
    case 2:
      lock_first = detail::lock_helper(mc, ma, mb);
      if (!lock_first) return;
      lock_first = (lock_first + 2) % lock_count;
      break;
    }
  }
}

unsigned lock_helper( mutex& m1, mutex& m2, mutex& m3)
{
  boost::unique_lock< mutex> l1(m1);
  if (unsigned const failed_lock=try_lock_internal(m2,m3))
  {
    return failed_lock;
  }
  l1.release();
  return 0;
}

unsigned try_lock_internal( mutex& mi, mutex& mj)
{
  boost::unique_lock<MutexType1> li(mi, boost::try_to_lock);
  if (!li)
  {
    return 1;
  }
  if (!mj.try_lock())
  {
    return 2;
  }
  li.release();
  return 0;
}
~~~

从lock_helper中可以看到, 3个mutex的情况下, 也是先锁一个, 然后再尝试锁另外两个. 而try_lock_internal中, 我们可以看到, 那个try_lock失败了, 就返回那个; 比如返回2, 
下次就从mc开始锁, 此时再返回2, 下次从mb开始锁. 哪个锁失败, 下次从哪个开始锁.

哪个锁失败, 下次从哪个开始锁, 这个是为什么呢? lock_algorithm的作者在参考文献[1]中指出, try_lock失败意味着该锁正被另一线程占据, 如果不换顺序, 下一次尝试的时候, 可能又会发生先锁的成功了, 后锁的仍然被其他线程占据, 如此重复加锁解锁, 虽然逻辑上没毛病, 但却是增加锁竞争, 浪费CPU的行为. 

## VC++2017中的实现

先从上一次失败的mutex开始锁, 不断尝试, 直到所有mutex都锁好, 微软家的标准库也是这个思路, 只是C++11语法中, 我们可以使用变长模板参数, 使接口可以写成这样:

~~~
template<typename Lock0, typename Lock1, typename ...LockN>
inline void lock(Lock0& lk0, Lock1& lk1, LockN&... lkn);
~~~

每轮循环记录第n个mutex加锁失败, 下次就先锁第n个mutex. 只是lkn是参数包, "先锁第n个mutex" 意味着访问参数包第n个参数, 经过搜索, 标准中似乎没有提供像vector那样随机访问参数包的操作, 估计是VC++的独特支持. 方便起见, 我们就用vector<mutex*>来代替参数包从而去掉模板, 使代码更简单易懂, 毕竟我们就讨论个加锁算法, 并没有打算讨论模板编程:

~~~

namespace std {
namespace detail {

inline void lock_from_locks(const int target, vector<mutex*>& lkn) {
  lkn[target]->lock();
}

inline bool try_lock_from_locks(const int target, vector<mutex*>& lkn) {
  return lkn[target]->try_lock();
}

// unlock lkn[first, last)
inline bool unlock_locks(const int first, const int last, vector<mutex*>& lkn) {
  for (int idx = first; idx != last; ++idx) {
    lkn[idx]->unlock();
  }
}

// try to lock lkn[first, last)
inline int try_lock_range(const int first, const int last, vector<mutex*>& lkn) {
  for (int idx = first; idx != last; ++idx) {
    if (!detail::try_lock_from_locks(idx, lkn)) {
      detail::unlock_locks(first, idx, lkn);
      return idx;
    }
  }
  return -1;
  
}

inline int lock_attempt(const int hard_lock, vector<mutex*>& lkn) {
  detail::lock_from_locks(hard_lock, lkn);
  int failed = -1;
  int backout_start = hard_lock; // 此时只有hard_lock锁了, backout_start用于解锁hard_lock

  failed = detail::try_lock_range(0, hard_lock, lkn);
  if (failed == -1) {
    backout_start = 0; // 此时[0, hard_lock]都锁了, backout需要解锁[0, hard_lock]
    failed = detail::try_lock_range(hard_lock + 1, lkn.size(), lkn);
    if (failed == -1) {
      return -1; // 此时全部都锁了
    }
  }
  // 解锁lkn[backout_start, hard_lock]
  detail::unlock_locks(backout_start, hard_lock + 1, lkn); 
  std::this_thread::yield(); // 有锁不成功的, 放弃CPU, 免得浪费
  return failed;
}

inline void lock_nonmenber(vector<mutex*>& lkn) {
  int hard_lock = 0;
  while (hard_lock != -1) {
    hard_lock = detail::lock_attempt(hard_lock, lkn);
  }
}

} // namespace detail

inline void lock(vector<mutex*>& lkn) {
  detail::lock_nonmenber(lkn);
}

} // namespace std

~~~

简单来说就是先锁`hard_lock`, 然后从0锁到`hard_lock - 1`, 如果都成功了, 再从`hard_lock + 1`锁到最后, 哪个失败了就将这个失败的设为`hard_lock`, 下次从它开始.

## GCC中的实现

GCC中的实现使用std::tie和std::tuple访问参数表, 因为std::tuple只能用模板参数决定访问哪个对象, 所以GCC的实现需要用模板递归的方式遍历参数包, 也是因为如此, GCC的实现并没有记录上一次失败的mutex, 而是每次从头再来:

~~~
namespace std {
namespace detail {

template<typename Lk>
inline std::unique_lock<Lk> try_to_lock(Lk& lk) {
  return std::unique_lock<Lk>(lk, std::try_to_lock);
}

template < int Idx, bool Continue = true>
struct try_lock_impl {
  template<typename... LkN>
  static void do_try_lock(std::tuple<LkN&...>& lkn, int* idx) {
    idx = Idx;
    auto lock = detail::try_to_lock(std::get<Idx>(lkn));
    if (lock.owns_lock()) { // 如果第Idx个mutex没有加锁成功, 即结束递推
      constexpr bool cont = Idx + 2 < sizeof...(lkn);
      using try_locker = try_lock_impl<Idx + 1, cont>; // 模板递推
      try_locker::do_try_lock(lkn, idx);
      if (idx == -1) {
        lock.release();
      }
    }
  }
};

template <int Idx>
struct try_lock_impl<Idx, false> {
  template<typename... LkN>
  static void do_try_lock(std::tuple<LkN&...>& lkn, int& idx) {
    idx = Idx;
    auto lock = detail::try_to_lock(std::get<Idx>(lkn));
    if (lock.owns_lock()) {
      idx = -1;
      lock.release();
    }
  }
};

} // namespace detail

template <typename Lk1, typename Lk2, typename... LkN>
void lock(Lk1& lk1, Lk2& lk2, LkN&... lkn) {
  while (true) {
    using try_locker = detail::try_lock_impl<0, sizeof...(LkN) != 0 >;
    std::unique_lock<Lk1> first(lk1);
    int idx; // 递归展开参数包, 如果全部加锁成功, idx会置为-1, 否则表示加锁失败那个
    auto locks = std::tie(lk2, lkn...);
    try_locker::do_try_lock(locks, idx);
    if (idx == -1) {
      first.release();
      return;
    }
  }
}

} // namespace std

注意`try_lock_impl`有一个特化, 是最后一个mutex, 结束遍历的版本, 这里如果都成功了, idx才会置为-1, 表示全部成功.

## 总结

要实现类似std::lock的加锁算法, 要求mutex具备lock, unlock, try_lock几个接口. 

boost的实现使用重载来提供近似变长参数的效果, 但最多支持9个参数, 也因为每个重载参数都是固定的, 所以会使用switch结构手动调整加锁顺序, 从上一次失败的开始加锁.

VC++的实现基于某种可能是微软家特殊支持的方式, 使得可以像数组一样访问参数包, 这样也使其可以记录上一轮加锁失败的idx, 下一次从这个mutex开始.

GCC的实现却是用tuple展开参数包, 编译时递归的写法, 让GCC没有记录上一次失败的mutex, 而是每次从头锁到尾.

**Reference:**  

* {:.ref} \[1]  Anthony Williams. [Acquiring Multiple Locks Without Deadlock](https://www.justsoftwaresolutions.co.uk/threading/acquiring-multiple-locks-without-deadlock.html). 2008.
* [:.ref} \[2] gcc-mirror. [mutex](https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/std/mutex). 2018
