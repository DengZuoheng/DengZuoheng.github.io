---
layout: post
title: VS包含目录中引用环境变量
description: VS包含目录中引用环境变量是 $(变量名) 而不是 %变量名%  
category: blog
---

跟小伙伴做基于opencv的项目, 说要配opencv的环境, 本着把整个工程文件夹扔github上的精神, 我们不能让每个小伙伴的工程包含目录都不同, 不然每次pull都发现工程配置被改了或冲突了. 所以, 我们得保持包含目录一致, 同时允许小伙伴把opencv放在不同的地方.

为此, 我们得先来个环境变量:

    OpenCV=C:\libs\opencv\opencv\build

然后给工程添加包含目录的时候, 就可以引用环境变量而不用关心OpenCV的安装位置了.

但是, 问题来了, 我们平时都是`%OpenCV%`这样用环境变量的, 但是这样写到包含目录却不工作, 能编译生成, 却下划红线提示无法打开头文件. 经过"大胆的假设和严谨的实验", 发现, 应该这样用`$(OpenCV)`...

于是, 修改后的包含目录是这样的:

    <PropertyGroup Condition="'$(Configuration)|$(Platform)'=='Debug|Win32'">
        <IncludePath>$(OpenCV)\include\opencv;$(OpenCV)\include\opencv2;$(OpenCV)\include;$(IncludePath)</IncludePath>
    </PropertyGroup>

这样, 即使用github同步给小伙伴, 也不会有大问题了.