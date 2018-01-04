---
layout: home
---

<div class="index-content blog">
    <div id="game"> <canvas id="canvas" ></canvas></div>
    <div class="section">
        <ul class="artical-cate">
            <li><a href="/blog"><span>Blog</span></a></li>
            <li><a href="/sf"><span>SF</span></a></li>
            <li class="on" ><a href="/project"><span>Project</span></a></li>
        </ul>

        <div class="cate-bar"><span id="cateBar"></span></div>

        <ul class="artical-list">
        {% for post in site.categories.project %}
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
