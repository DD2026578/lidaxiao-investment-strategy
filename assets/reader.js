(function () {
  'use strict';

  var STORE_KEY = 'ldx-book-v3';
  var stageEl = document.getElementById('stage');
  var pageImg = document.getElementById('pageImg');
  var skeleton = document.getElementById('skeleton');
  var tocEl = document.getElementById('toc');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var slider = document.getElementById('slider');
  var pageInput = document.getElementById('pageInput');
  var pageTotal = document.getElementById('pageTotal');
  var chapterNow = document.getElementById('chapterNow');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var hint = document.getElementById('hint');
  var drawerMeta = document.getElementById('drawerMeta');

  var state = {
    page: 1,
    total: 0,
    toc: [],
    fit: 'contain',
    dark: false,
    chapters: [],
    loading: 0,
    reqId: 0
  };

  var tocButtons = [];

  function pad(n) {
    return String(n).padStart(4, '0');
  }

  function pageUrl(n) {
    return './book/pages/' + pad(n) + '.webp';
  }

  function clamp(n) {
    return Math.min(state.total, Math.max(1, n));
  }

  /* ---------- boot ---------- */
  function boot() {
    fetch('./book/manifest.json', { cache: 'force-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('manifest ' + r.status);
        return r.json();
      })
      .then(function (m) {
        state.total = m.pages;
        state.toc = m.toc || [];
        document.title = m.title + '（' + m.subtitle + '）· 在线阅览';
        pageTotal.textContent = m.pages;
        slider.max = m.pages;
        pageInput.max = m.pages;
        drawerMeta.textContent = m.author + ' · 共 ' + m.pages + ' 页 · ' + m.toc.length + ' 个目录条目';

        buildChapters();
        buildToc();

        var start = readStart();
        goTo(start, true);
        bind();
        document.body.classList.add('ready');
        showHint();
      })
      .catch(function (err) {
        skeleton.classList.add('hide');
        stageEl.insertAdjacentHTML(
          'beforeend',
          '<div style="color:#9c4a32;font-size:14px;line-height:1.8;text-align:center">' +
            '内容加载失败，请刷新页面重试。<br><span style="font-size:12px;opacity:.7">' +
            String(err && err.message ? err.message : err) +
            '</span></div>'
        );
      });
  }

  function readStart() {
    var m = /[#&]p=(\d+)/.exec(location.hash);
    if (m) return clamp(parseInt(m[1], 10));
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (saved.page) return clamp(saved.page);
      if (saved.dark) setDark(true);
      if (saved.fit) setFit(saved.fit);
    } catch (e) {}
    return 1;
  }

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ page: state.page, dark: state.dark, fit: state.fit })
      );
    } catch (e) {}
  }

  /* ---------- chapters ---------- */
  function buildChapters() {
    state.chapters = state.toc
      .filter(function (t) { return t.lvl === 1; })
      .map(function (t) { return { title: t.title, page: t.page }; });
  }

  function chapterOf(page) {
    var found = null;
    for (var i = 0; i < state.chapters.length; i++) {
      if (state.chapters[i].page <= page) found = state.chapters[i];
      else break;
    }
    return found ? found.title : '';
  }

  /* ---------- toc ---------- */
  function buildToc() {
    var frag = document.createDocumentFragment();
    state.toc.forEach(function (item, idx) {
      var lvl2 = item.lvl >= 2;
      var btn = document.createElement('button');
      btn.className = 'toc-item ' + (lvl2 ? 'lvl2' : 'lvl1');
      btn.type = 'button';
      btn.dataset.page = item.page;
      btn.dataset.idx = idx;
      btn.innerHTML =
        '<span class="t">' + escapeHtml(item.title) + '</span>' +
        '<span class="p">' + item.page + '</span>';
      btn.addEventListener('click', function () {
        goTo(item.page);
        closeDrawer();
      });
      tocButtons.push(btn);
      frag.appendChild(btn);
    });
    tocEl.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var activeIdx = -1;
  function syncToc(page) {
    var idx = -1;
    for (var i = 0; i < state.toc.length; i++) {
      if (state.toc[i].page <= page) idx = i;
      else break;
    }
    if (idx === activeIdx) return;
    if (activeIdx >= 0 && tocButtons[activeIdx]) tocButtons[activeIdx].classList.remove('active');
    activeIdx = idx;
    if (idx >= 0 && tocButtons[idx]) {
      tocButtons[idx].classList.add('active');
      if (drawer.classList.contains('on')) {
        ensureVisible(tocButtons[idx]);
      }
    }
  }

  function ensureVisible(el) {
    var r = el.getBoundingClientRect();
    var dr = tocEl.getBoundingClientRect();
    if (r.top < dr.top + 8 || r.bottom > dr.bottom - 8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ---------- paging ---------- */
  function goTo(page, immediate) {
    if (!state.total) return;
    page = clamp(page);
    if (page === state.page && pageImg.getAttribute('src') && !immediate) {
      syncUi();
      return;
    }
    state.page = page;
    var token = ++state.reqId;
    var url = pageUrl(page);

    skeleton.classList.remove('hide');
    pageImg.classList.remove('loaded');
    skeleton.style.display = '';

    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      if (token !== state.reqId) return;
      pageImg.src = url;
      pageImg.alt = '第 ' + page + ' 页';
      requestAnimationFrame(function () {
        pageImg.classList.add('loaded');
        skeleton.classList.add('hide');
        skeleton.style.display = 'none';
      });
      preload(page + 1, page + 2, page - 1);
    };
    img.onerror = function () {
      if (token !== state.reqId) return;
      pageImg.classList.add('loaded');
      pageImg.alt = '第 ' + page + ' 页加载失败';
      skeleton.classList.add('hide');
      skeleton.style.display = 'none';
    };
    img.src = url;

    syncUi();
    syncToc(page);
    persist();
    if (immediate !== true) {
      var h = '#p=' + page;
      if (location.hash !== h) history.replaceState(null, '', h);
    }
  }

  function syncUi() {
    slider.value = state.page;
    pageInput.value = state.page;
    chapterNow.textContent = chapterOf(state.page);
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= state.total;
    stageEl.scrollTop = 0;
  }

  function next() { if (state.page < state.total) goTo(state.page + 1); }
  function prev() { if (state.page > 1) goTo(state.page - 1); }

  var preloaded = {};
  function preload() {
    for (var i = 0; i < arguments.length; i++) {
      var n = arguments[i];
      if (n < 1 || n > state.total || preloaded[n]) continue;
      preloaded[n] = true;
      var im = new Image();
      im.src = pageUrl(n);
    }
  }

  /* ---------- view modes ---------- */
  function setFit(mode) {
    state.fit = mode === 'width' ? 'width' : 'contain';
    stageEl.classList.toggle('fit-width', state.fit === 'width');
    stageEl.classList.toggle('fit-contain', state.fit === 'contain');
  }

  function toggleFit() {
    setFit(state.fit === 'width' ? 'contain' : 'width');
    persist();
  }

  function setDark(on) {
    state.dark = !!on;
    document.body.classList.toggle('dark', state.dark);
    document
      .querySelector('meta[name=theme-color]')
      .setAttribute('content', state.dark ? '#14120f' : '#ece7dd');
  }

  function toggleDark() {
    setDark(!state.dark);
    persist();
  }

  /* ---------- drawer ---------- */
  function openDrawer() {
    drawer.classList.add('on');
    scrim.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    if (activeIdx >= 0 && tocButtons[activeIdx]) ensureVisible(tocButtons[activeIdx]);
  }
  function closeDrawer() {
    drawer.classList.remove('on');
    scrim.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
  }
  function toggleDrawer() {
    drawer.classList.contains('on') ? closeDrawer() : openDrawer();
  }

  /* ---------- misc ui ---------- */
  var hintTimer;
  function showHint() {
    if (window.innerWidth < 720) {
      hint.textContent = '左右滑动翻页 · 双指缩放 · 点「目录」跳章';
    }
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove('show'); }, 4600);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
    } else {
      document.exitFullscreen();
    }
  }

  /* ---------- events ---------- */
  function bind() {
    document.getElementById('tocBtn').addEventListener('click', toggleDrawer);
    document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    document.getElementById('fitBtn').addEventListener('click', toggleFit);
    document.getElementById('themeBtn').addEventListener('click', toggleDark);
    document.getElementById('fsBtn').addEventListener('click', toggleFullscreen);

    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);

    document.getElementById('zonePrev').addEventListener('click', prev);
    document.getElementById('zoneNext').addEventListener('click', next);

    slider.addEventListener('input', function () {
      pageInput.value = slider.value;
      chapterNow.textContent = chapterOf(parseInt(slider.value, 10));
    });
    slider.addEventListener('change', function () {
      goTo(parseInt(slider.value, 10));
    });

    pageInput.addEventListener('change', function () {
      var v = parseInt(pageInput.value, 10);
      if (!isNaN(v)) goTo(v);
      else pageInput.value = state.page;
    });
    pageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        pageInput.blur();
        var v = parseInt(pageInput.value, 10);
        if (!isNaN(v)) goTo(v);
      }
    });

    // double click / double tap toggles fit
    var lastTap = 0;
    stageEl.addEventListener('click', function (e) {
      if (e.target === pageImg) {
        var now = Date.now();
        if (now - lastTap < 320) { toggleFit(); lastTap = 0; }
        else lastTap = now;
      }
    });

    // swipe
    var tx = 0, ty = 0, tt = 0;
    stageEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      tx = e.touches[0].clientX;
      ty = e.touches[0].clientY;
      tt = Date.now();
    }, { passive: true });
    stageEl.addEventListener('touchend', function (e) {
      if (!e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - tx;
      var dy = e.changedTouches[0].clientY - ty;
      if (Date.now() - tt < 600 && Math.abs(dx) > 55 && Math.abs(dy) < 60) {
        dx < 0 ? next() : prev();
      }
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ' && e.target.tagName === 'BUTTON') return;
      switch (e.key) {
        case 'ArrowLeft': case 'PageUp': prev(); break;
        case 'ArrowRight': case 'PageDown': case ' ': next(); break;
        case 'Home': goTo(1); break;
        case 'End': goTo(state.total); break;
        case 'Escape': closeDrawer(); break;
        case 't': case 'T': toggleDrawer(); break;
        case 'd': case 'D': toggleDark(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'z': case 'Z': toggleFit(); break;
        default: return;
      }
      e.preventDefault();
    });

    window.addEventListener('hashchange', function () {
      var m = /[#&]p=(\d+)/.exec(location.hash);
      if (m) goTo(parseInt(m[1], 10), true);
    });
  }

  boot();
})();
