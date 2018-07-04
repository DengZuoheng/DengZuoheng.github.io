---
layout: post
title: C++的循环系列#2&#58; boost foreach 性能测试
description: BOOST_FORACH会不会比iterator慢? 我们还能愉快地使用BOOST_FOREACH吗?
category: blog
---

BOOST_FORACH会不会比iterator慢? 这个问题也许困扰过不少人. 要探明这个问题, 我们需要设计一个benchmark, 用来对比不同写法的循环用时差距. 如果有差距, 我们是否可以设置一些参考值, 比如, 多大的循环下, 差距不明显, 仍然可以放心使用BOOST_FOREACH.

## 计时方式

方便起见, 我们直接就用`boost::timer`来计时了, 构造时开始计时, 调用`boost::timer::elapsed()`可以获得一个计时结果, 一个以秒为单位的实数. 高版本的boost有`auto_cpu_timer`, 但笔者的工作环境的boost比较旧, 于是就仿照写了一个auto_timer, 构造的时候开始计时, 析构的时候输出计时:

~~~
class auto_timer {
public:
    auto_timer(std::string name) : n(name) {

    }
    void out() {
        double used = t.elapsed();
        std::cout << n << " used: " << used << "sec" << std::endl;
    }
    ~auto_timer() {
        out();
    }
    std::string n;
    boost::timer t;
};
~~~

这是本文中主要的计时方式. 但`boost::timer`似乎没有精确到毫秒, 所以有时我也会更偷懒的用google test来测时间(gtest会输出每个测试的用时, 看起来是取整到毫秒). <del>什么? 你说google benchmark? 对不起, 没装...</del>

## 测试对象

毕竟`boost::timer`精度不高, 我们得弄个足够长时间的操作, 比如遍历个100m的vector, 然后遍历100遍, 但循环体却力求简单, 几乎什么都不做:

~~~
static std::vector<int> vec100m(100*1000*1000, 0);

int loop = 100;

void boost_foreach_performence_100m() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

~~~

同理我们可以写一个基于iterator的, 基于index的. 另外, 先剧透一下, BOOST_FOREACH确实会慢一些, 于是我们加入了模仿BOOST_FOREACH内层循环的版本, 看看BOOST_FOREACH的结构会产生多大的影响.

而且iterator和index的情况下有没有先把`vec.end()`或`vec.size()`提取出来又会有一些影响. 所以我们加入了提取版本和非提取版本. 

最后, 就是上一篇写的FOREACH了, 下面的代码中用`railgun foreach`指代.

共六种写法, 完整的代码如下:

~~~
#include <iostream>
#include <vector>
#include <string>
#include <boost/mpl/bool.hpp>
#include <boost/foreach.hpp>
#include <boost/timer.hpp>

class auto_timer {
public:
    auto_timer(std::string name) : n(name) {

    }
    void out() {
        double used = t.elapsed();
        std::cout << n << " used: " << used << " sec" << std::endl;
    }
    ~auto_timer() {
        out();
    }
    std::string n;
    boost::timer t;
};

static std::vector<int> vec100m(100*1000*1000, 0);

int loop = 100;

void boost_foreach_performence_100m() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }
    }
}

void build_in_iter_performence_100m() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        std::vector<int>::iterator e = vec.end();
        for (std::vector<int>::iterator it = vec.begin();
             it != e; ++it) {
            int& item = *it;
            item += i;
        }
    }
}

inline bool _set_false(bool& _continue) {
       _continue = false;
       return false;
}
template<typename T>
inline void _next(T& it) {
    ++it;
}

void build_in_iter_performence_100m_fake_internal_loop() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        std::vector<int>::iterator b = vec.begin();
        std::vector<int>::iterator e = vec.end();
        for (bool _continue = true;
             _continue && b != e;
             _continue ? _next(b) : (void)0) {
            if (_set_false(_continue)) {} else {
                for (int& item = *b; !_continue; _continue = true) {
                    item += i;
                }
            }
        }

    }
}

#include <railgun/foreach/foreach.hpp>

void railgun_foreach_100m() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        FOREACH(int& item, vec) {
            item += i;
        }

    }
}

void build_in_iter_performence_100m_call() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        for (std::vector<int>::iterator it = vec.begin();
             it != vec.end(); ++it) {
            int& item = *it;
            item += i;
        }
    }
}

void index_foreach_performence_100m() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        size_t s = vec.size();
        for (size_t idx = 0; idx < s; ++idx) {
            int& item = vec[idx];
            item += i;
        }
    }
}

void index_foreach_performence_100m_call() {
    auto_timer timer(__func__);
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        for (size_t idx = 0; idx < vec.size(); ++idx) {
            int& item = vec[idx];
            item += i;
        }
    }
}

int main() {
    boost_foreach_performence_100m();
    build_in_iter_performence_100m();
    build_in_iter_performence_100m_fake_internal_loop();
    railgun_foreach_100m();
    build_in_iter_performence_100m_call();
    index_foreach_performence_100m();
    index_foreach_performence_100m_call();
    return 0;
}
~~~

## 测试结果

我们在不同版本的编译器上各测试了一波(单位: 秒):

GCC 3.4.5 : 

| | debug | release + O2 |
| --- | --- | --- |
| boost foreach | 339.16 | 21.57 |
| iterator(预先提取end()) | 117.53 | 6.81 | 
| iterator(不提取end()) | 185.34 | 6.72 |
| iterator(模仿foreach的内层循环) | 183.95 | 6.92 |
| index(预先提取size()) | 203.95 | 6.67 |
| index(不提取size()) | 461.898 | 6.61 |
| railgun foreach | 335.35 | 6.97 |

GCC 4.4.7 :

| | debug | release + O2 |
| --- | --- | --- |
| boost foreach | 327.28 | 6.97 |
| iterator(预先提取end()) | 115.99 | 6.82 | 
| iterator(不提取end()) | 185.34 | 6.72 |
| iterator(模仿foreach的内层循环) | 183.74 | 6.67 |
| index(预先提取size()) | 44.82 | 7.35 |
| index(不提取size()) | 79.65 | 7.36 |
| railgun foreach | 328.4 | 6.52 |

GCC 4.8.4 :

| | debug | release + O2 |
| --- | --- | --- |
| boost foreach | 279.34 | 7.35 |
| iterator(预先提取end()) | 95.39 | 7.04 | 
| iterator(不提取end()) | 143.48 | 7.16 |
| iterator(模仿foreach的内层循环) | 156.61 | 7.09 |
| index(预先提取size()) | 43.16 | 8.09 |
| index(不提取size()) | 66.03 | 7.98 |
| railgun foreach | 269.29 | 7.05 |

可以看出:

- debug模式下BOOST_FOREACH总是慢三倍, 这个...我一会再洗.
- GCC 3.4.3 实在太老了, debug模式下index不提取size居然是最慢的, 但我感觉这是我们最常用的写法了.
- GCC 3.4.3 实在太老+1, 即使开了优化, BOOST_FOREACH也比iterator慢三倍, 这个没得洗.
- 虽然GCC 3.4.3很老, 但railgun foreach却没有这么慢, 这就很尴尬了, 难道我什么地方写错了么?
- 开了优化后, 不同写法并没有什么差距, 除了GCC 3.4.3
- debug模式下, 升级编译器还是有好处的, 躺着不动就可能提升几倍性能.
- debug模式下, BOOST_FOREACH的`_continue`结构需要背三分之一的锅, 剩下的可能是auto_any_cast的.

另外, 验证其线性时间复杂度的代码如下, 结果确实是挺线性的, 这里就不贴结果了:

~~~

#include <gtest/gtest.h>

#include <iostream>
#include <vector>
#include <string>
#include <boost/mpl/bool.hpp>
#include <boost/foreach.hpp>

std::vector<int> vec10k(10*1000);
std::vector<int> vec100k(100*1000);
std::vector<int> vec1m(1000*1000);
std::vector<int> vec10m(10*1000*1000);
std::vector<int> vec100m(100*1000*1000);

int loop = 100;

TEST(for_each_test, boost_foreach_performence_10k) {
    std::vector<int>& vec = vec10k;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

TEST(for_each_test, build_in_foreach_performence_10k) {
    std::vector<int>& vec = vec10k;

    for (int i = 0; i < loop; ++i) {
        for (std::vector<int>::iterator it = vec.begin();
             it != vec.end(); ++it) {
            int& item = *it;
            item += i;
        }
    }
}

TEST(for_each_test, boost_foreach_performence_100k) {
    std::vector<int>& vec = vec100k;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

TEST(for_each_test, build_in_foreach_performence_100k) {
    std::vector<int>& vec = vec100k;

    for (int i = 0; i < loop; ++i) {
        for (std::vector<int>::iterator it = vec.begin();
             it != vec.end(); ++it) {
            int& item = *it;
            item += i;
        }
    }
}

TEST(for_each_test, boost_foreach_performence_1m) {
    std::vector<int>& vec = vec1m;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

TEST(for_each_test, build_in_foreach_performence_1m) {
    std::vector<int>& vec = vec1m;

    for (int i = 0; i < loop; ++i) {
        for (std::vector<int>::iterator it = vec.begin();
             it != vec.end(); ++it) {
            int& item = *it;
            item += i;
        }
    }
}

TEST(for_each_test, boost_foreach_performence_10m) {
    std::vector<int>& vec = vec10m;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

TEST(for_each_test, build_in_foreach_performence_10m) {
    std::vector<int>& vec = vec10m;

    for (int i = 0; i < loop; ++i) {
        for (std::vector<int>::iterator it = vec.begin();
             it != vec.end(); ++it) {
            int& item = *it;
            item += i;
        }
    }
}

TEST(for_each_test, boost_foreach_performence_100m) {
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        BOOST_FOREACH(int& item, vec) {
            item += i;
        }

    }
}

TEST(for_each_test, build_in_foreach_performence_100m) {
    std::vector<int>& vec = vec100m;

    for (int i = 0; i < loop; ++i) {
        std::vector<int>::iterator e = vec.end();
        for (std::vector<int>::iterator it = vec.begin();
             it != e; ++it) {
            int& item = *it;
            item += i;
        }
    }
}

~~~

## 结论

boost foreach 是 2007年5月 1.3.4引入的[4], 当时gcc版本大概是4.2.0[3]; 
而gcc3.4.5是2005年. 用老版本的gcc来质疑boost foreach的性能是不合适的, 如其作者所说, 如果你真的关注性能, 就应该把优化开到最大, 并使用最新版本的编译器, 最新版本的编译器早已支持C++11,  我们也不再需要BOOST_FOREACH.

参考文献[1]中有透露boost内部的测试认为大概有5%的差距, 而参考文献[2]中指出人类可以识别1ms的差别. 那么我们设1ms为参考, 认为UI程序中1ms的差距是可以被用户发现的, 而低于1ms差距的时候, 可以愉快地使用BOOST_FOREACH.

gcc4.4下假设BOOST_FOREACH和iterator有5%差距, 而这5%的差距产生了1ms的差别, 举个例子, iterator跑了20ms, 5%的差距, BOOST_FOREACH需要跑21ms. 那么, 20ms可以跑多大的循环呢? 

上面的100x100m循环中, release模式下, iterator大概跑7s, 平均20ms可以跑个28m的循环, 当然, 也许我CPU比较好(E5-2697 v3), 那算一半, 凑个整, 10m的循环还是有的. debug模式下, BOOST_FOREACH需要327s, 平均每ms跑30k, 比iterator慢三倍, 要产生1ms的差距, 需要45k, 取一半凑整, 20k.

gcc3.4, release模式下, BOOST_FOREACH需要21.57s, 平均每ms跑462k, 比iterator慢三倍, 要产生1ms的差距, 需要693k, 取一半凑整, 300k. debug模式下跟gcc4.4没啥区别.

综上, debug模式下,BOOST_FOREACH 慢3倍. 考虑1ms的差距的话, 20k以下可以放心用BOOST_FOREACH, 不同编译器差距不大. release模式下, 编译器版本有影响, gcc3.4.5依然慢3倍, 可以用到300k, 而gcc4.4以上差距不大(大概5%), 可以用到10m.

| | debug | release + O2 |
| --- | --- | --- |
| <=GCC3.4.5 | 20k | 300k |
| >=GCC4.4.7 | 20k | 10m | 


**Reference:**  

* {:.ref} \[1]  Boost Developers Archive. [BOOST_FOREACH slow?](https://groups.google.com/forum/#!topic/boost-developers-archive/VsESzHeqQRg/discussion). Nov.18, 2008.  
* {:.ref} \[2]  Jeff Johnson. 认知与设计：理解UI设计准则（第2版）. 第14章. 小节2. [人类大脑的许多时间常量](http://www.ituring.com.cn/book/miniarticle/68484). 2014-08-11.  
* {:.ref} \[3]  [GCC Releases](https://gcc.gnu.org/releases.html)  
* {:.ref} \[4]  [Boost Version History](https://www.boost.org/users/history/)  




