---
layout: post
title: Django+jQuery的ajax
description: 用Django的时候怎么写ajax, 其实注意一下csrftoken就好了  
category: blog
---

首先你得有个js, 考虑用jQuery:
<pre>
$.ajax({
    url:"http://127.0.0.1:8000/RequestAjax/",
    data:{"data":some_data},
    async:true,
    dataType:"json",
    type:"POST",
    success:function(result){
        //do something

    }
});
</pre>
因为GET方法对数据长度有限制, 而我对这种限制有挺重的心理阴影, 所以, 我的话, 都会用POST方法的.

但是, 这样写Django会拒绝, 403, 所以, 还需要其他操作, 搜索过后, 别人说, 你需要带上cookie, 不过, 这也是有js框架帮你做的, 就是jquery.cookie.js, 官网: http://plugins.jquery.com/cookie/

有了jquery.cookie, 你就可以在上面那段代码前面加上:
<pre>
var csrftoken = $.cookie('csrftoken');
function csrfSafeMethod(method) {
    // these HTTP methods do not require CSRF protection
    return (/^(GET|HEAD|OPTIONS|TRACE)$/.test(method));
}

$.ajaxSetup({
    beforeSend: function(xhr, settings) {
        if (!csrfSafeMethod(settings.type) && !this.crossDomain) {
            xhr.setRequestHeader("X-CSRFToken", csrftoken);
        }
    }
});
</pre>
这样, js端基本算完成了.

后台呢, 渲染页面的时候你就得让他设置cookie, 所以, 你需要:
<pre>
#views.py那里
from django.template import RequestContext
def some(request):
    return render_to_response('some.html',context_instance=RequestContext(request))
</pre>
响应`/RequestAjax/`的view你就照常从request.POST字典那里读取数据就好了, 不过一个json对象传过来不知道怎么解释, 所以, 我通常都是在js那把对象序列化成字符串(用JSON.stringify, 比如str=JSON.stringify(data)就把data序列化成字符串赋给str), 然后传字符串到view, 再用python标准库的json库解析成json.

然后, 又将返回的对象序列化成字符串作为HttpResponse的参数, 当然, Django也是有json response什么的, 看需要用吧.

需要注意的几点, 第一, 需要带上csrftoken的cookie; 第二, url要写全; 第三, 给服务器发数据的话, 把对象序列化成字符串.

**Reference:**  

* {:.ref} \[1] : [javascript - django ajax post 403 forbidden - Stack Overflow](http://stackoverflow.com/questions/13035412/django-ajax-post-403-forbidden)  
* {:.ref} \[2] : [Django jquery ajax 403 error - Stack Overflow](http://stackoverflow.com/questions/7646781/django-jquery-ajax-403-error)  
* {:.ref} \[3] : [jquery - 403 Forbidden error when making an ajax Post request in Django framework - Stack Overflow](http://stackoverflow.com/questions/19333098/403-forbidden-error-when-making-an-ajax-post-request-in-django-framework)  



