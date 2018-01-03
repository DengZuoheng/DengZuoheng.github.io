---
layout: post
title: 唤醒我的硬盘盒-一个MFC对话框小程序
description: 这是一个基于对话框的MFC程序,目标在于对于每个硬盘定时写入少量数据阻止硬盘盒进入自动休眠.涉及到一些隐藏到系统托盘,开机启动,获取当前登陆用户,读写json文件等代码,以前没写在博客,故这次记录之.
category: project
---

## 缘起

难得在某宝买个硬盘底座,但是却"过于智能",两分钟不读写就休眠,最过分的是,刷固件还要失败...

在想办法弄好固件前,得有个办法让硬盘底座不休眠.

一拍脑袋,就说些个程序不停地写入吧...

## 项目

直接上github连接吧:

https://github.com/DengZuoheng/wakeupdisk

效果:

![效果截图][1]

[1]: https://github.com/DengZuoheng/wakeupdisk/raw/master/image.png

## UI实现

因为是基与对话框的MFC程序,所以,用VS2013拖足够的checkbox就好了,这样每个控件会有一个ID,重复代码比较容易优化.
需要遍历所有控件的情节,就用vector容器存控件ID进行遍历,如果是C++11,写起来还是很方便的:

~~~
 static vector<decltype(IDC_CHECKC)> ctrl_macro_vec = {
        IDC_CHECKC,IDC_CHECKD,IDC_CHECKE,IDC_CHECKF,
        IDC_CHECKG,IDC_CHECKH,IDC_CHECKI,IDC_CHECKJ,
        IDC_CHECKK,IDC_CHECKL,IDC_CHECKN,IDC_CHECKM,
        IDC_CHECKO,IDC_CHECKP,IDC_CHECKQ,IDC_CHECKR,
        IDC_CHECKS,IDC_CHECKT,IDC_CHECKU,IDC_CHECKV,
        IDC_CHECKW,IDC_CHECKX,IDC_CHECKY,IDC_CHECKZ };
~~~

没有C++11,用boost::assign库也能实现类似列表初始化的效果.

而获取控件状态方面,这里用的是:

~~~
CButton* pButton = (CButton*)GetDlgItem(ctrl_macro_vec[i]);
//获取状态
pButton->GetCheck();
//设置状态
pButton->SetCheck(STATUS_CHECKED);//STATUS_CHECKED是自己定义的宏
~~~

## 数据结构

要储存的,只有每个盘符有没被勾选,轮询间隔,是否开机启动.

开始时,我是为这些数据设了一个成员变量的,但是,用json存放配置的话,读取json时我会用boost::property_tree,所以,设成员变量的话就多了一个数据交换的步骤.所以干脆只存一个ptree好了.

于是与UI交换数据的时候,就变成这样:

~~~
    for (int i = 0; i < vec_size; ++i){
        CButton* pButton = (CButton*)GetDlgItem(ctrl_macro_vec[i]);
        string drive = "C";
        drive[0] += i;
        pt.put("disksetting." + drive, 
            pButton->GetCheck() == STATUS_CHECKED ? true : false);
    }

    CButton* pButton = (CButton*)GetDlgItem(IDC_START);
    pt.put("runonstartup", 
        pButton->GetCheck() == STATUS_CHECKED ? true : false);

    pt.put("frequency", GetDlgItemInt(IDC_EDIT_FRE));
    //reset the timer
    KillTimer(ID_TIMER);
    SetTimer(ID_TIMER, pt.get<int>("frequency"), NULL);

    SetRunOnStartUp(pt.get<bool>("runonstartup"));

~~~

这里需要声明json文件的结构:

~~~
{
    "runonstartup": "false",
    "frequency": "60000",
    "disksetting":
    {
        "C": "true",    "D": "true",    "E": "true",    "F": "true",
        "G": "false",   "H": "true",    "I": "true",    "J": "true",
        "K": "true",    "L": "true",    "M": "true",    "N": "false",
        "O": "true",    "P": "true",    "Q": "true",    "R": "true",
        "S": "false",   "T": "true",    "U": "true",    "V": "true",
        "W": "true",    "X": "true",    "Y": "false",   "Z": "true"
    }
}
~~~

ptree读写json也是很方便:

~~~
//读取json文件构建ptree
read_json("init.json", pt);
//将ptree内容写入json
write_json("init.json", pt);
~~~

**注意ptree对json文件的格式要求是严格的**,比如平时写js的时候,true是不带双引号的,列表最后一项加个逗号也没问题,在这里全部不行,你需要写最严格的json语法.而且write_json写出来的json无论是key还是value都是带双引号的,所以建议最开始手写的时候就带双引号.

## 隐藏到系统托盘

因为程序需要长时间运行,所以隐藏到托盘的功能是必须要的.

这段代码当然是上网抄的:

~~~
void CwakeupdiskDlg::ToTray(){
   
    NOTIFYICONDATA nid;
    nid.cbSize = (DWORD)sizeof(NOTIFYICONDATA);
    nid.hWnd = this->m_hWnd;
    nid.uID = IDR_MAINFRAME;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_SHOWTASK;//自定义的消息名称
    nid.hIcon = LoadIcon(AfxGetInstanceHandle(), MAKEINTRESOURCE(IDR_MAINFRAME));
    
    wsprintf(nid.szTip, TEXT("%s"), TEXT("托盘测试"));
    Shell_NotifyIcon(NIM_ADD, &nid);//在托盘区添加图标
    ShowWindow(SW_HIDE);//隐藏主窗口
   
}
~~~

运行时调用Totray,托盘就多了个图标,然后隐藏窗口.nid结构要求一个自定义消息名称,托盘的图标接受到消息,就用这个自定义消息为名发到程序的消息队列中.这个消息的lParam是图标接收到的消息,比如我要相应托盘图标的左键点击消息显示窗口:

~~~
afx_msg LRESULT CwakeupdiskDlg::OnShowtask(WPARAM wParam, LPARAM lParam){
    if (lParam == WM_LBUTTONDOWN){
        ShowWindow(SW_SHOW);//隐藏主窗口
    }
    return 0;
}
~~~

## 获取当前登录账户名

这段代码网上到处都是,亲测可用,虽然到最后没有用:

~~~
#include "stdafx.h"
#include "Wtsapi32.h"
#pragma comment(lib,"Wtsapi32.lib")

BOOL GetLogUser(CString& str_name){
    BOOL bRet = FALSE;
    str_name = _T("");
    //for xp or above 
    TCHAR *szLogName = NULL;
    DWORD dwSize = 0;
    if (WTSQuerySessionInformation(
            ((HANDLE)NULL),
            ((DWORD)-1),
            WTSUserName,
            &szLogName,
            &dwSize)
        ){
        str_name = szLogName;
        WTSFreeMemory(szLogName);
        bRet = TRUE;
    }

    return bRet;
}
~~~

写这个代码是最头疼的问题,就是连接问题,Wtsapi32.lib有了,Wtsapi32.dll也有了,编译没问题,就是连接错.找了两天(其实什么也没找见),最终偶然发现,原来是`#pragma comment(lib,"Wtsapi32.lib")`应该写在`#include "Wtsapi32.h"`后面...

## 设置开机启动

本来,想写用户的注册表来设置开机启动,所以才会有上面获取当前登录用户名的代码,但是找到了另一个看起来更可能工作的代码,就没用用户名,而是设置注册表"HKEY_LOCAL_MACHINE\Software\\Microsoft\\Windows\\CurrentVersion\\Run",代码如下,加了一个参数用于删除开机启动的设置:

~~~
void CwakeupdiskDlg::SetRunOnStartUp(bool bFlag){
    HKEY RegKey=NULL;
    CString sPath;

    GetModuleFileName(NULL, 
        sPath.GetBufferSetLength(MAX_PATH + 1),
        MAX_PATH);

    sPath.ReleaseBuffer();
    int nPos;
    nPos = sPath.ReverseFind('\\');
    sPath = sPath.Left(nPos);
    CString lpszFile = sPath + "\\wakeupdisk.exe";//这里加上你要查找的执行文件名称   
    CFileFind fFind;
    BOOL bSuccess;
    bSuccess = fFind.FindFile(lpszFile);
    fFind.Close();

    if (bSuccess){
        CString fullName(lpszFile);

        RegOpenKey(HKEY_LOCAL_MACHINE, 
            TEXT("Software\\Microsoft\\Windows\\CurrentVersion\\Run"), 
            &RegKey);

        if (bFlag){
            RegSetValueEx(RegKey, 
                TEXT("wakeupdisk"), 
                0, 
                REG_SZ, 
                (BYTE*)(LPCTSTR)fullName, 
                fullName.GetLength() * 2);//这里加上你需要在注册表中注册的内容   
        }else{
            RegDeleteValue(RegKey, TEXT("wakeupdisk"));
        }
        
        this->UpdateData(FALSE);
    }else{
        //theApp.SetMainSkin();   
        MessageBox(TEXT("没找到执行程序，自动运行失败"));
        exit(0);
    }
}
~~~

这里是先找我要设置的程序有没有,有才开始动注册表,需要注意的是RegSetValueEx的第5个参数--数据长度,我的VS是定义了Unicode宏的,这里的编码就有点奇怪了,fullName.GetLength()得到的只跟我预想的一致,但是实际上只有半个字符串存进注册表了,所以这里乘了2,使得全部存进注册表.

到这里开机启动时基本实现了,但是还遇到了一个问题,下面会讲到.

## 开机启动的问题

当系统启动时,主程序启动了,但是却没法正常读取json文件,如果单独在资源管理器启动程序,却可以正常读取json文件.这个问题原因都还没找到,不过计划是让程序第一次读取失败的话,休眠个半分钟再尝试读一遍,不过,下次有空再写吧

## 修复开机启动问题

据说,开机启动时,相对路径是不安全的,所以程序没有成功读取配置文件,要顺利读取配置文件的话,就需要配置文件的绝对路径,但是,通常配置文件都放在程序的同一目录下,所以,获取了程序的绝对路径,就可以构造出配置文件的绝对路径了.

`::GetModuleFileNameA(NULL, FilePath, MAX_PATH);`就是这么个函数,第一个参数填NULL的话,获取的就是当前程序的路径(其他参数谷歌去吧),但是获取的路径是放到一个字符数组里面的,并没有结束符,所以我们得手动加上,用strrchr函数找到最后一个`\\`的位置,然后在其下一个位置加上结束符`\0`.

完整的示例如下,传入一个配置文件名,函数获取当前路径然后拼接好绝对路径名返回:

~~~
std::string GetModuleProfileName(std::string basic_file_name){
    char FilePath[MAX_PATH];
    ::GetModuleFileNameA(NULL, FilePath, MAX_PATH);
    (strrchr(FilePath, '\\'))[1] = 0;
    std::string retpath(FilePath);
    return retpath + basic_file_name;
}
~~~

## 启动自动隐藏

成功设置开机启动后, 又碰到一个问题, 就是每次开机启动都有生成窗口, 还得手动关掉, 很是不爽, 于是就想让它启动时自动隐藏到托盘, 搜索了一圈, 什么`showWindow(SW_HIDE)`亲测无效, 最后找到了一个`SetWindowPlacement`的方法, 效果还可以, 就用了, 代码如下:

~~~
//首先你得有个成员来保存正常的WindowPlacement以便回复
//然后在OnInitDialog添加
GetWindowPlacement(&m_wp); //恢复时用
ModifyStyleEx(WS_EX_APPWINDOW, WS_EX_TOOLWINDOW);//从任务栏中去掉.
WINDOWPLACEMENT wp;
wp.length = sizeof(WINDOWPLACEMENT);
wp.flags = WPF_RESTORETOMAXIMIZED;
wp.showCmd = SW_HIDE;
SetWindowPlacement(&wp);
~~~

然后该恢复的时候恢复就好了, 不过恢复的时候默认会跑到左上角, 这个问题还没解决, 不过影响不大, 因为我基本上不会再点开它.