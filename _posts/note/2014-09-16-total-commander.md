---
layout: post
title: Total Commamder常用命令
description: 简记一些TC的用法,方便复习
category: note
---


###文件
- 新建文件:shift+F4
- 新建文件夹:F7
- 重命名:shift+F6(完了记得敲回车)
- 批量重命名:Ctrl+M
- 复制文件名:Alt+M+Y
- 复制文件名加路径:Alt+M+p
- 快速查看:Ctrl+Q
- 关闭快速查看:Ctrl+Q
- 快速筛选:输入字母(需设置)
- 展开所有文件夹:Ctrl+B
- 打开默认编辑器:F4
- 复制:F5
- 移动:F6
- 删除:F8
- 打开默认查看器:F3
- 打开桌面:Alt+C+O


###标签
- 改变当前标签:Shift+F6
- 移动当前标签到另一视图:Ctrl+U
- 复制当前标签:ctrl+T
- 切换视图:Tab
- 切换标签:Ctrl+Tab
- 关闭当前标签:Ctrl+W 
- 关闭全部标签:Ctrl+Shift+W
- 返回根目录:Ctrl+\
- 打开标签收藏夹:Ctrl+D
- 刷新:F2

###系统
- 在当前路径打开cmd:Alt+C+D
- 执行命令行:→

###压缩
- 压缩文件到另一标签的当前视图:Alt+F5
- 解压文件到另一标签的当前视图:Alt+F9
- 解压\压缩到当前文件夹:修改路径剩下`\`

###设置打开方式
1. 下载安装[ChoiceEditor][1]
2. 把ChoiceEditor设置成默认编辑器
3. 然后就可以选择不同的编辑器了
4. ChoiceEditor目录下的ChoiceEditor.ini就是打开菜单的配置文件,看起来像这样:
<pre>
	[Options]
	Language=0
	CheckCursor=1
	CheckKey=27
	AlwaysChecked=1
	[General]
	DisplayName0=Notepad++ 
	Editor0=C:\Program Files (x86)\Notepad++\notepad++.exe
	Ext0=*
	DisplayName1=Google Chrome
	Editor1=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
	Ext1=HTML
	DisplayName2=WinMerge
	Editor2=C:\Program Files (x86)\WinMerge\WinMergeU.exe
	Ext2=*
	DisplayName3=Kingsoft Spreadsheets
	Editor3=C:\Users\Administrator\AppData\Local\Kingsoft\WPS Office\9.1.0.4843\office6\et.exe
	Ext3=XLSX
	DisplayName4=MarkdownPad 2
	Editor4=C:\Portable Application\MarkdownPad 2 Pro Portable v2.4.3.39518\MarkdownPad2.exe
	Ext4=MD
</pre>

可以根据自己的需要手动添加打开方式.比如上面的配置就对所有文件都增加了notepad++和WinMerge的打开,因为这是我最常用的;通常情况下ChoiceEditor能识别出系统的默认查看程序,但是偶尔也会抽风,故还是自己设置比较顺心.

[1]:http://www.totalcmd.net/plugring/ChoiceEditor_patched.html