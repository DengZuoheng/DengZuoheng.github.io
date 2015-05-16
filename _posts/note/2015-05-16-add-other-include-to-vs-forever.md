---
layout: post
title: Visual Studio为所有项目永久添加额外包含路径
description: VS中使用第三方库, 比如Boost的时候总是要手动添加包含路径等等, 实在太不智能了, 于是上网找了个方法, 挺好用的, 便记下来  
category: note
---

## 方案1 ##

找到你VS安装目录下的`\VC\VCWizards\default.vcxproj`, 比如我的是`c:\Program Files (x86)\Microsoft Visual Studio 12.0\VC\VCWizards\default.vcxproj`, 在`<Project></Project>`中插入:
<pre>
  &lt;PropertyGroup&gt;
    &lt;IncludePath&gt;C:\libs\boost\boost_1_55_0\include;$(IncludePath)&lt;/IncludePath&gt;
  &lt;/PropertyGroup&gt;
</pre>
格式就这样了, 如果要添加lib的路径的话, 就用`<LibraryPath></LibraryPath>`.

当然, 还有一种方法, 就是你建好一个项目, 把改添加的都添加了, 然后对比一下两个.vcxproj有什么不同, 不同的地方加到default.vcxproj去.

这种方法只对新建项目有效, 以往的项目是无效的.

## 方案2 ##

这次我们动的是`C:\Users\<user>\AppData\Local\Microsoft\MSBuild\v4.0\Microsoft.Cpp.Win32.user.props`, 同样是加一个`<PropertyGroup>`, 格式同上面是一样的.

**Reference:**  
\[1]: hwangbae. 为Visual Studio添加默认INCLUDE包含路径一劳永逸的方法(更新). 2012.6.24. http://www.cnblogs.com/hwangbae/archive/2012/06/24/2560463.html  
\[2]: http://stackoverflow.com/questions/3349378/edit-includepath-macro-in-visual-studio-2010
