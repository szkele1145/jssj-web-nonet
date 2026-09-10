/* ============================================================
 * 建设世界 · 离线版引导层
 * ------------------------------------------------------------
 * 1) 立刻劫持 window.fetch / XMLHttpRequest，把 /api/* 请求交给
 *    offline-core.js（跑在浏览器里的 sql.js + 内嵌 backup.db）
 * 2) 懒加载 SQLite 引擎与数据库（不阻塞首屏）
 * 3) 注入右下角「离线版」浮标：查看数据来源 / 下载数据库 / 还原
 *
 * 除了本文件与构建期的小补丁，页面代码与原站完全一致。
 * 适用于 GitHub Pages（含 /仓库名/ 子路径）以及本地双击打开。
 * ============================================================ */
(function () {
  'use strict';

  // ---- 计算站点根路径（兼容 GitHub Pages 子路径与 file://）----
  var PREFIX = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) return '';
    return s.replace(/offline\/offline\.js(\?.*)?$/, '');
  })();

  var CONFIG = {
    dbName: 'backup.db',
    builtAt: window.__JSSJ_OFFLINE_BUILT_AT__ || '',
    adminKey: 'kelejssjapi',
  };

  // ---- 本地存储（不可用时退回内存）----
  var memoryStore = (function () {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
  })();
  var storage = memoryStore, storageOK = false;
  try {
    window.localStorage.setItem('__jssj_probe', '1');
    window.localStorage.removeItem('__jssj_probe');
    storage = window.localStorage;
    storageOK = true;
  } catch (e) { storageOK = false; }

  var api = null;
  var bootError = null;

  // ---- 加载资源 ----
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('无法加载 ' + url)); };
      document.head.appendChild(s);
    });
  }

  function fetchDbBytes() {
    // GitHub Pages / 任意 http 服务：直接取同源的 backup.db
    return fetch(PREFIX + 'db/backup.db', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) { return new Uint8Array(buf); });
  }

  function embeddedDbBytes() {
    // file:// 下 fetch 被禁用：退回内嵌 base64 副本
    return loadScript(PREFIX + 'db/backup-embedded.js').then(function () {
      var b64 = window.__JSSJ_DB_BASE64__;
      if (!b64) throw new Error('内嵌数据库缺失');
      return window.JSSJOfflineCore.base64ToBytes(b64);
    });
  }

  var ready = (function () {
    return loadScript(PREFIX + 'lib/sql-asm.js')
      .then(function () { return loadScript(PREFIX + 'offline/offline-core.js'); })
      .then(function () { return loadScript(PREFIX + 'offline/asset-map.js').catch(function () { window.__JSSJ_ASSET_MAP__ = window.__JSSJ_ASSET_MAP__ || {}; }); })
      .then(function () { return loadScript(PREFIX + 'offline/download-map.js').catch(function () { window.__JSSJ_DOWNLOAD_MAP__ = window.__JSSJ_DOWNLOAD_MAP__ || {}; }); })
      .then(function () {
        return fetchDbBytes().catch(function () { return embeddedDbBytes(); });
      })
      .then(function (bytes) {
        return window.initSqlJs().then(function (SQL) {
          CONFIG.builtAt = window.__JSSJ_OFFLINE_BUILT_AT__ || '';
          api = window.JSSJOfflineCore.createOfflineApi({
            SQL: SQL,
            dbBytes: bytes,
            assetMap: window.__JSSJ_ASSET_MAP__ || {},
            downloadMap: window.__JSSJ_DOWNLOAD_MAP__ || {},
            storage: storage,
            config: CONFIG,
          });
          window.__JSSJ_OFFLINE__ = api;
          return api;
        });
      })
      .catch(function (e) { bootError = e; throw e; });
  })();

  // ---- fetch / XHR 拦截 ----
  function apiPath(url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.pathname === '/api' || u.pathname.indexOf('/api/') === 0) return u.pathname + u.search;
    } catch (e) {}
    return null;
  }

  function headerObject(src) {
    var out = {};
    try {
      if (!src) return out;
      if (typeof src.forEach === 'function') src.forEach(function (v, k) { out[String(k).toLowerCase()] = v; });
      else Object.keys(src).forEach(function (k) { out[String(k).toLowerCase()] = src[k]; });
    } catch (e) {}
    return out;
  }

  function toResponse(res) {
    var headers = {};
    var redirectTo = null;
    var hs = res.headers || {};
    Object.keys(hs).forEach(function (k) {
      if (k.toLowerCase() === 'location') redirectTo = hs[k];
      else headers[k] = hs[k];
    });
    if (redirectTo) {
      // 相对地址（如 assets/01_x.png）需要按当前页面解析成绝对地址，
      // 否则浏览器会拿 API 域名做 base 去请求
      var abs = redirectTo;
      try { abs = new URL(redirectTo, window.location.href).href; } catch (e) {}
      return Response.redirect(abs, res.status || 302);
    }
    if (res.bytes) return new Response(res.bytes, { status: res.status, headers: headers });
    if (res.text == null || res.status === 204 || res.status === 205 || res.status === 304) {
      return new Response(null, { status: res.status, headers: headers });
    }
    return new Response(res.text, { status: res.status, headers: headers });
  }

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    var path = apiPath(url);
    if (!path) return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error('fetch 不可用'));
    var method = (init && init.method) || (input && input.method) || 'GET';
    var headers = headerObject(init && init.headers ? init.headers : (input && input.headers));
    var body = init ? init.body : null;
    return ready.then(function (a) {
      return toResponse(a.handle(method, path, { headers: headers, body: body }));
    });
  };

  // XHR：后台「上传下载文件」用的是 XMLHttpRequest
  if (window.XMLHttpRequest) {
    var XHR = window.XMLHttpRequest;
    var origOpen = XHR.prototype.open;
    var origSend = XHR.prototype.send;
    var origSetHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.open = function (method, url) {
      this.__offlinePath = apiPath(url);
      this.__offlineMethod = method;
      this.__offlineHeaders = {};
      return origOpen.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (k, v) {
      if (this.__offlinePath && this.__offlineHeaders) this.__offlineHeaders[String(k).toLowerCase()] = v;
      return origSetHeader.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      if (!this.__offlinePath) return origSend.apply(this, arguments);
      var xhr = this;
      ready.then(function (a) {
        var res = a.handle(xhr.__offlineMethod, xhr.__offlinePath, { headers: xhr.__offlineHeaders || {}, body: body });
        setTimeout(function () {
          try {
            Object.defineProperty(xhr, 'status', { value: res.status, configurable: true });
            Object.defineProperty(xhr, 'statusText', { value: res.status === 200 ? 'OK' : 'Error', configurable: true });
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: res.text || '', configurable: true });
            Object.defineProperty(xhr, 'response', { value: res.text || '', configurable: true });
            if (xhr.upload && typeof xhr.upload.onprogress === 'function') {
              xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 });
            }
            if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
            if (typeof xhr.onload === 'function') xhr.onload();
          } catch (e) {}
        }, 20);
      });
    };
  }

  // ---- 供页面补丁使用：把 /uploads/xxx 之类的相对地址补成可用的绝对地址，
  //      data: / http(s): / blob: 原样返回（离线图床返回的是 dataURL）
  window.fileUrl = function (u) {
    u = String(u == null ? '' : u);
    if (!u) return u;
    if (/^(data:|blob:|https?:|\/\/)/i.test(u)) return u;
    return 'https://api.jssj.cc.cd' + (u.charAt(0) === '/' ? '' : '/') + u;
  };

  // ---- 右下角浮标 ----
  function injectBadge() {
    var css = document.createElement('style');
    css.textContent = [
      '#jssjOfflineBadge{position:fixed;right:14px;bottom:14px;z-index:9998;font-family:inherit;font-size:13px;line-height:1.6;text-align:left;}',
      '#jssjOfflineBadge .pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;cursor:pointer;',
      'background:rgba(20,30,40,.86);border:1px solid rgba(90,176,224,.35);color:#7bb3d9;backdrop-filter:blur(8px);',
      'box-shadow:0 4px 18px rgba(0,0,0,.35);letter-spacing:.5px;user-select:none;transition:.2s;}',
      '#jssjOfflineBadge .pill:hover{border-color:#5ab0e0;color:#c0e8ff;}',
      '#jssjOfflineBadge .pill .dot{width:7px;height:7px;border-radius:50%;background:#5ab0e0;box-shadow:0 0 6px #5ab0e0;}',
      '#jssjOfflineBadge .panel{display:none;width:330px;max-width:calc(100vw - 28px);margin-bottom:8px;padding:14px 16px;border-radius:14px;',
      'background:rgba(16,24,32,.96);border:1px solid rgba(90,176,224,.25);color:#c8dce6;backdrop-filter:blur(10px);',
      'box-shadow:0 10px 34px rgba(0,0,0,.5);}',
      '#jssjOfflineBadge.open .panel{display:block;}',
      '#jssjOfflineBadge h4{margin:0 0 8px;font-size:14px;color:#7bb3d9;font-weight:500;letter-spacing:1px;}',
      '#jssjOfflineBadge .row{font-size:12px;opacity:.85;margin-bottom:4px;word-break:break-all;}',
      '#jssjOfflineBadge .row b{color:#eef2f5;font-weight:500;}',
      '#jssjOfflineBadge .hint{font-size:11.5px;opacity:.55;margin:8px 0 10px;border-top:1px solid rgba(160,175,190,.12);padding-top:8px;}',
      '#jssjOfflineBadge .btns{display:flex;flex-wrap:wrap;gap:6px;}',
      '#jssjOfflineBadge button{flex:1 1 auto;padding:6px 10px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:12px;',
      'background:rgba(90,176,224,.1);border:1px solid rgba(90,176,224,.25);color:#7bb3d9;transition:.2s;}',
      '#jssjOfflineBadge button:hover{background:rgba(90,176,224,.2);color:#c0e8ff;}',
      '#jssjOfflineBadge .warn{color:#e0b05a;}',
      'html.light-mode #jssjOfflineBadge .pill{background:rgba(255,255,255,.94);color:#2f7a9a;border-color:rgba(30,120,180,.3);}',
      'html.light-mode #jssjOfflineBadge .panel{background:rgba(255,255,255,.97);color:#25404e;border-color:rgba(30,120,180,.25);}',
      'html.light-mode #jssjOfflineBadge h4{color:#1f7a9a;}',
      'html.light-mode #jssjOfflineBadge .row b{color:#0a3a5a;}',
      '@media(max-width:480px){#jssjOfflineBadge{right:8px;bottom:8px;}#jssjOfflineBadge .pill{font-size:12px;padding:5px 10px;}}'
    ].join('');
    document.head.appendChild(css);

    var box = document.createElement('div');
    box.id = 'jssjOfflineBadge';
    box.innerHTML =
      '<div class="panel" id="jssjOfflinePanel">' +
      '<h4>🔌 建设世界 · 离线版</h4>' +
      '<div class="row" id="jssjOfflineMeta">正在读取内嵌数据库…</div>' +
      '<div class="row" id="jssjOfflineCounts"></div>' +
      '<div class="hint">本页所有数据都来自随站点分发的 <b>backup.db</b>（浏览器内运行的 SQLite），不需要任何后端服务器。' +
      '管理后台里的增删改会保存在本浏览器，不影响站点文件。</div>' +
      '<div class="btns">' +
      '<button id="jssjOfflineDl">下载当前数据库</button>' +
      '<button id="jssjOfflineJson">导出 JSON</button>' +
      '<button id="jssjOfflineReset">还原原始数据</button>' +
      '</div></div>' +
      '<div class="pill" id="jssjOfflinePill"><span class="dot"></span>离线版</div>';
    document.body.appendChild(box);

    var pill = document.getElementById('jssjOfflinePill');
    var meta = document.getElementById('jssjOfflineMeta');
    var counts = document.getElementById('jssjOfflineCounts');

    pill.addEventListener('click', function (e) {
      e.stopPropagation();
      box.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!box.contains(e.target)) box.classList.remove('open');
    });

    function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

    function render() {
      if (bootError) {
        meta.innerHTML = '<span class="warn">⚠ 离线数据库加载失败：' + (bootError.message || bootError) + '</span>';
        return;
      }
      if (!api) { meta.textContent = '正在读取内嵌数据库…'; return; }
      var i = api.info();
      var src = i.source === 'saved'
        ? '本浏览器保存的版本（含你的修改）'
        : CONFIG.dbName + '（随站点分发）';
      meta.innerHTML = '数据来源：<b>' + src + '</b> · ' + kb(i.dbSize) +
        (CONFIG.builtAt ? ' · 构建于 ' + CONFIG.builtAt.replace('T', ' ') : '');
      var c = i.counts;
      counts.innerHTML = '记录：动态 <b>' + c.posts + '</b> · 投票 <b>' + c.votes + '</b> · 神人榜 <b>' + c.stories +
        '</b> · 封禁 <b>' + c.bans + '</b> · 捐赠 <b>' + c.donors + '</b> · 下载 <b>' + c.downloads + '</b>' +
        ' · 访问 <b>' + i.pv + '</b>（UV ' + i.uv + '）';
      var extra = '';
      if (!storageOK) extra += '<div class="row warn">⚠ 浏览器未开放本地存储，后台改动只在本次会话有效。</div>';
      if (i.storageError) extra += '<div class="row warn">⚠ ' + i.storageError + '</div>';
      var old = box.querySelector('.dynwarn');
      if (old) old.remove();
      if (extra) {
        var d = document.createElement('div');
        d.className = 'dynwarn';
        d.innerHTML = extra;
        counts.insertAdjacentElement('afterend', d);
      }
    }

    function saveBlob(blob, name) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }

    document.getElementById('jssjOfflineDl').addEventListener('click', function () {
      if (!api) return;
      saveBlob(new Blob([api.exportBytes()], { type: 'application/octet-stream' }),
        'jssj-offline-' + new Date().toISOString().slice(0, 10) + '.db');
    });
    document.getElementById('jssjOfflineJson').addEventListener('click', function () {
      if (!api) return;
      saveBlob(new Blob([api.exportJson()], { type: 'application/json;charset=utf-8' }),
        'jssj-backup-' + new Date().toISOString().slice(0, 10) + '.json');
    });
    document.getElementById('jssjOfflineReset').addEventListener('click', function () {
      if (!api) return;
      if (!confirm('还原为随站点分发的原始数据？\n\n浏览器里保存的所有改动都会被清除。')) return;
      api.reset();
      location.reload();
    });

    ready.then(render).catch(render);
    window.__jssjOfflineRender = render;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBadge);
  } else {
    injectBadge();
  }
})();
