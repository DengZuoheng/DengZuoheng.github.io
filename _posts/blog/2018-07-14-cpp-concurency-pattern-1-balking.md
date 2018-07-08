---
layout: post
title: C++并发型模式#1&#58; Balking, Guarded Suspension, Double-Checked Locking
description: C++语境的并发型模式是怎么样的呢? 我们先从Balking讲起, 讨论3个相关的模式
category: blog
---

## 锲子

考虑你有一台智能洗衣机, 然后你把衣服扔进去, 随便按了快洗什么的就开始洗了.

然后...你又用手机上的客户端设了个快洗. 

那么, 洗衣机应该洗两次吗? 还是说客户端要卡在那阻塞等待?

很明显, 最符合直觉的方式, 告诉你正在洗了, 然后什么都不做. 这种直觉反映到代码上, 其实就是balking模式了: 某对象的某方法被调用时, 如果该对象不在合适状态上, 就什么都不做.

从这种思路出发,  立即返回(立即抛个异常也算), 怎么都不做的, 我们将其称balking模式; 不立即返回, 等待状态变化到合适状态的, 称为guarded suspension模式; 因为balking或者guarded suspension, 临界区比较大, 当这种互斥成本很高, double-check locking模式为我们提供一种策略, 去减少这个成本. 

当然, 多数文献中, 都是在java语境下讨论这些个模式, 下面, 我们将在C++语境下考察这些模式.

## balking模式

我们将维基百科的例子[5]翻译成C++:

~~~
class Example {
public:
       Example() : m_jobInProgress(false) {}
public:
       void runJob() {
              {
                     boost::lock_guard<boost::mutex> guard(m_mutex);
                     if (m_jobInProgress) {
                           return;
                     }
                     m_jobInProgress = true;
              }
              
              // ... do run the job
       }
       void jobCompleted() {
              boost::lock_guard<boost::mutex> guard(m_mutex);
              m_jobInProgress = false;
       }
private:
       boost::mutex m_mutex;
       bool m_jobInProgress;
};
~~~

用一个`m_jobInProgress` flag去表示job是不是正在run, 可以看到对`m_jobInProgress`的操作是线程安全的(至少希望是线程安全的), 这样, 当我们有多个线程去调用`runJob()`的时候, 如果正在run, 就不会重复run. 

好吧, 这个例子是在太简单, 以至于我们完全看不出这玩意有什么用, 有什么资格成为一个模式. . 我们换一个更实际一点的例子.

考虑你有一个编辑器类`Editor`, 有保存的功能. 毕竟写入硬盘是高成本的事情, 我们觉得用户保存的时候, 如果没有编辑过, 我们就不实际写到硬盘里, 嗯, 很符合直觉的样子:

~~~
class Editor {
public:
       Editor() : m_changedFlag(false) {}
public:
       void edit(const std::string& context) {
              m_context = context;
              m_changedFlag = true;
       }
       void save(const std::string& filename) {
              if (!m_changedFlag) {
                     return;
              }
              doSave(filename);
              m_changedFlag = false;
       }
       void doSave(const std::string& filename) {
              std::ofstream ofs(filename);
              ofs << m_context;
       }
private:
       bool m_changedFlag;
       std::string m_context;
};
~~~

但是, 无数血与泪的故事告诉我们, 编辑器应该有一个自动保存的功能. 如果使用另一个线程去做自动保存的话, 大概会有一个这样的`Autosaver`类:

~~~
class Autosaver {
public:
       Autosaver(Editor* editor, const std::string& fname)
              : m_editor(editor), m_fname(fname), m_continue(true) {}
public:
       void operator()() {
              while (m_continue) {
                     boost::this_thread::sleep_for(boost::chrono::seconds(1));
                     m_editor->save(m_fname);
              }
       }
       void finished() {
              boost::lock_guard<boost::mutex> guard(m_mutex);
              m_continue = false;
       }
public:
       Editor* m_editor;
       std::string m_fname;
       bool m_continue;
       boost::mutex m_mutex;
};
~~~

我们可以在Editor构造和析构的时候操作自动保存线程:

~~~
class Autosaver;
class Editor {
public:
       explicit Editor(const std::string& asfname);
       ~Editor();
public:
       void edit(const std::string& context);
       void save(const std::string& filename);
       void doSave(const std::string& filename);
private:
       bool m_changedFlag;
       boost::mutex m_mutex;
       std::string m_context;
       Autosaver* m_autosaver;
       boost::thread m_autosaverThread;
};

// define of Autosaver

Editor::Editor(const std::string& asfname)
       : m_changedFlag(false), m_autosaver(NULL) {
       m_autosaver = new Autosaver(this, asfname);
       m_autosaverThread = boost::thread(boost::ref(*m_autosaver));
}
Editor::~Editor() {
       if (m_autosaver) {
              m_autosaver->finished();
              m_autosaverThread.interrupt();
              m_autosaverThread.join();
              delete m_autosaver;
              m_autosaver = NULL;
       }
}
void Editor::edit(const std::string& context) {
       boost::lock_guard<boost::mutex> gaurd(m_mutex);
       m_context = context;
       m_changedFlag = true;
}
void Editor::save(const std::string& filename) {
       boost::lock_guard<boost::mutex> gaurd(m_mutex);
       if (!m_changedFlag) {
              return;
       }
       doSave(filename);
       m_changedFlag = false;
}
void Editor::doSave(const std::string& filename) {
       std::ofstream ofs(filename);
       ofs << m_context;
}

~~~

因为有自动保存线程会调用`save(...)`, 所以我们需要一个mutex去保护`m_changeFlag`, 构造的时候起自动保存线程, 析构的时候让其结束.  而这里`m_changeFlag`的维护以及`save(...)`函数根据`m_changeFlag`的值决定是否立即返回的操作, 就属于balking模式的使用.

看, 又有mutex, 又有flag, 是不是就有点模式的感觉了, 说白了, balking模式, 就是 个多线程版本的带锁的flag而已. 怎么? 觉得很扯淡, 觉得扯淡就对了, 因为balking模式本身就有很多问题.

有人认为balking模式是反模式[1], 不该作为一个模式. 而且, 一般的, balking仅适用于状态无法保证何时恢复, 是否会恢复的场合. 如果恢复所需要的时间相对稳定, 则应该考虑guarded suspension, 阻塞等待或带超时的阻塞等待. 甚至, balking可以作为超时为0的guarded suspension特例. 所以, 我们讨论balking模式时, 应当作为一个编程史的标本, 而不是设计或重构时应该优先考虑的模式.

## guarded suspension模式

有的地方翻译为 "保护性暂挂模式", 其意为, 一个对象会被不同线程访问, 其中一些线程只有在对象处于某种适宜状态下才会调用对象的某些方法, 否则挂起等待, 而另一些线程则可能将对象改变到适宜状态; 听起来跟balking差不多, 只是balking查看状态时, 如果不符合就立即返回, 而garded suspension在不符合时会等待, 直到符合.

维基上用java描述的例子[6]是这样的:

~~~
public class Example {
    synchronized void guardedMethod() {
        while (!preCondition()) {
            try {
                // Continue to wait
                wait();
                // …
            } catch (InterruptedException e) {
                // …
            }
        }
        // Actual task implementation
    }
    synchronized void alterObjectStateMethod() {
        // Change the object state
        // …
        // Inform waiting threads
        notify();
    }
}
~~~

对应到C++的话, 其实就是 _条件变量_ (condition variable)的用法. 如果上述例子在C++中实现的话, 为了达成`synchronized`, `wait`, `notify`的效果, Example会持有一个`mutex`和一个`condition_variable`成员, 只是java对象看起来自带了. 使用boost的话, C++代码如下:

~~~
class Example {
public:
       Example() : m_preCondition(true) {}
public:
       void guardedMethod() {
              boost::unique_lock<boost::mutex> lock(m_mutex);
              while (!preCondition()) {
                     m_cond.wait(lock);
              }
              // Actual task implementation
       }
       void alterObjectStateMethod() {
              boost::lock_guard<boost::mutex> guard(m_mutex);
              m_preCondition = true;
              m_cond.notify_all();
       }
       bool preCondition() const {
              return m_preCondition;
       }
private:
       bool m_preCondition;
       boost::mutex m_mutex;
       boost::condition_variable m_cond;
};
~~~

也许你发现了`m_cond.wait`的时候, 用的是`boost::unique_lock`而不是`boost::lock_guard`, 这是因为, 为了避免死锁, wait函数内部其实在系统调用前会先解锁, 然后再阻塞等待, 被唤醒后才再锁上, 这会需要`lock()`和`unlock()`两个接口, 而这两个接口都是`boost::lock_guard`没有的.

而在`alterObjectStateMethod`中, `m_cond_notify_all()`指唤醒所有等待的线程, 这是取决于业务的. 举个例子, 我们通常实现线程安全的队列时, 也是用`condition_variable`来notify的, 但是我们需要在每次push的时候都notify, 这时`notify_all`就不好了, 因为只来了一个元素, 只有最先醒来的线程能得到, 其他还是再次进入睡眠. 所以, 写线程安全队列时, 我们用的是`notify_one()`.

当然, 也有人指出[1], 这种写法不能控制睡眠/唤醒方式, 以及指定唤醒哪个线程(`condition_variable`只能指定唤醒一个还是多个). 为了指定唤醒的线程, 人们提出了`Scheduler`模式, 我们会在另一篇博客中讨论.

另外一个问题是, 如果`guardedMethod`的`// Actual task implementation`不会改变对象的状态, 全程加锁似乎是没有必要的. 我们似乎可以在`preCondition()`返回`false`时再加锁, 这种写法被发展为`double-checked locking`模式, 用于减少竞争, 常用于延迟初始化.

## double-checked locking模式

考虑如下代码:

~~~
class Helper {
public:
       Helper() {}
       void help() {}
};
class Example {
public:
       Example() : m_helper(NULL) {}
public:
       Helper * getHelper() {
              if (!m_helper) {
                     m_helper = new Helper();
              }
              return m_helper;
       }
private:
       Helper * m_helper;
};
~~~

只有第一次`getHelper`的时候才会将`m_helper`初始化, 但是, 如果允许多线程调用`getHelper`的话, 这些线程可能同时去创建`m_helper`或者使用没完全初始化的`m_helper`, 所以这里必须加锁:

~~~
class Example {
public:
       Example() : m_helper(NULL) {}
public:
       Helper * getHelper() {
              boost::lock_guard<boost::mutex> lock(m_mutex);
              if (!m_helper) {
                     m_helper = new Helper();
              }
              return m_helper;
       }
private:
       boost::mutex m_mutex;
       Helper * m_helper;
};
~~~

这样虽然很安全, 但是只有第一次调用需要初始化, 其他调用似乎不需要锁保护, 这样锁整个函数的做法竞争很频繁, 成本很高. 所以我们可以把锁移动到if语句块内.

 ~~~
class Example {
public:
       Example() : m_helper(NULL) {}
public:
       Helper * getHelper() {
              if (!m_helper) {
                     boost::lock_guard<boost::mutex> lock(m_mutex);
                     m_helper = new Helper();
              }
              return m_helper;
       }
private:
       boost::mutex m_mutex;
       Helper * m_helper;
};
~~~
这又有一个问题, 从判断到加锁, 不知道经过了什么调度, 可能其他线程已经初始化好了`m_helper`, 这样可能导致重复初始化. 所以, 加锁后, 我们得再判断一次:

~~~
class Example {
public:
       Example() : m_helper(NULL) {}
public:
       Helper * getHelper() {
              if (!m_helper) {
                     boost::lock_guard<boost::mutex> lock(m_mutex);
                     if (!m_helper) {
                           m_helper = new Helper();
                     }
              }
              return m_helper;
       }
private:
       boost::mutex m_mutex;
       Helper * m_helper;
};
~~~
这看起来似乎安全了, 然而我们用的是C++, 当编译器执行`m_helper = new Helper();`的时候, 其实有以下步骤:

- 为对象分配空间
- 在分配的空间构造对象
- 让m_helper指向对象

编译器因为优化, 指令重排的操作, 可能会先让`m_helper`指向对象, 然后再构造. 但是, 指向对象这条指令执行完时, 该线程可能挂起了, 然后其他线程看到`m_helper`不为空, 然后就用了一个未构造的对象.

为此, 人们探讨了很多方法[2](这里不一一讨论, 可以看文末列出的参考资料), 发现对于C++98, 没有一个完美跨平台的实现. 这个问题直到C++11普及之后才修复. 需要平台相关支持的C++98代码大概如下(也许各个指针会用 volatile关键字修饰):

~~~
class Example {
public:
       Example() : m_helper(NULL) {}
public:
       Helper * getHelper() {
              Helper* tmp = m_helper;
              // insert memory barrier here
              if (!m_helper) {
                     boost::lock_guard<boost::mutex> lock(m_mutex);
                     tmp = m_helper;
                     if (!tmp) {
                           tmp = new Helper();
                           // insert memory barrier here
                           m_helper = tmp;
                     }
              }
              return m_helper;
       }
private:
       boost::mutex m_mutex;
       Helper * m_helper;
};
~~~
需要在注释的地方加入你所用平台的内存屏障代码. 

double-checked locking常用于实现线程安全的单例模式, 相关讨论也很丰富[2], 我印象中的结论是C++98没有完美跨平台的实现, 甚至老一点的环境不可能实现[7]. C++11在标准中增加了相关支持[3], 不说一般的延迟初始化, 单例肯定是能写出来了. 有时间会单独开一篇探讨这个话题.

## 总结

总的来说, 这三种模式都是用来处理多线程环境下对象的状态的.

Balking模式估计通常用不上, 即使想用也应该考虑其风险, 毕竟通常我们也不把它当`模式`.

而Guarded Suspension模式在C++看来就是普通的条件变量的使用, 最多带个超时. 而且无法指定唤醒哪个线程, Scheduler模式可以解决这个指定问题.

Double-Checked Locking模式在C++98中由于指令重排, 多处理器缓存机制等问题, 很难写出完美安全的实现, 需要平台有关的内存屏障支持, 而C++11提供了跨平台的解决方案.<del>所以快点升C++11吧</del>


**Reference:**  
* {:.ref} \[1]  Drew Goldberg. [Balking - Design Patterns, Dealing with Incomplete and Incorrect States](https://www.cs.colorado.edu/~kena/classes/5828/s12/presentation-materials/goldbergdrew.pdf)  
* {:.ref} \[2]  Scott Meyers, Andrei Alexandrescu. [C++ and the Perils of Double-Checked Locking](https://www.aristeia.com/Papers/DDJ_Jul_Aug_2004_revised.pdf). September. 2004.  
* {:.ref} \[3]  Jeff Preshing. [Double-Checked Locking is Fixed In C++11](http://preshing.com/20130930/double-checked-locking-is-fixed-in-cpp11/). Sept.2013.  
* {:.ref} \[4]  buyoufa. [多线程设计模式——Guarded Suspension（保护性暂挂模式）](https://blog.csdn.net/buyoufa/article/details/51839059). July. 2016  
* {:.ref} \[5]  wikipedia. [Balking pattern](https://en.wikipedia.org/wiki/Balking_pattern)  
* {:.ref} \[6]  wikipedia. [Guarded suspension](https://en.wikipedia.org/wiki/Guarded_suspension)  
* {:.ref} \[7]  wikipedia. [Double-checked locking](https://en.wikipedia.org/wiki/Double-checked_locking)
