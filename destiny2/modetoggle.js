function getUrlQueries() {
    var queryStr = window.location.search.slice(1); // 文頭?を除外
    queries = {};

    // クエリがない場合は空のオブジェクトを返す
    if (!queryStr) {
        return queries;
    }

    // クエリ文字列を & で分割して処理
    queryStr.split('&').forEach(function(queryStr) {
        // = で分割してkey,valueをオブジェクトに格納
        var queryArr = queryStr.split('=');
        queries[queryArr[0]] = queryArr[1];
    });

    return queries;
}

$(document).ready(function() {
    var mode = Cookies.get("setmode");

    if (mode == undefined) {
        Cookies.set("setmode", "pve");
        mode = "pve";
    }

    var query = getUrlQueries()
    if (query['mode'] == 'pve') {
        Cookies.set("setmode", "pve");
        mode = "pve";
    } else if (query['mode'] == 'pvp') {
        Cookies.set("setmode", "pvp");
        mode = "pvp";
    }

    if (mode == "pvp") {
        $('.pve').hide();
        $('.pvp').show();
        $('#main').toggleClass('pvp_mode');
        $('#p_toggle').toggleClass('on');
    } else {
        $('.pve').show();
        $('.pvp').hide();
    }

    $('.toggle_button').click(function() {
        $('#main').toggleClass('pvp_mode');
        $('#p_toggle').toggleClass('on');

        if ($('#main').hasClass('pvp_mode')) {
            Cookies.set("setmode", "pvp");
            $('.pve').hide();
            $('.pvp').show();
        } else {
            Cookies.set("setmode", "pve");
            $('.pve').show();
            $('.pvp').hide();
        }
    });
});

window.addEventListener('load', function() {
    if (!localStorage.getItem('disp_popup')) {
        localStorage.setItem('disp_popup', 'on');
        const body = document.querySelector('body');
        const bgPopup = document.querySelector('.bg_onetime_popup');
        const popup = document.querySelector('.onetime_popup');
        const popupTitleClose = document.querySelector('.onetime_popup_title_close');
        body.classList.add('open_popup');

        bgPopup.addEventListener('click', function() {
            closePopup();
        });
        popup.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        popupTitleClose.addEventListener('click', function() {
            closePopup();
        });

        function closePopup() {
            body.classList.remove('open_popup');
        }
    }
}, false);