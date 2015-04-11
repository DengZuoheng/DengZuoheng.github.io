---
layout: post
title: Github-从小白到菜鸟的教程
description: 这是一个github教程,目的在于学习使用github做文档版本管理乃至项目代码管理,前半部分使用与两者,后半部分使用于代码管理.主要使用github for windows客户端,mac和linux看情况涉及.
category: blog
---

>无论是Linux 还是Git，得一即可得天下

**声明:**

- 不出意外,此教程会同时出现在小邓的博客和JDC论坛,不允许任何形式的转载
- 不出意外,此教程参考资料都会标明,如涉及版权问题,请联系我删除
- 不出意外,此教程考虑读者是没有版本控制概念的初学者
- 不出意外,大部分操作我都**没**在linux或mac上试过
- 出了意外再找我吧

## 1. github基础
### 1.1 版本控制概念
<!--
什么是版本控制?
维基百科如是说\[1\]:
>版本控制（Revision control）是维护工程蓝图的标准作法，能追踪工程蓝图从诞生一直到定案的过程。此外，版本控制也是一种软件工程技巧，借此能在软件开发的过程中，确保由不同人所编辑的同一程式档案都得到同步。
>透过文档控制（documentation control），能记录任何工程项目内各个模块的改动历程，并为每次改动编上序号。

>一种简单的版本控制形式如下：赋给图的初版一个版本等级“A”。当做了第一次改变后，版本等级改为“B”，以此类推。最简单的例子是，最初的版本指定为“1”，当做了改变之后，版本编号增加为“2”，以此类推。

>借此，版本控制能提供项目的设计者，将设计回复到之前任一状态的选择权，这种选择权在设计过程进入死胡同时特别重要。

>理论上所有的资讯记录都可以加上版本控制，在过去的实务中，除了软件开发的流程，其它的领域中很少有使用较复杂的版本控制技巧与工具（虽然可能为其带来许多好处）。目前已有人开始用版本控制软件来管理CAD电子档案，电路板设计，来补足本来由人手工执行的传统版本控制。

Pro Git如是说(有删改):
>版本控制是一种记录一个或若干文件内容变化，
以便将来查阅特定版本修订情况的系统。实际上，你可以对任何类型的文件进行版本控制。

>如果你是位图形或网页设计师，可能会需要保存某一幅图片或页面布局文件的所有修订版
本（这或许是你非常渴望拥有的功能）。采用版本控制系统（VCS）是个明智的选择。有
了它你就可以将某个文件回溯到之前的状态，甚至将整个项目都回退到过去某个时间点的状
态。你可以比较文件的变化细节，查出最后是谁修改了哪个地方，从而找出导致怪异问题出
现的原因，又是谁在何时报告了某个功能缺陷等等。使用版本控制系统通常还意味着，就算
你乱来一气把整个项目中的文件改的改删的删，你也照样可以轻松恢复到原先的样子。但额
外增加的工作量却微乎其微。

简单的说,就是在协作者之间同步文件,并记录谁什么时候改动了什么地方,并提供恢复到过去任一版本的方法.

举个栗子,你和队友写代码了,你有好几个队友,写的代码有好几十个文件,写了好几个月,无论分工多么明确,中间肯定还是要把代码交给队友用,或者用队友的代码的吧,这时候怎么办?

用邮件发送不科学吧,QQ什么的就更不用提了,另外即使你愿意忍受邮件发(远古时期真有邮件发的),好吧,你不怕你队友手残乱改代码么?

我想你会想到本次接受队友发过来的代码都另存一份,好吧,你队友通常两天发一次,一次几个文件,每个文件改几行,一年发了几个月,请问,公有多少个备份?

你要怎么知道队友一个月前手残改了什么?

用不了多久就会发现前几天改好的bug又回来了;打开编辑器不知道该动哪个文件了......

这时你肯定会想起我说的Github的

不用Git你也会用subversion的

事实上,用了就根本停不下来.
-->
//TODO

### 1.2 github简介
Git是一个分布式版本控制软件,Github是一个共享虚拟主机服务,两个是不同的东西,不过各种提供Git服务的站点操作起来应该差不多,其中Github是用户最多的(大概),而且Github的windows客户端的GUI能实现许多功能而不用命令行,非程序员也能快速上手(大概).

### 1.3 安装github
安装Github for Windows,首先你得联网,然后打开[Github for Windows官网][1],下载,安装,安装需要下载,毕竟天朝局域网,抽下风正常的,不行就重试两次吧(PS:需要.Net Framework支持,版本不记得了,安装失败会提示,提示啥就装啥吧),安装过程可能很漫长,此时应该去github.com注册个账号,邮箱和密码选常用的,用户名选好认的,头像之后再管.

安装完了,桌面上会多出两个图标:
![Github lnk logo][3]

其中原型的是图形UI,方形的是shell,打开图形UI客户端就会要求登陆,登陆完了如下图:

![Github for Windows 默认界面][2]

其他系统的安装参看Pro Git 1.4

linux下或mac下需要一些设置,设置参看Pro Git 1.5;

window下GUI右上角齿轮状按钮可以打开,选择`Options...`开始设置,能设置默认的克隆路径和账号,默认的克隆路径应该选一个你容易找到的,路径没有空格和非ASCII字符的,比如我就喜欢设置到`C:\\Projects`

### 1.4 新建仓库
所谓仓库,可以简单地认为是一个文件夹或目录,里面存放着这个项目中所有你想用Github来版本控制的文件.通常用来放代码,文档,程序要用到的图片,因为Github对每个免费仓库是有大小限制的(我记得是300M来着,一般项目足够了),所以实在没必要的就别往里放了.
假设你在上述步骤已经把默认路径设置为`C:\\Projects`了,创建仓库有一下几种方法:

#### 1.4.1 从头开始建
- 点击图形UI左上角的加号,然后填写Name,Name是新建后由Github创建的文件夹名,也是在github.com上能看到的项目名,所以别起得太low了,也别指望中文(所有文件名最好都用英文且不要加空格),就建一个`github-tutorial`吧

- Local是仓库所在的路径,新文件夹会在这里创建

- Git ignore是github的忽略规则,符合的文件都不会被监控,之后可以改,不过有预设的就选预设吧,不知道的就默认吧

- 然后点Create repository,不出意外的话就成功了,出了意外多半是名字不对

然后`C:\\projects\`下就多了个`github-tutorial`文件夹了,里面有两个文件(貌似是隐藏的):`.gitattributes`和`.gitignore`,后者就是刚才说到的忽略规则,用文本编辑器打开看需要编辑就好,还有个隐藏的`.git`目录,用于存放仓库信息,文件快照啥的(这个绝对不能手滑删了),文件结构像这样:

<pre>
    Projects/
        github-tutorial/
            .gitattributes
            .gitignore
            .git/
                 hooks
                 info
                 ...
</pre>	

#### 1.4.2 以现有的目录为仓库
如果已经写了一些代码了,不想从头来过,可以把这个目录用鼠标拖到图形UI的..左边吧,然后放开鼠标,不出意外的话就一路默认就好,除了意外,看下面吧

#### 1.4.3 用命令创建
打开Git Shell,cd到你要作为仓库的目录,运行

	git init

然后会像上面一样自动生成`.git`目录,但是`.gitattributes`和`.gitignore`不会自动生成.怎么挂载到图形UI嘛...还是用鼠标拖比较方便...

#### 1.4.4 在github.com在线创建
首先登陆.
打开`https://github.com/DengZuoheng?tab=repositories`其中`DengZuoheng`换成你的用户名,然后是这样的:

![在线创建仓库][5]

然后该填什么填什么:

![在线创建仓库2][6]

### 1.5 提交与同步
#### 1.5.1 添加文件
如果用图形UI创建仓库的话,一开始就会有一个提交,我们先不管这个,先试一下添加一个文件到仓库吧.
实际上,Github for Windows会监控所有文件,除了符合忽略规则的.所以,你只要在仓库所在的目录新建文件或粘贴从其他地方复制过来的文件就好了.比如,我现在测试用的账号叫zuoheng,方便起见新建一个`zuoheng.txt`吧,顺便写两行字吧,比如:

    1.这是一个测试
    2.this is a test

保存文件的时候记得用UTF-8无BOM编码格式保存,用其他编码的话容易导致乱码.
然后在打开Github图形UI,可以看到Github自动监视了这个文件:

![Github for Windows 主界面][4]

左边是仓库列表点击相应仓库就可以展开这个仓库的提交历史,中间是提交历史点击其中一项会在最右展开这次提交变动的文件,最右可以查看这次提交的提交信息和详细的文件变动情况,绿色表示新增行,红色表示删除行什么的(虽然经常有误判的情况)

#### 1.5.2 提交
在最右勾选要提交的文件,然后图形UI中上方可以看到`Uncommitted changes`,下面有两填写的地方(没看到找找旁边有没`Show`之类的按钮,点击展开)

summary写你这次提交概述啥的,description详细描述这次提交的变更情况,为啥要改代码,改了什么等等,方便你的队友拿到新代码后知道你干了啥.

填写完了就点`Commit to master`(这里的master是分枝名,表示这是主分支,分枝的概念后面再说),如果成功,`Unsynced changes`会多一项,这时代码的变化情况就暂存到`.git`目录去了,当然,不用管具体存在哪,怎么存,因为我们只是在学Github怎么用而已.暂存之后代码就算是安全了,即使你之后乱改代码,不出意外的话也能恢复到这时的状态.

命令行也可以做到相应的操作,而且抽风的概率比图形UI低很多很多.为了演示命令操作,我们再新建两个文件:`1.txt`,`2.txt`,分别写一行
<pre>
    this is 1.txt
</pre>
<pre>
    this is 2.txt
</pre>
然后打开Git shell,cd到相应的目录中,不出意外,应该显示`C:\\projects\github-tutorial [master +2 ~0 -0 !]>`,`+`表示新增文件,`~`表示更改文件,`-`表示删除文件.

    git status

查看当前状态,会列出所有未提交的文件,然后确定哪些要提交后使用:

    git add 1.txt

然后是commit,直接git commit的话会打开默认编辑器给你填写提交信息,`#`开头的是注释,第一行是刚才的summary,第二行开始是description:

    git commit

也可以添加`-m`参数在命令行中完成提交信息:

    git commit -m "这是提交信息"

也可以跳过`git add`步骤,直接默认add所有被改动的文件:

    git commit -a -m "这是提交信息"

#### 1.5.2 同步
刚刚的所有操作,都是在本地进行的,也就是说,你的变化只有你自己的电脑知道,如果需要让队友也应用这些变化,就需要同步到远程(可以理解为同步到服务器),而你的队友也需要在你同步之后同步一次把变化下载下来应用到本地.

图形界面上,右上角有个`sync`按钮,如果一次都没同步过的话,就是仓库出于未发布状态,右上角会是`publish repository`点一下就会上传代码和变更历史了,GUI偶尔会在这个步骤抽风.

这时候就需要命令行了,Git Shell命令很简单:

    git push 

其他环境下`git push`是带其他参数的,这里就先不讲了.

如果没有远程仓库,是不会成功push的,创建github的远程仓库有两种方法,一种是上面说的用GUI,另一种是在你的github主页上repositories标签那new一个.
在冲突的情况下push会失败,你必须解决冲突,再commit,再push,这些后面处理冲突的部分会讲到.


### 1.6 查看提交历史
GUI上查看提交历史就如1.5.1图所示, 会自动列举, 不过时间不是日期而是距离现在的时间, 比如5分钟前. 

命令行下, 用`git log`列举所有记录, 按`回车`可以一直显示下去, 按`q`可以结束.

`git reflog`同时会给出7位的版本号.

### 1.7 移动与删除
`git mv`是移动文件的命令, 但是就像linux的移动文件操作一样, 并不会携带以往记录一起移动, 所以, 用`git status`看起来, 就像是新增了一个文件然后删除了一个文件一样. 

`git rm`是删除文件的命令, 同时也会使文件脱离git的版本控制, 而且, 也能选择是否在硬盘中留下该文件:

    git rm -f -r file #强制删除, 不留文件, -r可以帮助你递归删除file目录里的所有文件
    git rm --cached file #从版本控制中删除, 但是保留硬盘中的文件

### 1.8 撤销操作
#### 1.8.1 修改最后一次提交
如果觉得刚刚的commit不合适,比如加少文件啦,提交信息没写好啦,想撤销这次操作(前提是你没同步或没push),就可以用--amend重新提交:

    git commit --amend

事情就像:

    git commit -m "提交信息" #发现不对,加少文件了
    git add a.txt #再加上你要提交的文件
    git commit --amend #打开默认编辑器重写提交信息

#### 1.8.2 取消已经暂存的文件
`git add`之后还没commit,突然发现不应该add某个文件,可以用:

    git reset HEAD a.txt

事实上,`git add`之后`git status`命令的话会提示这个命令用于撤销add,所以记不住问题也不大.

#### 1.8.3 取消未提交的文件修改
当你修改或删除文件后`git status',会提示`git add <file>`和`git checkout -- <file>`两种命令,后者就是撤销本次修改和删除(当然是git add之前):

    git checkout -- a.txt

如果已经把整个工作目录弄乱了,可以一次重置(恢复到最近一次提交的状态):

    git reset --hard HEAD

### 1.9 版本回退
版本控制的最大好处之一目测就是版本回退了, GUI上每个commit的右边详情都有个`revert`, 点击的话, 版本回退到没有这个commit前的状态, 只有这次commit修改过的文件才会受影响.

比如, 文件最开始只有一行`11111111`, commit了一次, 记作commit1, 然后多加了一行`22222222`, 又commit了一次, 记作commit2, 如果我点commit2的revert, 文件就会回退到只有一行`11111111`的状态, 但是因为之后修改过, 所以是会当做冲突处理的, 解决冲突见 1.9;

命令行也差不多, 语义还更明确一些, 比如回退到上一版本:`git reset -hard HEAD^`, 回退到上上版本:`git reset -hard HEAD^^`, 回退到前100个版本:`git reset -hard HEAD~100`.

回退到指定版本的操作跟上面GUI的操作是一致的, 但是命令行下你得先查查commit的版本号, 版本号可用`git reflog`.得到前面的7位(大概是哈希), 比如`435ccc9`, 我们要回到到这就用`git reset -hard 435ccc9`

因为回退版本的话, 本回退那次commit所有修改过的文件都会受影响, 所以, 每次commit都应该小一些, 否则回退了也是凌乱, 如果有大量变动, 就应该建一个分支再回退, 确定自己搞不搞得定, 搞不定的话, 还是老实看日志自己手动改回去吧.

###9.处理冲突
当你的合作者与你同时改了同一个文件, 然后还push了, 那么就发生冲突了, 因为程序无法判断以谁为准, 所以后push的人会push失败;

如果你改了一个文件, 你的合作者也改了这个文件, 而且还push了, 你在不commit的情况下, 想pull的话, 就会失败, 应该, 你也改动的, 程序不能覆盖掉你的改动;

你有两个分支, 都改动了同一个文件, 合并的时候会提示冲突, 要求手动处理...

以上这些情况就是所谓冲突, 一般都会被标出为`conflict`, 处理冲突其实很简单, 只要手动编辑冲突的文件, 然后再commit就可以了.

冲突的文件都会将冲突的地方用特殊的符号标出来, 比如:

<pre>
&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;HEAD 
你刚刚改的代码
=========
远程仓库的代码
&gt;&gt;&gt;&gt;&gt;&gt;&gt;&gt; 仓库最后一次提交的版本
</pre>

你只需要把这堆东西编辑好, 然后提交就好了.

有些特别的情况, 比如命名冲突了, 你却碰巧把别人的pull下来, 然后你的没push上去, 也没提示冲突, 这种情况, 以我的经验, 先把我的改动备份下来, 回滚版本, 在把我的改回去. 这就引出了处理冲突的终极大法:

- 备份你的改动, 重新克隆仓库, 然后再改回去

当然这只是落后一两个commit的情况下的办法, 不到万不得已还是不要用的好.

需要注意的是, 并不是说编辑了同一文件就一定冲突, 严谨的说法是编辑了同一文件的统一区域会产生冲突. 不同区域的话, git会自动合并.

还需要注意的是, git只会提醒编辑统一区域的那种冲突, 你要是改了文件名啥的, git当然是不会提示冲突的, 所以, 多跑测试, 你说测试代码也冲突了? 别问我, 我也不知道...

###10.添加协作者
Collaborator,姑且翻译成协作者吧,翻译不对就到评论区喷吧.

所谓协作者,就是可以直接向你的仓库提交代码的其他github用户,对同一个团队的人来说,还是加为协作者比较好,不然每次提交代码都要pull request就痛苦了.

对于github,添加协作者只能在github网页上操作:

- 打开你的仓库地址,比如:https://github.com/dengzuoheng/dengzuoheng.github.io
- 右中下有个`setting`,点进去
- 之后左边有个`Collaborators`,点进去,点的过程可能需要验证一次密码
- 然后就可以输入协作者的用户名了,注意得输入全名,比如`dengzuoheng`, 然后系统提示我的全名`DengZuoheng`,你得选这个,才能成功填写协作者
- 也就是说,不允许随便打个名字就加为协作者,必须是系统检索到真有这个人才能添加

###11.取得既有项目的仓库

取得既有项目的仓库,就是,现在已经有一个仓库了,你想下载代码下来用,或者你被添加成协作者了,你需要下载代码来修改.

其实就是把远程的代码弄下来.

方法很简单,主要有两个:

1. 到网页上操作:
    - 所有仓库页面,比如https://github.com/dengzuoheng/dengzuoheng.github.io右下角都有一个`Clone in Desktop`按钮,如果你安装了github for Windowsk客户端,你点这个按钮,就会调用这个客户端来克隆,最新版本的可以选择的克隆的目标路径,默认自然是github客户端设置的默认路径.
    - 然后克隆成功的话,客户端会自动挂载这个仓库,然后你就该干嘛干嘛了
    
2. 命令行:
    - 命令行就简单了,cd到你要存放的目录,然后`git clone 仓库地址.git`,仓库地址可以是ssh的,也可以是https的,比如:
<pre>
#ssh版
git clone git@github.com:DengZuoheng/DengZuoheng.github.io.git
#https版
git clone https://github.com/DengZuoheng/DengZuoheng.github.io.git
</pre>
    

###12.Markdown
Markdown是一种轻量级标记语言, 用存文本表现出结构的那种, 可以转换成HTML, 通常, 程序猿用它来写邮件.

我们扯出markdown做怎么呢? 因为, github的readme就是用markdown写的; 相信你在很多仓库中都见过一个`README.md`的文件, 在github网页中会以一定排版显示出来, readme是做什么的相信我不用多说了, 但是这个`.md`代表着这是根据markdown格式编写的, github会自动解释. 所以, 人民也提喜欢用markdown来写文档. 另外, github的wiki也是用markdown编辑的. 

markdown的语法也是颇为简单, 一般一两天就能学致日常使用了, 详细语法参考:

- [http://wowubuntu.com/markdown/](http://wowubuntu.com/markdown/)

当然, github不仅支持markdown, 还有一些类似的轻量级的标记语言, 如: AsciiDoc, Creole, MediaWiki, Org-mode, Pod, RDoc, Textitle, reStructureText.

通常学会一种就够用了, 不过, 参与到别人的项目的时候, 别人用什么写, 你也得用什么写, 所以, 其实迟早都得学. 

##2.分支
###1.分支概念
//TO DO
###2.分支新建与合并
//TO DO
###3.冲突时的分支合并
//TO DO
###4.分支工作流
//TO DO
###5.rebase
//TO DO
##3.github开源项目
###1.fork
fork 相当于复制一个仓库到你账号下, fork后就可以在你fork回来的仓库中乱搞而不影响原仓库. fork很简单, 随便打开个什么仓库你总能看到"fork"按钮, 比如`https://github.com/DengZuoheng/DengZuoheng.github.io`右上附近就是了.

fork之后, 你就可以clone下来更改了, 但是, 为了与源项目, 或者说上游项目保持同步(否则别人更新了你没跟着更新), 你得用git remote add添加上游远程库的地址. 参考官方帮助第3步:

    git remote add upstream https://github.com/DengZuoheng/DengZuoheng.github.io.git

这样, 你用`git remote -v`查看, 应该是这样子的:

    origin    https://github.com/YOUR_USERNAME/DengZuoheng.github.io.git (fetch)
    origin    https://github.com/YOUR_USERNAME/DengZuoheng.github.io.git (push)
    upstream  https://github.com/DengZuoheng/DengZuoheng.github.io.git (fetch)
    upstream  https://github.com/DengZuoheng/DengZuoheng.github.io.git (push)

然后, 就可以用git rebase导入上游仓库的更新了, 同理也可以用git merge将更新合并到你在修改的分支. 

另外, 如果改改你自己用的话, 在主分支上改也没关系, 但是如果你打算pull request的话, 还是为你的修改新建一个分支吧. 
  
###2.pull request
在你fork出来的仓库的页面`https://github.com/YOUR_USERNAME/DengZuoheng.github.io`点`pull request`, 然后`new pull request`,然后左边选择base branch，右边选择head branch.

base branch是你希望pull request被merge到上游项目的哪个branch里, head branch你希望自己开发库里的哪个branch被用来进行pull request(就是被你修改了的那个分支)

发送pull request之后, 在这个pull request被关闭之前, 你在这个分支上新的commit都会被自动追加到这个pull request, 不用另起pull request. 

如果你是被pull request的那个, `git pull`, `git merge`等命令就可以合并了, 具体参数吗, 上网找找...另外, github上的pull request不会自动关闭, 需要手动, 打开你项目的pull request然后找到已经完事的那项, 点`delete`之类的.

有些时候pull request也称`pr`, 毕竟pull request这么长, 打起字很累....

建议自己弄两账号, 再弄以仓库, 多pr几次就明白了. 

官方也是有帮助的, 可参考:

- Using Pull Requests: https://help.github.com/articles/using-pull-requests
- Merging a pull request: https://help.github.com/articles/merging-a-pull-request
- Closing a pull request: https://help.github.com/articles/closing-a-pull-request
- Tidying up Pull Requests: https://help.github.com/articles/tidying-up-pull-requests

###3.子模块
//TO DO
###4.github pages
//TO DO
##4.git与其它系统
###1.从svn迁移到git
//TO DO

**Reference:**  
\[1\] : [版本控制](http://zh.wikipedia.org/wiki/%E7%89%88%E6%9C%AC%E6%8E%A7%E5%88%B6)  
\[2\] : 涂根华的博客. Git使用教程. http://www.cnblogs.com/tugenhua0707/p/4050072.html  
\[3\] : Mort. Pull Request的正确打开方式（如何在GitHub上贡献开源项目）. http://www.soimort.org/posts/149/  
\[4\] : Github help. Fork A Repo. https://help.github.com/articles/fork-a-repo/
\[5\] : Git下冲突的解决. http://www.cnblogs.com/sinojelly/archive/2011/08/07/2130172.html

[1]:https://windows.github.com/
[2]:http://dengzuoheng.github.io/images/2014-10-3-19-54-51.png
[3]:http://dengzuoheng.github.io/images/2014-10-3-20-14-21.png
[4]:http://dengzuoheng.github.io/images/2014-10-3-21-47-24.png
[5]:http://dengzuoheng.github.io/images/2014-10-18-20-20-50.png
[6]:http://dengzuoheng.github.io/images/2014-10-18-20-23-08.png