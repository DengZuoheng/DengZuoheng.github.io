---
layout: post
title: 二叉树遍历的种种
description: 好吧, 我们又要遍历二叉树了 
category: blog
---

### 为什么会有前序, 中序, 后序三种遍历方式?

我也想知道, 这个以后再说

### 三种递归遍历

这个很常见, 先不写

### 三种非递归遍历

这个也挺常见, 也先不写

### 给节点, 找后继

这个最近面试才碰到, 以前没玩过, 先写了.

做事情先得有个思路, 然后才能优化, 找后继这事就是, 对给出的节点的情况分别讨论, 然后逐步合并不同的case, 最后应该能达到最简洁的写法, 我猜...

中序遍历找后继: 首先判断这个节点有没右子节点, 有的话就返回右子树的最左节点, 没有的话, 就上溯到第一个不是右子节点的祖先, 然后返回这个祖先的父节点.

前序遍历找后继: 如果有左子节点, 就返回左子节点; 如果有右子节点, 就返回右子节点; 都没有, 就找第一个, 使这个节点为其左子树节点, 的祖先, 然后返回这个祖先节点的右子节点.

后序遍历找后继: 如果是左子节点, 而且其父节点有右子节点, 这返回其父节点的右子树的最左; 其余情况返回其父节点.

为了实现这些思路, 首先你需要一个...节点:

<pre>
struct Node
{
    int data;
    Node* left;
    Node* right;
    Node* parent;
};
</pre>

然后需要一些判断有没孩子啊, 是哪个孩子啊, 有没父节点啊, 之类的辅助函数:

<pre>

int is_left_child(struct Node* node)
{
    if(node && node->parent && node->parent->left)
    {
        return node->parent->left == node;
    }
    return 0;
}

int has_left_child(struct Node* node)
{
    return node && node->left;
}

int has_two_child(struct Node* node)
{
    return has_left_child(node)&&has_right_child(node)
}

int is_right_child(struct Node* node)
{
    if(node && node->parent && node->parent->right)
    {
        return node->parent->right == node;
    }
    return 0;
}

int has_right_child(struct Node* node)
{
    return node && node->right;
}

int has_parent(struct Node* node)
{
    return node && node->parent;
}

</pre>

然后就是实现了:

- 中序:

<pre>
/*如果有右子树, 则返回右子树最左
如果没有右子树, 这上溯到第一个不是右子节点的祖先, 
然后返回这个祖先的父节点*/
struct Node* find_inorder_next(struct Node* node)
{
    if(NULL == node)
    {
        return NULL;
    }
    if (has_right_child(node))
    {
        struct Node* tmp = node->right;
        while(has_left_child(tmp))
        {
            tmp=tmp->left;
        }
        return tmp;
    }
    else
    {
        struct Node* tmp = node;
        while(is_right_child(tmp) && has_parent(tmp))
        {
            tmp = tmp->parent;
        }
        return tmp->parent;
    }
    
}
</pre>

- 前序:

<pre>
/*如果有左子节点, 就返回左子节点
如果有右子节点, 就返回右子节点
都没有, 就找第一个, 使这个节点为其左子树节点, 的祖先,
然后返回这个祖先节点的右子节点*/
struct Node* find_preorder_next(struct Node* node)
{
    if(NULL == node)
    {
        return NULL;
    }
    if(has_left_child(node))
    {
        return node->left;
    }
    else if (has_right_child(node))
    {
        return node->right;
    }
    else
    {    
        struct Node* tmp = node;
        //找第一个使其为左子树节点的祖先节点
        //然后返回这个祖先节点的右子节点
        //一直找不到就意味着已经是最后一个了
        while(tmp)
        {
            if (has_two_child(tmp->parent) && is_left_child(tmp))
            {
                return tmp->parent->right;
            }
            else
            {
                tmp = tmp->parent;
            }
        }
        return tmp;
        
    }
}
</pre>

- 后序

<pre>
/*如果是左子节点, 而且其父节点有右子节点, 这返回其父节点的右子树的最左
其余情况返回其父节点*/
struct Node* find_postorder_next(struct Node* node)
{
    if(NULL == node)
    {
        return NULL;
    }
    if (is_left_child(node)&&has_right_child(node->parent))
    {
        struct Node* tmp = node->parent->right;
        while(has_left_child(tmp))
        {
            tmp = tmp->left;
        }
        return tmp;
    }
    else
    {
        return node->parent;
    }
}
</pre>

**Reference:**  

* {:.ref} \[1]: flyinsail. [二叉树遍历的前驱和后继 - 饮水思源](http://bbs.sjtu.edu.cn/bbscon,board,Algorithm,file,M.1041171619.A.html)