---
layout: home
---

<div class="index-content blog">
    <div class="section">
        <ul class="artical-cate">
            <li ><a href="http://doc.eicsu.com/system"><span>制度文档</span></a></li>
            <li class="on"><a href="http://doc.eicsu.com/planning"><span>策划</span></a></li>
            <li ><a href="http://doc.eicsu.com/summary"><span>总结</span></a></li>
            <li ><a href="http://doc.eicsu.com/survey"><span>调研</span></a></li>
        </ul>

        <div class="cate-bar"><span id="cateBar"></span></div>

        <ul class="artical-list">
        {% for post in site.categories.planning %}
            <li>
                <h2><a href="http://doc.eicsu.com/{{ post.url }}">{{ post.title }}</a></h2>
                <div class="title-desc">{{ post.description }}</div>
            </li>
        {% endfor %}
        </ul>
    </div>
</div>
