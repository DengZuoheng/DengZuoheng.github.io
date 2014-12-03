---
layout: post
title: Debian下搭建shadowsocks
description: shadowsocks是轻量级的代理软件,比svn跟难被发现,而且速度很不错,服务端和客户端配置都很简单.linode最低配置,开着代理看视频都没问题.
category: blog
---

##准备##
- vps:1个,我的是linode 1G,debian操作系统
- M$用户需要putty(远程登录):1个
- shadowsocks客户端(比如最简单的yingwa):1个

##开始##
###1. 必要环境
更新apt-get:

    apt-get update

安装GCC编译器:

    apt-get install build-essential autoconf libtool libssl-dev gcc -y

安装git:
    
    apt-get install git -y

###2. 安装shadowsocks
2.1 用git下载源码包:

    git clone https://github.com/madeye/shadowsocks-libev.git

2.2 编译源码包:
    
    cd shadowsocks-libev
    ./configure
    make && make install

2.3 运行shadowsocks:

    nohup /usr/local/bin/ss-server -s IP地址 -p 端口 -k 密码 -m 加密方式 &

比如[1]:

    nohup /usr/local/bin/ss-server -s 156.132.67.213 -p 8981 -k admin888 -m aes-256-cfb &

##客户端##
shadowsocks客户端有很多,除了WP8,其他大部分平台都有相应的客户端.

Windows下我喜欢用yingwa,很傻瓜很简单,尤其是你需要教会小白用的时候.

##备注##
###1. 加密###
启动命令可以不写`-m aes-256-cfb`,那样的话默认加密方式为table,这种加密速度最快.但是aes-256-cfb更安全,实际上如果vps不太破的话,对速度几乎没有影响的.个人认为还是加密好,不然查水表了就不好了.

###2.更改端口密码等###
端口,密码,加密方式都是启动命令中配置的,所以关掉重新启动一遍就行了.

###3.开机启动
参考文献中指出可以加入开机启动,但是我从来没试过:

    echo "nohup /usr/local/bin/ss-server -s IP地址 -p 端口 -k 密码 -m 加密方式 &" >> /etc/rc.local

如果没有设置开机启动的话,每次开机都需要自行一次2.3的启动命令.