/* ============================================================
 * 建设世界 · 共享界面逻辑
 * ------------------------------------------------------------
 * 原来每个页面底部都抄了一份「侧边栏 + 主题切换」脚本（12 份），
 * 改一处要改 12 遍。这里统一收口，页面只需：
 *
 *   <link rel="stylesheet" href="css/style.css">
 *   ...
 *   <script src="js/ui.js"></script>
 *
 * 主题防闪烁由各页 <head> 里的一行内联脚本负责（必须先于渲染执行）。
 *
 * 说明：本文件不定义 API_BASE / fetchApi / esc，避免与各页自己的
 * js/home.js、js/server.js、js/forum.js 里的同名声明打架。
 * ============================================================ */
(function () {
  'use strict';

  var THEME_KEY = 'theme';
  var root = document.documentElement;

  /* ---------- 主题 ----------
   * 三套，固定三种，不再有「玻璃+浅色」的第四种组合：
   *   dark  深邃（默认）
   *   light 浅色
   *   glass 液态玻璃（固定深色底 —— 亮玻璃在白底上会糊成一片）
   */
  var THEMES = ['dark', 'light', 'glass'];
  var THEME_LABEL = { dark: '深邃', light: '浅色', glass: '液态玻璃' };
  var THEME_ICON = { dark: 'fas fa-moon', light: 'fas fa-sun', glass: 'fas fa-droplet' };

  function readTheme() {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (THEMES.indexOf(t) < 0) {
      // 没存过就跟随系统
      var prefersDark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
      t = prefersDark ? 'dark' : 'light';
    }
    return t;
  }

  function current() {
    if (root.classList.contains('glass')) return 'glass';
    if (root.classList.contains('light-mode')) return 'light';
    return 'dark';
  }

  function applyTheme(theme, persist) {
    if (THEMES.indexOf(theme) < 0) theme = 'dark';
    // 玻璃固定深色：glass 与 light-mode 互斥
    var light = theme === 'light';

    root.classList.toggle('glass', theme === 'glass');
    root.classList.toggle('light-mode', light);

    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    }

    var icon = document.getElementById('themeIcon');
    if (icon) icon.className = THEME_ICON[theme];

    Array.prototype.forEach.call(document.querySelectorAll('.theme-option'), function (btn) {
      btn.setAttribute('aria-selected', String(btn.getAttribute('data-theme') === theme));
    });

    var btn = document.getElementById('themeToggle');
    if (btn) {
      var label = THEME_LABEL[theme];
      btn.setAttribute('title', '主题：' + label);
      btn.setAttribute('aria-label', '切换主题（当前：' + label + '）');
    }

    // 移动端浏览器地址栏配色 + 表单控件配色跟随主题
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', light ? '#f8fafc' : theme === 'glass' ? '#0a0d14' : '#191d28');
    root.style.colorScheme = light ? 'light' : 'dark';
  }

  /* ---------- 主题弹窗 ---------- */
  var popover, popBtn, lastPopFocus;
  var OPTION_KEYS = ['dark', 'light', 'glass'];

  function isPopOpen() { return !!popover && popover.classList.contains('open'); }

  function openPop() {
    if (!popover) return;
    lastPopFocus = document.activeElement;
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    if (popBtn) popBtn.setAttribute('aria-expanded', 'true');
    var first = popover.querySelector('.theme-option[aria-selected="true"]') || popover.querySelector('.theme-option');
    if (first) first.focus();
  }

  function closePop(refocus) {
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    if (popBtn) popBtn.setAttribute('aria-expanded', 'false');
    if (refocus !== false && lastPopFocus && lastPopFocus.focus) lastPopFocus.focus();
  }

  function buildPopover() {
    popover = document.getElementById('themePopover');
    popBtn = document.getElementById('themeToggle');
    if (!popBtn || popover) return;

    var wrap = popBtn.parentNode;
    if (wrap && !wrap.classList.contains('theme-picker')) wrap.classList.add('theme-picker');

    popover = document.createElement('div');
    popover.id = 'themePopover';
    popover.className = 'popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', '选择界面主题');
    popover.setAttribute('aria-hidden', 'true');
    popover.innerHTML =
      '<div class="popover-title">界面主题</div>' +
      '<button type="button" class="theme-option" data-theme="dark" role="option" aria-selected="false">' +
        '<i class="fas fa-moon"></i><span class="theme-name">深邃</span><i class="fas fa-check theme-check"></i></button>' +
      '<button type="button" class="theme-option" data-theme="light" role="option" aria-selected="false">' +
        '<i class="fas fa-sun"></i><span class="theme-name">浅色</span><i class="fas fa-check theme-check"></i></button>' +
      '<div class="popover-divider"></div>' +
      '<button type="button" class="theme-option" data-theme="glass" role="option" aria-selected="false">' +
        '<i class="fas fa-droplet"></i><span class="theme-name">液态玻璃</span><i class="fas fa-check theme-check"></i></button>';
    popBtn.parentNode.appendChild(popover);

    popBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      isPopOpen() ? closePop() : openPop();
    });

    popover.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.theme-option') : null;
      if (!opt) return;
      applyTheme(opt.getAttribute('data-theme'), true);
      closePop();
    });

    // 点外面关闭
    document.addEventListener('click', function (e) {
      if (!isPopOpen()) return;
      if (popover.contains(e.target) || e.target === popBtn || popBtn.contains(e.target)) return;
      closePop(false);
    });
  }

  function initTheme() {
    applyTheme(readTheme(), false);
    buildPopover();
    // buildPopover 之后重刷一次：弹窗刚生成，需要同步选中态与按钮文案
    applyTheme(current(), false);

    // 跟随系统（仅在用户没手动选过时生效）
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () {
        var stored = null;
        try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
        if (stored) return;
        applyTheme(mq.matches ? 'dark' : 'light', null, false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }
  }

  /* ---------- 侧边栏 ---------- */
  var sidebar, backdrop, opener, lastFocus;

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function focusables() {
    if (!sidebar) return [];
    return Array.prototype.filter.call(
      sidebar.querySelectorAll(FOCUSABLE),
      function (el) { return el.offsetParent !== null || el === document.activeElement; }
    );
  }

  function openSidebar() {
    if (!sidebar) return;
    lastFocus = document.activeElement;
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    sidebar.setAttribute('aria-hidden', 'false');
    if (opener) opener.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    // 等过渡开始、元素可见后再移焦（立刻移焦会因为仍在 visibility:hidden 而失败）
    setTimeout(function () {
      if (!isOpen()) return;
      var f = focusables();
      if (f.length) f[0].focus();
    }, 60);
  }

  function closeSidebar(refocus) {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
    if (opener) opener.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (refocus !== false && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function isOpen() { return !!sidebar && sidebar.classList.contains('open'); }

  function initSidebar() {
    sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    backdrop = document.getElementById('sidebarBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sidebarBackdrop';
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    opener = document.getElementById('sidebarToggle');
    sidebar.setAttribute('aria-hidden', 'true');
    if (opener) {
      opener.setAttribute('aria-expanded', 'false');
      if (!opener.getAttribute('aria-label')) opener.setAttribute('aria-label', '打开目录');
      if (!opener.getAttribute('aria-controls')) opener.setAttribute('aria-controls', 'sidebar');
    }

    if (opener) opener.addEventListener('click', function (e) { e.stopPropagation(); isOpen() ? closeSidebar() : openSidebar(); });

    var closeBtn = document.getElementById('sidebarClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeSidebar(); });

    backdrop.addEventListener('click', function () { closeSidebar(); });

    // Esc 关闭 + Tab 焦点锁在侧栏内
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isPopOpen()) { e.preventDefault(); closePop(); return; }
      if (!isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeSidebar(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // 点击链接即关闭（同页锚点除外）
    sidebar.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (a) closeSidebar(false);
    });

    // 视口变大到桌面尺寸时自动收起，避免残留遮罩
    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 901px)');
      var onMq = function (ev) { if (ev.matches && isOpen()) closeSidebar(false); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
  }

  /* ---------- 当前页高亮 ---------- */
  function initActiveNav() {
    if (!sidebar) return;
    var here = location.pathname.split('/').pop() || 'index.html';
    Array.prototype.forEach.call(sidebar.querySelectorAll('.sidebar-menu a[href]'), function (a) {
      var target = a.getAttribute('href').split('/').pop().split('#')[0];
      if (target && target === here) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  /* ---------- 顶栏滚动状态 ---------- */
  function initNavbarScroll() {
    var nav = document.querySelector('.navbar');
    if (!nav) return;
    var ticking = false;
    function update() {
      nav.classList.toggle('is-stuck', window.scrollY > 8);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------- 页面离开时收起侧栏（避免 bfcache 残留） ---------- */
  function initPageHide() {
    window.addEventListener('pagehide', function () { closeSidebar(false); closePop(false); });
  }

  function init() {
    initTheme();
    initSidebar();
    initActiveNav();
    initNavbarScroll();
    initPageHide();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
