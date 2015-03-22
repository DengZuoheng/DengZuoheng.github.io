---
layout: post
title: sizeof, 字节对齐与数据结构对齐
description: 据说各实习招聘笔试总喜欢考sizeof一个结构体的问题, 虽然自己不常用, 不过还是整理了一下写下来了.   
category: blog
---

事情是这样的, 前两天做疼讯的在线笔试, 碰到一题大概这样的:

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

我说, 一个`char`1byte, `int`4byte, `float`4byte, `double`8byte, `int*`目测4byte(64位下目测8byte), 结果, 怎么都算不对啊...因为, 我完全没想起字节对齐那事...

事实上, sizeof(MyStruct)==40

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

    #include<iostream>
    using namespace std;
    int main()
    {
        cout << "char:" << sizeof(char) << endl//1
            << "short:" << sizeof(short) << endl//1
            << "int:" << sizeof(int) << endl//4
            << "long:" << sizeof(long) << endl//4
            << "float:" << sizeof(float) << endl//4
            << "double:" << sizeof(double) << endl//8
            << "long long:" << sizeof(long long) << endl//8
            << "long double:" << sizeof(long double) << endl//8
            << "char*:" << sizeof(char*) << endl//4
            << "int*:" << sizeof(int*) << endl;//4
        return 0;
    }

数组的:

    #include<iostream>
    using namespace std;
    int main()
    {
        char str[] = "hello";
        int arr[8];
        cout << "str:" << sizeof(str) << endl//6, 因为后面还有个'\0'
            << "arr:" << sizeof(arr) << endl;//32
        return 0;
    }

因为, 指针, long double等会因为平台影响而不同, 所以, 考试出现的话, 基本就可以吐槽出题人不靠谱了; 至于其他, 都是不变的, 所以, 为了笔试, 要记下来...

后面的内容我们就先只考虑32位的环境了, 毕竟我的VS要编译个64位的程序也怪折腾的.

##字节对齐
内存是一个byte一个byte地存的这个我们知道, 但是, CPU不是一个byte一个byte地读的, 因为, 我们老早就用上32位的CPU了, 应该说我们早就用上64位的CPU了, 那么, CPU每个读周期就能(应该也只能)读32bit(64位的CPU应该读64bit); 如果, 这么巧, 一个int跨越了两次读周期, 完了还得高地位拼接, 那不就浪费时间了么; 于是, 人们想了写办法不让这种情况发生, 比如直接报错, 比如编译器默认给你对齐, 比如, 你直接设置对齐.

我们设的话是怎么设的呢? 我见过的就`#pragma pack(n)`, 通常n都是2的某次幂, 具体参数可以删参考[2]查一下. `#pragma pack()`的位置时有影响的, `#pragma pack()`之后的, 才受这个设置影响, 否则按默认算. 比如:
    
    //ubuntu14.04 x64 gcc
    #include<iostream>
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
        std::cout<<sizeof(s1)<<std::endl;//8
        std::cout<<sizeof(s2)<<std::endl;//6
        return 0;
    }

就现象而言, 设置pack(n)后, 一个数据的起始偏移就会是n的倍数, 就像把 内存分成了n byte n byte的块一样, 不会允许一个大小小于一个快的数据跨越两个块, 比如, 现在我们pack(4), 第一个4byte放了个char, 占掉1byte, 现在你要放个int, 需要4byte, 如果直接放的话, 会用到第二个4byte, 这样CPU就得用两个读周期来读, 就慢了, 所以我们不能允许这样, 所以, 我们要把这个int放到第二个4byte去, 刚好4byte装完; 那刚刚那剩下的3byte怎么办, 空着就空着呗, 反正内存便宜, 一般我们就把这空着的叫padding了.

虽然这么说, 但是是事实上, 大部分编译器都会给你设置个默认的, 比如VS上, 默认都设为pack(8), 都够64位用了.

##字节对齐与结构体
好, 关键问题来了, 为什么我们要考虑字节对齐, 即使编译器给了默认设置, 因为, 要考试, 考试, 试...

大部分情况下, 考的都是算个sizeof(结构体)什么的, 所以, 我们先来个简单的:
    
    #pragma pack(2)
    struct s1
    {
        char a;
        int b;
    }

这种情况, 按我们刚刚的分析, 应该是这样的:

    bytes:  | 1     2   |  3  4  |  5  6  |  7  8  |
    menber: | a |padding|       b         |没了

所以, sizeof(s1)应该是6, 但在VS上测试, 结果是8, 用`offsetof()`查看, b的偏移确实是4了, 跟我们的预测不一致啊, 为什么呢? 呃, 先换个平台试下...

同样的代码, 在VS2013中是8, GCC中是6, 对与这种事, 我只能表示...听GCC的!

**更新: 其实VS也是能信的, 如果建的是空项目, 那么就是6, 如果建的是win32控制台程序, 那么就是8, 可能, win32控制台程序至少为4吧, 我猜**

OK, 我们来看稍微复杂点的情况:

    #include<iostream>
    #pragma pack(1)
    struct s1{char a;int b;char c;};
    
    #pragma pack(2)
    struct s2{char a;int b;char c;};
    
    #pragma pack(4)
    struct s3{char a;int b;char c;};
    
    #pragma pack(8)
    struct s4{char a;int b;char c;};
    
    int main()
    {
        std::cout<<sizeof(s1)<<std::endl;//6=1+4+1
        std::cout<<sizeof(s2)<<std::endl;//8=2+4+2
        std::cout<<sizeof(s3)<<std::endl;//12=4+4+4
        std::cout<<sizeof(s4)<<std::endl;//12=(4+4)+4
        return 0;
    }






**Reference:**  
[1] : http://en.wikipedia.org/wiki/Data_structure_alignment
[2] : https://msdn.microsoft.com/en-us/library/2e70t5y1.aspx
[3] : http://stackoverflow.com/questions/3318410/pragma-pack-effect
[4] : http://redawn.sinaapp.com/archives/254
[5] : http://blog.sina.com.cn/s/blog_5c717fa001012ml7.html
[6] : http://kopptblog.sinaapp.com/2012/04/19/dataalignment/