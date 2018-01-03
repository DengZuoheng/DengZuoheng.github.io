---
layout: post
title: C++不可继承类
description: 在不使用final的情况下实现不可继承类, 虽然不是很可移植, 但很多情况下都能用
category: blog
---

只要继承boost::noninheritable就好, 当然, boost的命名空间是我随便弄的. 

~~~
#include <iostream>
using namespace std;
namespace etude{
    namespace _noninheritable{
        class noninheritable_base{
        protected:
            noninheritable_base(){}//不可以使用default, 不然不可继承性就失效了
            ~noninheritable_base(){}
        };
        class noninheritable :public virtual noninheritable_base{
        protected:
            noninheritable(){}
            ~noninheritable(){}
        };
    };
    typedef _noninheritable::noninheritable noninheritable;
#define ETUDE_FINAL private etude::noninheritable
};

class Example: private etude::noninheritable{
public:
    Example(){
        cout<<"Example construct"<<endl;
    }
    Example(const Example& b){
        cout << "Example copy construct" << endl;
    }
};

class BJJ :public Example{
    int i;
};

int main(){
    Example b1;
    Example b2(b1);
    BJJ bj;
    return 0;
}
~~~

基本原理是私有继承改变了基类成员的保护级别, 所以对BJJ而言noninheritable_base和noninheritable的构造析构都是私有的, 但是没关系, 
因为一层一层地调用的话, 这种保护级别影响不了BJJ, 所以, noninheritable需要虚拟继承noninheritable_base, 将noninheritable_base的构造责任推给BJJ, 
于是BJJ就需要访问noninheritable_base的构造函数, 于是因为私有而无法访问, 编译错误.

然而, 因为私有继承的含义为"用...实现", 也就是说, 私有继承目标只是复用私有基类的代码, 而不是与私有基类有概念上的关系. 所以, 私有继承的不可继承类实现方式有失优雅.

参考文献[1]给出了另一种实现方式.

~~~
#include <iostream>
using namespace std;
namespace etude{
    template<typename T>
    class make_final{
    private:
        ~make_final(){
            cout << "make_final disc" << endl;
        }
        friend T;
    };
};

class Example:virtual public etude::make_final<Example>{
public:
    Example(){
        cout<<"Example construct"<<endl;
    }
    Example(const Example& b){
        cout << "Example copy construct" << endl;
    }
};

class BJJ :public Example{
    int i;
};

int main()
{
    BJJ bj;
    return 0;
}
~~~

基本原理是有缘关系的不可继承性, Example是make_final的友元, 而BJJ不是, 但是, 因为Example虚拟继承make_final, BJJ需要访问make_final的构造和析构函数, 
于是编译错误. 而make_final利用模板将Example变成了自己的友元.

注意, 这种方式在VS下不一定能引发编译错误. <del>CL的前端就是这么残</del>

**Reference:**  

* {:.ref} \[1]:  Amjad, Z. (2003). A non-inheritable class. [Blog] __CodeProject__. Available at: http://www.codeproject.com/Articles/4444/A-non-inheritable-class [Accessed 28 Dec. 2015].  