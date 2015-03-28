---
layout: post
title: C++不可继承类
description: 在不使用final的情况下实现不可继承类, 虽然不是很可移植, 但很多情况下都能用
category: note
---

只要继承boost::noninheritable就好, 当然, boost的命名空间是我随便弄的. 

<pre>
#include&lt;iostream&gt;

using namespace std;

namespace boost{
    namespace _noninheritable{
        class noninheritable_base
        {
        protected:
            noninheritable_base(){}//不可以使用default, 不然不可继承性就失效了
            ~noninheritable_base(){}
        };
        class noninheritable :public virtual noninheritable_base
        {
        protected:
            noninheritable(){}
            ~noninheritable(){}
        };
    };
    typedef _noninheritable::noninheritable noninheritable;
    

#define BOOST_FINAL private boost::noninheritable

};

class Bilibili : private boost::noninheritable
{
public:
    Bilibili(){
        cout &lt;&lt; "Bilibili construct" &lt;&lt; endl;
    }
};
/*
class BilibiliJJ :public Bilibili
{
public:
    //error:boost::_noninheritable::noninheritable_base::noninheritable_base()不可访问
    BilibiliJJ()
    {

    }
};
*/
</pre>