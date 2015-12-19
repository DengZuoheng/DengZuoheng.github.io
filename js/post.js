$(document).ready(function(){

    var isMobile = {
        Android: function() {
            return navigator.userAgent.match(/Android/i);
        }
        ,BlackBerry: function() {
            return navigator.userAgent.match(/BlackBerry/i);
        }
        ,iOS: function() {
            return navigator.userAgent.match(/iPhone|iPad|iPod/i);
        }
        ,Opera: function() {
            return navigator.userAgent.match(/Opera Mini/i);
        }
        ,Windows: function() {
            return navigator.userAgent.match(/IEMobile/i);
        }
        ,any: function() {
            return (isMobile.Android() || isMobile.BlackBerry() || isMobile.iOS() || isMobile.Opera() || isMobile.Windows());
        }
    };

    $('pre').addClass('prettyprint linenums'); //添加Google code Hight需要的class

    
    window.disqus_shortname = 'dengzuohenggithubio'; // required: replace example with your forum shortname
    $('#disqus_container .comment').on('click',function(){
        $(this).html('加载中...');
        var that = this;
        $.getScript('http://' + disqus_shortname + '.disqus.com/embed.js',function(){$(that).remove()});
    });
    
    
    $('.entry a').each(function(index,element){
        var href = $(this).attr('href');
        if(href){
            if(href.indexOf('#') == 0){
            }else if ( href.indexOf('/') == 0 || href.toLowerCase().indexOf('dengzuoheng.github.io')>-1 ){
            }else if ($(element).has('img').length){
            }else{
                $(this).attr('target','_blank');
                $(this).addClass('external');
            }
        }
    });

    (function(){
        var ie6 = ($.browser.msie && $.browser.version=="6.0") ? true : false;

        function initHeading(){
            var h2 = [];
            var h3 = [];
            var h4 = [];
            var h2index = 0;
            var h3index = 0;

            $('.entry h2, .entry h3, .entry h4').each(function(index,item){
                console.log($(item).html());
                if(item.tagName.toLowerCase() == 'h2'){
                    var h2item = {};
                    h2item.name = $(item).text();
                    h2item.id = 'menuIndex'+index;
                    h2.push(h2item);
                    h2index++;
                }else if(item.tagName.toLowerCase()=='h3'){
                    var h3item = {};
                    h3item.name=$(item).text();
                    h3item.id='menuIndex'+index;
                    if(!h3[h2index-1]){
                        h3[h2index-1]=[];
                    }
                    h3[h2index-1].push(h3item);
                    h3index++;
                    
                }else{
                    var h4item = {};
                    h4item.name = $(item).text();
                    h4item.id = 'menuIndex'+index;
                    if(!h4[h3index-1]){
                        h4[h3index-1] = [];
                    }
                    h4[h3index-1].push(h4item);
                }
                item.id = 'menuIndex' + index;
            });
            console.log({h2:h2,h3:h3,h4:h4});
            return {h2:h2,h3:h3,h4:h4}
        }
        function genTmpl(){
            var h1txt = $('h1').text();
            var tmpl = '<ul><li class="h1"><a href="#">' + h1txt + '</a></li>';

            var heading = initHeading();
            console.log(heading);
            var h2 = heading.h2;
            var h3 = heading.h3;
            var h4 = heading.h4;

            for(var i=0;i<h2.length;i++){
                tmpl += '<li><a href="#" data-id="'+h2[i].id+'">'+h2[i].name+'</a></li>';

                if(h3[i]){
                    for(var j=0;j<h3[i].length;j++){
                        tmpl += '<li class="h3"><a href="#" data-id="'+h3[i][j].id+'">'+h3[i][j].name+'</a></li>';
                        
                        if(h4[j]){
                            for(var k=0;k<h4[j].length;k++){
                                tmpl+='<li class="h4"><a href="#" data-id="'+h4[j][k].id+'">'+h4[j][k].name+'</a></li>';
                            }
                        }
                    }
                }
            }
            tmpl += '</ul>';
            console.log(tmpl);
            return tmpl;
        }

        function genIndex(){
            var tmpl = genTmpl();
            var indexCon = '<div id="menuIndex" class="sidenav"></div>';

            $('#content').append(indexCon);

            $('#menuIndex')
                .append($(tmpl))
                .delegate('a','click',function(e){
                    e.preventDefault();

                    var selector = $(this).attr('data-id') ? '#'+$(this).attr('data-id') : 'h1'
                    var scrollNum = $(selector).offset().top;

                    $('body, html').animate({ scrollTop: scrollNum-30 }, 400, 'swing');
                });
        }

        var waitForFinalEvent = (function () {
            var timers = {};
            return function (callback, ms, uniqueId) {
                if (!uniqueId) {
                    uniqueId = "Don't call this twice without a uniqueId";
                }
                if (timers[uniqueId]) {
                    clearTimeout (timers[uniqueId]);
                }
                timers[uniqueId] = setTimeout(callback, ms);
            };
        })();

        if($('.entry h3').length > 2 && !isMobile.any() && !ie6){

            genIndex();

            $(window).load(function(){
                var scrollTop = [];
                $.each($('#menuIndex li a'),function(index,item){
                    var selector = $(item).attr('data-id') ? '#'+$(item).attr('data-id') : 'h1'
                    var top = $(selector).offset().top;
                    scrollTop.push(top);
                });

                var menuIndexTop = $('#menuIndex').offset().top;
                var menuIndexLeft = $('#menuIndex').offset().left;

                $(window).scroll(function(){
                    waitForFinalEvent(function(){
                        var nowTop = $(window).scrollTop();
                        var length = scrollTop.length;
                        var index;

                        if(nowTop+20 > menuIndexTop){
                            $('#menuIndex').css({
                                position:'fixed'
                                ,top:'20px'
                                ,left:menuIndexLeft
                            });
                        }else{
                            $('#menuIndex').css({
                                position:'static'
                                ,top:0
                                ,left:0
                            });
                        }

                        if(nowTop+60 > scrollTop[length-1]){
                            index = length;
                        }else{
                            for(var i=0;i<length;i++){
                                if(nowTop+60 <= scrollTop[i]){
                                    index = i;
                                    break;
                                }
                            }
                        }
                        $('#menuIndex li').removeClass('on');
                        $('#menuIndex li').eq(index-1).addClass('on');
                    });
                });

                $(window).resize(function(){
                    $('#menuIndex').css({
                        position:'static'
                        ,top:0
                        ,left:0
                    });

                    menuIndexTop = $('#menuIndex').offset().top;
                    menuIndexLeft = $('#menuIndex').offset().left;

                    $(window).trigger('scroll')
                    $('#menuIndex').css('max-height',$(window).height()-80);
                });
            })

            //用js计算屏幕的高度
            $('#menuIndex').css('max-height',$(window).height()-80);
        }
    })();

    $.getScript('http://dengzuoheng.github.io/js/prettify/prettify.js',function(){
        prettyPrint();
    });

    if(/\#comment/.test(location.hash)){
        $('#disqus_container .comment').trigger('click');
    }

    if(/css3-animation/.test(location.href)){
        $("head").append("<link rel='stylesheet' type='text/css' href='/css/css3-ani.css'/>");
        $.getScript('/js/css3-ani.js',function(){});
    }
});
