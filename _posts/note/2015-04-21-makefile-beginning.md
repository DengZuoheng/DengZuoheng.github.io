---
layout: post
title: makefile那些事
description: mekefile入门以及一些基本特性
category: note
---

## 概述 ##
makefile就像专门用于管理编译的脚本, 决定一个目录中, 哪些源文件需要先编译, 哪些后编译, 哪些目标文件依赖哪些源文件, 怎么连接等等; 也就是写一次makefile, 你的工程就可以自动化编译了, 当然, 新增了源文件的话, 也要跟着修改makefile.

直接在工程目录下执行:

    make

就自动编译了.


事实上, 不同厂商的make语法会有不同, 所以复杂的makefile要写得通用也是很困难的, 不过也有专门用来生成makefile的工具, 这里先不提; 方便起见, 我们先用GNU的make来试一下c语言文件的编译吧.

程序的编译过程基本就是先把源文件编译成中间文件, 比如windows下的.obj, UNIX下的.o, 然后将中间文件链接成执行文件, 前者过程叫`编译`, 后者过程叫`链接`, 虽然说gcc支持你一步登天, 但是文件躲起来的时候, 一次编译顺便链接的命令写起来就不方便了, 所以我还是喜欢一步一步来. 先编译出一堆中间文件, 然后在链接成最终的目标文件(可执行).

所以, 下面写makefile的时候, 我们也是按照先编译出中间文件, 后链接出目标文件的套路来.

## makefile基础 ##

要开始写makefile了, 首先是一些准备工作, 我是用的环境:

- 操作系统: ubuntu 14.04 
- 编译器: gcc 4.8.2
- 编辑器: sublime text 2

我们想编译个hello world试下, 首先建一个`helloworld`目录,在`helloworld`目录下建一个`helloworld.c`, 一个`makefile`, makefile 的名义一般认为只有`Makefile`或`makefile`, 这样才能被make自动找出来执行.

helloworld.c的代码:
<pre>

#include <stdio.h>

int main()
{
    printf("hello world\n");
    return 0;
}

</pre>

makefile的内容:
<pre>
helloworld : helloworld.o
    gcc -o helloworld helloworld.o

helloworld.o : helloworld.c
    gcc -c helloworld.c
</pre>

然后打开你的终端, cd到helloworld, 执行make, 然后执行helloworld试试, 就像

<pre>
cd helloworld
make
./helloworld
</pre>

一切正常的话, 就输入hello world了, 不正常的话, 会提示错误, 有三种可能, 一是makefile的语法错误, 一是编译命令的错误, 一是代码语法错误.

第一次写makefile最可能的错误就是那句编译命令的缩进了, 比如上面的`gcc -c helloworld.c`, 前面必须有一个`tab`, 而且是`hard tab`, 而不能用4个空格代替, 这是makefile语法规定的, 反正我现在还没找到解决方法.

从第一份可以看到makefile大致的格式, 首先写一个目标, 空格, 冒号, 空格, 目标依赖的文件, 下一行, 缩进, 完成目标的命令, 就像这样:

<pre>
target ... : prerequisites ... 
    command 
    ... 
    ... 
</pre>

target是一个目标文件, 可以是objectfile, 也可以是可执行文件, 还可以是一个标签, 比如clean, install, 这些东西叫"伪目标", 这个, 后面再说.

prerequisites是生成这个target所需要的文件或目标文件(.o什么的)

commandshi make需要执行的命令, 可以是任意shell命令, 可以多行, 关键是得缩进, 而且是tab缩进, 不能是空格.

## makefile的执行规则 ##

默认情况下, 我们在当前目录下输入make命令, make就会在当前目录下查找makefile或Makefile.

找到makefile后, 会找文件中第一个target, 如果target不存在, 或者target的依赖项prerequisites的修改日期比target新, 然后make要执行命令去生成target, 在执行命令之前, 对每一个依赖项递归检查修改日期, 也递归地生成, 最后就把第一个target生成出来了.

make实际上并不关心command是什么,只管在需要的时候执行command. 命令执行失败或者错了都不管.

这意味着, 如果我们只改了工程中的一个文件, 被重新编译的只有依赖这个文件的那些文件, 与这个文件没关系的其他一切都不会重新编译.

## 一个稍微复杂的例子 ##
ok, 现在我们有一个工程, 名叫maketest, 结构如下:

<pre>
maketest\
    - main.c
    - abc.h
    - abc1.c
    - abc2.c
    + hello\
        hello.h
        hello1.c
        hello2.c
    - makefile
</pre>

我们的main.c是这样的:

<pre>
#include  &lt;stdio.h&gt;
#include "hello/hello.h"
#include "abc.h"

int main()
{
	hello1();
	hello2();
	abc1();
	abc2();
	return 0;
}
</pre>

所以, 我们的makefile是这样的:

<pre>
main : main.o hello1.o hello2.o abc1.o abc2.o
	cc -o main main.o hello1.o hello2.o abc1.o abc2.o

main.o : main.c ./hello/hello.h abc.h
	cc -c main.c

hello1.o : ./hello/hello1.c ./hello/hello.h
	cc -c ./hello/hello1.c

hello2.o :./hello/hello2.c ./hello/hello.h
	cc -c ./hello/hello2.c 

abc1.o : abc1.c abc.h
	cc -c abc1.c

abc2.o : abc2.c abc.h
	cc -c abc2.c
</pre>

这样一结合上面的执行规则, 就很好理解了.

## makefile中的变量 ##

上面那一长串`main.o hello1.o hello2.o abc1.o abc2.o`想必无论是看起来还是写起来都很让人不爽, 所以, 当然, 我们可以用变量来替换, 就像这样:

    objects = main.o hello1.o hello2.o abc1.o abc2.o

可以用$(objects)来引用变量. 于是我们上面的例子可以变成

<pre>
objects = main.o hello1.o hello2.o abc1.o abc2.o
main : $(objects)
	cc -o main $(objects)

main.o : main.c ./hello/hello.h abc.h
	cc -c main.c

hello1.o : ./hello/hello1.c ./hello/hello.h
	cc -c ./hello/hello1.c

hello2.o :./hello/hello2.c ./hello/hello.h
	cc -c ./hello/hello2.c 

abc1.o : abc1.c abc.h
	cc -c abc1.c

abc2.o : abc2.c abc.h
	cc -c abc2.c
</pre>

注意, makefile中的变量只做替换作用, 与其说是变量, 不如说是宏.

## makefile 中的伪目标 ##
伪目标是一种没有被第一个目标文件直接或间接关联的"目标文件", 所以, 伪目标后面的命令不会自动被执行, 需要被显式调用, 比如我们常用的`make install`.

我们先来个简单的, 让make输出一个hello deng zuoheng:

还是我们刚刚那个makefile, 我们在最后加上:

<pre>
.PHONY : say_hello
say_hello :
    echo "hello deng zuoheng"
</pre>

其中, `.PHONY`表示say_hello是一个伪目标. 这样, 我们在该目录下执行:

    $ make say_hello

就会执行`echo "hello deng zuoheng"`指令, 也就是输出一个hello deng zuoheng.

伪目标可以干嘛呢, 比如, 其实每个makefile都应该写一个清除目标文件的规则, 使得目录不至于凌乱, 而且重新编译起来更方便顺手(这才是首要吧- - ), 风格大概是这样的:

<pre>
.PHONY : clean
clean :
	rm main $(objects)
</pre>

用起来是这样的:

    $ make clean

另外, 常见的还有:

- make all：产生我们设定的目标，即此范例中的可执行文件。相当于`$ make`
- make distclean：除了清除可执行文件和目标文件外，把configure所产生的Makefile也清除掉。
- make install：将程序安装至系统中。如果原始码编译无误，且执行结果正确，便可以把程序安装至系统预设的可执行文件存放路径。如果用bin_PROGRAMS宏的话，程序会被安装至/usr/local/bin这个目录。
- make dist：将程序和相关的档案包装成一个压缩文件以供发布。

上面这些都是典型的使用GNU的AUTOCONF和AUTOMAKE产生的程序的makefile说具有的. 不过我们也可以手写一个, 下面以`make install`为例:

<pre>
.PHONY : install
install :
	cp main /usr/local/bin
</pre>

## makefile中的注释 ##

`#`开头, 整行注释:

    #这是注释

怎么, 你想要多行注释? 多打几个`#`不就完了么.

## 后话 ##

当然, makefile不能只有这么丁点功能, 更多功能详见官方文档: [GNU make](http://www.gnu.org/software/make/manual/make.html)

另外, 虽然上面讲得那么轻松愉快, 但是, 实际上, 大型工程要写出真.跨平台的makefile是很麻烦甚至不可能的. 于是, GNU提供了Autoconf及Automake这两套工具来解决这个问题. 这是后话, 以后再说.

**Reference**  

* {:.ref} \[1] : 陈皓. 跟我一起写 Makefile. 2004. http://blog.csdn.net/haoel/article/details/2886  
* {:.ref} \[2] : Linux@Linux社区. ./configure,make,make install的作用. http://www.linuxidc.com/Linux/2011-02/32211.htm  
* {:.ref} \[3] : 杨 小华. 例解 autoconf 和 automake 生成 Makefile 文件. http://www.ibm.com/developerworks/cn/linux/l-makefile/
