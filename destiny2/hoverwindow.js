function textSwitching(info) {
    $("#info").html("");
    switch (info) {
        case 'sample':
            $("#info").text("このように情報が出ます");
            break;
        case 'starvation':
            $("#info").text("かけら「飢餓の残響」適用時の数値");
            break;
        case 'ash':
            $("#info").text("かけら「灰の名残」適用時の数値");
            break;
        case 'magnitude':
            $("#info").text("かけら「マグニチュードの火花」適用時の数値");
            break;
        case 'durance':
            $("#info").text("かけら「監禁の囁き」適用時の数値");
            break;
        case 'univ_debuff':
            $("#info").text("全体デバフ");
            break;
        case 'univ_buff':
            $("#info").text("強化バフ");
            break;
        case 'auto':
            $("#info").text("オートライフル");
            break;
        case 'sidearm':
            $("#info").text("ピストル");
            break;
        case 'smg':
            $("#info").text("サブマシンガン");
            break;
        case 'hc':
            $("#info").text("ハンドキャノン");
            break;
        case 'pulse':
            $("#info").text("パルスライフル");
            break;
        case 'scout':
            $("#info").text("スカウトライフル");
            break;
        case 'bow':
            $("#info").text("弓");
            break;
        case 'sr':
            $("#info").text("スナイパーライフル");
            break;
        case 'shotgun':
            $("#info").text("ショットガン");
            break;
        case 'fusion':
            $("#info").text("フュージョンライフル");
            break;
        case 'glspecial':
            $("#info").text("後装式グレネードランチャー");
            break;
        case 'trace':
            $("#info").text("トレースライフル");
            break;
        case 'glaive':
            $("#info").text("グレイブ");
            break;
        case 'rocket':
            $("#info").text("ロケットランチャー");
            break;
        case 'glheavy':
            $("#info").text("ドラム式グレネードランチャー");
            break;
        case 'mg':
            $("#info").text("マシンガン");
            break;
        case 'linear':
            $("#info").text("リニア・フュージョンライフル");
            break;
        case 'sword':
            $("#info").text("剣");
            break;
        case 'barrier':
            $("#info").text("バリア");
            break;
        case 'unstoppable':
            $("#info").text("アンストッパブル");
            break;
        case 'overload':
            $("#info").text("オーバーロード");
            break;
        case 'arc':
            $("#info").text("アーク");
            break;
        case 'solar':
            $("#info").text("ソーラー");
            break;
        case 'void':
            $("#info").text("ボイド");
            break;
        case 'stasis':
            $("#info").text("ステイシス");
            break;
        default:
            $("#info").text("ポップアップテキスト指定なし");
    }
}

var getFontSize = function() {
    var getSize = 0;
    var setId = 'get-font-size-area';
    var $tmpDiv = $('#' + setId);
    if ($tmpDiv.length === 0) {
        var setCss = {
            'margin': 0,
            'padding': 0,
            'border': 0,
            'height': 'auto',
            'display': 'none',
            'line-height': 1,
            'font-size': '1em'
        };

        $tmpDiv = $('<div>');
        $tmpDiv.attr('id', setId).css(setCss).text('&nbsp;');
        $('body').append($tmpDiv);
    }
    getSize = $tmpDiv.height();

    return getSize;
};

var setStyle = function(ele, styles) {
    Object.keys(styles).forEach(function(key) {
        ele.style[key] = styles[key];
    });
}

var calcStrWidth = function(str, sz, fmly) {
    var ele = document.createElement('span');
    ele.id = 'calc';
    ele.innerHTML = str;
    var styles = {
        'white-space': 'nowrap',
        'visibility': 'hidden'
    };
    if (sz != undefined) {
        styles['font-size'] = sz;
    }
    if (fmly != undefined) {
        styles['font-family'] = fmly;
    }
    setStyle(ele, styles);
    document.body.appendChild(ele);
    var ele_w = ele.offsetWidth;
    document.body.removeChild(ele);
    return ele_w;
};

var showingBalloon = false;

function hideBalloon() {
    var coords = {};
    coords.top = $(window).scrollTop();
    coords.left = 0;

    $("#hover-balloon").offset(coords);
    $('#hover-balloon').css('display', 'none');

    showingBalloon = false;
}

$(window).ready(function() {
    $('.balloon, .w-icons').hover(
        function() {
            if (window.matchMedia("(max-width: 768px)").matches == false && showingBalloon == false) {
                var raw = $(this).attr('class')
                var info = raw.split([" "]);

                textSwitching(info[1]);
                var coords = {};

                var top = $(this).offset().top;
                windowtop = $(window).scrollTop();

                coords.top = top - windowtop - 40;

                var widthPixel = $("#hover-balloon").outerWidth();
                if (info[0] == "w-icons") {
                    var iconWidthPixel = calcStrWidth($(this).text(), getFontSize(), 'Destiny_Keys');
                    coords.left = $(this).offset().left + (iconWidthPixel - widthPixel) * 0.5;
                } else
                    coords.left = $(this).offset().left - 20;

                $("#hover-balloon").offset(coords);
                $('#hover-balloon').css('display', 'inline-block');
                showingBalloon = true;
            }
        },
        function() {
            if (showingBalloon) {
                hideBalloon();
            }
        }
    );
    $(window).scroll(function() {
        if (showingBalloon) {
            hideBalloon();
        }
    });
    $('.balloon, .w-icons').on('click', function() {
        if (window.matchMedia("(max-width: 768px)").matches == true && showingBalloon == false) {
            var raw = $(this).attr('class')
            var info = raw.split([" "]);

            textSwitching(info[1]);
            var coords = {};

            var top = $(this).offset().top;
            windowtop = $(window).scrollTop();

            coords.top = top - windowtop - 40;

            var widthPixel = $("#hover-balloon").outerWidth();

            if (info[0] == "w-icons")
                var iconWidthPixel = calcStrWidth($(this).text(), getFontSize(), 'Destiny_Keys');
            else
                var iconWidthPixel = widthPixel * 2;
            if ($(this).offset().left + widthPixel < $(window).width() && $(this).offset().left + (iconWidthPixel - widthPixel) * 0.5 > 0) {
                var iconWidthPixel = calcStrWidth($(this).text(), getFontSize(), 'Destiny_Keys');
                if (info[0] == "w-icons") {
                    coords.left = $(this).offset().left + (iconWidthPixel - widthPixel) * 0.5;
                } else
                    coords.left = $(this).offset().left - 20;
            } else if ($(this).offset().left + widthPixel > $(window).width()) {
                coords.left = $(window).width() - widthPixel - 1;
            } else {
                coords.left = 1;
            }

            $("#hover-balloon").offset(coords);
            $('#hover-balloon').css('display', 'inline-block');
            showingBalloon = true;
        }
    });
    $('.hp_bar').hover(
        function() {
            if (window.matchMedia("(max-width: 768px)").matches == false && showingBalloon == false) {
                var img = $(this).attr('windowimg')

                $("#info").html("<img src=\"" + img + "\" style=\"width: 15em\">");
                var coords = {};

                var top = $(this).offset().top;
                windowtop = $(window).scrollTop();

                coords.top = top - windowtop - 100;

                var widthPixel = $("#hover-balloon").outerWidth();
                var iconWidthPixel = $(this).outerWidth();
                coords.left = $(this).offset().left + (iconWidthPixel - widthPixel) * 0.5;

                $("#hover-balloon").offset(coords);
                $('#hover-balloon').css('display', 'inline-block');
                showingBalloon = true;
            }
        },
        function() {
            if (showingBalloon) {
                hideBalloon();
            }
        }
    );
    $(window).scroll(function() {
        if (showingBalloon) {
            hideBalloon();
        }
    });
    $('.hp_bar').on('click', function() {
        if (window.matchMedia("(max-width: 768px)").matches == true && showingBalloon == false) {
            var img = $(this).attr('windowimg')

            $("#info").html("<img src=\"" + img + "\" style=\"width: 15em\">");
            var coords = {};

            var top = $(this).offset().top;
            windowtop = $(window).scrollTop();

            coords.top = top - windowtop - 90;

            coords.left = 1;

            $("#hover-balloon").offset(coords);
            $('#hover-balloon').css('display', 'inline-block');
            showingBalloon = true;
        }
    });
});