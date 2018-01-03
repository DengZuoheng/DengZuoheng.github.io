---
layout: post
title: Total Commamder常用命令与使用方法
description: 简记一些TC的用法,方便复习
category: blog
---

其实几乎所有命令都可以重映射, 因为我习惯左手键盘右手鼠标, 所以很
多命令都映射到方便左手的键位了.比如回退映射到Esc, 全不选映射到
`Ctrl+~`

## 文件

- 新建文件:shift+F4
- 新建文件夹:F7
- 重命名:shift+F6(完了记得敲回车)
- 批量重命名:Ctrl+M
- 复制文件名:Alt+M+Y
- 复制文件名加路径:Alt+M+p
- 快速查看:Ctrl+Q
- 关闭快速查看:Ctrl+Q
- 快速筛选:输入字母(需设置),F2退出筛选
- 快速搜索:Ctrl+S(可用`*`做通配符,如`*.cpp`)
- 展开所有文件夹:Ctrl+B
- 收回展开:Ctrl+B
- 打开默认编辑器:F4
- 复制:F5
- 移动:F6
- 删除:F8
- 打开默认查看器:F3
- 打开桌面:Alt+C+O
- 复制文件名:Alt+M+Y(我的重定向:Alt+C)
- 复制文件名以及完整路径:Alt+M+P(我的重定向:Alt+Shift+C)
- 右键菜单: Appl, 或者选中文件长按右键, 或者"配置"->"选项"->"操作"->"鼠标选择模式"设置

## 选择

- 全选:Ctrl+A
- 全不选: Ctrl+小键盘-

## 标签

- 改变当前标签:Shift+F6
- 移动当前标签到另一视图:Ctrl+U
- 左右面板互换:Ctrl+Shift+U
- 将光标所指目录在左面板打开:Ctrl+Shift+↑(我的重映射:Shift+A)
- 将光标所指目录在右面板打开:Ctrl+Shift+→(我的重映射:Shift+S)
- 复制当前标签:ctrl+T
- 切换视图:Tab
- 切换标签:Ctrl+Tab
- 关闭当前标签:Ctrl+W 
- 关闭全部标签:Ctrl+Shift+W
- 返回根目录:Ctrl+\
- 打开标签收藏夹:Ctrl+D
- 刷新:F2
- 改变当前路径: 光标指向返回上级目录项,Shift+F6
- 获取当前路径: 同上, 此时路径会被选中, Ctrl+C可复制
- 获取当前路径: Ctrl+P会把当前路径打印到下面的命令行栏, 然后`→`可选中之

## 系统

- 在当前路径打开cmd:Alt+C+D
- 执行命令行:→
- 展开命令行记录:Ctrl+↓或Alt+F8

## 压缩

- 压缩文件到另一标签的当前视图:Alt+F5
- 解压文件到另一标签的当前视图:Alt+F9
- 解压\压缩到当前文件夹:修改路径剩下`\`

## 设置打开方式

1. 下载安装[ChoiceEditor][1]
2. 把ChoiceEditor设置成默认编辑器
3. 然后就可以选择不同的编辑器了
4. ChoiceEditor目录下的ChoiceEditor.ini就是打开菜单的配置文件,
看起来像这样:

<pre>
#这就是个例子
[Options]
Language=0
CheckCursor=1
CheckKey=27
AlwaysChecked=1
[General]
DisplayName0=your editor name such as notepad++
Editor0=the path to notepad++.exe
Ext0=*
DisplayName1=Google Chrome
Editor1=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
Ext1=HTML

</pre>

可以根据自己的需要手动添加打开方式.

比如上面的配置就对所有文件都增加了notepad++和WinMerge的打开, 
因为这是我最常用的;

通常情况下ChoiceEditor能识别出系统的默认查看程序,但是偶尔也会抽风, 
故还是自己设置比较顺心.

## 备份设置 ##

设置一般存在`C:\Users\YOUR_USER_NAME\AppData\Roaming\GHISLER\`(我的win8.1), 
有插件的时候, 会有其他ini, 没有的话就只有WINCMD.INI, 
一般情况下搜索`wincmd.ini`就是它了; 我在github上的备份: 
[GHISLER](https://github.com/dengzuoheng/scripts/GHISLER)

## 插件安装 ##

参考:

- [高手之路: Total Commander之插件基础篇（上）](http://arch.pconline.com.cn//pcedu/tuijian/system/filemanage/0604/782779.html)  
- [高手之路：TC插件安装和管理详解（下）](http://arch.pconline.com.cn//pcedu/tuijian/system/filemanage/0604/784023.html)  
- [高手之路: TC插件详解—使用方法篇（中）](http://arch.pconline.com.cn//pcedu/tuijian/system/filemanage/0604/783177.html)  

简而言之, 下载某插件.zip或某杂件.rar, 然后在totalcommander中访问到
下载下来的目录, 然后enter你下载的某插件.zip, 
然后total commander会识别出插件, 然后提示是否安装.

安装之后可重启一下total commander, 对于lister插件, 你`ctrl+q`的
时候就会观察是否生效了, lister插件的配置可以在`ctrl+q`之后, 
另一边的面板中右键, 有可能打开该插件的配置. 

而文件系统类的插件, 比如注册表, 环境变量
之类的, 需要在`网上邻居`或者`网络`中访问.如果找不到`网络`在哪里, 
可以在`配置`中, `显示驱动器列表`(我一般是不显示的), 然后`网络`
应该就在驱动器列表里面. 找到之后, 可以`ctrl+d`添加到快捷列表, 然后
你又可以不显示驱动器列表了.

[官方的插件列表](http://www.ghisler.com/plugins.htm)中有许多不错的
插件, 其他地方也可以找到插件, 善用搜索引擎即可.

我比较喜欢的插件:

文件系统类:

- 注册表Registry
- 环境变量编辑器[envvar](http://totalcmd.net/plugring/envvar.html)
- 控制台[TConsole](http://totalcmd.net/plugring/tconsole.html)
- 开启启动列表[Startups](http://totalcmd.net/plugring/Startups.html)
- window service列表[Services2](http://totalcmd.net/plugring/Services2.html)

查看器类:

- 图片查看Imagine
- 多种文件查看器ulister(安装完记得看改插件的readme)
- 音频信息查看器[Audio Tag View](http://totalcmd.net/plugring/audiotagview.html): 默认会播放, 用这个替代掉觉得好多了
- 文件夹信息查看器[DirSizeCalc Charts](http://totalcmd.net/plugring/dirsizecalc_charts.html)
- SQLite查看器[SQLite Viewer](http://totalcmd.net/plugring/sqliteviewer.html)


[1]:http://www.totalcmd.net/plugring/ChoiceEditor_patched.html

**Reference:**  

* {:.ref} \[1]: bernd. [112 Keyboard Shortcuts for Total Commander 8](http://www.shortcutworld.com/en/win/total-commander_8.0.html)  