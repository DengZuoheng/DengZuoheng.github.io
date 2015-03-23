---
layout: post
title: sizeof, 字节对齐与数据结构对齐
description: 据说各实习招聘笔试总喜欢考sizeof一个结构体的问题, 虽然自己不常用, 不过还是整理了一下写下来了.   
category: blog
---

事情是这样的, 前两天做疼讯的在线笔试, 碰到一题大概这样的:
<pre>
#pragma pack(8)
struct MyStruct
{
    char a;
    int b;
    char c;
    float d;
    char e;
    double f;
    int* g;
    char* h;
};//求sizeof(MyStruct)
</pre>
我说, 一个`char`1byte, `int`4byte, `float`4byte, `double`8byte, `int*`目测4byte(64位下目测8byte), 结果, 怎么都算不对啊...因为, 我完全没想起字节对齐那事...

事实上, sizeof(MyStruct)==40, 不信可以直接跳到总结

## sizeof各种基本类型
说字节对齐前, 我们得先清楚个种数据结构都是怎么算sizeof的, 为了偷懒, 我们先引一大段wiki的说法:

> The following typical alignments are valid for compilers from Microsoft (Visual C++), Borland/CodeGear (C++Builder), Digital Mars (DMC) and GNU (GCC) when compiling for 32-bit x86:  
> 
> - A char (one byte) will be 1-byte aligned.  
> - A short (two bytes) will be 2-byte aligned.  
> - An int (four bytes) will be 4-byte aligned.  
> - A long (four bytes) will be 4-byte aligned.  
> - A float (four bytes) will be 4-byte aligned.  
> - A double (eight bytes) will be 8-byte aligned on Windows and 4-byte aligned on Linux (8-byte with -malign-double compile time option).  
> - A long long (eight bytes) will be 8-byte aligned.  
> - A long double (ten bytes with C++Builder and DMC, eight bytes with Visual C++, twelve bytes with GCC) will be 8-byte aligned with C++Builder, 2-byte aligned with DMC, 8-byte aligned with Visual C++ and 4-byte aligned with GCC.  
> - Any pointer (four bytes) will be 4-byte aligned. (e.g.: char*, int*)  
> 
> The only notable differences in alignment for an LP64 64-bit system when compared to a 32-bit system are:  
> 
> - A long (eight bytes) will be 8-byte aligned.  
> - A double (eight bytes) will be 8-byte aligned.  
> - A long double (eight bytes with Visual C++, sixteen bytes with GCC) will be 8-byte aligned with Visual C++ and 16-byte aligned with GCC.  
> - Any pointer (eight bytes) will be 8-byte aligned.  
> 
> Some data types are dependent on the implementation.  

不够直观的话, 我们跑个32位程序试试:

基本数据类型的:
<pre>
#include<iostream>
using namespace std;
int main()
{
    cout &lt;&lt; "char:" &lt;&lt; sizeof(char) &lt;&lt; endl//1
        &lt;&lt; "short:" &lt;&lt; sizeof(short) &lt;&lt; endl//1
        &lt;&lt; "int:" &lt;&lt; sizeof(int) &lt;&lt; endl//4
        &lt;&lt; "long:" &lt;&lt; sizeof(long) &lt;&lt; endl//4
        &lt;&lt; "float:" &lt;&lt; sizeof(float) &lt;&lt; endl//4
        &lt;&lt; "double:" &lt;&lt; sizeof(double) &lt;&lt; endl//8
        &lt;&lt; "long long:" &lt;&lt; sizeof(long long) &lt;&lt; endl//8
        &lt;&lt; "long double:" &lt;&lt; sizeof(long double) &lt;&lt; endl//8
        &lt;&lt; "char*:" &lt;&lt; sizeof(char*) &lt;&lt; endl//4
        &lt;&lt; "int*:" &lt;&lt; sizeof(int*) &lt;&lt; endl;//4
    return 0;
}
</pre>
数组的:
<pre>
#include<iostream>
using namespace std;
int main()
{
    char str[] = "hello";
    int arr[8];
    cout &lt;&lt; "str:" &lt;&lt; sizeof(str) &lt;&lt; endl//6, 因为后面还有个'\0'
        &lt;&lt; "arr:" &lt;&lt; sizeof(arr) &lt;&lt; endl;//32
    return 0;
}
</pre>
因为, 指针, long double等会因为平台影响而不同, 所以, 考试出现的话, 基本就可以吐槽出题人不靠谱了; 至于其他, 都是不变的, 所以, 为了笔试, 要记下来...

后面的内容我们就先只考虑32位的环境了, 毕竟我的VS要编译个64位的程序也怪折腾的.

##字节对齐
内存是一个byte一个byte地存的这个我们知道, 但是, CPU不是一个byte一个byte地读的, 因为, 我们老早就用上32位的CPU了, 应该说我们老早就用上64位的CPU了, 那么, CPU每个读周期就能(应该也只能)读32bit(64位的CPU应该读64bit); 如果, 这么巧, 一个int跨越了两次读周期, 完了还得高地位拼接, 那不就浪费时间了么; 于是, 人们想了写办法不让这种情况发生, 比如直接报错, 比如编译器默认给你对齐, 比如, 你自己设置对齐.

我们设的话是怎么设的呢? 我见过的就`#pragma pack(n)`, 通常n都是2的某次幂, 具体参数可以删参考[2]查一下. `#pragma pack()`的位置时有影响的, `#pragma pack()`之后的, 才受这个设置影响, 否则按默认算. 比如:

<pre>
//ubuntu14.04 x64 gcc
#include&lt;iostream&gt;
struct s1
{
    char a;
    int b;
};
#pragma pack(2)
struct s2
{
    char a;
    int b;
};

int main()
{
    std::cout&lt;&lt;sizeof(s1)&lt;&lt;std::endl;//8
    std::cout&lt;&lt;sizeof(s2)&lt;&lt;std::endl;//6
    return 0;
}
</pre>

就现象而言, 设置pack(n)后, **一个类型为type的成员数据的起始偏移就会是min(n,sizeof(type))的倍数**. 

就像把内存分成了n byte n byte的块一样, 不会允许一个size小于等于一个块的数据跨越两个块, 比如, 现在我们pack(4), 第一个4byte放了个char, 占掉1byte, 现在你要放个int, 需要4byte, 如果直接放的话, 会用到第二个4byte, 这样CPU就得用两个读周期来读, 就慢了, 所以我们不能允许这样, 所以, 我们要把这个int放到第二个4byte去, 刚好4byte装完; 那刚刚那剩下的3byte怎么办, 空着就空着呗,<del> 反正内存便宜, </del>一般我们就把这空着的叫padding了.

如果是pack(8), 那int的偏移还是4的倍数, 而double的偏移就是8的倍数了. 

虽然这么说, 但事实上, 大部分编译器都会给你设置个默认的, 比如VS上, 默认都设为pack(8), 都够64位用了.

**补充** 参考[4]中指出, 数据成员完成各自对齐后, 结构本身也要对齐, 结果结构本身的大小是min(n,max(sizeof(member type) : for member in struct))的倍数. 这个现象构建起来有点麻烦, 可以先看后面的内容, 再回来看这个例子:
<pre>
#pragma pack(4)
struct s3{
    char a;double d;char e;
};
struct s5{
    char a;char b;char c;
};
#pragma pack(8)
struct s4{
    char a;double d;char e;
};
struct s6{
    char a;char b;char c;
}
#pragma pack(16)
struct s7{
    char a;double d;char e;
};
//main()
std::cout&lt;&lt;sizeof(s3)&lt;&lt;std::endl;//16, 整个结构体的大小是n的倍数
std::cout&lt;&lt;sizeof(s4)&lt;&lt;std::endl;//24, 整个结构体的大小是sizeof(double)的倍数
std::cout&lt;&lt;sizeof(s5)&lt;&lt;std::endl;//3
std::cout&lt;&lt;sizeof(s6)&lt;&lt;std::endl;//3
std::cout&lt;&lt;sizeof(s7)&lt;&lt;std::endl;//24, 整个结构体的大小是sizeof(double)的倍数
</pre>

##字节对齐与结构体
好, 关键问题来了, 为什么我们要考虑字节对齐, 即使编译器给了默认设置, 因为, 要考试, 考试, 试...

大部分情况下, 考的都是算个sizeof(结构体)什么的, 所以, 我们先来个简单的:
<pre>
#pragma pack(2)
struct s1
{
    char a;
    int b;
}
</pre>
这种情况, 按我们刚刚的分析, 应该是这样的:
<pre>
bytes:  | 1     2   |  3  4  |  5  6  |  7  8  |
menber: | a |padding|       b         |没了
</pre>
所以, sizeof(s1)应该是6, 但在VS上测试, 结果是8, 用`offsetof()`查看, b的偏移确实是4了, 跟我们的预测不一致啊, 为什么呢? 呃, 先换个平台试下...

同样的代码, 在VS2013中是8, GCC中是6, 对与这种事, 我只能表示...听GCC的!

**更新: 其实VS也是能信的, 如果建的是空项目, 那么就是6, 如果建的是win32控制台程序, 那么就是8, 可能, win32控制台程序至少为4吧, 我猜...**

OK, 我们来看稍微复杂点的情况:

<pre>
#include&lt;iostream&gt;
#pragma pack(1)
struct s1{char a;int b;char c;};

#pragma pack(2)
struct s2{char a;int b;char c;};

#pragma pack(4)
struct s3{char a;int b;char c;};
struct s5{char a;int b;char c;double d};

#pragma pack(8)
struct s4{char a;int b;char c;};
struct s6{char a;int b;char c;double d};
int main()
{
    std::cout&lt;&lt;sizeof(s1)&lt;&lt;std::endl;//6=1+4+1
    std::cout&lt;&lt;sizeof(s2)&lt;&lt;std::endl;//8=2+4+2
    std::cout&lt;&lt;sizeof(s3)&lt;&lt;std::endl;//12=4+4+4
    std::cout&lt;&lt;sizeof(s4)&lt;&lt;std::endl;//12=4+4+4
    std::cout&lt;&lt;sizeof(s5)&lt;&lt;std::endl;//20=4+4+4+8
    std::cout&lt;&lt;sizeof(s6)&lt;&lt;std::endl;//24=4+4+8+8, d的偏移得是8的倍数
    return 0;
}
</pre>

s1的三个成员的偏移是0, 1, 5,s2的是0, 2, 6, s3和s4的是0, 4, 8; s5的4个成员偏移为0, 4, 8, 12; s6的4个成员偏移为0, 4, 8, 16; 看看你算对了没. 

## offsetof()
VS下是直接支持offsetof(type,member)的, gcc要用的话, 可以:

    #define offsetof(type, member)  __builtin_offsetof (type, member)

## 总结

- 计算sizeof的时候要考虑字节对齐
- 字节对齐我们可以用`#pragma pack(n)`来设置, VS默认为8
- 对于结构的每一成员, 设其类型为type, 其地址偏移不为0的时候, 就是min(n,sizeof(type))的倍数
- 对于整个结构, 设其最大的成员的类型为largest_type, 则整个结构的体积填充至min(n,sizeof(largest_type))的倍数

现在, 回到我们最开始的问题:
<pre>
#pragma pack(8)
struct MyStruct
{
    char a;//offset=0, 占1 byte, padding 3 byte
    int b;//offset=4=min(8,sizeof(int), 占 4 byte, 没padding
    char c;//offset=8, 占1 byte, padding 3 byte
    float d;//offset=12, 占 4 byte, 没padding
    char e;//offset=16, 占1 byte, padding 3 byte
    double f;//offset=24, 占 8 byte, 没padding
    int* g;//offset=32, 占 4 byte, 没padding
    char* h;//offset=36, 占 4 byte, 没padding
};//整个size得是8的倍数, 所以是40
//其实, 我觉得, 最后一个换成char会更有代表性
</pre>
测试代码(VS2013,32位):
<pre>
#include&lt;iostream&gt;

#pragma pack(8)
using namespace std;
struct s1
{
    char a;
    int b;
    char c;
    float d;
    char e;
    double f;
    int* g;
    char* h;
};

int main()
{
    cout &lt;&lt; sizeof(s1) &lt;&lt; endl;
    cout &lt;&lt; offsetof(s1, a) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, b) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, c) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, d) &lt;&lt; " "
        &lt;&lt; offsetof(s1, e) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, f) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, g) &lt;&lt; " " 
        &lt;&lt; offsetof(s1, h) &lt;&lt; endl;
    system("pause");
    return 0;
}

</pre>
**Reference:**  
[1] : http://en.wikipedia.org/wiki/Data_structure_alignment  
[2] : https://msdn.microsoft.com/en-us/library/2e70t5y1.aspx  
[3] : http://stackoverflow.com/questions/3318410/pragma-pack-effect  
[4] : http://redawn.sinaapp.com/archives/254  
[5] : http://blog.sina.com.cn/s/blog_5c717fa001012ml7.html  
[6] : http://kopptblog.sinaapp.com/2012/04/19/dataalignment/  
[7] : https://gcc.gnu.org/onlinedocs/gcc/Offsetof.html  