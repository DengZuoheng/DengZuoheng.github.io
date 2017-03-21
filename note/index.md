---
layout: home
---

<div class="index-content blog">
    <div class="section">
        <ul class="artical-cate">
            <li><a href="/blog"><span>Blog</span></a></li>
            <li class="on"><a href="/note"><span>note</span></a></li>
            <li ><a href="/project"><span>project</span></a></li>
        </ul>

        <div class="cate-bar"><span id="cateBar"></span></div>

        <ul class="artical-list">
        {% for post in site.categories.note %}
            <li>
                <h2><a href="http://dengzuoheng.github.io{{ post.url }}">{{ post.title }}</a></h2>
                <div class="title-desc">{{ post.date|date:"%Y-%m-%d" }}&emsp;{{ post.description }}</div>
            </li>
        {% endfor %}
            <li>
                {% include footer.html %}
            </li>
        </ul>
    </div>
</div>
