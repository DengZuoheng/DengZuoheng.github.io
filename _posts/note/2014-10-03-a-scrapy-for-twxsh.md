---
layout: post
title: Scrapy实现简单爬虫抓取旧站数据
description: 向老师索取数据库密码的过程总是比较漫长,不如写两天代码,使用python Scrapy框架实现一个爬虫自己把数据抓下来好了,操作记录和注意事项如下,需者自取
category: note
---

###1.准备工作
首先你得知道爬虫是怎么工作的,CSDN有篇[Python爬虫入门教程][1]写得还不错,我就是参考这篇编写的,因为院学生会的旧站用的是古(keng)典(die)的table布局,用正则表达式提取估计非常痛苦,所以看完基础教程后果断选择Scrapy框架.

为了使用Scrapy,首先你得安装Scrapy,博主参考上文中CSDN教程中的安装方法还算成功: 
 
1. 安装Python  
建议Python 2.7.X,因为Python3在各种库中支持情况都不太统一,另外建议安装32位,下面一些部件中可能没有64位,安装完后记得在环境变量中配置Python目录和Python\Script目录,然后在cmd中输入`python`,如果输出版本信息,说明环境变量配置成功.

2. 安装lxml  
到https://pypi.python.org/pypi/lxml/3.3.1选择对应版本安装即可

3. 安装setuptools  
https://pypi.python.org/packages/2.7/s/setuptools/

4. 安装Twisted  
http://twistedmatrix.com/trac/wiki/Downloads

4. 安装zope.interface  
https://pypi.python.org/pypi/zope.interface/4.1.0#downloads

5. 安装pyOpenSSL  
https://launchpad.net/pyopenssl

6. 安装win32py  
http://sourceforge.net/projects/pywin32/files/pywin32/Build%20219/

8. 安装Scrapy  
安装了上面这些部件,只需在cmd上执行`easy_install scrapy`即可,安装完成后执行`scrapy`检查,出现版本信息自然是安装成功了.

**上面的过程与Scrapy[官方文档][3]的安装指南有不同,官方安装指南安装的是pip,但是我安装pip后安装Scrapy总是出错,原因至今没找到,于是用了CSDN那篇教程的安装方法**

###2.抓取网页
Scrapy应该默认就是多线程的,所以抓取过程很快,Scrapy项目的建立和运行可参考官方文档,这里不赘述.
抓取过程中可能出现编码问题,网上找的\[1\]解决方案是在python\lib\site-packages下新建sitecustomize.py:
<pre>
import sys
sys.setdefaultencoding('utf-8')
#不行就设为gb3132试试呗
</pre>

接下来要正经地抓网页了,比如,要把旧站[新闻中心][5]的所有新闻链接抓下来,首先你得写一个爬虫:
<pre>
from scrapy.spider import Spider
from scrapy.selector import Selector 

class TwxshSpider4NewsURL(Spider):
    name="twxshspider4newsurl"
    allowed_domains=["http://eic.jnu.edu.cn/"]
    start_urls=[
        "http://eic.jnu.edu.cn/twxsh/channels/101.html",
        "http://eic.jnu.edu.cn/twxsh/channels/101_2.html",
        "http://eic.jnu.edu.cn/twxsh/channels/101_3.html",
        "http://eic.jnu.edu.cn/twxsh/channels/101_4.html"]

    def parse(self,response):
        sel=Selector(response)
        urls=sel.xpath('body/table[3]/tr[2]/td[1]/table[1]/tr[1]/td[3]/table[1]/tr[2]/td[1]/table/tr[1]/td[1]/a/@href')
        
        filename=response.url.split('/')[-1]
        f=open(filename,'wb')
        for url in urls:
            f.write('http://eic.jnu.edu.cn'+url.extract()+'\r\n')
        f.close

</pre>
这里的`start_urls`是我自己打开网页复制下来的,因为只有几页,再写一个爬虫抓的话效率就低了.

Scrapy自动对返回体调用你实现的`parse`方法来处理,要提取有用的信息就要在这里实现了.比如这里就用xpath选择器选择了body下的第3个table的第2个tr.....因为这网页就全是table,我也没办法,只能自己下载一个网页,整理好格式,一个一个table地数,然后找到对应的a标签提取其href属性.

xpath的用法可以找w3school的XML教程看看就好,知道它有与jQuery选择器相同甚至之上的表达能力就行了.

抓取到目标的url后,就可以根据这些url提取正文了.过程跟上面的差不多,就直接贴代码了,需要注意的地方后面会特别指出:
<pre>
# -*- coding: utf-8 -*- 
from scrapy.spider import Spider
from scrapy.selector import Selector
import re
import thread
import urllib2

import os
#读取要爬的URL
def read_urls(filename):
    lst=[]
    f=open(filename)
    while True:
        line=f.readline()
        if not line:
            break
        line=line.split('html')[0]+'html'
        lst.append(line)
    f.close()
    return lst
#下载图片
def downloadimg(url,out_put_path):
    socket=urllib2.urlopen(url)
    data=socket.read()
    with open(out_put_path,'wb') as jpg:
        jpg.write(data)
    socket.close()
#主爬虫
class TwxshSpider4NewsText(Spider):
    name="twxshspider4newstext"
    allowed_domains=["http://eic.jnu.edu.cn/"]
    start_urls=read_urls('newsurl.txt')

    def parse(self,response):
        #新建各种文件和文件夹
        new_dir_name=response.url.split('/')[-1].split('.html')[0]
        
        cur_path='newstext\\'
        new_path=os.path.join(cur_path,new_dir_name)
        if not os.path.isdir(new_path):
            os.makedirs(new_path)
        #新建图片文件夹,用于储存图片
        img_path=os.path.join(new_path,'images')
        os.makedirs(img_path)

        filename=cur_path+new_dir_name+"\\"+new_dir_name+'.txt'
        imgsrcs=cur_path+new_dir_name+"\\"+'src.txt'
       
        sel=Selector(response)
       
        #处理标题
        title=sel.xpath('body/table[3]/tr[2]/td[1]/table[1]/tr[1]/td[1]/text()').extract()[-1].strip()
        #处理日期
        s="来源：添加时间：".decode('utf-8')
        date=sel.xpath('body/table[3]/tr[2]/td[1]/table[1]/tr[3]/td[1]/text()').extract()[0].decode('utf-8').replace(s,"")
        #处理正文
        content=sel.xpath('body/table[3]/tr[2]/td[1]/table[1]/tr[5]/td[1]/*')
        #摘取图片链接
        srcs=content.css("img[src]")
        ff=open(filename,'wb')
        fi=open(imgsrcs,'wb')
       
        #写入文件
        for src in srcs:
            img_sel=Selector(text=src.extract(),type="html")
            imgurl="http://eic.jnu.edu.cn"+img_sel.xpath("//@src").extract()[0]
            fi.write(imgurl+'\r\n')
            try:
                out_put_path=img_path+'\\'+imgurl.split('/')[-1]
                thread.start_new_thread(downloadimg,(imgurl,out_put_path))
            except:
                pass
            
        fi.close()

        ff.write("title: "+title+'\r\n')
        ff.write("date: "+date+'\r\n')
        ff.write("content: \r\n")
        for text in content:
            ff.write(text.extract())
        
        ff.write('\r\n')
        ff.close()
       
</pre>
其中读取url是读取刚刚抓取到的url,我把他们写到同一个文件了.
<del>看到这里的xpath多折磨人了吧,旧站的开发者你出来,我保证不打死你- -</del>

###注意事项
####xpath
- `text()`只是用于标签中的纯文本提取,如果标签中还有其他标签,用`text()`提取出来的就是空白符之类的没用的东西,或者啥也没给你提取出来,如果要提取html文本,就用`div/*`或`div/node()`这样的方法,把这个div内的所有内容提取出来\[2\],如:
	<pre>
	response.xpath('//div[@id="main_content"]').extract()
	#提取结果:"<div id="main_content"><p>测试文本</p></div>"
	
	response.xpath('//div[@id="main_content"]/*').extract()
	#提取结果:"<p>测试文本</p>,某些情况也可能提取不完整
	
	response.xpath('//div[@id="main_content"]/node()').extract()
	#同上,但更保险
	</pre>

- Scrapy的xpath的节点序号是从1开始计数的,比如要提取第一个td元素,应该是`td[1]`

####css选择器
除了xpath外,Scrapy还提供CSS风格的选择器,于是可以像CSS和jQuery那样选择元素,对于结构明确的html文本用起来还是很爽的,[官方教程][7]和下面的例子可以感受一下:
<pre>
from scrapy import Selector
doc = """
    <div>
         <ul>
             <li id="theid" class="item-0"><a href="link1.html">first item</a></li>
             <li class="item-1"><a href="link2.html">second item</a></li>
             <li class="item-inactive"><a href="link3.html">third item</a></li>
             <li class="item-1"><a href="link4.html">fourth item</a></li>
             <li class="item-0"><a href="link5.html">fifth item</a></li>
        </ul>
     </div>
    """
sel = Selector(text=doc, type="html")
print(sel.css('#theid').extract())
print(sel.css('#theid::attr(class)').extract())
print(sel.css('a[href]').extract())
print(sel.css('a::text').extract())
</pre>

####中文字符串
- python源码中使用非ASCII字符的话需要在代码最前面加:
<pre>
# -*- coding: utf-8 -*- 
</pre>
否则无论注释还是字符串都不给用中文.

- 替换中文字符串的时候,最好将参与操作的字符串都转成utf-8,比如:
<pre>
s="来源：添加时间：".decode('utf-8')
date=sel.xpath('body/td[1]/text()').extract()[0].decode('utf-8').replace(s,"")
#把"来源：添加时间："删掉
</pre>

####下载图片
直接用urllib2模块的urlopen方法打开图片的URL,然后读出来,写到指定的文件中去就行了:
<pre>
import urllib2
#下载图片
def downloadimg(url,out_put_path):
    socket=urllib2.urlopen(url)
    data=socket.read()
    with open(out_put_path,'wb') as jpg:
        jpg.write(data)
    socket.close()
</pre>
配合多线程效果更佳:

<pre>
import thread
try:
    thread.start_new_thread(downloadimg,(imgurl,out_put_path))
except:
    pass
</pre>

###小结
到这里基本上是成功了,需要的就是建立好文件结构,把抓回来的数据存起来就好了,学生工作,活动之类的都可以用相同的方法写出来,最后的代码和抓取的数据都在我的github上,有兴趣的可以翻一翻:
https://github.com/DengZuoheng/pyspider4twxsh

**参考文献**  
\[1\] : [\[Python\]\[网络爬虫(12):爬虫框架Scrapy的第一个爬虫示例入门教程\]][4].请叫我旺海.CSDN.  
\[2\] : [scrapy中的提取正文的方法][6].网页采集.51CTO博客

[1]:http://blog.csdn.net/column/details/why-bug.html
[2]:https://pypi.python.org/pypi/lxml/3.3.1
[3]:http://scrapy-chs.readthedocs.org/zh_CN/latest/
[4]:http://blog.csdn.net/pleasecallmewhy/article/details/19642329
[5]:http://eic.jnu.edu.cn/twxsh/channels/101.html
[6]:http://webscrapy.blog.51cto.com/8343567/1543031
[7]:http://scrapy-chs.readthedocs.org/zh_CN/latest/topics/selectors.html




