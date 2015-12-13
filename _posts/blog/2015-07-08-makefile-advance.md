---
layout: post
title: 更多makefile的事
description: 实习之后, 发现对比较大的项目, makefile是可以写的很复杂, 很抽象的, 而且make工具也不止有gnu make, 还有FreeBSD pmake等等
category: blog
---

## 1. 内置变量 ##

.RECIPEPREFIX : makefile每个命令之前需要一个tab键, 而且必须是tab, 但是, 你可以用
内置变量`.RECIPEPREFIX`来改变这一点., 然后你就可以写成这样:
<pre>
.RECIPEPREFIX = &gt;
all:
&gt; echo Hello, world
</pre>

## 2. 命令之间的关系
命令之间是没有继承关系的, 即使是同一个target下的命令, 所以, 你不能再命令中export
一个环境变量并指望下一天命令能用上这个环境变量. 所以不同的命令是在不同进程中执行的.

当然, 你可以用分号解决这个问题.

分号让很多命令挤在一行不好看? `\`换行帮你解决.

还有一种方法是显式地声明这一堆命令要在同一个shell进程中执行, 比如:
<pre>
.ONESHELL:
var-kept:
    export foo=bar; 
    echo "foo=[$$foo]"
</pre>

## 3. 回声与关闭回声 ##
正常情况下，make会打印每条命令，然后再执行，这就叫做回声（echoing）, 我们可以在命令前面加`@`
来关闭它, 比如:
<pre>
test:
    @# 这是测试
    @echo TODO
</pre>

## 4. 模式匹配 ##
Make命令允许对文件名，进行类似正则运算的匹配，主要用到的匹配符是%。
比如，假定当前目录下有 f1.c 和 f2.c 两个源码文件，需要将它们编译为对应的对象文件。

    %.o: %.c

等同于下面的写法。

    f1.o: f1.c
    f2.o: f2.c

使用匹配符%，可以将大量同类型的文件，只用一条规则就完成构建。

## 5. 变量赋值 ##
Makefile允许设置变量, 比如:
<pre>
txt = Hello World
test:
    @echo $(txt)
</pre>

要调用shell变量时, 要加两个`$`, 比如:
<pre>
test:
    @echo $$HOME
</pre>

Makefile的赋值符复杂一点, 因为Makefile提供个4种赋值符:`=`, `?=`, `:=`, `+=`,

- `=` 是执行时扩展, 允许递归扩展.
- `:=` 是定义时扩展
- `?=` 当变量为空时才赋值
- `+=` 追加到变量尾端

可以认为, 自定义变量都是字符串, 毕竟我们只是用来编译嘛. 以上4中赋值符的区别可以
用一下Makefile体会一下:

<pre>
var0 = "fuck"
var1 = $(var0)
var2 := $(var0)
var3 = you
var4 
var3 ?=$(var0)
var4 ?=$(var0)
var5 = "him"
var5 += "he"
var0 = "love"

check:
    @echo var0
    @echo var1
    @echo var2
    @echo var3
    @echo var4
    @echo var5
</pre>

## 6. 自动变量 ##
Makfile支持一些自动变量, 但是这些自动变量受上下文影响, 比如:
- `$@`指代当前目标, `a:b`中`$@`就指a, 可以用时用两个目标, 比如:
<pre>
    a.txt b.txt: 
    touch $@
</pre>
等价于:
<pre>
    a.txt:
        touch a.txt
    b.txt:
        touch b.txt
</pre>
- `$<` 指代第一个前置条件。比如，规则为 t: p1 p2，那么$< 就指代p1。
- `$?` 指代比目标更新的所有前置条件，之间以空格分隔。比如，规则为 t: p1 p2，其中 p2 的时间戳比 t 新，$?就指代p2。
- `$^` 指代所有前置条件，之间以空格分隔。比如，规则为 t: p1 p2，那么 $^ 就指代 p1 p2 。
- `$*` 指代匹配符 % 匹配的部分， 比如% 匹配 f1.txt 中的f1 ，$* 就表示 f1。
- `$(@D)` 和 `$(@F)` 分别指向 $@ 的目录名和文件名。比如，$@是 src/input.c，那么$(@D) 的值为 src ，$(@F) 的值为 input.c。
- `$(<D)` 和 `$(<F)` 分别指向 $< 的目录名和文件名。

**未完待续**

**Refrence**  
\[1] : 阮一峰．Make 命令教程. 阮一峰的网络日志. http://www.ruanyifeng.com/blog/2015/02/make.html  
\[2] : http://stackoverflow.com/a/448939