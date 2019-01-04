---
layout: post
title: 计时等待引发的血案&#58; 一个不可避免的超时竟态
description: 条件变量计时等待, 返回超时不代表没被notify, 导致了Qt4.7.4线程池的一个bug
category: blog
---

## 疑云

某日, QA给我报了个bug, 说咱家软件用过我写的某个功能A后, 再用另外一个功能B可能会卡死, 听起来就像我的锅. 于是我把繁复的业务逻辑去掉, 代码看起来像下面这样的:

~~~
#include <QApplication>
#include <QMainWindow>
#include <QtConcurrentMap>
#include <QtConcurrentRun>
#include <QFuture>
#include <QThreadPool>
#include <QtTest/QTest>
#include <QFutureSynchronizer>

struct Task2 { // only calculation
    typedef void result_type;
    void operator()(int count) {
        int k = 0;
        for (int i = 0; i < count * 10; ++i) {
            for (int j = 0; j < count * 10; ++j) {
                k++;
            }
        }
        assert(k >= 0);
    }
};

struct Task1 { // will launch some other concurrent map
    typedef void result_type;
    void operator()(int count) {

        QVector<int> vec;
        for (int i = 0; i < 5; ++i) {
            vec.push_back(i+count);
        }
        Task2 task;

        QFuture<void> f = QtConcurrent::map(vec.begin(), vec.end(), task);
        {
            // without releaseThread before wait, it will hang directly
            QThreadPool::globalInstance()->releaseThread();
            f.waitForFinished(); // BUG: may hang there
            QThreadPool::globalInstance()->reserveThread();
        }
    }
};


int main() {
    QThreadPool* gtpool = QThreadPool::globalInstance();
    gtpool->setExpiryTimeout(50);
    int count = 0;
    for (;;) {
        QVector<int> vec;
        for (int i = 0; i < 40 ; i++) {
            vec.push_back(i);
        }
        // feature A, launch a task with nested map
        Task1 task; // Task1 will have nested concurrent map
        QFuture<void> f = QtConcurrent::map(vec.begin(), vec.end(),task);

        f.waitForFinished(); // BUG: may hang there

        count++;

        // waiting most of thread in thread pool expire
        while (QThreadPool::globalInstance()->activeThreadCount() > 0) {
            QTest::qSleep(50);
        }

        // feature B, launch a task only calculation
        Task2 task2;
        QFuture<void> f2 = QtConcurrent::map(vec.begin(), vec.end(), task2);

        f2.waitForFinished(); // BUG: may hang there

        qDebug() << count;
    }
    return 0;
}
~~~

这代码没法跑到天荒地老, 可能会hang在`waitForFinished`那. 以下环境可以重现:

~~~
Linux version 2.6.32-696.18.7.el6.x86_64; Qt4.7.4; GCC 3.4.5

Windows 7; Qt4.7.4; mingw 4.4.0
~~~

这里解释一下为什么这么写:

首先`Task1`嵌套一个`QtConcurrent::map`是因为`Task1`要完成一部分操作之后, 才知道要起多少`Task2`, 而且这部分操作也挺耗时的. 

`Task1`中间的`QThreadPool::globalInstance()->releaseThread()`是怎么回事呢? 因为等待`QtConcurrent::map`返回的QFuture是阻塞的(相对的QtConcurrent::Run返回的QFuture在自己的task还是开始运行的情况下, 可能会"偷"回来自己跑), 所以这个等待会占据一个线程在那傻等, 这种傻等的线程多了, 线程池的线程就都给占了. 所以要嵌套使用`QtConcurrent::map`肯定是要去动全局线程池的线程数的, 这里用的便是`releaseThread`:

> **void QThreadPool::releaseThread()**
> Releases a thread previously reserved by a call to `reserveThread()`.
> 
> Note: Calling this function without previously reserving a thread temporarily increases `maxThreadCount()`. **This is useful when a thread goes to sleep waiting for more work, allowing other threads to continue. Be sure to call `reserveThread()` when done waiting, so that the thread pool can correctly maintain the `activeThreadCount()`**.
> 
> See also `reserveThread()`.
> 
> **void QThreadPool::reserveThread()**
> Reserves one thread, disregarding `activeThreadCount()` and  `maxThreadCount()`.
> 
> Once you are done with the thread, call `releaseThread()` to allow it to be reused.
> 
> Note: This function will always increase the number of active threads. This means that by using this function, it is possible for `activeThreadCount()` to return a value greater than `maxThreadCount()`.
> 
> See also `releaseThread()`.

如果你真的很怀疑这两函数有问题, 我们可以看一下它们的源码:

~~~
// qtlib4.7.4/src/corlib/concurrent/qthreadpool.cpp
void QThreadPool::reserveThread()
{
    Q_D(QThreadPool);
    QMutexLocker locker(&d->mutex);
    ++d->reservedThreads;
}

void QThreadPool::releaseThread()
{
    Q_D(QThreadPool);
    QMutexLocker locker(&d->mutex);
    --d->reservedThreads;
    d->tryToStartMoreThreads();
}
~~~

有锁呀, 也`tryToStartMoreThreads()`了呀, 这个`reservedThreads`是怎么回事呢? 它用在了`activeThreadCount()`和`tooManyThreadActive()`:

~~~
int QThreadPoolPrivate::activeThreadCount() const
{
    // To improve scalability this function is called without holding 
    // the mutex lock -- keep it thread-safe.
    return (allThreads.count()
            - expiredThreads.count()
            - waitingThreads
            + reservedThreads);
}

void QThreadPoolPrivate::tryToStartMoreThreads()
{
    // try to push tasks on the queue to any available threads
    while (!queue.isEmpty() && tryStart(queue.first().first))
        queue.removeFirst();
}

bool QThreadPoolPrivate::tooManyThreadsActive() const
{
    const int activeThreadCount = this->activeThreadCount();
    return activeThreadCount > maxThreadCount && (activeThreadCount - reservedThreads) > 1;
}
~~~

`reservedThreads`越小, `activeThreadCount()`就越小, 就越能起更多线程, 看起来没毛病呀.

所以按道理上面的代码应该能一直跑下去才对, 怎么就hang了呢?

## 线索

如果我们在hang的时候gdb进去`info threads`看一下, 会发现hang住时线程数量并没有想象中那么多, 除主线程外, 就没两个了. 所以, 我猜测这是可能Qt的bug, QThreadPool可能没有维护好activeThreadCount().

具体怎么没维护好, 我们得研究一下参与`activeThreadCount()`计算的几个值. gdb下在`activeThreadCount()`内打断点, 然后在hang住的时候, 通过gdb `print gti->activeThreadCount()`进到断点(gti是指向QThreadPool::globalInstance()的临时变量). 

你要说哪个值不正常嘛... `reservedThreads`挺正常的, 就是我们设出来的, `allThreads`和`expiredThreads`其实看不出来. `waitingThreads`这时候是负的, 看起来就很可疑.

嗯, 确实很可疑, 咋一看, 代码里面没有让`waitingThreads`变成负数的场景. 会改变这个值的地方就两个, `QThreadPoolThread::run()`和`QThreadPoolPrivate::tryStart`.

其中, `tryStart`看起来像这样(有删减):

~~~
bool QThreadPoolPrivate::tryStart(QRunnable *task)
    QMutexLocker locker(&mutex);

    taskQueue.append(task); // Place the task on the task queue
    if (waitingThreads > 0) {
       // there are already running idle thread. They are waiting on the 'runnableReady' 
       // QWaitCondition. Wake one up them up.
       waitingThreads--;
       runnableReady.wakeOne();
    } else if (runningThreadCount < maxThreadCount) {
       startNewThread(task);
    }
}
~~~

而`run`看起来像这样(有删减):

~~~
void QThreadPoolThread::run()
{
    QQMutexLocker locker(&manager->mutex);
    for(;;) {
        QRunnable *r = manager->queue.takeFirst();
        do {
            if (r) {
                // run the task
                locker.unlock();
                r->run();
                locker.relock();
            }
            // if too many threads are active, expire this thread
            if (manager->tooManyThreadsActive())
                break;
            r = manager->queue.takeFirst();
        } while (r != 0);

        // if too many threads are active, expire this thread
        bool expired = manager->tooManyThreadsActive();
        if (!expired) {
            ++manager->waitingThreads;
            registerTheadInactive();
            // wait for work, exiting after the expiry timeout is reached
            expired = !manager->runnableReady.wait(locker.mutex(), manager->expiryTimeout);
            ++manager->activeThreads;
    
            if (expired)
                --manager->waitingThreads; //<- break here
        }
        if (expired) {
            manager->expiredThreads.enqueue(this);
            registerTheadInactive();
            break;
        }
    }
}
~~~

`tryStart`里面, 只有`waitingThreads`大于0才会减, 而这个过程有锁保护. 所以, 要有问题肯定也是`run`中的, 因为`QWaitCondition::wait`会解锁, 于是我在`//<- break here`那里加了个条件断点, 如果`waitingThreads`等于0的时候中断. 如果能断在那, 之后就自减, 就会减成负数了.

嗯, 确实能断在那.

## 真相

我想聪明的你已经意识到问题了, 条件变量计时等待的时候, 如果超时的瞬间被notify了, 怎么办? 算超时还是算信号?

我们看pthread[文档](http://pubs.opengroup.org/onlinepubs/009695399/functions/pthread_cond_timedwait.html)的说法:

> It is important to note that when pthread_cond_wait() and pthread_cond_timedwait() return without error, the associated predicate may still be false. Similarly, when pthread_cond_timedwait() returns with the timeout error, the associated predicate may be true due to an **unavoidable race** between the expiration of the timeout and the predicate state change.


我们看boost1.66的说法:

> When this function returns true:
> * A notification (or sometimes a spurious OS signal) has been received
> * Do not assume that the timeout has not been reached
> * Do not assume that the predicate has been changed
>
> When this function returns false:
> * The timeout has been reached
> * Do not assume that a notification has not been received
> * Do not assume that the predicate has not been changed

~~~

也就是说, 我们可以知道确实超时了, 不知道有没有被signal. 那我们已经很接近真相了.

我们来还原一下案发现场, 某一时刻, 某线程A完成了所有task, `++manager->waitingThreads`, 进入计时等待. 过了一会, 另一线程B给线程池加了个task, 因为`manager->waitingThreads > 0`所以回收了这个过期的线程A, 并notify唤醒它. 巧的是, notify的时候线程A的计时等待超时了, 线程A以为自己真的过期了, 就不再工作, 进入过期队列了, 这样`waitingThreads`就多减了一次, `waitingThreads`就会变成负数, 线程池的状态就被破坏了. 

## 结案

其实早在2013年, 人们就发现了这个bug, 即[QTBUG-3786](https://bugreports.qt.io/browse/QTBUG-3786), 这个问题在Qt4.8.6被修复([release log](https://github.com/nonrational/qt-everywhere-opensource-src-4.8.6/blob/master/changes-4.8.6)), 大家可以看这个[diff](https://github.com/qt/qtbase/commit/a9b6a78e54670a70b96c122b10ad7bd64d166514#diff-6d5794cef91df41c39b5e7cc6b71d041)).

因为用一个整数无法可靠地维护好`waitingThreads`, 这里QThreadPool换成了waitingThreads队列, 在进入计时等待前入队, 唤醒或超时时尝试移出, 如果已经被`tryStart`回收出队了, 自然队列里面就没有这个线程, 也就没法移出了; 反过来, 如果移出成功了, 就说明没有notify, 真过期了.

~~~
// if too many threads are active, expire this thread
bool expired = manager->tooManyThreadsActive();
if (!expired) {
    manager->waitingThreads.enqueue(this);
    registerThreadInactive();
    // wait for work, exiting after the expiry timeout is reached
    runnableReady.wait(locker.mutex(), manager->expiryTimeout);
    ++manager->activeThreads;
    if (manager->waitingThreads.removeOne(this))
        expired = true;
}
if (expired) {
    manager->expiredThreads.enqueue(this);
    registerThreadInactive();
    break;
}
~~~

注意这里把条件变量移动到QThreadPoolThread里了, 也就说每个QThreadPoolThread有一个条件变量, 这样`tryStart`回收时就可以先出队, 再notify, 并且只有指定的线程会被唤醒.

~~~
if (waitingThreads.count() > 0) {
    // recycle an available thread
    enqueueTask(task);
    waitingThreads.takeFirst()->runnableReady.wakeOne();
    return true;
}
~~~

另外, 改动QWaitCondition也是一种方案, 但这样要求条件变量的唤醒确实是队列的, 这个依赖实现, 并有性能损失, 详细分析可以参考文献[2][3].

在生产环境中, 因为还无法立刻升级到Qt4.8.7, 所以需在`waitForFinished()`前加一个`releaseThreads()`, 让线程池再加一个线程, 这样就不会卡住了, 因为至少有新加的这个线程在工作.

## 后日谈

你以为这样就结束了? 只要升到4.8.6, 最开始的代码就能运行到天荒地老了? 不, 真相仍然在迷雾之中, 即使是Qt4.8.7, 这代码依然会hang, 这还有一个bug(因为Qt5.12不hang了)! 这又是另一个故事了...

**Reference:**  

* {:.ref} \[1]  tunglt, [QtConcurrent: why releaseThread and reserveThread cause deadlock?
](https://stackoverflow.com/a/53760809/5570232), 2018  
* {:.ref} \[2]  Olivier Goffart, [QWaitCondition: Solving the Unavoidable Race](https://woboq.com/blog/qwaitcondition-solving-unavoidable-race.html), 2014  
* {:.ref} \[3]  Cort Ammon, Nemo, [Why does pthread_cond_timedwait doc talk about an “unavoidable race”?](https://stackoverflow.com/questions/18642385/why-does-pthread-cond-timedwait-doc-talk-about-an-unavoidable-race), 2013  
