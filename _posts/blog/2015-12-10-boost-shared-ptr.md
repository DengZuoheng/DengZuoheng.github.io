---
layout: post
title: boost智能指针之shared_ptr
description: let's 探讨一下boost家的shared_ptr到底有多少使用姿势. 
category: blog
---

我就假设你已经知道shared_ptr是干什么用的了

## 构造shared_ptr
首先, 你得`#include<boost/smart_ptr.hpp>`

然后, 但我们需要new一个对象的时候, 我们可以这样:

	int* p = new int(233);
	boost::shared_ptr<int> sp(p);
	//然后就不能再delete p了, 否则重复释放

当然我们可以构造一个空的`shared_ptr`:

	boost::shared_ptr<int> sp;
	assert(!sp);

我们还可以reset一个`shared_ptr`:

	boost::shared_ptr<int> sp;
	assert(!sp);
	int* p = new int(233);
	sp.reset(p);
	assert(sp);
	assert(233 == *sp);

还能管理void型指针:

	boost::shared_ptr<void> sp(new int(233));
	//写个死循环验证一下内存是不是真没泄露

从boost1.5.3开始, 甚至能直接用来管理数组:

	size_t n = 2;
	boost::shared_ptr<int[]> p1(new int[n]);
	boost::shared_ptr<int[233]> p2(new int[233]);
	boost::shared_ptr<int[233]> p3(new int[233]);
	assert(typeid(p2) == typeid(p3));
	assert(typeid(p1) != typeid(p2));//他们是不同的类型
	//p2 = p1;//boost::shared_ptr<int[]>不能转换成boost::shared_ptr<int[233]>
	p1 = p3;//但是boost::shared_ptr<int[233]>能转换
	p3 = p2;

当然, 因为没有重载`operator[]`, 所以感觉还是用`shared_array`比较好.

那我能否用`shared_ptr`来管理malloc出来的内存?

	int* p = (int*)malloc(233 * sizeof(int));
	boost::shared_ptr<int[]> p1(p);
	//跑起来似乎没问题, 但这确实是undefined behavior
	//因为delete会调用析构函数, 而malloc出来的内存不一定有相应的初始化
	//那就相当于在一块无效内存中调用析构函数

`shared_ptr`内部用的是`delete`和`delete[]`, 所以还是应该与`new`成对使用.

如果真的不想见到new, boost有`make_shared`和`allocate_shared`, 前者用new, 后者可用户定义allocator.

事实上, 使用`make_shared`能提高`shared_ptr`的性能, 因为这样能一次分配智能指针管理块与所管理的对象的内存.

用起来像这样:

	boost::shared_ptr<std::string> x = boost::make_shared<std::string>("hello, world!");

如果支持C++11, `make_shared`使用变长参数模板, 可支持任意多的参数而且完美转发, 如果没有C++11, 则最多提供10个参数. 如需传递应用. 可使用`boost::ref`.

对于`allocate_shared`, 除第一个参数得是allocator外, 其他与`make_shared`是一样的.

如果分配不到内存, 会抛出`bad_alloc`(or some thing like this)而不是返回空智能指针.

## 防止可能的泄露

不是说有了`shared_ptr`就告别内存泄露了, 不正确的用法照样可能造成泄露, 比如, 匿名的`shared_ptr`对象. boost文档中有一例子:

	void f(shared_ptr<int>, int);
	int g();
	
	void ok()
	{
	    shared_ptr<int> p( new int(2) );
	    f( p, g() );
	}
	
	void bad()
	{
	    f( shared_ptr<int>( new int(2) ), g() );
	}
	
对于bad的用法, 因为函数参数的表达式执行顺序不一定, 所以可能发生new了一个int, 然而没有继续初始化`shared_ptr`却去调用g(), 此时, 如果g抛异常了, 因为`shared_ptr`还没构造完, 当然不会正确管理内存. 于是泄露发生了.

为了解决这种问题, boost的最佳实践说: 永远使用具名的`shared_ptr`, 而且使用`make_shared`等工厂函数.

## 防止循环引用

我们来考虑一个场景, 我们有个Humen类, Humen类派生出了男性,女性和单身狗, 男性会有个wife, 女性会有个husband, 单身狗就不说了. 于是有:

	class Humen{};
	class Male:public Humen{
		boost::shared_ptr<Humen> _wife;
	};
	class Female:public Humen{
		boost::shared_ptr<Humen> _husband;
	};
	class SingleDog:public Humen{
	};

	
这会发生什么呢? 如果两个Humen对象互为夫妻, 他们将永垂不朽. 因为Male到了该析构的时候, 发现他的wife还引用着他, 于是不能析构, 他的wife该析构的时候, 发现他还引用着, 又不能析构. 于是, 只有单身狗能正常析构.

下面一个跟简单的例子可体会这种错误:

	class Human{
	public:
		Human(){};
		boost::shared_ptr<Human> _mate;
	};
	
	int main(){
		for (;;){
			boost::shared_ptr<Human> _male = boost::make_shared<Human>();
			boost::shared_ptr<Human> _female = boost::make_shared<Human>();
			_male->_mate = _female;
			_female->_mate = _male;
		}
	}

但我真需要一个mate怎么办? boost还有`weak_ptr`.

`wear_ptr`是一个弱化的`shared_ptr`, 它的存在不会阻碍析构, 而且可以从一个有效的`wear_ptr`中获取对应的`shared_ptr`. `weak_ptr`相当于一个旁观者, 它并不提供完整的指针操作, 如果你要使用其管理的对象, 必须取其`shared_ptr`.

将以上代码换成如下便可破解循环引用:

	class Human{
	public:
		Human(){};
		boost::weak_ptr<Human> _mate;
	};

## boost::weak_ptr
上面已经提到了`weak_ptr`, 可以看到, `weak_ptr`是为了配合`shared_ptr`而引入的一种智能指针, 它更像`shared_ptr`的一个助手而不是智能指针.

### weak_ptr类摘要

	template<class T> class weak_ptr {

    public:
      typedef T element_type;

      weak_ptr();//可以无参构造空的weak_ptr

      template<class Y> weak_ptr(shared_ptr<Y> const & r);//也可以用shared_ptr构造
	  /*这说明, 只能用shared_ptr构造weak_ptr, 不能指望在构造函数的时候构造出weak_ptr来
      weak_ptr(weak_ptr const & r);
      template<class Y> weak_ptr(weak_ptr<Y> const & r);

      ~weak_ptr();//析构, weak_ptr的析构也不会对引用对象产生什么影响

      weak_ptr & operator=(weak_ptr const & r);
      template<class Y> weak_ptr & operator=(weak_ptr<Y> const & r);
      template<class Y> weak_ptr & operator=(shared_ptr<Y> const & r);

      long use_count() const;//返回引用计数, weak_ptr的引用不会增加引用计数, 此函数通常仅用于测试和调试
      bool expired() const;//判断是否已经失效, 失效返回true; 比直接使用use_count()==0快
      shared_ptr<T> lock() const;//获取对应的shared_ptr, 如果是已经失效的, 会返回空的shared_ptr

      void reset();//重置
      void swap(weak_ptr<T> & b);//交换
	  };
	  //比较
	  template<class T, class U>
	    bool operator<(weak_ptr<T> const & a, weak_ptr<U> const & b);
	  //交换
	  template<class T>
	    void swap(weak_ptr<T> & a, weak_ptr<T> & b);
	}

## boost::shared_ptr类摘要

在讨论其他问题前, 我们是时候看看`shared_ptr`的类摘要以便了解`shared_ptr`本身有哪些接口(实际上, `shared_ptr`的摘要很长!):

	class bad_weak_ptr: public std::exception;
		template<class T> class weak_ptr;
		template<class T> class shared_ptr {
		public:
			typedef see below element_type;
			shared_ptr(); // 构造一个空的shared_ptr, 不抛异常
			shared_ptr(std::nullptr_t); // 构造一个空的shared_ptr, 不抛异常
			// Y* should be convertible to T*.
			template<class Y> explicit shared_ptr(Y * p);//p为new出来的指针或空指针, 如果构造出现异常, 则删除p
			template<class Y, class D> shared_ptr(Y * p, D d);//可定制删除器, 我们之后会讨论
			template<class Y, class D, class A> shared_ptr(Y * p, D d, A a);//自定义删除器与分配器
			template<class D> shared_ptr(std::nullptr_t p, D d);
			template<class D, class A> shared_ptr(std::nullptr_t p, D d, A a);

			~shared_ptr(); // never throws

			shared_ptr(shared_ptr const & r); // 复制构造函数
			template<class Y> shared_ptr(shared_ptr<Y> const & r); // never throws

			shared_ptr(shared_ptr && r); // 移动构造函数
			template<class Y> shared_ptr(shared_ptr<Y> && r); // never throws
			//constructs a shared_ptr that shares ownership with r and stores p. 我也不知道是什么
			template<class Y> shared_ptr(shared_ptr<Y> const & r, element_type * p); // never throws
			//从weak_ptr构造shared_ptr, 可能抛出bad_weak_ptr异常
			template<class Y> explicit shared_ptr(weak_ptr<Y> const & r);
			//从auto_ptr构造
			template<class Y> explicit shared_ptr(std::auto_ptr<Y> & r);
			template<class Y> shared_ptr(std::auto_ptr<Y> && r);
			//从std::unique_ptr移动构造
			template<class Y, class D> shared_ptr(std::unique_ptr<Y, D> && r);

			shared_ptr & operator=(shared_ptr const & r); // never throws
			template<class Y> shared_ptr & operator=(shared_ptr<Y> const & r); // never throws

			shared_ptr & operator=(shared_ptr const && r); // never throws
			template<class Y> shared_ptr & operator=(shared_ptr<Y> const && r); // never throws

			template<class Y> shared_ptr & operator=(std::auto_ptr<Y> & r);
			template<class Y> shared_ptr & operator=(std::auto_ptr<Y> && r);

			template<class Y, class D> shared_ptr & operator=(std::unique_ptr<Y, D> && r);

			shared_ptr & operator=(std::nullptr_t); // never throws
			//重置
			void reset(); // 停止shared_ptr的使用
			template<class Y> void reset(Y * p);//等价于交换
			template<class Y, class D> void reset(Y * p, D d);
			template<class Y, class D, class A> void reset(Y * p, D d, A a);

			template<class Y> void reset(shared_ptr<Y> const & r, element_type * p); // never throws

			T & operator*() const; // never throws; only valid when T is not an array type
			T * operator->() const; // never throws; only valid when T is not an array type

			element_type & operator[](std::ptrdiff_t i) const; // never throws; only valid when T is an array type

			element_type * get() const; // never throws

			bool unique() const; // 判断引用计数是否为1
			long use_count() const; // 返回引用计数

			explicit operator bool() const; // never throws

			void swap(shared_ptr & b); // never throws
			//相当于operator<
			template<class Y> bool owner_before(shared_ptr<Y> const & rhs) const; // never throws
			template<class Y> bool owner_before(weak_ptr<Y> const & rhs) const; // never throws
	};
	
	  template<class T, class U> bool operator==(shared_ptr<T> const & a, shared_ptr<U> const & b); // never throws
	  template<class T, class U> bool operator!=(shared_ptr<T> const & a, shared_ptr<U> const & b); // never throws
	  //反正是保证了C++标准的严格偏序	  
	  template<class T, class U> bool operator<(shared_ptr<T> const & a, shared_ptr<U> const & b); // never throws
	  template<class T> bool operator==(shared_ptr<T> const & p, std::nullptr_t); // never throws
	  template<class T> bool operator==(std::nullptr_t, shared_ptr<T> const & p); // never throws
	  template<class T> bool operator!=(shared_ptr<T> const & p, std::nullptr_t); // never throws
	  template<class T> bool operator!=(std::nullptr_t, shared_ptr<T> const & p); // never throws
	  template<class T> void swap(shared_ptr<T> & a, shared_ptr<T> & b); // never throws
	  //相当于p.get()
	  template<class T> typename shared_ptr<T>::element_type * get_pointer(shared_ptr<T> const & p); // never throws
	  template<class T, class U> shared_ptr<T> static_pointer_cast(shared_ptr<U> const & r); // never throws
	  template<class T, class U> shared_ptr<T> const_pointer_cast(shared_ptr<U> const & r); // never throws
	  template<class T, class U> shared_ptr<T> dynamic_pointer_cast(shared_ptr<U> const & r); // never throws
	  template<class T, class U> shared_ptr<T> reinterpet_pointer_cast(shared_ptr<U> const & r); // never throws
	  template<class E, class T, class Y> std::basic_ostream<E, T> & operator<< (std::basic_ostream<E, T> & os, shared_ptr<Y> const & p);
	  template<class D, class T> D * get_deleter(shared_ptr<T> const & p);
	}

## aliasing constructor

看类摘要的时候, 我们看待了一个:

	template <class Y>
	shared_ptr (const shared_ptr<Y>& r, T* p);

名为aliasing constructor的奇怪构造函数, 这个构造函数使得我们使用r的计数, 却指向p, 但是, 这样构造的`shared_ptr`不会删除p, 但是按照原来的计划来删除r.

我们先试一下是不是真的这么删法:

	int* p = new int(233);
	int* q = new int(666);
	boost::shared_ptr<int> r(p);
	boost::shared_ptr<int> s(r, q);
	assert(r.use_count() == 2);
	assert(*r == 233);
	assert(*s == 666);
	//q的内存泄露了
	//delete q;

这可以用来干嘛?

其中一种场合是, 我有一个类, 而且也经常用`shared_ptr`来管理这个类的实例, 但是这个类有一个指针成员(没有被智能指针管理), 而我又想跟别人shared一下这个成员, 于是, 就可以这样[5]:

	truct A
	{
	  int *B; // managed inside A
	};
	
	shared_ptr<A>   a( new A );
	shared_ptr<int> b( a, a->B );

另一种场合是智能指针转换, 比如`dynamic_pointer_cast`, 这个我们待会就会谈到.

## 指针转换

我有一个`Human*`, 想转成`Male*`来用, 怎么办?

以前, 如果Human至少有一个虚函数, 我们可以用`dynamic_cast`来进行转换, 如果成功, 我们会得到一个指向Male对象的指针, 如果失败, 我们会得到一个0. 

然而对智能指针, 我们不能干出下面这种事来:

	p = dynamic_cast<Male*>(sp.get());
    sp2 = boost::shared_ptr<Male>(p);

因为这样会导致引用计数失效, 对象不再被正确管理, 那怎么办呢?

刚刚我们讨论的aliasing constructor可以帮到我们, 比如这样:

	p = dynamic_cast<Male*>(sp.get());
	sp2 = boost::shared_ptr<Male>(sp,p);

于是我们就继续使用sp的计数, p的指针.

事实上, boost提供了`dynamic_pointer_cast`, 其实现就是这么干的(以下源码):

	template<class T, class U> shared_ptr<T> dynamic_pointer_cast( shared_ptr<U> const & r ) BOOST_NOEXCEPT
	{
	    (void) dynamic_cast< T* >( static_cast< U* >( 0 ) );//保证T*和U*是能够转换的
		
	    typedef typename shared_ptr<T>::element_type E;//为什么用E呢, 因为之前不知道做过多少转换了, 这样也保证E确实是一个typename, 而不是别的东西
	
	    E * p = dynamic_cast< E* >( r.get() );
	    return p? shared_ptr<T>( r, p ): shared_ptr<T>();
	}

于是, 我们可以这么用:

	sp2 = boost::dynamic_pointer_cast<Male>(sp);

同理, 还有:

	shared_ptr<T> boost::static_pointer_cast<T>( shared_ptr<U> const & r )
	shared_ptr<T> boost::const_pointer_cast<T>( shared_ptr<U> const & r )
	shared_ptr<T> boost::reinterpret_pointer_cast<T>( shared_ptr<U> const & r )

表现也与C++的`static_cast`, `const_cast`, `reinterpret_cast`一致.

##share from this, 获得this的shared_ptr

也许某些时候, 我们需要把指向自己的`shared_ptr`给别人, 但是我们却不能直接返回一个`shared_ptr<T>(this)`, 因为这样计数不一定正确, 虽然对于堆内存的对象, delete this是允许的[6].

既然我们有了`weak_ptr`, 我们能否构造出更安全的方法获得this的`shared_ptr`, 答案当然TMD是肯定的啦.

我们可以在类成员中保存一个`weak_ptr`, 需要的时候调用`lock()`函数, 返回一个`shared_ptr`. 这种解决方案被boost实现为一个助手基类, 名为`enable_shared_from_this<T>`, 摘要如下:

	namespace boost
	{
	
	template<class T> class enable_shared_from_this
	{
	public:
	
	    shared_ptr<T> shared_from_this();
	    shared_ptr<T const> shared_from_this() const;
	
	    weak_ptr<T> weak_from_this() noexcept;
	    weak_ptr<T const> weak_from_this() const noexcept;
	}
	
	} 

简单地说, `shared_from_this`返回`shared_ptr`,`weak_from_this`返回`weak_ptr`, 下面代码可以体会一下用法:

	class Example :public boost::enable_shared_from_this < Example >{
	public:
		int x;
		Example() :x(233){}
		Example(int _x) :x(_x){}
	};
	
	int main(){
		for (;;){
			boost::shared_ptr<Example> sp = boost::make_shared<Example>(666);
			assert(sp->x == 666);
			boost::shared_ptr<Example> p = sp->shared_from_this();
			assert(p.use_count() == 2);
			assert(p->x == 666);
	
		}
	}

当然, 只能对堆内存的对象这么玩法, 栈内存的对象这么玩会发生未定义行为. 

`enable_shared_from_this`对象内部保存了一个`weak_ptr`, 这个`weak_ptr`在`shared_ptr`创建的时候被赋值, 所以, `shared_from_this`只能在你创建了一个该对象的`shared_ptr`后才能使用. 具体实现我们可以在分析`shared_ptr`源码的时候再探讨.

## 线程安全性

`shared_ptr`的引用计数本身是安全且无锁的, 但对象的读写不是, 因为`shared_ptr`有两个数据成员, 读写操作不能原子化[7]. 多线程读写`shared_ptr`需要加锁.

	//等我写完boost并发编程再来举线程安全的例子.

## shared_ptr与标准库容器
对于`std::vector`, `std::list`, `std::deque`, 我们都可以认为能愉快地使用`shared_ptr`. 但是, 对`std::set`, `std::map`, `std::unordered_map`我们就得考虑一下了.

我们讨论类摘要的时候, 提到, `shared_ptr`提供了严格偏序的`operator<`, 所以`shared_ptr`放在`std::set`和`std::map`中也是可以的, 而且, 实验可知, `shared_ptr`是按照指针的地址来排序的. 比如:

	#include <boost/smart_ptr.hpp>
	#include <set>
	#include <iostream>
	
	int main()
	{
		boost::shared_ptr<int> p0(new int(0));
		boost::shared_ptr<int> p3(new int(3));
		boost::shared_ptr<int> p5(new int(5));
		boost::shared_ptr<int> p9(new int(9));
		boost::shared_ptr<int> p1(new int(1));
		boost::shared_ptr<int> p8(new int(8));
		boost::shared_ptr<int> p4(new int(4));
		boost::shared_ptr<int> p2(new int(2));
		boost::shared_ptr<int> p6(new int(6));
		boost::shared_ptr<int> p7(new int(7));
		std::set<boost::shared_ptr<int>> s;
		s.insert(p1);
		s.insert(p9);
		s.insert(p2);
		s.insert(p8);
		s.insert(p3);
		s.insert(p7);
		s.insert(p4);
		s.insert(p6);
		s.insert(p5);
		s.insert(p0);
		for (std::set<boost::shared_ptr<int>>::iterator it = s.begin(); 
			it != s.end(); ++it){
			std::cout << **it << std::endl;
		}
	
	}

对于`unordered_map`, 事情就复杂一些了, 如果boost版本小于1.46, 默认的`hash_value`是`shared_ptr`转换的bool值, 这会使得`unordered_map`退化成链表[8], boost1.47修复了这个问题[8].

我们可以试一下1.58会怎么样:

	#include <boost/functional/hash.hpp>
	std::cout << boost::hash<boost::shared_ptr<int>>()(sp) << std::endl;

于是, `unordered_map`也能愉快地使用了. 参考文献[8]中指出的`std::shared_ptr`问题, 似乎已经解决了.

## 与std::shared_ptr兼容性

并没有什么很好的方法使得`boost::shared_ptr`与`std::shared_ptr`相互转换, 所以, 我的想法是二者取其一(因为他们的行为应该是完全一致的), 当你的项目中已经有大量的`boost::shared_ptr`(而且还都是带着boost命名空间的), 那就继续使用boost, 如果是新项目, 则可以考虑使用`std::shared_ptr`, 因为`std::shared_ptr`作为标准的一部分, debugger对其的支持应该会好一些[9].

## 定制删除器与分配器

我们查看shared_ptr类摘要的时候, 可以看到一个特别的构造函数, 形如:

	shared_ptr(Y* p, D d);

第一个参数是要被管理的指针, 与其它形式的构造函数一致; 第二个参数称为删除器, 他是一个接受Y*的可调用物, d(p)的行为应类似与`delete p`, 而且不应该抛出异常. 

d可以是函数, 函数对象 lambda表达式, 但必须可拷贝. 此外, boost提供了一个自由函数`get_deleter(shared_ptr<T>const & p)`, 它能够返回删除器的指针.[10]

	boost::shared_ptr<int> sp(new int(233), [](int* p)->void{
			delete p;
			//std::cout << "our deleter called!" << std::endl;
		});

有了删除器, 我们就可以管理一些更复杂的资源, 比如数据库连接, socket连接什么的.

但是! 删除器与make_shared不可兼得, 因为make_shared不支持此参数.

基于shared_ptr<void>和定制删除器, 我们可以写出类似`退出作用域时回调`的代码来, 比如[10]:

	int main()
	{
		boost::shared_ptr<void> p((void*)0,[](void* p)->void{
			std::cout<<"this will call when scope end"<<std::endl;
		});
		return 0;
	}

或者更C++11一些:

	boost::shared_ptr<nullptr_t> p(nullptr, [](nullptr_t p)->void{
		std::cout << "this will call when scope end" << std::endl;
	});

至于分配器, boost文档指出分配器需要符合C++ allocator的标准:

> A must be an Allocator, as described in section 20.1.5 (Allocator requirements) of the C++ Standard

然而`C++ concepts: Allocator`[11]有点复杂, 这里暂不举例.

**Reference:**  
\[1]: http://www.boost.org/doc/libs/1_59_0/libs/smart_ptr/make_shared.html  
\[2]: http://www.boost.org/doc/libs/1_57_0/libs/smart_ptr/shared_ptr.htm  
\[3]: http://www.boost.org/doc/libs/1_57_0/libs/smart_ptr/weak_ptr.htm  
\[4]: Boris Kolpackov. shared_ptr aliasing constructor. web: http://www.codesynthesis.com/~boris/blog/2012/04/25/shared-ptr-aliasing-constructor/  
\[5]: http://stackoverflow.com/questions/1403465/what-is-boosts-shared-ptrshared-ptry-const-r-t-p-used-for  
\[6]: http://stackoverflow.com/questions/3150942/c-delete-this  
\[7]: 陈硕. 为什么多线程读写 shared_ptr 要加锁？. web: http://blog.csdn.net/solstice/article/details/8547547  
\[8]: http://stackoverflow.com/questions/6404765/c-shared-ptr-as-unordered-sets-key/12122314#12122314  
\[9]: http://stackoverflow.com/questions/6322245/should-i-switch-from-using-boostshared-ptr-to-stdshared-ptr  
\[10]: 罗剑锋. Boost程序库完全开发指南: 深入C++"准"标准库. 第2版. 北京:电子工业出版社. p72-p83  
\[11]: cppreference. C++ concepts: Allocator. web: http://en.cppreference.com/w/cpp/concept/Allocator