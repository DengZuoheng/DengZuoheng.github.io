---
layout: post
title: cJSON源码剖析
description: cJSON估计是最小巧的json解析库了, 直接下载的代码只有五百多行, 经过我强迫症地全部展开也只有1600多行, 很小, 也很好理解   
category: blog
---
cJSON.c源码如下, 几乎一行一行的加了注释:

<pre>
/*
  Copyright (c) 2009 Dave Gamble

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/

/* cJSON */
/* JSON parser in C. */

#include &lt;string.h&gt;
#include &lt;stdio.h&gt;
#include &lt;math.h&gt;
#include &lt;stdlib.h&gt;
#include &lt;float.h&gt;
#include &lt;limits.h&gt;
#include &lt;ctype.h&gt;
#include "cJSON.h"

static const char *ep;

const char *cJSON_GetErrorPtr(void) 
{
    return ep;
}

//不区分大小写的比较, 最后用key来索引value的时候会用到
static int cJSON_strcasecmp(const char *s1,const char *s2)
{
    if (!s1) //if s1=NULL
    {
        return (s1==s2)?0:1;
    }
    if (!s2) // if s2=NULL
    {
        return 1;
    }
    for (; tolower(*s1) == tolower(*s2); ++s1, ++s2)//这里真的不会越界
    {
        if (*s1 == 0)
        {
            return 0;
        }
    }
    return tolower(*(const unsigned char *)s1) - tolower(*(const unsigned char *)s2);
}

static void *(*cJSON_malloc)(size_t sz) = malloc;
static void (*cJSON_free)(void *ptr) = free;

//字符串复制
static char* cJSON_strdup(const char* str)
{
    size_t len;
    char* copy;

    len = strlen(str) + 1;
    if (!(copy = (char*)cJSON_malloc(len))) 
    {
        return 0;
    }
    memcpy(copy,str,len);
    return copy;
}

//应该是设置malloc和free的方法
void cJSON_InitHooks(cJSON_Hooks* hooks)
{
    if (!hooks) 
    { /* Reset hooks */
        cJSON_malloc = malloc;
        cJSON_free = free;
        return;
    }

    cJSON_malloc = (hooks-&gt;malloc_fn)?hooks-&gt;malloc_fn:malloc;
    cJSON_free   = (hooks-&gt;free_fn)?hooks-&gt;free_fn:free;
}

//新建一个节点
/* Internal constructor. */
static cJSON *cJSON_New_Item(void)
{
    cJSON* node = (cJSON*)cJSON_malloc(sizeof(cJSON));
    if (node) 
    {
        memset(node,0,sizeof(cJSON));
    }
    return node;
}

//删除节点的
/* Delete a cJSON structure. */
void cJSON_Delete(cJSON *c)
{
    cJSON *next;
    while (c)
    {
        next=c-&gt;next;
        //如果是一个引用, 而且子节点的指针有效, 就递归删除
        if (!(c-&gt;type&cJSON_IsReference) && c-&gt;child)
        {
            cJSON_Delete(c-&gt;child);
        } 
        //如果是一个引用, 而且是valuestring指针有效, 就free掉他
        if (!(c-&gt;type&cJSON_IsReference) && c-&gt;valuestring)
        {
            cJSON_free(c-&gt;valuestring);
        } 
        //如果string指针有效, 就free掉, string应该是一个key来的
        if (c-&gt;string)
        {
            cJSON_free(c-&gt;string);
        } 
        cJSON_free(c);
        c=next;
    }
}

/* Parse the input text to generate a number, and populate the result into item. */
static const char *parse_number(cJSON *item,const char *num)
{
    double n=0;
    double sign=1;
    double scale=0;
    int subscale=0;
    int signsubscale=1;

    //有符号的话, 先记着
    if (*num=='-') 
    {
        sign=-1;
        num++;  /* Has sign? */
    }
    //0就跳过了, 其实我很奇怪多个前导0怎么办
    if (*num=='0')
    {
        num++;          /* is zero */
    }
    if (*num&gt;='1' && *num&lt;='9')
    {
        do  
        {
            n=(n*10.0)+(*num++ -'0');
        }   
        while (*num&gt;='0' && *num&lt;='9'); /* Number? */
    }       
    if (*num=='.' && num[1]&gt;='0' && num[1]&lt;='9') 
    {
        num++;      
        do
        {
            n=(n*10.0)+(*num++ -'0');
            scale--; 
        }
        while (*num&gt;='0' && *num&lt;='9');
    }   /* Fractional part? */
    ///指数
    if (*num=='e' || *num=='E')     /* Exponent? */
    {   
        num++;
        if (*num=='+')
        {
            num++;  
        }
        else if (*num=='-')
        {
            signsubscale=-1;
            num++;      /* With sign? */
        }
        while (*num&gt;='0' && *num&lt;='9')
        {
            subscale=(subscale*10)+(*num++ - '0');  /* Number? */
        }
    }

    n=sign*n*pow(10.0,(scale+subscale*signsubscale));   /* number = +/- number.fraction * 10^+/- exponent */
    
    item-&gt;valuedouble=n;
    item-&gt;valueint=(int)n;
    item-&gt;type=cJSON_Number;
    //用完了就把char*返回了
    return num;
}
//将数字转为字符串
/* Render the number nicely from the given item into a string. */
static char *print_number(cJSON *item)
{
    char *str;
    double d=item-&gt;valuedouble;
    if (fabs(((double)item-&gt;valueint)-d)&lt;=DBL_EPSILON && d&lt;=INT_MAX && d&gt;=INT_MIN)
    {
        str=(char*)cJSON_malloc(21);    /* 2^64+1 can be represented in 21 chars. */
        if (str)
        {
            sprintf(str,"%d",item-&gt;valueint);
        }
    }
    else
    {
        str=(char*)cJSON_malloc(64);    /* This is a nice tradeoff. */
        if (str)
        {
            if (fabs(floor(d)-d)&lt;=DBL_EPSILON && fabs(d)&lt;1.0e60)
            {
                sprintf(str,"%.0f",d);
            }
            else if (fabs(d)&lt;1.0e-6 || fabs(d)&gt;1.0e9)
            {
                sprintf(str,"%e",d);
            }           
            else
            {
                sprintf(str,"%f",d);
            }                                           
        }
    }
    return str;
}

static unsigned parse_hex4(const char *str)
{
    unsigned h=0;
    if (*str&gt;='0' && *str&lt;='9')
    {
        h+=(*str)-'0'; 
    } 
    else if (*str&gt;='A' && *str&lt;='F')
    { 
        h+=10+(*str)-'A';
    } 
    else if (*str&gt;='a' && *str&lt;='f')
    { 
        h+=10+(*str)-'a';
    } 
    else
    { 
        return 0;
    }
    h=h&lt;&lt;4;str++;
    if (*str&gt;='0' && *str&lt;='9')
    { 
        h+=(*str)-'0'; 
    }
    else if (*str&gt;='A' && *str&lt;='F')
    { 
        h+=10+(*str)-'A'; 
    }
    else if (*str&gt;='a' && *str&lt;='f')
    { 
        h+=10+(*str)-'a'; 
    }
    else
    { 
        return 0;
    }
    h=h&lt;&lt;4;str++;
    if (*str&gt;='0' && *str&lt;='9')
    { 
        h+=(*str)-'0'; 
    }
    else if (*str&gt;='A' && *str&lt;='F')
    { 
        h+=10+(*str)-'A'; 
    }
    else if (*str&gt;='a' && *str&lt;='f')
    { 
        h+=10+(*str)-'a';
    } 
    else
    { 
        return 0;
    }
    h=h&lt;&lt;4;str++;
    if (*str&gt;='0' && *str&lt;='9')
    { 
        h+=(*str)-'0'; 
    }
    else if (*str&gt;='A' && *str&lt;='F')
    { 
        h+=10+(*str)-'A'; 
    }
    else if (*str&gt;='a' && *str&lt;='f')
    { 
        h+=10+(*str)-'a'; 
    }
    else
    { 
        return 0;
    }
    return h;
}

/* Parse the input text into an unescaped cstring, and populate item. */
static const unsigned char firstByteMark[7] = {
 0x00, 0x00, 0xC0, 0xE0, 0xF0, 0xF8, 0xFC };
static const char *parse_string(cJSON *item,const char *str)
{
    const char *ptr=str+1;
    char *ptr2;
    char *out;
    int len=0;
    unsigned uc,uc2;
    if (*str!='\"') 
    {
        //就是第一个字符不是'"', 所以就报错了
        //ep是一个全局变量
        ep=str;
        return 0;
    }   /* not a string! */
    //当*ptr不等于'"'且没遇到字符串尾且++len不等于0, 卧槽, 这里++len怎么可能等于0?
    while (*ptr!='\"' && *ptr && ++len) 
    {
        if (*ptr++ == '\\') 
        {
            ptr++;
        }
    }
    /* Skip escaped quotes. */
    //然后ptr就指向一个'"'了
    //然后就新开一段内存
    out=(char*)cJSON_malloc(len+1);
    /* This is how long we need for the string, roughly. */
    if (!out) 
    {
        return 0;
    }
    
    ptr=str+1;
    ptr2=out;
    while (*ptr!='\"' && *ptr)
    {
        //等特别处理转义字符
        if (*ptr!='\\')
        {
            *ptr2++=*ptr++;
        }
        else
        {
            ptr++;
            switch (*ptr)
            {
                case 'b': 
                    *ptr2++='\b';
                    break;
                case 'f': 
                    *ptr2++='\f';
                    break;
                case 'n': 
                    *ptr2++='\n';
                    break;
                case 'r': 
                    *ptr2++='\r';
                    break;
                case 't': 
                    *ptr2++='\t';
                    break;
                case 'u':    /* transcode utf16 to utf8. */
                    //对付unicode字符:utf-16,utf-8
                    uc=parse_hex4(ptr+1);
                    ptr+=4;
                    /* get the unicode char. */

                    if ((uc&gt;=0xDC00 && uc&lt;=0xDFFF) || uc==0)
                    {
                        break;
                    }
                    /* check for invalid.   */

                    if (uc&gt;=0xD800 && uc&lt;=0xDBFF)   /* UTF16 surrogate pairs.   */
                    {
                        if (ptr[1]!='\\' || ptr[2]!='u')
                        {
                            break;
                        }   
                            
                        /* missing second-half of surrogate.    */
                        uc2=parse_hex4(ptr+3);
                        ptr+=6;
                        if (uc2&lt;0xDC00 || uc2&gt;0xDFFF)
                        {
                            break;
                        }       
                        /* invalid second-half of surrogate.    */
                        uc=0x10000 + (((uc&0x3FF)&lt;&lt;10) | (uc2&0x3FF));
                    }

                    len=4;
                    if (uc&lt;0x80)
                    {
                        len=1;
                    } 
                    else if (uc&lt;0x800)
                    {
                        len=2;
                    } 
                    else if (uc&lt;0x10000)
                    {
                        len=3;
                    } 
                    ptr2+=len;
                    
                    switch (len) 
                    {
                        case 4: 
                            *--ptr2 =((uc | 0x80) & 0xBF);
                            uc &gt;&gt;= 6;
                        case 3: 
                            *--ptr2 =((uc | 0x80) & 0xBF);
                            uc &gt;&gt;= 6;
                        case 2: 
                            *--ptr2 =((uc | 0x80) & 0xBF);
                            uc &gt;&gt;= 6;
                        case 1: 
                            *--ptr2 =(uc | firstByteMark[len]);
                    }
                    ptr2+=len;
                    break;
                default:  
                    *ptr2++=*ptr;
                    break;
            }
            ptr++;
        }
    }
    *ptr2=0;
    if (*ptr=='\"')
    { 
        ptr++;
    }
    item-&gt;valuestring=out;
    item-&gt;type=cJSON_String;
    return ptr;
}

/* Render the cstring provided to an escaped version that can be printed. */
static char *print_string_ptr(const char *str)
{
    const char *ptr;
    char *ptr2,*out;
    int len=0;
    unsigned char token;
    
    if (!str)
    { 
        return cJSON_strdup("");
    }
    ptr=str;
    //统计长度
    while ((token=*ptr) && ++len) 
    {
        if (strchr("\"\\\b\f\n\r\t",token))
        { 
            len++;
        }
        else if (token&lt;32)
        { 
            len+=5;
        }
        ptr++;
    }
    //为什么加3, 因为你还得留着放'"','\n'呢
    out=(char*)cJSON_malloc(len+3);
    if (!out)
    {
        return 0;
    } 
    ptr2=out;
    ptr=str;
    *ptr2++='\"';
    while (*ptr)
    {
        if ((unsigned char)*ptr&gt;31 && *ptr!='\"' && *ptr!='\\') 
        {
            *ptr2++=*ptr++;
        }
        else
        {
            *ptr2++='\\';
            switch (token=*ptr++)
            {
                case '\\':  
                    *ptr2++='\\';
                    break;
                case '\"':  
                    *ptr2++='\"';
                    break;
                case '\b':  
                    *ptr2++='b';
                    break;
                case '\f':  
                    *ptr2++='f';
                    break;
                case '\n':  
                    *ptr2++='n';
                    break;
                case '\r':  
                    *ptr2++='r';
                    break;
                case '\t':  
                    *ptr2++='t';
                    break;
                default: 
                    sprintf(ptr2,"u%04x",token);
                    ptr2+=5;
                    break;
                    /* escape and print */
            }
        }
    }
    *ptr2++='\"';
    *ptr2++=0;
    return out;
}
/* Invote print_string_ptr (which is useful) on an item. */
static char *print_string(cJSON *item)  
{
    return print_string_ptr(item-&gt;valuestring);
}

/* Predeclare these prototypes. */
static const char *parse_value(cJSON *item,const char *value);
static char *print_value(cJSON *item,int depth,int fmt);
static const char *parse_array(cJSON *item,const char *value);
static char *print_array(cJSON *item,int depth,int fmt);
static const char *parse_object(cJSON *item,const char *value);
static char *print_object(cJSON *item,int depth,int fmt);

//跳过空白符
/* Utility to jump whitespace and cr/lf */
static const char *skip(const char *in) 
{
    while (in && *in && (unsigned char)*in&lt;=32) 
    {
        in++;
    }
    return in;
}

/* Parse an object - create a new root, and populate. */
cJSON *cJSON_ParseWithOpts(const char *value,const char **return_parse_end,int require_null_terminated)
{
    const char *end=0;
    cJSON *c=cJSON_New_Item();
    ep=0;
    if (!c)
    {
        return 0;
        /* memory fail */
    }

    end=parse_value(c,skip(value));
    if (!end)   
    {
        cJSON_Delete(c);
        return 0;
    }   /* parse failure. ep is set. */

    /* if we require null-terminated JSON without appended garbage, skip and then check for a null terminator */
    if (require_null_terminated) 
    {
        end=skip(end);
        if (*end) 
        {
            cJSON_Delete(c);
            ep=end;
            return 0;
        }
    }
    if (return_parse_end) 
    {
        *return_parse_end=end;
    }
    return c;
}
/* Default options for cJSON_Parse */
cJSON *cJSON_Parse(const char *value) 
{
    return cJSON_ParseWithOpts(value,0,0);
}

/* Render a cJSON item/entity/structure to text. */
char *cJSON_Print(cJSON *item)              
{
    return print_value(item,0,1);
}

char *cJSON_PrintUnformatted(cJSON *item)   
{
    return print_value(item,0,0);
}

//这里就是解释器的核心所在了
/* Parser core - when encountering text, process appropriately. */
static const char *parse_value(cJSON *item,const char *value)
{
    if (!value)                     
    {
        return 0;
        /* Fail on null. */
    }
    if (!strncmp(value,"null",4))   
    {
        item-&gt;type=cJSON_NULL;
        return value+4;
    }
    if (!strncmp(value,"false",5))  
    {
        item-&gt;type=cJSON_False;
        return value+5;
    }
    if (!strncmp(value,"true",4))   
    {
        item-&gt;type=cJSON_True;
        item-&gt;valueint=1;
        return value+4;
    }
    if (*value=='\"')               
    {
        return parse_string(item,value);
    }
    if (*value=='-' || (*value&gt;='0' && *value&lt;='9'))    
    {
        return parse_number(item,value);
    }
    if (*value=='[')                
    {
        return parse_array(item,value);
    }
    if (*value=='{')                
    {
        return parse_object(item,value);
    }

    ep=value;
    return 0;
    /* failure. */
}

/* Render a value to text. */
static char *print_value(cJSON *item,int depth,int fmt)
{
    char *out=0;
    if (!item) 
    {
        return 0;
    }
    switch ((item-&gt;type)&255)
    {
        case cJSON_NULL:    
            out=cJSON_strdup("null");
            break;
        case cJSON_False:   
            out=cJSON_strdup("false");
            break;
        case cJSON_True:    
            out=cJSON_strdup("true");
            break;
        case cJSON_Number:  
            out=print_number(item);
            break;
        case cJSON_String:  
            out=print_string(item);
            break;
        case cJSON_Array:   
            out=print_array(item,depth,fmt);
            break;
        case cJSON_Object:  
            out=print_object(item,depth,fmt);
            break;
    }
    return out;
}

//解释数组
/* Build an array from input text. */
static const char *parse_array(cJSON *item,const char *value)
{
    cJSON *child;
    if (*value!='[')    
    {
        ep=value;
        return 0;
    }   /* not an array! */
    //确定是一个数组
    item-&gt;type=cJSON_Array;
    //然后跳过空白符
    value=skip(value+1);
    //如果跳过之后, 就确定为空数组, 然后就返回了
    if (*value==']') 
    {
        return value+1;
        /* empty array. */
    }
    //如果不是空数组, 就new一个Item
    item-&gt;child=child=cJSON_New_Item();
    if (!item-&gt;child)
    {
        //如果内存分配出错, 还是返回
        return 0;
        /* memory fail */
    } 
    //跳过空白, 然后解析, 然后继续跳过空白, 准备下一步解释
    value=skip(parse_value(child,skip(value)));
    /* skip any spacing, get the value. */
    if (!value)
    {
        //如果顺便就给跳完了, 说明一定是json字符串有问题
        return 0;
    } 
    //将数组解释成链表
    while (*value==',')//这意味着, 数组不能以,结尾
    {
        cJSON *new_item;
        if (!(new_item=cJSON_New_Item())) 
        {
            return 0;
            /* memory fail */
        }
        child-&gt;next=new_item;
        new_item-&gt;prev=child;
        child=new_item;
        value=skip(parse_value(child,skip(value+1)));
        if (!value)
        {
            return 0;
            /* memory fail */
        } 
    }
    //解释完最后一个元素之后, 碰到']'才算正常, 否则就报错返回了
    if (*value==']')
    {
        return value+1;
        /* end of array */
    } 
    ep=value;
    return 0;
    /* malformed. */
}

/* Render an array to text */
static char *print_array(cJSON *item,int depth,int fmt)
{
    char **entries;
    char *out=0,*ptr,*ret;
    int len=5;
    cJSON *child=item-&gt;child;
    int numentries=0,i=0,fail=0;
    //统计数组有几个元素
    /* How many entries in the array? */
    while (child) 
    {
        numentries++;
        child=child-&gt;next;
    }
    /* Explicitly handle numentries==0 */
    if (!numentries)
    {
        out=(char*)cJSON_malloc(3);
        if (out) 
        {
            strcpy(out,"[]");
        }
        return out;
    }
    /* Allocate an array to hold the values for each */
    //开了个二维数组
    entries=(char**)cJSON_malloc(numentries*sizeof(char*));
    if (!entries)
    {
        return 0;
    } 
    memset(entries,0,numentries*sizeof(char*));
    /* Retrieve all the results: */
    child=item-&gt;child;
    while (child && !fail)
    {
        //迭代统计元素的长度
        ret=print_value(child,depth+1,fmt);
        //然后把元素对应的字符串存起来
        entries[i++]=ret;
        if (ret) 
        {
            len+=strlen(ret)+2+(fmt?1:0);
        }
        else 
        {
            //ret为空表示你没有内存了
            fail=1;
        }
        child=child-&gt;next;
    }
    
    /* If we didn't fail, try to malloc the output string */
    //然后开一个超级大的内存
    if (!fail)
    {
        out=(char*)cJSON_malloc(len);
    }
    /* If that fails, we fail. */
    if (!out) 
    {
        fail=1;
    }
    /* Handle failure. */
    //如果大内存开失败了, 或者刚刚迭代统计的时候就已经失败了, 就把内存全free掉
    if (fail)
    {
        for (i=0;i&lt;numentries;i++)
        {
            if (entries[i])
            {
                cJSON_free(entries[i]);
            } 
        } 
        cJSON_free(entries);
        return 0;
    }
    
    /* Compose the output array. */
    *out='[';
    ptr=out+1;
    *ptr=0;
    //然后一个一个拷贝
    for (i=0;i&lt;numentries;i++)
    {
        strcpy(ptr,entries[i]);
        ptr+=strlen(entries[i]);
        if (i!=numentries-1) 
        {
            *ptr++=',';
            if(fmt)*ptr++=' ';
            *ptr=0;
        }
        cJSON_free(entries[i]);
    }
    //最后记得把entries释放掉
    cJSON_free(entries);
    *ptr++=']';
    *ptr++=0;
    return out; 
}

//解释对象
/* Build an object from the text. */
static const char *parse_object(cJSON *item,const char *value)
{
    cJSON *child;
    //当然, '{'开头的才是对象
    if (*value!='{')    
    {
        ep=value;
        return 0;
    }   /* not an object! */
    //确定类型为object
    item-&gt;type=cJSON_Object;
    //然后跳过空白后
    value=skip(value+1);
    //如果发现下一个字符已经是'}'了, 说明是空对象
    if (*value=='}') 
    {
        return value+1;
        /* empty array. */
    }
    //不是空对象的话, 就new一个item
    item-&gt;child=child=cJSON_New_Item();
    if (!item-&gt;child)
    {
        return 0;
    } 
    //下一个应该是key, 所以用parse_string去解释, 如果不是key, 自然就报错了
    value=skip(parse_string(child,skip(value)));
    if (!value)
    {
        return 0;
    } 
    //因为解释会把字符串的指针赋给valuestring, 所以这时候应该把这个指针赋给string, 即key
    child-&gt;string=child-&gt;valuestring;
    child-&gt;valuestring=0;
    //下一步是找到冒号
    if (*value!=':') 
    {
        ep=value;
        return 0;
    }   /* fail! */
    //冒号后面是value, 所以就是用parse_value, 多跳了一格是因为刚刚的冒号
    value=skip(parse_value(child,skip(value+1)));
    /* skip any spacing, get the value. */
    if (!value)
    {
        return 0;
    } 
    //解释完之后, 因为有过个键值对, 所以, 但依然能发现逗号的时候, 就一直迭代解释
    //实际上, 也是解释为一个链表
    //超过跟刚才是一样的
    while (*value==',')
    {
        cJSON *new_item;
        if (!(new_item=cJSON_New_Item()))
        {
            return 0;
            /* memory fail */
        }   
        child-&gt;next=new_item;
        new_item-&gt;prev=child;
        child=new_item;
        value=skip(parse_string(child,skip(value+1)));
        if (!value) 
        {
            return 0;
        }
        child-&gt;string=child-&gt;valuestring;
        child-&gt;valuestring=0;
        if (*value!=':') 
        {
            ep=value;
            return 0;
        }   /* fail! */
        value=skip(parse_value(child,skip(value+1)));
        /* skip any spacing, get the value. */
        if (!value)
        {
            return 0;
        } 
    }
    //最后得对上'}'才行, 不然就报错了
    if (*value=='}') 
    {
        return value+1;
    }
    /* end of array */
    ep=value;
    return 0;
    /* malformed. */
}

/* Render an object to text. */
static char *print_object(cJSON *item,int depth,int fmt)
{
    char **entries=0,**names=0;
    char *out=0,*ptr,*ret,*str;
    int len=7,i=0,j;
    cJSON *child=item-&gt;child;
    int numentries=0,fail=0;
    /* Count the number of entries. */
    //因为是链表, 所以通过不断next来计数所有键值对
    while (child)
    {
        numentries++;
        child=child-&gt;next;
    } 
    /* Explicitly handle empty object case */
    //如果键值对的数目为0
    if (!numentries)
    {
        //fmt表示是否缩进, 缩进的话, 要加上许多\t
        //不缩进的话, 只需要'{}\0'的位置就够了, 所以是3
        out=(char*)cJSON_malloc(fmt?depth+4:3);
        if (!out)
        {
            return 0;
        }   
        ptr=out;
        *ptr++='{';
        if (fmt) 
        {
            *ptr++='\n';
            //这里就是加上多个\t了
            for (i = 0; i &lt; depth - 1; i++)
            {
                *ptr++ = '\t';
            }
        }
        *ptr++='}';
        *ptr++=0;
        return out;
    }
    /* Allocate space for the names and the objects */
    //存value的数组
    entries=(char**)cJSON_malloc(numentries*sizeof(char*));
    if (!entries)
    { 
        return 0;
    }
    //存key的数组
    names=(char**)cJSON_malloc(numentries*sizeof(char*));
    if (!names) 
    {
        cJSON_free(entries);
        return 0;
    }
    memset(entries,0,sizeof(char*)*numentries);
    memset(names,0,sizeof(char*)*numentries);
    /* Collect all the results into our arrays: */
    child=item-&gt;child;
    //深度增加, 为格式化输出做准备
    depth++;
    if (fmt)
    {
        //如上面解释, 如果是格式化的, 需要的内存是不一样的
        //这么看, 这里使用\t缩进而不用空耳缩进也是挺有道理的一件事
        len+=depth;
    }
    //然后就循环调用key和value的print函数
    //然后计算他们的长度
    while (child)
    {
        names[i]=str=print_string_ptr(child-&gt;string);
        entries[i++]=ret=print_value(child,depth,fmt);
        if (str && ret)
        { 
            //这里是计算长度的
            len+=strlen(ret)+strlen(str)+2+(fmt?2+depth:0);
        }
        else
        { 
            fail=1;
        }
        child=child-&gt;next;
    }
    
    /* Try to allocate the output string */
    if (!fail)
    { 
        out=(char*)cJSON_malloc(len);
    }
    if (!out)
    {
        fail=1;
    }
    /* Handle failure */
    //如果失败, 就把刚刚用递归得到的元素的内存释放掉, 然后把存他们指针的数组也释放了
    if (fail)
    {
        for (i=0;i&lt;numentries;i++) 
        {
            if (names[i])
            { 
                cJSON_free(names[i]);
            }
            if (entries[i])
            { 
                cJSON_free(entries[i]);
            }
        }
        cJSON_free(names);
        cJSON_free(entries);
        return 0;
    }
    //这才正式开始
    /* Compose the output: */
    *out='{';
    ptr=out+1;
    if(fmt)
    {
        *ptr++='\n';
    }
    *ptr=0;
    for (i=0;i&lt;numentries;i++)
    {
        if (fmt)
        {
            for (j=0;j&lt;depth;j++)
            { 
                *ptr++='\t';
            }
        }
        strcpy(ptr,names[i]);
        ptr+=strlen(names[i]);
        //这里可以看到键值对中间的冒号
        *ptr++=':';
        if (fmt)
        { 
            *ptr++='\t';
        }
        strcpy(ptr,entries[i]);
        ptr+=strlen(entries[i]);
        if (i!=numentries-1)
        { 
            *ptr++=',';
        }
        if (fmt)
        { 
            *ptr++='\n';
        }
        *ptr=0;
        cJSON_free(names[i]);
        cJSON_free(entries[i]);
    }
    
    cJSON_free(names);
    cJSON_free(entries);
    if (fmt)
    { 
        for (i=0;i&lt;depth-1;i++) 
        {
            *ptr++='\t';
        }
    }
    *ptr++='}';
    *ptr++=0;
    //其实我有点奇怪, 开头和结束都没有加换行是为什么?
    return out;
}

//获取数组的长度, 没什么好讲的
/* Get Array size/item / object item. */
int cJSON_GetArraySize(cJSON *array)                            
{
    cJSON *c=array-&gt;child;
    int i=0;
    while(c)
    {
        i++;
        c=c-&gt;next;
    }
    return i;
}

//获取数组中索引为item的对象
cJSON *cJSON_GetArrayItem(cJSON *array,int item)                
{
    cJSON *c=array-&gt;child;
    while (c && item&gt;0)
    { 
        item--;
        c=c-&gt;next;
    }
    return c;
}
//根据key来找value
cJSON *cJSON_GetObjectItem(cJSON *object,const char *string)    
{
    cJSON *c=object-&gt;child;
    //这里用的是最上面定义那个不区分大小写的字符串比较函数
    while (c && cJSON_strcasecmp(c-&gt;string,string))
    {
        c=c-&gt;next;
    } 
    return c;
}

/* Utility for array list handling. */
//这里应该是插入了一个item, 但是为什么叫suffix呢?
static void suffix_object(cJSON *prev,cJSON *item) 
{
    prev-&gt;next=item;
    item-&gt;prev=prev;
}
/* Utility for handling references. */
//创建一个引用, 但是这个引用是独立的一个json
static cJSON *create_reference(cJSON *item) 
{
    cJSON *ref=cJSON_New_Item();
    if (!ref)
    { 
        return 0;
    }
    memcpy(ref,item,sizeof(cJSON));
    ref-&gt;string=0;
    ref-&gt;type|=cJSON_IsReference;
    ref-&gt;next=ref-&gt;prev=0;
    return ref;
}

/* Add item to array/object. */
void cJSON_AddItemToArray(cJSON *array, cJSON *item)                        
{
    cJSON *c=array-&gt;child;
    if (!item)
    { 
        return;
    }
    if (!c) 
    {
        array-&gt;child=item;
    } 
    else 
    {
        //插到最后
        while (c && c-&gt;next)
        { 
            c=c-&gt;next;
        }
        suffix_object(c,item);
    }
}

void cJSON_AddItemToObject(cJSON *object,const char *string,cJSON *item)    
{
    if (!item) 
    {
        return;
    }
    //如果item本来是有一个string的, 就free掉, 用新的string替换掉, 作为key
    if (item-&gt;string)
    { 
        cJSON_free(item-&gt;string);
    }
    //这里是最开始定义那个字符串复制函数
    item-&gt;string=cJSON_strdup(string);
    //然后同数组插入那套路, 因为他们都是链表
    cJSON_AddItemToArray(object,item);
}

//添加引用到数组
void cJSON_AddItemReferenceToArray(cJSON *array, cJSON *item)                       
{
    cJSON_AddItemToArray(array,create_reference(item));
}
//添加引用到对象
void cJSON_AddItemReferenceToObject(cJSON *object,const char *string,cJSON *item)   
{
    cJSON_AddItemToObject(object,string,create_reference(item));
}
//从数组中分离对象, 这样, 数组就不包括这个对象了, 函数返回了这个对象的指针
cJSON *cJSON_DetachItemFromArray(cJSON *array,int which)            
{
    cJSON *c=array-&gt;child;
    while (c && which&gt;0)
    { 
        c=c-&gt;next;
        which--;
    }
    if (!c)
    { 
        return 0;
    }
    if (c-&gt;prev)
    { 
        c-&gt;prev-&gt;next=c-&gt;next;
    }
    if (c-&gt;next) 
    {
        c-&gt;next-&gt;prev=c-&gt;prev;
    }
    if (c==array-&gt;child) 
    {
        array-&gt;child=c-&gt;next;
    }
    c-&gt;prev=c-&gt;next=0;
    return c;
}

//这里就是数组中删除对象了, 先分离, 然后释放
void  cJSON_DeleteItemFromArray(cJSON *array,int which)         
{
    cJSON_Delete(cJSON_DetachItemFromArray(array,which));
}

//从对象中分离对象.....好吧, 从object中分离item
cJSON *cJSON_DetachItemFromObject(cJSON *object,const char *string) 
{
    int i=0;
    cJSON *c=object-&gt;child;
    while (c && cJSON_strcasecmp(c-&gt;string,string))
    { 
        i++;
        c=c-&gt;next;
    }
    if (c)
    { 
        return cJSON_DetachItemFromArray(object,i);
    }
    return 0;
}

void cJSON_DeleteItemFromObject(cJSON *object,const char *string) 
{
    cJSON_Delete(cJSON_DetachItemFromObject(object,string));
}

//替换array中的item
/* Replace array/object items with new ones. */
void  cJSON_ReplaceItemInArray(cJSON *array,int which,cJSON *newitem)       
{
    //先替换
    cJSON *c=array-&gt;child;
    while (c && which&gt;0)
    { 
        c=c-&gt;next;
        which--;
    }
    if (!c)
    { 
        return;
    }
    newitem-&gt;next=c-&gt;next;
    newitem-&gt;prev=c-&gt;prev;
    if (newitem-&gt;next)
    { 
        newitem-&gt;next-&gt;prev=newitem;
    }
    if (c==array-&gt;child)
    { 
        array-&gt;child=newitem;
    }
    else
    { 
        newitem-&gt;prev-&gt;next=newitem;
    }
    c-&gt;next=c-&gt;prev=0;
    //然后把原来的释放掉
    cJSON_Delete(c);
}

//替换object的item, 先找到那个item, 然后用替换数组item的函数去替换掉
void  cJSON_ReplaceItemInObject(cJSON *object,const char *string,cJSON *newitem)
{
    int i=0;
    cJSON *c=object-&gt;child;
    while(c && cJSON_strcasecmp(c-&gt;string,string))
    {
        i++;
        c=c-&gt;next;
    }
    if(c)
    {
        newitem-&gt;string=cJSON_strdup(string);
        cJSON_ReplaceItemInArray(object,i,newitem);
    }
}

/* Create basic types: */
//创建一个空对象
cJSON *cJSON_CreateNull(void)                   
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_NULL;
    }
    return item;
}
//创建一个true对象
cJSON *cJSON_CreateTrue(void)                   
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_True;
    }
    return item;
}
//创建一个false
cJSON *cJSON_CreateFalse(void)                  
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_False;
    }
    return item;
}
//创建一个布尔对象, 避暑true就是false
cJSON *cJSON_CreateBool(int b)                  
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=b? cJSON_True:cJSON_False;
    }
    return item;
}
//创建一个number           
cJSON *cJSON_CreateNumber(double num)           
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_Number;
        //他一个number值有两个的, 一个是int型, 一个是double型
        item-&gt;valuedouble=num;
        item-&gt;valueint=(int)num;
    }
    return item;
}
//创建一个string
cJSON *cJSON_CreateString(const char *string)   
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_String;
        item-&gt;valuestring=cJSON_strdup(string);
    }
    return item;
}
//创建一个数组
cJSON *cJSON_CreateArray(void)                  
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_Array;
    }
    return item;
}
//创建一个对象
cJSON *cJSON_CreateObject(void)                 
{
    cJSON *item=cJSON_New_Item();
    if(item)
    {
        item-&gt;type=cJSON_Object;
    }
    return item;
}

/* Create Arrays: */
//用一个数组创建一个json数组
cJSON *cJSON_CreateIntArray(const int *numbers,int count)       
{
    int i;
    cJSON *n=0,*p=0,*a=cJSON_CreateArray();
    for(i=0;a && i&lt;count;i++)
    {
        n=cJSON_CreateNumber(numbers[i]);
        if(!i)
        {
            a-&gt;child=n;
        }
        else
        { 
            suffix_object(p,n);
        }
        p=n;
    }
    return a;
}
//用一个数组创建一个json数组, 浮点型
cJSON *cJSON_CreateFloatArray(const float *numbers,int count)   
{
    int i;
    cJSON *n=0,*p=0,*a=cJSON_CreateArray();
    for(i=0;a && i&lt;count;i++)
    {
        n=cJSON_CreateNumber(numbers[i]);
        if(!i)
        {
            a-&gt;child=n;
        }
        else
        { 
            suffix_object(p,n);
        }
        p=n;
    }
    return a;
}
// 同上, double型
cJSON *cJSON_CreateDoubleArray(const double *numbers,int count) 
{
    int i;
    cJSON *n=0,*p=0,*a=cJSON_CreateArray();
    for(i=0;a && i&lt;count;i++)
    {
        n=cJSON_CreateNumber(numbers[i]);
        if(!i)
        {
            a-&gt;child=n;
        }
        else
        { 
            suffix_object(p,n);
        }
        p=n;
    }
    return a;
}
// 用上, 字符串型
cJSON *cJSON_CreateStringArray(const char **strings,int count)  
{
    int i;
    cJSON *n=0,*p=0,*a=cJSON_CreateArray();
    for(i=0;a && i&lt;count;i++)
    {
        n=cJSON_CreateString(strings[i]);
        if(!i)
        {
            a-&gt;child=n;
        }
        else 
        {
            suffix_object(p,n);
        }
        p=n;
    }
    return a;
}

/* Duplication */
// 复制一个json对象, recurse表示是否递归地复制
cJSON *cJSON_Duplicate(cJSON *item,int recurse)
{
    cJSON *newitem;
    cJSON *cptr;
    cJSON *nptr = 0;
    cJSON *newchild;
    /* Bail on bad ptr */
    if (!item)
    { 
        return 0;
    }
    /* Create new item */
    newitem=cJSON_New_Item();
    if (!newitem) 
    {
        return 0;
    }
    /* Copy over all vars */
    //这里何解, 我也看不懂
    newitem-&gt;type=item-&gt;type&(~cJSON_IsReference);
    newitem-&gt;valueint=item-&gt;valueint;
    newitem-&gt;valuedouble=item-&gt;valuedouble;
    if (item-&gt;valuestring)  
    {
        newitem-&gt;valuestring=cJSON_strdup(item-&gt;valuestring);
        if (!newitem-&gt;valuestring)  
        {
            cJSON_Delete(newitem);
            return 0;
        }
    }
    if (item-&gt;string)       
    {
        newitem-&gt;string=cJSON_strdup(item-&gt;string);
        if (!newitem-&gt;string)       
        {
            cJSON_Delete(newitem);
            return 0;
        }
    }
    /* If non-recursive, then we're done! */
    if (!recurse)
    {
        return newitem;
    } 
    /* Walk the -&gt;next chain for the child. */
    cptr=item-&gt;child;
    //然后对每一个元素递归调用复制
    while (cptr)
    {
        newchild=cJSON_Duplicate(cptr,1);
        /* Duplicate (with recurse) each item in the -&gt;next chain */
        if (!newchild) 
        {
            cJSON_Delete(newitem);
            return 0;
        }
        if (nptr)   
        {
            nptr-&gt;next=newchild,newchild-&gt;prev=nptr;
            nptr=newchild;
        }   
        /* If newitem-&gt;child already set, then crosswire -&gt;prev and -&gt;next and move on */
        else        
        {
            newitem-&gt;child=newchild;
            nptr=newchild;
        }                   
        /* Set newitem-&gt;child and move to it */
        cptr=cptr-&gt;next;
    }
    return newitem;
}

//压缩json字符串的
void cJSON_Minify(char *json)
{
    char *into=json;
    while (*json)
    {
        if (*json==' ')
        { 
            json++;
        }
        else if (*json=='\t')
        { 
            json++;
        }
        // Whitespace characters.
        else if (*json=='\r')
        { 
            json++;
        }
        else if (*json=='\n') 
        {
            json++;
        }
        else if (*json=='/' && json[1]=='/')
        {  
            while (*json && *json!='\n') 
            {
                json++;
            }
        }
        //卧槽, 还有注释的?
        // double-slash comments, to end of line.
        else if (*json=='/' && json[1]=='*') 
        {
            while (*json && !(*json=='*' && json[1]=='/'))
            { 
                json++;
            }
            json+=2;
        }   // multiline comments.
        else if (*json=='\"')
        {
            *into++=*json++;
            while (*json && *json!='\"')
            {
                if (*json=='\\')
                { 
                    *into++=*json++;
                }
                *into++=*json++;
            }
            *into++=*json++;
        } // string literals, which are \" sensitive.
        else
        { 
            *into++=*json++;
        }
        // All other characters.
    }
    *into=0;
    // and null-terminate.
}
</pre>