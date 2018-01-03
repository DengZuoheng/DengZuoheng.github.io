---
layout: post
title: 如何一次锁多个mutex且避免死锁
description: 上一篇博客中, 我们提到了无法保证加锁顺序的多个mutex, 需要一个全锁或全不锁的算法, 才能确保不会死锁, 当时我们用的是std::lock. 那么问题来了, std::lock是怎么做到不会死锁的呢?  
category: blog
---

上一篇博客中, 我们提到了无法保证加锁顺序的多个mutex, 需要一个全锁或全不锁的算法, 才能确保不会死锁, 当时我们用的是std::lock. 那么问题来了, std::lock是怎么做到不会死锁的呢?

毕竟c++11的线程模型来源于boost, 我们可以先看一下boost是怎么实现的.

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

哪个锁失败, 下次从哪个开始锁, 这个为什么lock_algorithm的作者没有说[1]; 我猜, 假设这几个mutex都是用boost::lock来锁的, 那么, 先锁那个无所谓; 如果这些锁在其他用到的地方是单独锁的, 那么, try_lock失败意味着, 这个锁的失败的可能更大. 如果不换顺序, 每次都先锁容易成功的锁, 而容易失败的又老是失败, 锁容易成功的锁的加锁次数变大了, 这是不必要的开销.


**Reference:**  

* {:.ref} \[1]  Anthony Williams. [Acquiring Multiple Locks Without Deadlock](https://www.justsoftwaresolutions.co.uk/threading/acquiring-multiple-locks-without-deadlock.html). 2008.
