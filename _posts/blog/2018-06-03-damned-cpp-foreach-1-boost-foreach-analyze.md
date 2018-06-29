---
layout: post
title: C++的循环系列#1&#58; boost foreach 源码分析
description: 写C++也有一段时间了, 依然没能沐浴C++11的光辉, C++98下又没有方便的像python zip, enumerate之类的方案, 想自己写一个的话, 很自然就想到看一下BOOST_FOREACH是怎么写的.
category: blog
---

## 缘起

古老的C++98中, 我们通常写个for loop是怎么样的呢, 大家应该早就<del>用上BOOST_FOREACH了</del>受够了:

~~~
std::vector<int> vec={1,2,3,4,5,6};
for (std::vector<int>::const_iterator it=vec.begin(); it != vec.end(); ++it) {
    const int& v = *it;
    std::cout<<v <<std::endl;
}
~~~

看起来还行? 那我们来点日常的:

~~~
std::vector<::lib::infra::foo::bar::foobar::LongTypeName> a_fucking_long_name_vec = someFuckingLongNameFactory();
for (std::vector<::lib::infra::foo::bar::foobar::LongTypeName>::const_iterator it = a_fucking_long_name_vec.begin();
       it != a_fucking_long_name_vec.end(); ++it) {
       const ::lib::infra::foo::bar::foobar::LongTypeName& val_name = *it;
       // do something with val_name
}
~~~

可以看出, 换个类型, 写法并没有变, 甚至it的名字都没变, 那我们是不是可以写个奇怪宏<del>不用, 升级C++11或C++17就好</del>, 帮我们少打几个字呢?

像这样:

~~~
#define FOREACH(val, col) \
    // some dark magic

std::vector<::lib::infra::foo::bar::foobar::LongTypeName> a_fucking_long_name_vec =someFuckingLongNameFactory();
FOREACH(val_name, a_fucking_long_name_vec) {
       // do something with val_name
}
~~~

或者这样?

~~~
FOREACH(val_name, someFuckingLongNameFactory()) {
        // do something with val_name
}
~~~

且不说少打了好些字, 至少不用给iterator起名字了.

那么, 我们如何实现dark magic部分呢?

(注意事项: 后面的内容许多代码都应该当作伪码, 除了明确指出其为"测试代码"的片段, 其他多半是无法直接编译运行的)

## 把FOREACH写得像一个表达式

第一反应是写成这样:

~~~
#define FOREACH(val, col) \
    for (col::iterator it = col.begin(); it != col.end(); ++it) \
~~~
       
val怎么办, for后面不带花括号就只能跟if或另一个for, 也许可以写成这样:

~~~
#define FOREACH(val, col) \
    for (col::iterator it = col.begin(); it != col.end(); ++it) \
        for (val = *it, bool _continue = true; _continue; _continue = false) \
~~~

然而古老的C++98不允许你这么在for loop中初始化两个不同类型的变量, 那么写成if形式呢?

~~~
#define FOREACH(val, col) \
    for (col::iterator it = col.begin(); it != col.end(); ++it) \
        if (val  = *it) \
~~~

看起来是可以的, 但是, 我们毕竟没有规定说val一定是个引用, 也许是个值呢? 如果是个值, 那我写个奇怪的type, 然后还写了

~~~
bool operator=(const exp& rhs) {
     return false;
}
operator bool() {
     return false;
}
~~~

之类的奇怪重载, 这个if表达式就没法玩了

所以, val的赋值这步, 还是得在循环里边, 所以我们反过来, 先写最后一步val的赋值:

~~~
#define FOREACH(val, col) \
    // some magic
    for (val = *it; OTHER_MAGIC; STILL_MAGIC) \
~~~

`OTHER_MAGIC`和`STILL_MAGIC`是实现最方便还是上面的_continue咯:

~~~
#define FOREACH(val, col) \
    // some magic
    for (val = *it; _continue; _continue =false) \
~~~

既然, _continue没法在最后一个for中初始化, 我们用上面在if中赋值的方法在最后一个for前面加个if, 在这个if中对`_continue`赋值:

~~~
#define FOREACH(val, col) \
    // some magic
    if (_continue = true) \
        for (val = *it; _continue; _continue = false)\
~~~

这样看起来很有道理, 但是总有奇怪的用户, 会写出这样的代码:

~~~
FOREACH(int val, vec) {
    // do something with val
} else {
    // some strange code
}
~~~

所以, 你还得把最后一个`for`写到最后一个`if`的`else`部分, 但是, 赋值为`true`, 这个`if`判断最后会判断_continue的值, 所以只能赋值为`false`:

~~~
#define FOREACH(val, col) \
    // some magic
    if (_continue=false) { } else \
        for (val = *it; !_continue;_continue=true)\
~~~

在if中赋值通常会引发编译器warning, 所以需要一个函数:

~~~
bool set_false(bool& _continue) {
  _continue = false;
  return false;
}

#define FOREACH(val, col) \
  // some magic
  if (set_false(_continue)){} else\
  for (val = *it; !_continue;_continue=true)\
~~~

到了这里, 我们终于还是要面对一个问题, `it`怎么来的? `_continue`怎么来的?

it和_continue都可以在for结构里声明, 但是, 我们上面的进展还没有涉及实际对容器的遍历, 所以肯定还需要一个实际遍历的循环, 这样就会有3重循环:

~~~
#define FOREACH(val, col) \
    for (auto it = col.begin(); it != col.end(); ++it) \
        for (bool _continue = true; _continue; _continue = false) \
            if (set_false(_continue)) {}  else \
                for (auto val = *it; !_continue; _continue = true)\
~~~

因为for loop等价于以下代码, 所以`_continue`初始化那个`for`, 中间的condition得是`true`:

~~~
{
    init_statement
        while ( condition ) {
        statement
        iteration_expression ;
    }
}
~~~

到这里我们感觉可以遍历一个容器了, 虽然看起来有点复杂, 不太靠谱, 不知道能不能简化一下;

我们先整理一下思路, 这里有三个问题:

1. 如果没有auto, 我们不知道iterator的类型
2. 遍历容器时我们两次引用了col, 如果col是个表达式, 就调用了两次; 
3. 我们假设了col是标准容器, 如果是个数组呢? 

那么我们可不可以弄一个包装容器:

1. 推导待遍历容器的元素类型;
2. 包装这个待遍历容器, 然后得到一个可以遍历此包装容器器的迭代器:
3. 避免多次引用col, 也许是说第一次使用的时候, 就需要在第一次使用的时候, 将这个容器的引用或者右值保存下来.


鉴于我们要在这样一个结构里保留一个类型不定的变量比较困难(if 里面的变量都得有`operator bool`, for的话可能降低性能), 我们先指望我们能得到begin和end, 这样我们的结构会如下:

~~~
#define FOREACH(val, col) \
    if (foreach_iter_t iter_begin  = FOREACH_WRAPPER_BEGIN(col) {} else \
    if (foreach_iter_t iter_end = FOREACH_WRAPPER_END(col) {} else \
    for (; iter_begin != iter_end; ++iter_begin) \
        for (bool _continue = true; _continue; _continue = false) \
            if (set_false(_continue)) {} else\
                for (auto val = *iter_begin; !_continue; _continue = true)\
~~~

if里面无法一次得到两个变量, 所以begin和end得分别声明, 但这样可能会需要两次使用col, 到此重复求值; 所以这里的FOREACH_WRAPPER_XXX我们都先假设为宏, 希望后面能找到什么办法, 可以利用begin啥的来得到end. 

现在我们再来看一下这个三重循环是不是能简化一下.

迭代和解引用迭代器是必须的, 中间这个_contine能不能和迭代合并一下呢? 比如:

~~~
for (bool _continue = true; _continue && iter_begin != iter_end; ++iter_begin))
    if (set_false(_continue)) {} else \
    for (auto val = *iter_begin; !_continue;_continue = true) \
~~~

但这样写的话, 我们在循环体内`break`时, 解引用的循环`break`了, 这时调用了`++iter_begin`...虽然不会再次执行循环体, 但是迭代器多++了一次也不好, 我们可以根据`_continue`的值处理一下:

~~~
for (bool _continue = true; _continue && iter_begin != iter_end; _continue? ++iter_begin: (void)0)
    if (set_false(_continue)) {} else \
    for (auto val = *iter_begin; !_continue;_continue = true) \
~~~

因为`break`, `_continue`没有被设为`true`, 所以`++iter_begin`不会被调用.

## 持有和操作迭代器

现在我们先在试着写一个foreach_iter_t :

~~~
template<typename T>
struct foreach_iter_t  {
    foreach_iter_t(T const& t) : item(t) {}
    operator bool() const { return false;}
    T item;
};
~~~

因为我们是在`if`里面声明`iter_begin`啥的, 所以, `operator bool`是需要重载一下的.

然后可以写出一个简单的begin包装函数:

~~~
template <typename ContainerType>
foreach_iter_t<typename ContainerType::const_iterator> begin(const ContainerType& c) {
    return c.begin();
}
~~~

好像有什么不对, 这样的话, 我们声明`xx b = begin(col)`的时候, 并不知道`xx`是什么, 因为我们本来就不知道container的类型.

而且, `begin`函数的返回会拷贝`foreach_iter_t`的临时实例, 而这个实例里面有一个迭代器, 迭代器的拷贝成本可说不好高不高, 能不能省略掉这次拷贝呢?

还真能, 参考文献[1]中提到, 将派生类的临时实例绑定到基类声明的常量引用, 这个临时实例的生命会延长到与该引用一致. 什么意思? 

就是`const base_type b = begin(col)`时, 直到我们用完`b`, 那个`begin`返回值, 那个应该是临时变量的返回值,  才析构.   (不是基类引用也行[2], 因为这里我们不知道类型, 所以就得搞一个基类, 类似类型擦除). 

所以 根据参考文献[1][2], 我们可以写成这样:

~~~
struct foreach_iter_t {
    operator bool() const { return false;}
};

template<tyename T> 
struct foreach_iter_impl : foreach_iter_t {
    foreach_iter_impl(const T& t) : item(t) {}
    mutable T item;
};

template <typename ContainerType>
foreach_iter_impl<typename Container::const_iterator> begin(const ContainerType& c) {
    return c.begin();
}

#define FOREACH(val, col) \
    if (const foreach_iter_t& iter_begin  = begin(col) ) {} else \

~~~

但是, 这样的话我们就丢失了类型信息, 自然没法随随便便就写出一个`operator++`来, 所以, 我们得像`begin`函数一样, 写个`next`函数好了:

~~~
template<typename ContainerType>
void next(const foreach_iter_t& iter,  const ContaineType& ) {
    ???
}
~~~

因为迭代器实际上在`foreach_iter_impl`中,  我们得将`foreach_iter_t`转成`foreach_iter_impl`, 此时需要类型信息, 这个信息可以从第二无名参数来; 方便起见, 我们可以写一个`foreach_iter_cast`去获取这个迭代器:

~~~
template <typename T>
T& foreach_iter_cast(const foreach_iter_t& iter) {
    return static_cast<const foreach_iter_impl<T>& >(iter).item;
}
~~~

于是, `next`就会是这样的:

~~~
template<typename ContainerType>
void next(const foreach_iter_t& iter,  const ContaineType& ) {
     ++ foreach_iter_cast(typename ContainerType::const_iterator>(iter);
}
~~~

然而, 如果`col`是一个函数表达式, 我们每次调用`next`, 就会调用一下这个函数, 这是不能接受的, 所以, 接下来, 我们就得研究怎么获取类型信息而不反复调用col.

那么有没有不调用col而获得col的类型信息的方法呢?

当然有啦(....废话)

## 获取容器的类型信息

大家应该还记得学c的时候, 常常会用以下宏来实现min/max:

~~~
#define min(a, b) ((a) < (b) ? (a) : (b))
~~~

三目条件运算符, 如果条件为真, 第三操作数是不会执行的,  我们可以利用这一点, 使得col进入表达式而不被执行, 比如:

~~~
#define ENCODED_TYPEOF(col) true ? SOME_MAGIC : col;
~~~

我们希望能从`SOME_MAGIC`得到col的类型信息. 这依赖于三目运算符的类型推导规则, 三目运算符始终是一个有结果的表达式, 结果是什么类型, 自然是从后两个操作数中得来的. 具体怎么来的, 我们可以参考文献[1]:

> 对于表达式 (b ? x : y), 如果x的类型是X, y的类型是Y, 而且X和Y不同, 而且其中一个是类类型, 编译器就会看X能不能转成Y以及Y能不能转成X. 如果只有X转Y或者只有Y转X(就是不能互相转), 这种转换就是一种无歧义的类型推导. 比如Y能转换成X, 而X不能转换成Y, 表达式的类型就会是Y.

按这个意思,  我们应该写成: `SOME_MAGIC`可以转换成col, 而col不能转换成`SOME_MAGIC`, 这样表达式的类型就是col的类型.

但我们知道`SOME_MAGIC`是不可能转换成col, 因为col的构造函数肯定不知道`SOME_MAGIC`是什么鬼. 所以我们不能直接就把col放着, 我们得包一下:

~~~
#define ENCODED_TYPEOF(col) true ? any_type() : encode_type(container))
~~~

`any_type`是一个类, 而`encode_type`返回某个类型的实例, 而`any_type`可以转换成这个类型, 我们可以这样写:

~~~
template <typename T> 
struct type2type {
    // nothing
}

template <typename T>
type2type<T> encode_type(const T& t) {
    return type2type<T>();
}

struct any_type {
    template<typename T>
    operator type2type<T>() const {
        return type2type<T>();
    }
};
~~~

此时, `any_type`可以转换成`type2type`, 所以, `ENCODE_TYPE(col)`会返回一个`type2type<ContainerType>`.  于是我们可以改一下`next`函数:

~~~
template<typename ContainerType>
void next(const foreach_iter_t& iter, type2type<ContainerType>) {
    ++ foreach_iter_cast(typename ContainerType::const_iterator>(iter);
}
~~~

而调用的时候, 为了使用好不容易得来的类型信息, 我们需要这么写:

~~~
...
next(iter, ENCODED_TYPEOF(col));
...
~~~

接下来, 我们需要研究如果col是个函数调用(或者说, 右值表达式), 我们怎么"保存"这个右值的问题.

## 探测右值

那么, 首先我们得知道怎么判断一个东西它是不是右值. 这个问题, 真的是语言问题, 就像上面推导col的类型一样, 不是熟悉c++标准的同学, 应该是想不出来的(想出来的大佬, 请务必接受我的敬意). 所以, 我们直接看文献[1]的答案吧.

很<del>遗憾</del>巧, 答案还是我们刚研究过的三目运算符....

刚刚我们提到, 2,3位的操作数如果类型不同, 会有一个转换的规则, 我们就是利用这个转换规则, 来获得col的类型的. 更进一步地, 文献[1]指出, 据c++标准5.16. 如果Y是个左值, 当X可以转换成Y的引用, 我们就说X可以转换成Y. 如果Y是个右值, 当X可以转换成Y, 我们说X可以转换成Y. 就是这个引用的差别,  使得我们可以判断这个操作数是不是右值.

这意味着, 我们可以写出这样的代码, 来判断表达式col是不是右值, 这个过程甚至不需要对表达式求值:

~~~
// 这段代码在VS2017是不work的, VS2015却可以

struct rvalue_probe {
    template<class R> operator R() {
        throw "rvalue";
    }
    template<class L> operator L&() const {
        throw "lvalue";
    }
};

#define RVALUE_TEST(col) \
    try { \
        true ? rvalue_probe() : (col); \
    } catch(const char* result) { \
        std::cout << result << std::endl;\
    }\
~~~

当col的类型是T且是个左值时, 编译器就试图将`rvalue_probe`转换成`const T&`, 而T是个右值是, 就会试图转换成T. 这个`operatorL&() const`的`const`怎么来的呢? 是因为函数重载的问题, 我们就不深入了<del>篇幅已经够长了</del>.

也许在你的编译器上, 上面这个代码是不work的, 这算编译器厂商的锅, `BOOST_FOREACH`的作者也在代码中吐槽这事:

> //Detect at run-time whether an expression yields an rvalue  
> // or an lvalue. This is 100% standard C++, but not all compilers  
> // accept it. Also, it causes FOREACH to break when used with non-  
> // copyable collection types.  

如果真不work, 我们后面也有别的方法去探测右值, 这里可以先脑补它是work的, 然后继续向前.

这样, 稍微改造一下`rvalue_probe`, 我们就可以在对右值表达式求值的时候, 顺便知道它是否是右值了:

~~~
struct rvalue_probe {
    template<class T> 
    rvalue_probe(const T& t, bool& b) : p_temp(const_cast<T*>(&t)), is_rvalue(b) {
        // pass
    }
    template<class R> operator R() {
        is_rvalue  =true;
        return *static_cast<R*>(p_temp);
    }
    template<class L> operator L&() const {
        return *static_cast<L*>(p_temp);
    }
    void* p_temp; 
    bool& is_rvalue;
}

#define EVAL(col, is_rvalue) \
    (true ? rvalue_probe((col), is_rvalue) :  (col)
~~~

`EVAL`返回什么呢? 当col是个右值表达式, `rvalue_probe`构造时会对其求值, 得到临时变量t, 并把t的指针保存到`p_temp`. 随即发生了转换, 因为此时还在"一个表达式"里面, 所以`p_temp`依然是有效的. 参考一下测试代码(注意这里的vector, 这个奇怪的vector在之后的测试代码中经常出现):

~~~
#include <iostream>
#include <vector>

class vector : public std::vector<int> {
public:
    vector() : std::vector<int>() {
        std::cout << "constructor" << std::endl;
        int arr[] = { 1, 2, 3, 4, 5 };
        std::vector<int>::assign(arr, arr + 5);
    }
    vector(const vector& rhs) : std::vector<int>(rhs) {
        std::cout << "copy constructor" << std::endl;
    }
    vector& operator=(const vector& rhs) {
        std::cout << "assign operator" << std::endl;
        std::vector<int>::operator=(rhs);
        return *this;
    }
    ~vector() {
        std::cout << "distructor" << std::endl;
    }
};

vector create_vec() {
    std::cout << "create_vec" << std::endl;
    return vector();
}
struct rvalue_probe {
    template<class T>
    rvalue_probe(const T& t, bool& b) : p_temp(const_cast<T*>(&t)),  is_rvalue(b) {
        // pass
    }
    template<class R> operator R() {
        std::cout << "begin operator R" << std::endl;
        is_rvalue = true;
        return *static_cast<R*>(p_temp);
    }
    template<class L> operator L&() const {
        std::cout << "begin operator L&" << std::endl;
        is_rvalue = false;
        return &static_cast<L*>(p_temp);
    }
    void* p_temp;
    bool& is_rvalue;
};
#define EVAL(col, is_rvalue) \
    (true ? rvalue_probe((col), is_rvalue) :  (col))

template<typename T>
void contain(const T& col, const bool& is_rvalue) {
    std::cout << "begin contain" << std::endl;
    std::cout << "end contain" << std::endl;
}

int main() {
    bool is_rvalue = false;
    contain(EVAL(create_vec(), is_rvalue), is_rvalue);
    std::cout << "end main" << std::endl;
}
~~~

其输出(VS2015，mingw5.3)为:

~~~
create_vec
constructor
begin operator R
copy constructor
begin contain
end contain
distructor
distructor
end main
~~~

`rvalue_probe`转换函数的返回会复制一次, 这次似乎没有必要, 但又无法避免. (`BOOST_FOREACH`中, 用的不是指针, 而是引用, 但这次复制仍然没有避免), BOOST_FOREACH里面是这样的, 可以参考一下:

~~~
template<typename T>
struct rvalue_probe
{
    rvalue_probe(T &t, bool &b): value(t), is_rvalue(b){ }

    operator T() {
        this->is_rvalue = true;
        return this->value;
    }

    operator T &() const {
        return this->value;
    }

private:
    T & value;
    bool &is_rvalue;
};

template<typename T>
rvalue_probe<T> make_probe(T &t, bool &b) { return rvalue_probe<T>(t, b); }

template<typename T>
rvalue_probe<T const> make_probe(T const &t, bool &b) { return rvalue_probe<T const>(t, b); }

#define EVAL(COL, is_rvalue) \
    (true ? make_probe((COL), is_rvalue) : (COL))

~~~

## 保存右值

OK, 我们继续向前, 因为我们有begin, end函数来获取两个迭代器, 所以, 对于右值来说, 我们还需要把它保存起来(没错, 又复制一次), 当然左值就不复制了, 那么我们需要一个`union`类似物, 右值的时候存的是右值的副本, 左值的时候存的是左值的指针. `boost::variant`可以, 不过`BOOST_FOREACH`里面用的是一个跟简单的版本(simple_variant). 这里我们不妨用`boost::variant`.

至于结果存到哪, 我们翻到最前面的`foreach_iter_t`, 这玩意其实是个模板对不对, 往里面塞个容器也是可以的对不对, 就用它了, 不过, 这时候还叫`foreach_iter_t`好像不太合适, 给个general一点的名字, `auto_any`(这里的`auto_any`的名字就来自`BOOST_FOREACH`, `auto`是自动内存分配的`auto`, 即栈区内存, 意味着`auto_any`的实例都不应该用`new`的)啥的:

~~~
struct auto_any_base {
    operator bool() const { return false;}
};

template<typename T> 
struct auto_any : auto_any_base{
    auto_any_base(const T& t) : item(t) {}
    mutable T item;
};

template <typename T>
T& auto_any_cast(const auto_any_base& iter) {
    return static_cast<const auto_any<T>& >(iter).item;
}
~~~

因为`auto_any`不是迭代器了, 我们就不给它写`operator++`了, 所以`FOREACH`的写法更新一下:

~~~
#define FOREACH(VAL, COL) \
       if (bool _foreach_is_rvalue = false) {} else \
       if (const auto_any_base& _foreach_col = FOREACH_CONTAIN(COL)) {} else \
       if (const auto_any_base& _foreach_begin  = FOREACH_BEGIN(COL) {} else \
       if (const auto_any_base& _foreach_end = FOREACH_END(col) {} else \
       for (bool _continue = true; \
                 _continue && !FOREACH_DONE(COL); \
                 _continue ? FOREACH_NEXT(COL) : (void)0) \
            if (set_false(_continue)) {} \
            for (VAL = FOREACH_DEREF(COL); !_continue; _continue = true) \
~~~

其中`_foreach_col`是我们保存的右值副本或左值指针.

根据剧透, 我们调用`BOOST_FOREACH`时, VAL其实是指定了类型的, 所以对iter解引用的auto我们就去掉了(虽然我们可以用`BOOST_AUTO`, `BOOST_TYPEOF`啥的达成, 但暂时就深入了).

因为获取副本, 迭代器时, 我们都需要COL表达式来推导类型, 而且也会引用`_foreach_is_rvalue`, 所以这里各种操作都用宏包装了一下, 下面我们就来说一下各个宏的实现.

## 第一个可运行的FOREACH

`FOREACH_CONTAIN`的作用是取得我们需要的`variant`, 因为我们用`EVAL`宏求值的时候给`is_rvalue`赋值了, 所以我们可以写个`contain`函数, 把`is_rvalue`传进去, 根据`is_rvalue`的值返回variant

~~~
template<typename ContainerType>
auto_any<boost::variant<const ContainerType*, ContainerType> > 
contain(const ContainerType& t, const bool& is_rvalue) {
    typedef boost::variant<const ContainerType*, ContainerType> variant_t;
    return is_rvalue ? variant_t(t) : variant_t(&t);
}
~~~

然后我们的`FOREACH_CONTAIN`宏可以这么写:

~~~
#define FOREACH_CONTAIN(COL) \
    contain(EVAL(COL, _foreach_is_rvalue), _foreach_is_rvalue) \
~~~

这里我们就知道`contain`的`is_rvalue`参数为什么是引用了, 如果传值的话, 因为C++03没有规定参数的求值顺序, 我们就说不好传进来的是什么呢, 但是传引用的话, 不管求值顺序如何, 函数内使用的时候, 总归是求过值的. 

`begin`函数我们需要综合`is_rvalue`和`ENCODE_TYPEOF`的结果:

~~~
template<typename ContainerType>
auto_any<typename ContainerType::const_iterator>
begin (const auto_any_base& container, bool is_rvalue, type2type<ContainerType>) {
    typedef boost::variant<const ContainerType*, ContainerType> variant_t
    variant_t& var = auto_any_cast<variant_t>(container);
    const ContainerType& c = is_rvalue ? boost::get<ContainerType>(var) :
                                         *boost::get<const ContainerType*>(var);
    return c.begin();
}

#define FOREACH_BEGIN(COL) \
    begin(_foreach_col, _foreach_is_rvalue, ENCODED_TYPEOF(COL)) \
~~~

end函数也差不多:

~~~
template<typename ContainerType>
auto_any<typename ContainerType::const_iterator>
end (const auto_any_base& container, bool is_rvalue, type2type<ContainerType>) {
    typedef boost::variant<const Container*, ContainerType> variant_t
    variant_t& var = auto_any_cast<variant_t>(container);
    const ContainerType& c = is_rvalue ? boost::get<ContainerType>(var) :
                                         *boost::get<const ContainerType*>(var);
    return c.end();
}

#define FOREACH_END(COL) \
    end(_foreach_col, _foreach_is_rvalue, ENCODED_TYPEOF(COL) \
~~~

next函数我们甚至已经写过了:

~~~
template<typename ContainerType>
void next(const auto_any_base& iter, type2type<ContainerType>) {
      ++ auto_any_cast(typename ContainerType::const_iterator>(iter);
}

#define FOREACH_NEXT(COL) \
    next(_foreach_begin, ENCODED_TYPEOF(COL));
~~~

done也简单:

~~~
template<typename ContainerType>
bool done(const auto_any_base& cur, const auto_any_base& end, type2type<ContainerType>) {
    typedef typename ContainerType::const_iterator iter_t;
    return auto_any_cast<iter_t>(cur) == auto_any_cast<iter_t>(end);
}
#define FOREACH_DONE(COL) \
    done(_foreach_begin, _foreach_end, ENCODED_TYPEOF(COL)
~~~

`deref`需要稍微注意一下, 怎么从`iter_t`到该iter指向的值的引用类型, `BOOST_FOREACH`中用的是`boost::iterator_reference`, 我们就先简单用`iter_t::reference`好了:

~~~
template<typename ContainerType>
ContainerType::const_iterator::reference deref(auto_any_t cur, type2type<ContainerType>) {
    typedef typename ContainerType::const_tierator iter_t;
    return *auto_any_cast<iter_t>(cur);
}

#define FOREACH_DEREF(COL) \
    deref(_foreach_begin, ENCODED_TYPEOF(col)) \
~~~

到这里, 我们总算有一个能遍历标准容器的`FOREACH`了(虽然右值的处理仍然有问题), 下面是现阶段完整的测试和代码, 可以看出, `BOOST_FOREACH`的右值场景是不会复制很多次的, 我们一会再来讨论:

~~~
#include <gtest/gtest.h>

#include <iostream>
#include <vector>
#include <string>
#include <boost/variant.hpp>
#include <boost/foreach.hpp>

bool set_false(bool& _continue) {
  _continue = false;
  return false;
}

struct auto_any_base {
  operator bool() const { return false; }
};
template<typename T>
struct auto_any : public auto_any_base {
  auto_any(const T & t) : item(t) {}
  mutable T item;
};
template <typename T>
struct type2type {
  // nothing
};
template <typename T>
type2type<T> encode_type(const T& t) {
  return type2type<T>();
}
struct any_type {
  template<typename T>
  operator type2type<T>() const {
  return type2type<T>();
  }
};
template <typename T>
T& auto_any_cast(const auto_any_base& iter) {
  return static_cast<const auto_any<T>& >(iter).item;
}
template<typename ContainerType>
auto_any<boost::variant<const ContainerType*, ContainerType> >
contain(const ContainerType& t, const bool& is_rvalue) {
  typedef boost::variant<const ContainerType*, ContainerType> variant_t;
  return is_rvalue ? variant_t(t) : variant_t(&t);
}
struct rvalue_probe {
  template<class T>
  rvalue_probe(const T& t, bool& b) : p_temp(const_cast<T*>(&t)), is_rvalue(b) {
  // pass
  }
  template<class R> operator R() {
  is_rvalue = true;
  return *static_cast<R*>(p_temp);
  }
  template<class L> operator L&() const {
  return *static_cast<L*>(p_temp);
  }
  void* p_temp;
  bool& is_rvalue;
};
#define EVAL(COL, is_rvalue) (true ? rvalue_probe((COL), is_rvalue) : (COL))
#define ENCODED_TYPEOF(COL) (true ? any_type() : encode_type(COL))
#define FOREACH_CONTAIN(COL) \
  contain(EVAL(COL, _foreach_is_rvalue), _foreach_is_rvalue)

template<typename ContainerType>
auto_any<typename ContainerType::const_iterator>
begin(const auto_any_base& container, bool is_rvalue, type2type<ContainerType>) {
  typedef boost::variant<const ContainerType*, ContainerType> variant_t;
  variant_t& var = auto_any_cast<variant_t>(container);
  const ContainerType& c = is_rvalue ? boost::get<ContainerType>(var) :
  *boost::get<const ContainerType*>(var);

  return c.begin();
}
#define FOREACH_BEGIN(COL) \
  begin(_foreach_col, _foreach_is_rvalue, ENCODED_TYPEOF(COL))

template<typename ContainerType>
auto_any<typename ContainerType::const_iterator>
end(const auto_any_base& container, bool is_rvalue, type2type<ContainerType>) {
  typedef boost::variant<const ContainerType*, ContainerType> variant_t;
  variant_t& var = auto_any_cast<variant_t>(container);
  const ContainerType& c = is_rvalue ? boost::get<ContainerType>(var) :
  *boost::get<const ContainerType*>(var);

  return c.end();
}

#define FOREACH_END(COL) \
  end(_foreach_col, _foreach_is_rvalue, ENCODED_TYPEOF(COL))

template<typename ContainerType>
void next(const auto_any_base& iter, type2type<ContainerType>) {
  ++auto_any_cast<typename ContainerType::const_iterator>(iter);
}

#define FOREACH_NEXT(COL) \
  next(_foreach_begin, ENCODED_TYPEOF(COL)) \

template<typename ContainerType>
bool done(const auto_any_base& cur, const auto_any_base& end, type2type<ContainerType>) {
  typedef typename ContainerType::const_iterator iter_t;
  return auto_any_cast<iter_t>(cur) == auto_any_cast<iter_t>(end);
}

#define FOREACH_DONE(COL) \
  done(_foreach_begin, _foreach_end, ENCODED_TYPEOF(COL)) \

template<typename ContainerType>
typename ContainerType::const_iterator::reference deref(const auto_any_base& cur, type2type<ContainerType>) {
  typedef typename ContainerType::const_iterator iter_t;
  return *auto_any_cast<iter_t>(cur);
}

#define FOREACH_DEREF(COL) \
  deref(_foreach_begin, ENCODED_TYPEOF(COL)) \

#define FOREACH(VAL, COL) \
  if (bool _foreach_is_rvalue = false) {} else \
  if (const auto_any_base& _foreach_col = FOREACH_CONTAIN(COL)) {} else \
  if (const auto_any_base& _foreach_begin = FOREACH_BEGIN(COL)) {} else \
  if (const auto_any_base& _foreach_end = FOREACH_END(COL)) {} else \
  for (bool _continue = true; \
  _continue && !FOREACH_DONE(COL); \
  _continue ? FOREACH_NEXT(COL) : (void)0) \
  if (set_false(_continue)) {} else \
       for (VAL = FOREACH_DEREF(COL); !_continue; _continue = true) \

class vector : public std::vector<int> {
public:
  vector() : std::vector<int>() {
       std::cout << "constructor" << std::endl;
       int arr[] = {1, 2, 3, 4, 5};
       std::vector<int>::assign(arr, arr + 5);
  }
  vector(const vector& rhs) : std::vector<int>(rhs) {
       std::cout << "copy constructor" << std::endl;
  }
  vector& operator=(const vector& rhs) {
       std::cout << "assign operator" << std::endl;
       std::vector<int>::operator=(rhs);
       return *this;
  }
  ~vector() {
       std::cout << "distructor" << std::endl;
  }
};

vector create_vec() {
  std::cout << "create_vec" << std::endl;
  return vector();
}

TEST(for_each_test, left_value_for_each_test) {
  vector vec;
  FOREACH(int item, vec) {
  std::cout << item << std::endl;
  }
}

TEST(for_each_test, right_value_for_each_test) {
  FOREACH(int item, create_vec()) {
  std::cout << item << std::endl;
  }
}

TEST(for_each_test, right_value_boost_for_each_test) {
#ifdef BOOST_FOREACH_COMPILE_TIME_CONST_RVALUE_DETECTION
  std::cout << "compile time const rvalue detection" << std::endl;
#endif
#ifdef BOOST_FOREACH_RUN_TIME_CONST_RVALUE_DETECTION

  std::cout << "run time const rvalue dection" << std::endl;
#endif
#ifdef BOOST_FOREACH_NO_CONST_RVALUE_DETECTION

  std::cout << "no const rvalue detection" << std::endl;
#endif

  BOOST_FOREACH(int item, create_vec()) {
  std::cout << item << std::endl;
  }
}

~~~

`contain`函数中, `create_vec()`返回, `rvalue_probe`的转换, `variant`的构造返回都会复制一次右值, 所以复制了3遍, 这听起来很不靠谱, 而上面的测试代码应该也可以看到`BOOST_FOEACH`没有这么多次复制. 这是怎么做到的呢? 

## 再探右值探测

事实上, BOOST_FOREACH中, 根据编译器的版本, 分成了三种情况, 编译时右值探测, 运行时右值探测以及...没有右值探测. 

没有右值探测的编译器版本应该是比较老的了, 比如gcc3.x以前(那都是十几年前了), 我们就愉快地忽略这种情况了; 

而我们上面讨论了很久的右值探测, 在这里就是运行时右值探测. 我们可以把`BOOST_FOREACH`的代码拷贝出来, 手动去设置文件开头那些宏, 然后让`BOOST_FOREACH`用运行时右值探测, 你会发现也是复制了3遍.

gcc3.4和msvc13.1后, BOOST_FOREACH用的都是编译时右值探测了, 所以, 本章节讨论的自然就是这种情况了. 但BOOST_FOREACH里面用的方法笔者是想不出来了, 有兴趣的读者可以自己想想看, 下面我们就直接公布答案了.

翻看BOOST_FOREACH的源码, 可以看到两个函数:

~~~
template<typename T>
inline boost::mpl::false_ *is_rvalue_(T &, int) { return 0; }
template<typename T>
inline boost::mpl::true_ *is_rvalue_(T const &, ...) { return 0; }
~~~

嗯, 一个奇怪的重载函数, 去掉boost::mpl的干扰, 我们可以弄一个简单一些的测试版本:

~~~
template<typename T>
bool is_rvalue(T &, int) {
       std::cout << "is lvalue" << std::endl;
       return false;
}
template<typename T>
bool is_rvalue(T const &, ...) {
       std::cout << "is rvalue" << std::endl;
       return true;
}

int main() {
       vector vec;
       const vector cvec;
       vector const& crvec = vec;
       int arr[] { 1,2,3 };
       is_rvalue(vec, 0);
       is_rvalue(cvec, 0);
       is_rvalue(crvec, 0);
       is_rvalue(create_vec(), 0);
       is_rvalue(arr, 0);
}
~~~

这里用到的vector是我们上面用到的那个自己定义出来的测试用vector. 你猜输出是怎样的?

~~~
constructor
constructor
is lvalue
is lvalue
is lvalue
create_vec
constructor
is rvalue
distructor
is lvalue
distructor
distructor
~~~

只有`create_vec()`是`rvalue`, 惊不惊喜, 意不意外? 还有更惊喜的, 我们把`is_rvalue`那个奇怪的第二参数去掉, 或者都是`int`, 或者都是`...`之后, 要么编译不过, 要么不能正确探测右值. 第二个参数居然是关键所在? 对此, 笔者只能表示`???`

如果我们翻看`BOOST_FOREACH`, 会发现作者说:

> // Detect at compile-time whether an expression yields an rvalue or  
> // an lvalue. This is rather non-standard, but some popular  compilers  
> // accept it.  

好吧, 真正的黑魔法; 虽然不知道怎么回事, 但我们可以认为这么一个黑魔法是可以编译器探测右值的, 关键是怎么利用它. 因为我们的目标是编译时探测右值, 所以不能依靠返回值的具体量. 我们只能用编译时能用的信息, 比如常量? 类型? 也许我们可以用一下参数类型, 返回类型啥的.

我们回去看BOOST_FOREACH的`is_rvalue`的声明, 会发现它们返回了一个奇怪的东西, `boost::mpl::false_*`, 什么鬼? 去看定义, 是这样的:

~~~
template< bool C_ >
struct bool_ : integral_constant<bool, C_> {
     operator bool() const { return C_; }
     bool operator()() const { return C_; }
};
typedef bool_<true> true_;
typedef bool_<false> false_;
~~~

嗯, 模板元编程的东西, `true_`和`false_`是`bool_`的不同特化, 总之是不同类型, 所以BOOST_FOREACH利用的是返回值的类型, 至于怎么利用, 我们在`ENCODED_TYPEOF`的讨论中已经讨论过了, 利用三目运算符操作数的类型转换规则, 第二操作数可以转换为第三操作数是, 类型为第三操作数的类型, 那么, 我们把is_rvalue放到第三操作数位, 我们就得到一个`boost::mpl::true_*`或`boost::mpl::false_*`的三目运算符, 于是我们就相当于编译时知道了col是右值还是左值.

但是, 要怎么走不同分支呢? 答案相信大家已经想到了, 类型不是不一样么, 重载呀, 于是我们可以写出一个根据col是右值还是左值重载的`contain`函数:

~~~
 template<typename T>
inline boost::mpl::false_* is_rvalue(T &, int) {
       return 0;
}
template<typename T>
inline boost::mpl::true_* is_rvalue(T const &, ...) {
       return 0;
}
#define FOREACH_IS_RVALUE(COL) \
       (true ? 0 : is_rvalue(COL, 0))

template<typename T>
inline auto_any<T> contain(T const &t, boost::mpl::true_ *) // rvalue
{
       // TODO: how to return
}
template<typename T>
inline auto_any<T *> contain(T &t, boost::mpl::false_ *) // lvalue
{
       // TODO: how to return
}
~~~

contain可以通过第二参数的重载, 编译时选择不同分支, 而第一参数, 按`is_rvalue`的行为, 我们其实不再需要一个`variant`去包装col, 我们可以直接通过重载得到COL的类型. 那么, 应该返回什么呢?

右值复制一遍, 左值只需引用, 我们最初的目标是这样的, 所以, 右值的时候返回`auto_any<T>`, 左值的时候返回`auto_any<T*>`, 用指针的话, 之后的`auto_any_cast`可以根据第二参数来重载.  所以, 右值版本返回t本身, 让其转换为`auto_any<T>`实例, 而左值版本应该返回t的指针. 

获取t的指针有个小问题, 根据参考文献[3], 可以使用`boost::addressof`确保得到模板类型的指针类型., 于是`contain`应该是这样的:

~~~
 template<typename T>
inline auto_any<T> contain(T const &t, boost::mpl::true_ *) //  rvalue
{
     return t;
}
template<typename T>
inline auto_any<T *> contain(T &t, boost::mpl::false_ *) // lvalue
{

     return boost::addressof(t);
}

#define FOREACH_IS_RVALUE(COL) \
    (true ? 0 : is_rvalue(COL)

#define FOREACH_EVALUATE(COL) \
    (COL)

#define FOREACH_CONTAIN(COL) \
    contain(FOREACH_EVALUATE(COL) , FOREACH_IS_RVALUE(COL))
~~~

这里的`FOREACH_EVALUATE`直接求值就好, 我们甚至可以不写这个宏, 但是在`BOOST_FOREACH`中, 有不同的右值探测方式, `FOREACH_EVALUATE`宏就有不同版本, 所以即使在简单, 也得写个宏.

简单测试一下:

~~~
int main() {
       if (const auto_any_base& _foreach_col = FOREACH_CONTAIN(create_vec())) {}  else {
              std::cout << "do some thing with _foreach_col" << std::endl;
       }
       std::cout << "end if" << std::endl;
       return 0;
}
~~~

复制构造函数调用了一次, 符合我们的希望, 而且也可以看到"do some thing with _foreach_col"前, 那个右值被析构了, 我们确实没办法在右值版本也返回指针. 那么, 然后就是继续用重载右值和左值版本的策略来重写各个函数了, <del>显然, 易得, 留作练习</del>, 比如`begin`:

~~~
template<typename T>
inline auto_any<typename T::const_iterator>
begin(const auto_any_base& container, type2type<T>, boost::mpl::false_*) { //  lvalue
       const T* c = auto_any_cast<T*>(container);
       return c->begin();
}
template<typename T>
inline auto_any<typename T::const_iterator>
begin(const auto_any_base& container, type2type<T>, boost::mpl::true_*) { //  rvalue
       const T& c = auto_any_cast<T>(container);
       return c.begin();
}
~~~

增加一个参数, 使其有左值和右值两个版本, 左值的版本将`auto_any_base` cast成指针, 而右值的版本这cast成引用, 同理, 我们可以得到第二版本的可运行`FOREACH`:

~~~
#pragma once
#include <boost/mpl/bool.hpp>
bool set_false(bool& _continue) {
       _continue = false;
       return false;
}
struct auto_any_base {
       operator bool() const { return false; }
};
template<typename T>
struct auto_any : public auto_any_base {
       auto_any(const T & t) : item(t) {}
       mutable T item;
};
template <typename T> struct type2type { };
template <typename T>
type2type<T> encode_type(const T& t) { return type2type<T>(); }
struct any_type {
       template<typename T>
       operator type2type<T>() const {
              return type2type<T>();
       }
};
template <typename T>
T& auto_any_cast(const auto_any_base& iter) {
       return static_cast<const auto_any<T>& >(iter).item;
}
template<typename T>
inline boost::mpl::false_* is_rvalue(T &, int) { return 0; }
template<typename T>
inline boost::mpl::true_* is_rvalue(T const &, ...) { return 0; }
template<typename T>
inline auto_any<T> contain(T const &t, boost::mpl::true_ *) { // rvalue
       return t;
}
template<typename T>
inline auto_any<T *> contain(T &t, boost::mpl::false_ *) { // lvalue
       return boost::addressof(t);
}
template<typename T>
inline auto_any<typename T::const_iterator>
begin(const auto_any_base& container, type2type<T>, boost::mpl::false_*) { //  lvalue
       const T* c = auto_any_cast<T*>(container);
       return c->begin();
}
template<typename T>
inline auto_any<typename T::const_iterator>
begin(const auto_any_base& container, type2type<T>, boost::mpl::true_*) { //  rvalue
       const T& c = auto_any_cast<T>(container);
       return c.begin();
}
template<typename T>
inline auto_any<typename T::const_iterator>
end(const auto_any_base& container, type2type<T>, boost::mpl::false_*) { // lvalue
       const T* c = auto_any_cast<T*>(container);
       return c->end();
}
template<typename T>
inline auto_any<typename T::const_iterator>
end(const auto_any_base& container, type2type<T>, boost::mpl::true_*) { // rvalue
       const T& c = auto_any_cast<T>(container);
       return c.end();
}
template<typename T>
inline void next(const auto_any_base& iter, type2type<T>) {
       typedef typename T::const_iterator iter_t;
       ++auto_any_cast<iter_t>(iter);
}
template<typename T>
inline bool done(const auto_any_base& cur, const auto_any_base& end, type2type<T>)  {
       typedef typename T::const_iterator iter_t;
       return auto_any_cast<iter_t>(cur) == auto_any_cast<iter_t>(end);
}
template<typename T>
inline typename T::const_iterator::reference
deref(const auto_any_base& cur, type2type<T>) {
       typedef typename T::const_iterator iter_t;
       return *auto_any_cast<iter_t>(cur);
}
#define ENCODED_TYPEOF(COL) (true ? any_type() : encode_type(COL))
#define FOREACH_IS_RVALUE(COL) (true ? 0 : is_rvalue(COL, 0))
#define FOREACH_EVALUATE(COL) (COL)
#define FOREACH_CONTAIN(COL) contain(FOREACH_EVALUATE(COL) ,  FOREACH_IS_RVALUE(COL))
#define FOREACH_BEGIN(COL) begin(_foreach_col, ENCODED_TYPEOF(COL),  FOREACH_IS_RVALUE(COL))
#define FOREACH_END(COL) end(_foreach_col, ENCODED_TYPEOF(COL),  FOREACH_IS_RVALUE(COL))
#define FOREACH_NEXT(COL) next(_foreach_begin, ENCODED_TYPEOF(COL))
#define FOREACH_DONE(COL) done(_foreach_begin, _foreach_end, ENCODED_TYPEOF(COL))
#define FOREACH_DEREF(COL) deref(_foreach_begin, ENCODED_TYPEOF(COL))
#define FOREACH(VAL, COL) \
       if (const auto_any_base& _foreach_col = FOREACH_CONTAIN(COL)) {} else \
       if (const auto_any_base& _foreach_begin = FOREACH_BEGIN(COL)) {} else \
       if (const auto_any_base& _foreach_end = FOREACH_END(COL)) {} else \
       for (bool _continue = true; \
              _continue && !FOREACH_DONE(COL); \
              _continue ? FOREACH_NEXT(COL) : (void)0) \
                     if (set_false(_continue)) {} else \
                           for (VAL = FOREACH_DEREF(COL); !_continue; _continue =  true) \

~~~

## 常量检测

虽然我们写的`FOREACH`可以应对左值和右值的区别呢了, 但是, 由于我们上面的代码, 推导迭代器类型时, 用的都是`T::const_iterator`, 所以我们的FOREACH是做不到以下行为(改变元素)的:

~~~
vector vec;
FOREACH(int& item, vec) {
    item++;
}
~~~

但是, 我们又不能改成`T::iterator`, 这样vec确实是常量时, 就编译不过了, 我们需要判断col是不是个常量, 然后根据判断的结果`typedef`迭代器的类型.

随便搜索一下不难找到判断时候常量类型的`type_traits`, 比如`boost::is_const`:

~~~
template <class T> struct is_const : public boost::false_type {};
template <class T> struct is_const<T const> : boost::public true_type{};

const vector;
static_assert(is_const<const vector>::value);
~~~

`boost::mpl`也提供了编译时条件判断的工具:`boost::mpl::if_`, 比如 `typedef boost::if<c,f1,f2>::type type`如果`c`为`true`, 这`type`为`f1`, 否则为`f2`, 至于原理, 当然还是模板特化.

但是, 他们要怎么联系在一起呢?, 虽然我们是可以写出

~~~
template<typename T>
inline auto_any<typename boost::mpl::if_<boost::is_const<T>, typename  T::const_iterator, typename T::iterator>::type>
begin(const auto_any_base& container, type2type<T>, boost::mpl::false_*) { //  lvalue
       const T* c = auto_any_cast<T*>(container);
       return c->begin();
}
~~~

这样的代码, 但是, auto_any_cast也得根据是否常量来返回不同类型的, 如果`auto_any_cast`返回的常量, 那我们的`begin`怎么推导返回类型都白搭. 

既然`auto_any_cast`和`begin`的返回值推导都需要知道col是否常量, 那么, 我们是不是可以让`type2type`携带这个信息呢? 比如改成`type2type<T, IS_CONST>`? 

首先, 先考虑我们最初的目标, 获取迭代器类型, 我们可以写个trait去封装上面复杂的推导:

~~~
template<typename T, typename IS_CONST = boost::mpl::false_>
struct foreach_iterator {
       typedef typename boost::mpl::if_<
              IS_CONST,
              typename T::const_iterator,
              typename T::iterator>::type type;
};
~~~

然后我们的begin就会像这样:

~~~
template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type
begin(const auto_any_base& container, type2type<T, IS_CONST>, boost::mpl::false_*) { // lvalue
        return boost::begin(*auto_any_cast<T*, IS_CONST>(container);
}
~~~

这里使用`boost::begin`获取迭代器, 是为了将const等处理交给boost处理, `boost::begin`是`boost::range`的一部分, 可以获得range的迭代器, 这个range甚至包含数组, 是个挺方便的工具, 我们这里也跟着用了.

于是, 我们需要一个带`IS_CONST`的`type2type`和`auto_any_cast`, 先来看`type2type`, 之前的`type2type`什么都没有,  我们要增加一个模板参数, 不用也不行, 所以我们可以用在`boost::mpl::if_`中定义一个type, 也方便我们用的时候获取真正需要的容器类型, `BOOST_FOREACH`中用继承的方式, 我们自然是沿用:

~~~
template<typename T, typename IS_CONST = boost::mpl::false_>
struct type2type : boost::mpl::if_<IS_CONST, T const, T>{ };
~~~

`auto_any_cast`的话, 其实没有什么变化, 因为它是为了获得item, 而item是mutable的, 所以, 我们只需推导好返回类型便可 :

~~~
template<typename T, typename IS_CONST>
inline typename boost::mpl::if_<IS_CONST, T const, T>::type&
auto_any_cast(const auto_any_base& a) {
        return static_cast<const auto_any<T>&>(a).item;
}
~~~

而新的`ENCODED_TYPEOF`就需要多一些考虑了, 因为我们需要在这里获得col是否常量的信息; 按之前的风格, 我们会写一个`is_const_`的函数, 返回`boost::mpl::true_`和`boost::mpl::false_`的指针, 然后由此重载encode_type, 然后再三目运算符中不需要执行就能得到我们需要的`type2type`

在之前的`ENCODED_TYPEOF`的三目运算符中, 我们是用`any_type`可以转换成`type2type<T>`来完成的推导的, 但如果我们去翻`BOOST_FOREACH`的源码的话, 会发现并没有`any_type`这个结构, 因为`BOOST_FOREACH`是用`0`可以转换成任意类型的指针来完成这一推导的. 而且, 因为我们实际上并不需要这个三目运算符的结果, 所以结果是指针还是值是无所谓的.  所以, `encode_type`的参数是`is_const_`返回的指针类型, 其返回的也是指针类型, 其他函数的形参也是`type2type`的指针. 

~~~
template<typename T>
inline boost::mpl::false_* is_const_(T&) { return 0; }

template<typename T>
inline boost::mpl::true_ *is_const_(T const &) { return 0; }

// 其实type2type的第二模板参数我们给了默认来着
template<typename T> inline type2type<T, boost::mpl::false_>*
encode_type(T &, boost::mpl::false_ *) { return  0; }

template<typename T> inline type2type<T, boost::mpl::true_>* 
encode_type(T const &,  boost::mpl::true_*)  { return 0; }

#define ENCODED_TYPEOF(COL) 
    (true ? 0 : encode_type(COL,  is_const_(COL)))
~~~

我们的`begin`函数需要再改成形参为`type2type`指针的样子:

~~~
template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type
begin(const auto_any_base& container, type2type<T, IS_CONST>*, boost::mpl::false_*) { // lvalue
        return boost::begin(*auto_any_cast<T*, IS_CONST>(container);
}
~~~

其他函数写法差不多, 但是`next`需要注意一下, `auto_any_cast`的时候, 不需要使用`IS_CONST`, 因为得`++`, 下面是完整的第三个版本的`FOREACH`:

~~~
#include <boost/mpl/bool.hpp>
#include <boost/range/end.hpp>
#include <boost/range/begin.hpp>
bool set_false(bool& _continue) {
       _continue = false;
       return false;
}
struct auto_any_base {
       operator bool() const { return false; }
};
template<typename T>
struct auto_any : public auto_any_base {
       auto_any(const T & t) : item(t) {}
       mutable T item;
};
template<typename T, typename IS_CONST = boost::mpl::false_>
struct type2type : boost::mpl::if_<IS_CONST, T const, T> { };

template<typename T> inline type2type<T, boost::mpl::false_>*
encode_type(T &, boost::mpl::false_ *) { return  0; }

template<typename T> inline type2type<T, boost::mpl::true_>*
encode_type(T const &, boost::mpl::true_*) { return 0; }

template<typename T, typename IS_CONST>
inline typename boost::mpl::if_<IS_CONST, T const, T>::type&
auto_any_cast(const auto_any_base& a) {
       return static_cast<const auto_any<T>&>(a).item;
}

template<typename T, typename IS_CONST = boost::mpl::false_>
struct foreach_iterator {
       typedef typename boost::mpl::if_<
              IS_CONST,
              typename T::const_iterator,
              typename T::iterator>::type type;
};

template<typename T>
inline boost::mpl::false_* is_const_(T&) { return 0; }

template<typename T>
inline boost::mpl::true_ *is_const_(T const &) { return 0; }

template<typename T>
inline boost::mpl::false_* is_rvalue(T &, int) { return 0; }

template<typename T>
inline boost::mpl::true_* is_rvalue(T const &, ...) { return 0; }

template<typename T>
inline auto_any<T> contain(T const &t, boost::mpl::true_ *) { // rvalue
       return t;
}

template<typename T>
inline auto_any<T *> contain(T &t, boost::mpl::false_ *) { // lvalue
       return boost::addressof(t);
}

template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type>
begin(const auto_any_base& container, type2type<T, IS_CONST>*,  boost::mpl::false_*) { // lvalue
       return boost::begin(*auto_any_cast<T*, IS_CONST>(container));
}

template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type>
begin(const auto_any_base& container, type2type<T, IS_CONST>*, boost::mpl::true_*)  { // rvalue
       return boost::begin(auto_any_cast<T, IS_CONST>(container));
}

template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type>
end(const auto_any_base& container, type2type<T, IS_CONST>*, boost::mpl::false_*)  { // lvalue
       return boost::end(*auto_any_cast<T*, IS_CONST>(container));
}

template<typename T, typename IS_CONST>
inline auto_any<typename foreach_iterator<T, IS_CONST>::type>
end(const auto_any_base& container, type2type<T, IS_CONST>*, boost::mpl::true_*) {  // rvalue
       return boost::end(auto_any_cast<T, IS_CONST>(container));
}

template<typename T, typename IS_CONST>
inline void next(const auto_any_base& iter, type2type<T, IS_CONST>*) {
       typedef typename foreach_iterator<T, IS_CONST>::type iter_t;
       ++auto_any_cast<iter_t, boost::mpl::false_>(iter);
}

template<typename T, typename IS_CONST>
inline bool done(const auto_any_base& cur, const auto_any_base& end, type2type<T,  IS_CONST>*) {
       typedef typename foreach_iterator<T, IS_CONST>::type iter_t;
       return (auto_any_cast<iter_t, IS_CONST>(cur) ==
                  auto_any_cast<iter_t, IS_CONST>(end));
}

template<typename T, typename IS_CONST>
inline typename std::iterator_traits<typename foreach_iterator<T,  IS_CONST>::type>::reference
deref(const auto_any_base& cur, type2type<T, IS_CONST>*) {
       typedef typename foreach_iterator<T, IS_CONST>::type iter_t;
       return *auto_any_cast<iter_t, IS_CONST>(cur);
}

#define ENCODED_TYPEOF(COL) (true ? 0 : encode_type(COL, is_const_(COL)))
#define FOREACH_IS_RVALUE(COL) (true ? 0 : is_rvalue(COL, 0))
#define FOREACH_EVALUATE(COL) (COL)
#define FOREACH_CONTAIN(COL) contain(FOREACH_EVALUATE(COL) ,  FOREACH_IS_RVALUE(COL))
#define FOREACH_BEGIN(COL) begin(_foreach_col, ENCODED_TYPEOF(COL),  FOREACH_IS_RVALUE(COL))
#define FOREACH_END(COL) end(_foreach_col, ENCODED_TYPEOF(COL),  FOREACH_IS_RVALUE(COL))
#define FOREACH_NEXT(COL) next(_foreach_begin, ENCODED_TYPEOF(COL))
#define FOREACH_DONE(COL) done(_foreach_begin, _foreach_end, ENCODED_TYPEOF(COL))
#define FOREACH_DEREF(COL) deref(_foreach_begin, ENCODED_TYPEOF(COL))
#define FOREACH(VAL, COL) \
       if (const auto_any_base& _foreach_col = FOREACH_CONTAIN(COL)) {} else \
       if (const auto_any_base& _foreach_begin = FOREACH_BEGIN(COL)) {} else \
       if (const auto_any_base& _foreach_end = FOREACH_END(COL)) {} else \
       for (bool _continue = true; \
              _continue && !FOREACH_DONE(COL); \
              _continue ? FOREACH_NEXT(COL) : (void)0) \
                     if (set_false(_continue)) {} else \
                           for (VAL = FOREACH_DEREF(COL); !_continue; _continue =  true) \
~~~

## 总结

到这里, 我们算是完成了标准容器的FORECH了.  主要有几个重点:

- 使用`if...else...for`花样嵌套可以把`FOREACH`宏写得像"一个表达式";
- if表达式的括号内可以声明一个变量, 不过其bool转换需要细心考虑;
- 将一个临时变量绑定到常量引用上, 这个临时变量的生命会延长到与这个常量引用一致;
- 我们可以利用三目运算符类型推导规则来推导表达式的类型;
- C++98中的右值探测真的是黑魔法;

剩下的问题, 就是支持数组和C String(null terminate), 鉴于我们这篇博客已经很长了, 数组和C String的部分的各种指针问题也挺繁琐的, 这个坑我们有缘再填吧. 后面的篇章会先考虑`BOOST_FOREACH`的扩展和性能问题.


 
**Reference:**  

* {:.ref} \[1]  Eric Niebler. [Conditional Love: FOREACH Redux](https://www.artima.com/cppsource/foreach.html). Feb. 17, 2005.  
* {:.ref} \[2]  Herb Sutter. [GotW #88: A Candidate For the “Most Important const”](https://herbsutter.com/2008/01/01/gotw-88-a-candidate-for-the-most-important-const/). Jan. 1, 2008.  
* {:.ref} \[3]  Stack Overflow. [When to use addressof(x) instead of &x?](https://stackoverflow.com/questions/14820307/when-to-use-addressofx-instead-of-x)  
* {:.ref} \[4]  fanster28_. [boost foreach 探究](https://blog.csdn.net/fanster28_/article/details/6077682). Dec. 15, 2010  
* {:.ref} \[5]  夜雨_倚琴. [boost源码分析之 BOOST_FOREACH](https://blog.csdn.net/Lunar_lty/article/details/23966221). April. 18, 2014  




