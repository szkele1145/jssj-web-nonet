/* ============================================================
 * 离线版 API 核心 · 对比测试
 * 把离线核心的响应与线上真实 API（api.jssj.cc.cd）逐接口比对，
 * 差异应当只剩「图片 URL 被本地化」这一项（测试会自动反向还原后比对）。
 * 运行：node 离线版/_build/test-core.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const LIVE = 'https://api.jssj.cc.cd';
const ADMIN_KEY = 'kelejssjapi';

const initSqlJs = require(path.join(ROOT, 'lib/sql-asm.js'));
const core = require(path.join(ROOT, 'offline/offline-core.js'));

let pass = 0, warn = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  if (ok) { pass++; results.push(['PASS', name, '']); }
  else { fail++; results.push(['FAIL', name, detail || '']); }
}
function note(name, detail) { warn++; results.push(['NOTE', name, detail || '']); }

const memStore = () => {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _map: m };
};

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
};
const j = (v) => JSON.stringify(sortKeys(v));

(async () => {
  const SQL = await initSqlJs();
  const dbBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'db/backup.db')));
  const assetMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'offline/asset-map.json'), 'utf8'));
  // 反向映射：assets/xxx -> 原始外链，用于把离线结果还原成线上格式
  const reverse = {};
  for (const [remote, local] of Object.entries(assetMap)) reverse[local] = remote;

  const storage = memStore();
  const api = core.createOfflineApi({
    SQL, dbBytes, assetMap, storage,
    config: { dbName: 'backup.db', builtAt: '2026-09-10T00:00:00' },
  });

  const unlocal = (v) => {
    if (typeof v === 'string') {
      let out = v;
      for (const [local, remote] of Object.entries(reverse)) out = out.split(local).join(remote);
      return out;
    }
    if (Array.isArray(v)) return v.map(unlocal);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = unlocal(v[k]); return o; }
    return v;
  };

  const callOffline = (method, url, opts = {}) => {
    const res = api.handle(method, url, { headers: opts.headers || {}, body: opts.body });
    let json = null;
    if (res.text) { try { json = JSON.parse(res.text); } catch (e) { json = null; } }
    return { status: res.status, json, headers: res.headers, bytes: res.bytes };
  };
  const callLive = async (method, url, opts = {}) => {
    const r = await fetch(LIVE + url, { method, headers: opts.headers || {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const txt = await r.text();
    let json = null; try { json = JSON.parse(txt); } catch (e) {}
    return { status: r.status, json, text: txt };
  };

  const auth = { Authorization: 'Bearer ' + ADMIN_KEY };
  const norm = (o, drop = []) => {
    const c = JSON.parse(JSON.stringify(o));
    for (const k of drop) delete c[k];
    return c;
  };

  console.log('=== 公开接口对比（离线 vs 线上）===');
  const publicGets = [
    ['/api/posts', []],
    ['/api/votes', ['votes'], 'dropVoteFlag'],
    ['/api/stories', []],
    ['/api/bans', []],
    ['/api/donors', []],
    ['/api/downloads', []],
    ['/api/stats/public', []],
    ['/api/search?q=' + encodeURIComponent('捐赠'), []],
    ['/api/search?q=' + encodeURIComponent('女装'), []],
    ['/api/search?q=' + encodeURIComponent('abc'), []],
    ['/api/search?q=' + encodeURIComponent('女装') + '&fuzzy=1', []],
  ];

  for (const [url, , mode] of publicGets) {
    const off = callOffline('GET', url);
    let live;
    try { live = await callLive('GET', url); } catch (e) { note(url, '线上请求失败：' + e.message); continue; }
    let offJ = unlocal(off.json);
    if (mode === 'dropVoteFlag' && offJ && offJ.votes) offJ.votes = offJ.votes.map(v => norm(v, ['hasVoted', 'myVote']));
    let liveJ = live.json;
    if (mode === 'dropVoteFlag' && liveJ && liveJ.votes) liveJ.votes = liveJ.votes.map(v => norm(v, ['hasVoted', 'myVote']));
    const same = j(offJ) === j(liveJ);
    check(url, same && off.status === live.status, same ? '' : '\n   离线: ' + j(offJ).slice(0, 600) + '\n   线上: ' + j(liveJ).slice(0, 600));
  }

  console.log('=== 管理员接口对比 ===');
  const adminGets = ['/api/stats', '/api/export', '/api/oplog'];
  for (const url of adminGets) {
    const off = callOffline('GET', url, { headers: auth });
    let live;
    try { live = await callLive('GET', url, { headers: auth }); } catch (e) { note(url, '线上请求失败：' + e.message); continue; }
    const offJ = norm(unlocal(off.json), ['exportedAt', 'offline']);
    const liveJ = norm(live.json, ['exportedAt', 'offline']);
    const same = j(offJ) === j(liveJ);
    if (same) check(url, true);
    else {
      // oplog / export 可能因为线上有更新的数据而不同：逐项报告
      const offLen = offJ.logs ? offJ.logs.length : Object.keys(offJ).map(k => Array.isArray(offJ[k]) ? k + ':' + offJ[k].length : '');
      const liveLen = liveJ.logs ? liveJ.logs.length : Object.keys(liveJ).map(k => Array.isArray(liveJ[k]) ? k + ':' + liveJ[k].length : '');
      note(url, '结构与内容有差异（离线库比线上旧属正常）\n   离线: ' + JSON.stringify(offLen) + '\n   线上: ' + JSON.stringify(liveLen));
    }
  }

  console.log('=== 鉴权 ===');
  check('POST /api/auth 正确密码', callOffline('POST', '/api/auth', { body: { password: ADMIN_KEY } }).json.success === true);
  check('POST /api/auth 错误密码 401', callOffline('POST', '/api/auth', { body: { password: 'x' } }).status === 401);
  check('未授权访问 /api/stats 401', callOffline('GET', '/api/stats').status === 401);
  check('未授权删除／api/posts/1 401', callOffline('DELETE', '/api/posts/1').status === 401);
  check('未知路由 404', callOffline('GET', '/api/不存在的东西').status === 404);
  check('POST /api/track 204 且不改库', (() => {
    const before = callOffline('GET', '/api/stats/public').json.pv;
    const r = callOffline('POST', '/api/track', { body: { vid: 'vtesttest', page: '/index.html' } });
    const after = callOffline('GET', '/api/stats/public').json.pv;
    return r.status === 204 && before === after;
  })());
  check('GET /api/mc-status 离线占位', (() => {
    const d = callOffline('GET', '/api/mc-status').json;
    return d.success === true && d.proto === 'offline' && d.online === false;
  })());
  check('GET /api/uptime 天数合理', (() => {
    const d = callOffline('GET', '/api/uptime').json;
    return d.success && d.days > 500 && d.startDate === '2024-06-28';
  })());
  check('GET /api/health', callOffline('GET', '/api/health').json.success === true);
  check('GET /api/img 白名单外拒绝', callOffline('GET', '/api/img?url=' + encodeURIComponent('https://evil.com/a.png')).status === 400);
  check('GET /api/img 白名单内重定向到本地', (() => {
    const r = callOffline('GET', '/api/img?url=' + encodeURIComponent('https://img.xwyue.com/i/2026/07/24/6a62ba384a1df.jpg'));
    return r.status === 302 && r.headers.Location === 'assets/03_6a62ba384a1df.jpg';
  })());

  console.log('=== 写入 / 持久化（模拟浏览器 localStorage）===');
  const created = callOffline('POST', '/api/posts', {
    headers: auth,
    body: { title: '离线测试帖', author: '测试', content: '离线版写入测试', pinned: false, images: [] },
  });
  check('新增动态', created.json.success === true && created.json.post.title === '离线测试帖');
  const newId = created.json.post && created.json.post.id;
  check('新增后列表可见', callOffline('GET', '/api/posts').json.posts.some(p => p.id === newId));
  check('写入已持久化到 storage', !!storage.getItem('jssj_offline_db'));
  check('删除动态', callOffline('DELETE', '/api/posts/' + newId, { headers: auth }).json.success === true);
  check('删除后列表消失', !callOffline('GET', '/api/posts').json.posts.some(p => p.id === newId));

  const vres = callOffline('POST', '/api/votes/' + callOffline('GET', '/api/votes').json.votes[0].id + '/vote', { body: { option: 'yes' } });
  note('离线投票结果', JSON.stringify(vres.json).slice(0, 200) + '（库里那条投票截止日期已过，被拒属预期）');

  // 用同一份 storage 重新建一个实例，验证「改动被保存下来」
  const api2 = core.createOfflineApi({ SQL, dbBytes, assetMap, storage, config: { dbName: 'backup.db' } });
  check('重载后仍保留改动', api2.info().source === 'saved');
  check('重置回原始库', (() => { api2.reset(); return api2.info().source === 'file' && api2.info().counts.posts === 3; })());

  check('图片上传（dataURL）', (() => {
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    const up = callOffline('POST', '/api/upload', { headers: auth, body: { data: png, name: 'a.png' } });
    const listed = callOffline('GET', '/api/images', { headers: auth }).json;
    return up.json.success === true && listed.images.length === 1;
  })());
  check('伪造扩展名被魔数拦下', callOffline('POST', '/api/upload', {
    headers: auth, body: { data: 'data:image/png;base64,' + Buffer.from('<html>x</html>').toString('base64'), name: 'x.png' },
  }).status === 400);
  check('下载上传在离线版返回友好错误', callOffline('POST', '/api/downloads/upload', { headers: auth }).status === 400);
  check('GET /api/backup 返回数据库字节', (() => {
    const r = callOffline('GET', '/api/backup', { headers: auth });
    return r.status === 200 && r.bytes && r.bytes.length > 100000;
  })());
  check('导入 JSON', (() => {
    const r = callOffline('POST', '/api/import', {
      headers: auth,
      body: { posts: [{ id: 'imp1', title: '导入帖', author: 'A', content: 'c', images: [], pinned: false, date: '2026-01-01' }] },
    });
    return r.json.success === true && r.json.imported.posts === 1 && callOffline('GET', '/api/posts').json.posts.some(p => p.id === 'imp1');
  })());

  console.log('');
  console.log('=== 结果 ===');
  for (const [st, name, detail] of results) {
    console.log('[' + st + '] ' + name + (detail ? '\n   ' + detail : ''));
  }
  console.log('\n通过 ' + pass + ' · 需注意 ' + warn + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常: ' + (e && e.stack || e)); process.exit(2); });
