---
layout: post
title: 谷歌高级搜索--关键词与URL语法
description: 简述一些谷歌的搜索语法以及如何通过设定URL参数达成高级搜索的功能.
category: note
---

## 目标

尽量用键盘完成搜索条件的设定, 比如在那个网站搜索, 返回中文结果(因为我默认设置结果为英文, 然而英语渣, 故有时需要让结果为中文), 筛选结果的时间段等等.

## 注意事项

方便起见, 假设读者知道URL是什么, 知道URL怎么带参数, 知道"google advance search"是什么, 能正常访问谷歌搜索.

一下内容主要针对谷歌搜索, 其他搜索引擎也许有类似功能, 可自行挖掘.

这里使用shell风格的变量命名和注释风格, $开头的就是个名字而已.

## 关键词语法

### 表示在指定域名下搜索

     $keyword site:domain_name
     #常用于某些网站自带搜索很蠢萌情况, 比如搜索知乎: 诗云 site:zhihu.com

### 排除指定关键词

     $keyword -$keyword_you_do_not_want
     #比如: 维基百科 -百度

### 精确匹配

     "$exact $keyword"

### 范围

     $begin..$end
     #可以带单位, 不过我没试过

### 文件类型

     $keyword filetype:$filetype
     #或者 
     $keyword ext:$filetype
     #比如 filetype:pdf 等价于 ext:pdf

### 或

     $keyword1 OR $keyword2

### 通配符*

     $ke*ord

### 指定域名的cache

     $keyword cache:$domain_name

### 近义词

     $keyword ~$nearly

### 搜索网页中含有某链接的结果

     $keyword link:$domain_name
     #比如搜索：link:http://baidu.com，则结果为包含百度这个链接的页面。

### 搜索标题内包含关键词的结果

     intitle:$keyword
     #例如 intitle:古文观止mobi site:pan.baidu.com

### 搜索网站地址中包含关键词的结果

      inurl:$keyword

### 搜索相关网站

      related:$site_url

### 突破网站入口下载
    index of 可以突破网站入口下载，例如搜索：孤独患者 index of/mp3

## URL语法

用法:

    https://www.google.com/search?q=keyword&as_eq=xxx


### 搜索查询

    q=$keyword
    #或者
    as_q=$keyword

### 排除  

    as_eq=$k1+$k2+$k3
    #排除$k1,$k2,$k3

### 只包含指定国家的结果

    cr=$countryName
    #例如 cr=countryCN

### 指定结果显示语言

    hl=$langTag
    #指定显示语言, 这个最好不好改, 因为这个会保持

### 只包含指定语言的结果

    lr=$langTag
    #例如 lr=lang_zh-CN 只搜索中文网页
    #lr的常用值:
    #    + lang_zh-CN 中文简体
    #    + lang_zh-TW 中文繁体
    #    + lang_en 英语
    #    + lang_ja 日语

### 搜索词组, 精确匹配

    as_epq=$k1+$k2
    #相当于搜索框语法中"$k1 $k2"

### 指定文件类型

    as_ft=[i,e]
    #如果as_ft=i 则包含as_filetype指定的文件类型,
    #如果as_ft=e 则排除as_filetype指定的文件类型
    as_filetype=$filetype #指定搜索的文件类型

### 指定时间

    as_qdr=[all,y$n,m$n,w$n,d$n,h$n]
    #all表示所有结果,$n表示数字, 比如:
    #    + m3表示过去3个月,
    #    + m6表示过去六个月,
    #    + y表示过去1年,
    #    + d表示天,
    #    + w表示周
    #可用于新闻搜索, 比如近几天github又被墙了, 直接搜索"github被墙"会有很多陈年旧事
    #用as_qdr=w则只返回近一周的结果

### 数值范围 

    as_nlo=$num1&as_nhi=$num2 
    #查找$num1和$num2 之间的数

### 或语义

    as_oq=$k1+$k2+$k3 
    #词的列表, 相当于 OR
    #例: as_oq=apple+google+facebook 

### 关键词搜索位置

    as_occt=[any,title,body,url,links] 
    #指定在哪里查找关键词, 可取值为
    #   + any:任何地方,
    #   + title,
    #   + body,
    #   + url,
    #   + links=在网页链接内
    #比如 as_occt=title, 相当于搜索框语法中的`intitle:`

### 指定域名下搜索

    as_dt=[i,e]  
    #i表示包含指定域, e表示不包含指定域, 这个指定域由as_sitesearch
    as_sitesearch 
    #指定搜索域名

### 安全搜索

    safe=[active,off,images] 
    #active表示启用安全搜索, off表示禁用安全搜索, images应该是尽量

### 查找类似页面

    as_rq as_rq=$URL 
    #查找与$URL类似的页面

### 查找链接到$URL的页面 

    as_lq=$URL

### 用特殊的使用权限(政府, 商业, 非商业等)定位页面

    right=cc_*


辅助字符:

    %20 空格
    %22 双引号
    %2B 加号


**reference**  

* {:.ref} \[1]: (美) Johnny Long等. Google Hacking技术手册. 2009. 机械工业出版社. CP1~CP2  