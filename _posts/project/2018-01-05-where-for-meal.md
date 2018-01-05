---
layout: post
title: 吾日三省吾身
description: 早餐吃什么, 午餐是什么, 晚餐吃什么
category: project
---

<p>
    <input type="checkbox" id="1" class="option" value="A3"> A3 <br>
    <input type="checkbox" id="2" class="option" value="快乐园"> 快乐园 <br>
    <input type="checkbox" id="3" class="option" value="嘉旺"> 嘉旺 <br>
    <input type="checkbox" id="4" class="option" value="排骨饭"> 排骨饭 <br>
    <input type="checkbox" id="5" class="option" value="吉野家"> 吉野家 <br>
    <input type="checkbox" id="6" class="option" value="六千馆"> 六千馆 <br>
    <input type="checkbox" id="7" class="option" value="楼下"> 楼下 <br>
</p>
<h2 id="result"></h2>
<button id="submit">随便</button>
<script type="text/javascript">
    document.querySelector("#submit").onclick=function() {
        var allOption = document.querySelectorAll(".option");
        var checkedOption = [];
        allOption.forEach(function(obj, idx) {
            if (obj.checked) {
                checkedOption.push(obj.id);
            }
        });
        let randomIdx = Math.floor(Math.random() * checkedOption.length);
        let selectedId = checkedOption[randomIdx];
        let result = document.getElementById(selectedId).value;
        document.getElementById("result").innerHTML = result;  
    }
</script>