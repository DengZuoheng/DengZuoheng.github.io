---
layout: post
title: ubuntu下编译指定版本的cgminer
description: 据说linux期末考试要编译一个cgminer以彰显makefile大法.   
category: blog
---

##简介##
cgminer是一个比特币挖矿的玩意, 在github上托管源码, 这次我们要折腾的呢, 就是通过这源码编译出一个cgminger来. 而且, 还要编译一个2.0.0版本的以彰显git大法好.

##准备工作##
材料:

- ubuntu 12+ (我测试用的是14.04) 1个
- 网络环境 (没网说个**) 1个
- 人品 若干

##开始##
**如果需要搞明白整个过程怎么回事的, 可以跳到最后看总结**

### 1. 更新一下apt-get ###
首先, 我们得更新一下apt-get, 指不准待会要用它来装点什么:

    sudo su
    apt-get update

这一步如果不幸出错, 那我也没辙了, 怪墙咯

### 2. 克隆仓库
然后, 我们得把git仓库clone下来:

    git clone https://github.com/ckolivas/cgminer.git
    cd cgminer

这一步如果不幸出错, 多半就是命令打错了, 重新检查一遍, 还错的话, 多半就是你系统压根没装git, 所以你就装一个呗:

    apt-get install git

### 3. 选版本
然后, 因为我们得编译v2.0.0, 所以, 首先我们得知道有没有这个版本, 所以, 我们得看这个仓库的git tag, 比如:

    git tag -l

就能列出所有被打上的tag, 每个tag就是一个版本. 一下列出太多我不爽怎么办, 可以指定一个范围, 比如:

    git tag -l 'v2.0.*'

就只列出`v2.0.`打头的. 我们要的就是v2.0.0别多想了.

接下来, 用`git checkout tag_name`命令来检出我们要的版本, 比如v2.0.0:

    git checkout v2.0.0

这时  git 可能会提示你当前处于一个“detached HEAD" 状态, 因为 tag 相当于是一个快照, 是不能更改它的代码的, 自然, 也不给你写makefile什么的, 如果要在 tag 代码的基础上做修改，你需要一个分支; 分支的名字, 方便起见, 就用我名字吧:

    git checkout -b dengzuoheng

这样就建立了一个名为dengzuoheng的分支了, 想必原来的仓库不会有这么奇葩的分支名吧.

注意, 刚刚我们是先检出了tag然后再建分支, 事实上, 我们可以一步到位, 用`git checkout -b branch_name tag_name`命令, 比如:
    git checkout -b dengzuoheng v2.0.0

这样, 我们相当于处理完版本问题了.

### 4. 读Readme ###
接下来, 当然是阅读仓库的Readme啦, 还有人比作者更熟悉自家项目的安装么.

从readme可以看出该项目依赖与哪些库, 这些依赖库都是要实现安装才能顺利编译的, v2.0.0必须的依赖项大概就这些:

- libcurl4-openssl-dev
- libncurses5-dev
- pkg-config

记着待会安装, 应该都可以用apt-get安装的.

然后, 如果不做额外配置的话, 我们得执行autogen.sh, configure, make, make install

嗯, 就是这样, 下面我们来执行一遍.

### 5. 编译安装 ###
#### 5.1 安装依赖库 ####
用apt-get一次性全安装了:

    sudo apt-get install -y build-essential autoconf automake libtool pkg-config libcurl3-dev libudev-dev libncurses-dev 

#### 5.2 执行autogen.sh ####

    sh autogen.sh

#### 5.3 执行configure ####

    ./configure

这一步可能会出错的, 认真看出错提示, 很可能是缺了依赖库, 缺什么你就装什么.

这一步成功了的话, 会生成makefile, 有了makefile才能编译.

#### 5.4 make ####

    make

#### 5.6 install ####

    make install

#### 5.7 测试 ####

这时候应该已经完成了, 我们可以查看一下版本号看成功了没:

    cgminer -V

顺利的话, 输出应该是`cgminer 2.0.0`.

##总结##
简单地说, 就是一步一步执行以下命令:

<pre>
sudo su

apt-get update

apt-get install git

git clone https://github.com/ckolivas/cgminer.git

cd cgminer

git checkout -b dengzuoheng v2.0.0

sudo apt-get install -y build-essential autoconf automake libtool pkg-config libcurl3-dev libudev-dev libncurses-dev 

sh autogen.sh

./configure

 make

make install

cgminer -V

</pre>

**Reference**  
\[1]: 蔡清华. Ubuntu虚拟机中编译运行cgminer挖矿软件. http://my.oschina.net/blueprint/blog/222885  
\[2]: http://www.oschina.net/question/1030451_105857  
\[3]: 张映. apt-get 命令详解(中文),以及实例. http://blog.51yip.com/linux/1176.html


