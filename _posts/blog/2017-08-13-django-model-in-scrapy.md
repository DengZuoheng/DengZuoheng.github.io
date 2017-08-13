---
layout: post
title: 在scrapy中使用django model
description: scrapy还没有很好用的数据库抽象, django model比较简单, 熟悉的人也多, 正好一用.
category: blog
---

## scrapy_djangoitem

直接使用django项目中定义的model作为scrapy的item定义, 有scrapu插件`scrapy_djangoitem`\[1\]可以使用, 其使用如下:

~~~
# items.py
import scrapy
from scrapy_djangoitem import DjangoItem
import your_django_app

class SomeModelItem(DjangoItem):
    django_model = your_django_app.models.SomeModel
    # 这里也可以加其他field

~~~

注意这里需要import你的django的app, 所以需要在scrapy项目中的settings.py中处理好python path, 使得运行时可以import相应module.

## 在scrapy item pipeline中使用django.model存取数据

既然我们处理好python path 而且都import了django的app了, 那么下一步自然想在item中是用model去存数据了. 我们需要在scrapy的settings.py中初始化django:

~~~
import django

os.environ['DJANGO_SETTINGS_MODULE'] = 'your_django_app.settings'

django.setup()
~~~

其实这段代码跟django项目中的manage.py里的代码并没有什么区别, 主要目标就是设置django项目的settings.py的地址, 然后调用django.setup()

然后我们可以在pipelines.py中:

~~~
from your_crawler.items import *
import your_django_app

class YourCrawlerPipeline(object):
    def process_item(self, item, spider):
        if isinstance(item, SomeModelItem):
            obj, created = your_django_app.models.SomeModel.objects.get_or_create(some_attr = item['some_attr'])
            obj.other_attr = item['other_attr']
            proxy.save()
            return item

~~~   

相同的事情, 在spider或其他什么地方都能做到.


**Reference:**  


* {:.ref} \[1] https://github.com/scrapy-plugins/scrapy-djangoitem