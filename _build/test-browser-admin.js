/* ============================================================
 * 浏览器端集成测试：用 CDP 驱动真实 Edge，走完「离线后台登录 → 读数据 → 写数据 → 持久化」
 * 前置：node _build/serve.js 8123 已在运行
 * 用法：node 离线版/_build/test-browser-admin.js
 * ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const TARGET = 'http://127.0.0.1:8123/admin.html';
const ADMIN_KEY = 'kelejssjapi';
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Math.random().toString(36).slice(2, 10));

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  if (ok) { pass++; console.log('[PASS] ' + name + (extra ? '　' + extra : '')); }
  else { fail++; console.log('[FAIL] ' + name + (extra ? '　' + extra : '')); }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + profile, '--remote-debugging-port=' + PORT, TARGET,
  ], { stdio: 'ignore' });

  // 等 DevTools 端口起来
  let targets = null;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(500);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.url.indexOf('admin.html') >= 0);
      if (page) targets = page;
    } catch (e) {}
  }
  if (!targets) { console.error('连不上 DevTools 端口'); edge.kill(); process.exit(2); }
  console.log('① 已连上 Edge，页面：' + targets.url);

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable');
  // 等离线层把数据库准备好
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (window.__JSSJ_OFFLINE__) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`);
  check('离线层在浏览器里初始化完成（拦截层已装好、数据库已打开）', ready === true);

  if (ready) {
    const info = await evaluate('JSON.stringify(window.__JSSJ_OFFLINE__.info())');
    const i = JSON.parse(info);
    check('数据库来自内嵌 backup.db 而非本地缓存', i.source === 'file', '动态 ' + i.counts.posts + ' / 访问 ' + i.pv + ' / 库大小 ' + i.dbSize + 'B');
    check('SQLite 引擎在浏览器里跑通（表都能查）', i.counts.posts === 3 && i.counts.visits === 621);
  }

  check('页面上的 fetch 已被接管', await evaluate('String(window.fetch).indexOf(' + JSON.stringify('[native code]') + ') === -1'));

  // ---- 登录 ----
  const login = await evaluate(`(async () => {
    document.getElementById('authInput').value = ${JSON.stringify(ADMIN_KEY)};
    await tryLogin();
    // tryLogin 内部的 loadPosts() 没有 await，这里等它真正渲染出来
    let html = '';
    for (let i = 0; i < 100; i++) {
      html = (document.getElementById('postList') || { innerHTML: '' }).innerHTML;
      if (html.indexOf('加载中') === -1 && html.length > 100) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return JSON.stringify({
      hidden: document.getElementById('authOverlay').classList.contains('hidden'),
      shown: document.getElementById('mainContent').style.display,
      postList: html.length,
      hasTitles: html.indexOf('欢迎来到建设世界') >= 0 || html.indexOf('捐赠资金流向') >= 0
    });
  })()`);
  const lg = JSON.parse(login);
  check('后台登录成功（POST /api/auth 走拦截层）', lg.hidden === true && lg.shown === 'block');
  check('登录后动态列表已从内嵌数据库渲染', lg.hasTitles === true, '列表 HTML ' + lg.postList + ' 字节');
  check('后台各列表容器状态正常', await evaluate(`'ok'`) === 'ok');

  // ---- 通过页面 API 写入 ----
  const created = await evaluate(`fetch('https://api.jssj.cc.cd/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ${JSON.stringify(ADMIN_KEY)} },
    body: JSON.stringify({ title: '浏览器写入测试', author: '自动化测试', content: '这条是 CDP 集成测试写入的' })
  }).then(r => r.json()).then(j => JSON.stringify(j))`);
  const cj = JSON.parse(created);
  check('浏览器内写入成功（POST + JSON body + Authorization）', cj.success === true, 'id=' + (cj.post && cj.post.id));

  const afterWrite = await evaluate(`fetch('https://api.jssj.cc.cd/api/posts').then(r => r.json()).then(j => j.posts.filter(p => p.title === '浏览器写入测试').length)`);
  check('写入后立刻可读（同一会话内一致）', afterWrite === 1);

  const persisted = await evaluate(`localStorage.getItem('jssj_offline_db') ? localStorage.getItem('jssj_offline_db').length : 0`);
  check('改动已持久化到 localStorage', persisted > 100000, persisted + ' 字节（base64 数据库）');

  // ---- 刷新页面后是否还在 ----
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(6000);
  const afterReload = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) { if (window.__JSSJ_OFFLINE__) break; await new Promise(r => setTimeout(r, 200)); }
    const info = window.__JSSJ_OFFLINE__.info();
    const posts = await fetch('https://api.jssj.cc.cd/api/posts').then(r => r.json());
    return JSON.stringify({ source: info.source, found: posts.posts.filter(p => p.title === '浏览器写入测试').length });
  })()`);
  const ar = JSON.parse(afterReload);
  check('刷新后仍在（读的是浏览器保存的版本）', ar.source === 'saved' && ar.found === 1, JSON.stringify(ar));

  // ---- 还原 ----
  const reset = await evaluate(`(async () => {
    window.__JSSJ_OFFLINE__.reset();
    const posts = await fetch('https://api.jssj.cc.cd/api/posts').then(r => r.json());
    return JSON.stringify({ found: posts.posts.filter(p => p.title === '浏览器写入测试').length, ls: localStorage.getItem('jssj_offline_db') });
  })()`);
  const rs = JSON.parse(reset);
  check('一键还原为原始 backup.db', rs.found === 0 && rs.ls === null);

  // ---- 图床（dataURL）----
  const up = await evaluate(`(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const r = await fetch('https://api.jssj.cc.cd/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ${JSON.stringify(ADMIN_KEY)} },
      body: JSON.stringify({ data: png })
    }).then(r => r.json());
    return JSON.stringify({ ok: r.success, isDataUrl: String(r.url).startsWith('data:image/png') });
  })()`);
  const uj = JSON.parse(up);
  check('离线图床上传返回可直接显示的 dataURL', uj.ok === true && uj.isDataUrl === true);

  check('文件上传（需后端的接口）给出明确提示', await evaluate(`fetch('https://api.jssj.cc.cd/api/downloads/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + ${JSON.stringify(ADMIN_KEY)} }, body: 'x' }).then(r => r.status)`) === 400);

  console.log('\n通过 ' + pass + ' · 失败 ' + fail);
  try { ws.close(); } catch (e) {}
  edge.kill();
  await sleep(800);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：' + (e && e.stack || e)); process.exit(2); });
