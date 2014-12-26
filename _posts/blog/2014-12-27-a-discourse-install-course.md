---
layout: post
title: 一次Discourse安装过程
description: VPS即将到期, 本来以为不会再安装的discourse可能就要在下次有钱续费VPS的时候再安装一次了, 所以还是记下安装过程, 免得下次装找不见. 
category: blog
---

##准备##
> 首先你得有个VPS

本人的VPS是linode 1G, 而Discourse要求至少1G内存(包括swap), 于是我就把swap设到最大了, 估计能达到要求.

然后是安装系统, 因为参考文献[1]用的是ubuntu, 我这里也用ubuntu了.

##开始安装

下面是根据参考文献[1]的安装过程.

###安装git:

    apt-get update
    apt-get install git

###安装docker:

    wget -qO- https://get.docker.io/ | sh

###安装discourse

    mkdir /var/docker
    git clone https://github.com/discourse/discourse_docker.git /var/docker
    cd /var/docker
    cp samples/standalone.yml containers/app.yml

###编辑discourse配置文件
    nano containers/app.yml

需要改动的是：

- UNICORN_WORKERS（如果是1Gb内存就是2，2GB内存以上就是3-4）
- DISCOURSE_DEVELOPER_EMAILS管理员邮箱、
- DISCOURSE_HOSTNAME 绑定的域名、
- DISCOURSE_SMTP_ADDRESS是邮局服务器、
- DISCOURSE_SMTP_PORT, DISCOURSE_SMTP_USER_NAME, DISCOURSE_SMTP_PASSWORD则是SMTP的端口、账号和密码。

比如:

<pre>

env:
  LANG: en_US.UTF-8
  ## TODO: How many concurrent web requests are supported?
  ## With 2GB we recommend 3-4 workers, with 1GB only 2
  #UNICORN_WORKERS: 3
  ##
  ## TODO: List of comma delimited emails that will be made admin and developer
  ## on initial signup example 'user1@example.com,user2@example.com'
  DISCOURSE_DEVELOPER_EMAILS: 'dengzuoheng@gmail.com'
  ##
  ## TODO: The domain name this Discourse instance will respond to
  DISCOURSE_HOSTNAME: 'jnu-developer.com'
  ##
  ## TODO: The mailserver this Discourse instance will use
  DISCOURSE_SMTP_ADDRESS: smtp.mandrillapp.com
  # (mandatory)
  DISCOURSE_SMTP_PORT: 587
  # (optional)
  DISCOURSE_SMTP_USER_NAME: dengzuoheng@gmail.com
  # (optional)
  DISCOURSE_SMTP_PASSWORD: eHPTmMVBFpbtrpP5zWuolQ
  # (optional)
  ##
  ## The CDN address for this Discourse instance (configured to pull)
  #DISCOURSE_CDN_URL: //discourse-cdn.example.com
## These containers are stateless, all data is stored in /shared
## These containers are stateless, all data is stored in /shared

</pre>

需要注意的是, SMTP服务不工作的话, discourse就无法注册了, 就得重新安装了. 所以, 要选择靠谱的邮件服务, gmail之类的私人邮箱也是不好的, 最好上Mandrill或Mailgun, 我这里用的是Mandrill, 没怎么测试过, 不过发QQ邮箱通常都不成功.

###执行Bootstrap:

    ./launcher bootstrap app

Bootstrap过程会提示生成SSH key, 整个过程几分钟吧.

###启动discourse:

    ./launcher start app

###到网页端注册管理员账号

就用刚刚配置文件中的管理员邮箱来注册, 然后discourse会发送激活邮件, 如果收不到, 就得检查配置文件中SMTP中的设置是否正确. 正确的话, 没辙了, 用其他程序试一下你的Mandrill的key到底工不工作吧. 

发现设置错的了话, 应该得重新执行Bootstrap, 当然, 重新安装都不是多大的工作量.

/var/docker中有不少的launcher命令，包括：start（启动）、stop（停止）、restart（重启）、destroy（删除）、bootstrap（重新生成）、logs（日志）、rebuild（重建）。命令格式如：

    ./launcher start app。

###设置discourse
discourse的后台是主页url后面加`/admin`, 可以设置为中文,等等

**参考文献**  
[1]qi. (2014, 06, 26). Discourse安装使用-简洁强大Ruby on Rails免费开源论坛Discuz!替代品 [Online]. Available: http://www.freehao123.com/discourse/  
[2]discourse. INSTALL-digital-ocean [Online]. Available: https://github.com/discourse/discourse/blob/master/docs/INSTALL-digital-ocean.md