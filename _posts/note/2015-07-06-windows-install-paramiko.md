---
layout: post
title: windows下安装paramiko
description: 首先得下载一个pycrypto的windows安装包, 然后pip安装paramiko
category: note
---

paramiko是python的一个ssh库, 用以ssh远程执行命令, 使用简单方便, 但安装依赖pycrypto,
windows下安装pycrypto的话, 不能直接用pip安装, 首先你得到这http://www.voidspace.org.uk/python/modules.shtml#pycrypto下载一个Windows安装包, 先把pycrypto安装了, 然后就可以用pip安装paramiko了.

<del>windows必须死, 在linux下就两行命令解决的问题:
$ pip install pycrypto
$ pip install paramiko
</del>