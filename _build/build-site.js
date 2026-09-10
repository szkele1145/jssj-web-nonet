/* ============================================================
 * 离线版站点构建脚本
 * ------------------------------------------------------------
 * 1) 把原站前端（13 个页面 + css/js + favicon）复制到 离线版/
 * 2) 在每个页面 <head> 最前面注入 offline/offline.js（API 拦截层）
 * 3) 页面内硬编码的外链图片一并下载到 assets/ 并改写为本地路径
 * 4) 对 admin.html / js/server.js 做少量「离线适配」补丁
 * 5) 生成 offline/asset-map.js、db/backup-embedded.js、.nojekyll
 *
 * 运行：node 离线版/_build/build-site.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/一只屑/Desktop/建设世界';
const OUT = path.join(SRC, '离线版');
const ASSETS = path.join(OUT, 'assets');

const PAGES = [
  'index.html', 'server.html', 'members.html', 'forum.html', 'newcomer.html',
  'votes.html', 'legends.html', 'bans.html', 'download.html', 'donate.html',
  'search.html', 'about.html', 'admin.html',
];

const INJECT = '<script src="offline/offline.js"></script>';

// ------------------------------------------------------------
// 页面补丁：原站代码按线上后端写的，这里只改「必须改」的几处
// ------------------------------------------------------------
const PATCHES = {
  'admin.html': [
    // 离线图床返回的是 dataURL，原代码无条件拼 API_BASE 会变成 https://api.jssj.cc.cddata:image/...
    ['${esc(API_BASE + im.url)}', '${esc(fileUrl(im.url))}'],
    ['${esc(API_BASE + f.url)}', '${esc(fileUrl(f.url))}'],
    ['const full = API_BASE + relUrl;', 'const full = fileUrl(relUrl);'],
    // 下载上传在无后端的离线版不可用，提前告知
    [
      '<div class="form-group"><label>上传文件（直接传到服务器，推荐）</label><input type="file" id="downloadFile"></div>',
      '<div class="form-group"><label>上传文件（直接传到服务器，推荐）</label><input type="file" id="downloadFile"></div>\n' +
      '<div style="font-size:.8rem;color:rgba(224,176,90,.75);line-height:1.7;margin:-.3rem 0 .6rem;">离线版提示：这个站点没有后端，无法上传文件。请在「或填外部下载链接」里填 GitHub Release 地址（大文件走 Release）。</div>',
    ],
  ],
  'download.html': [
    // 下载项 URL 已指向 GitHub Release，绝对地址不要再拼 ?fn=（会破坏 Release 的签名跳转）
    [
      "      const full = d.url && d.url.startsWith('/') ? API_BASE + d.url : d.url;\n" +
      "      const href = full + (d.filename ? (full.indexOf('?') >= 0 ? '&' : '?') + 'fn=' + encodeURIComponent(d.filename) : '');",
      "      const full = fileUrl(d.url);\n" +
      "      const needsFn = d.filename && d.url && d.url.startsWith('/');\n" +
      "      const href = full + (needsFn ? (full.indexOf('?') >= 0 ? '&' : '?') + 'fn=' + encodeURIComponent(d.filename) : '');",
    ],
    [
      '<h2><i class="fas fa-download" style="color:#5ad0a0;"></i> 下载中心</h2>',
      '<h2><i class="fas fa-download" style="color:#5ad0a0;"></i> 下载中心</h2>' +
      '<div style="font-size:.78rem;color:rgba(160,175,190,.45);margin-top:.4rem;line-height:1.7;">' +
      '离线静态版：站点本身不含大文件，整合包托管在 GitHub Release，点击即可下载。</div>',
    ],
  ],
};

const SERVER_JS_PATCH = [
  [
    "function renderServerStatus(data) {\n  const container = document.getElementById('serverStatusContent');",
    `function renderServerStatus(data) {
  const container = document.getElementById('serverStatusContent');
  // [离线版] 无后端，不做实时查询，展示静态说明卡片
  if (data && data.proto === 'offline') {
    const s = data.server || {};
    container.innerHTML = \`
      <div class="mc-card">
        <div class="mc-head">
          <div class="mc-live"><span class="mc-live-text mc-live-off">离线版</span></div>
          <div class="mc-online"><i class="fas fa-box-archive"></i> 静态数据</div>
        </div>
        <div class="mc-meta"><span class="mc-proto proto-ping"><i class="fas fa-plug"></i>不查询实时状态</span></div>
        <div class="mc-body">
          <div class="mc-motd">本页是<b>离线静态版</b>：站内所有数据都来自随站点分发的 backup.db，页面不依赖任何后端，因此这里不显示实时在线人数。<br>
服务器地址 <b>\${s.srv || 'jssj.cc.cd'}</b>，Java 版 SRV 指向 <b>\${s.host || ''}:\${s.port || ''}</b>，Query 端口 <b>\${s.queryPort || ''}</b>。<br>
需要实时状态请到线上站点查看。</div>
        </div>
      </div>\`;
    return;
  }`,
  ],
];

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------
const IMG_RE = /(?:src|href)="(https?:\/\/[^"]+\.(?:png|jpe?g|gif|webp|bmp|ico)(?:\?[^"]*)?)"/gi;

// 读 JSON 时去掉可能的 BOM（被 PowerShell 写过的文件会带 BOM）
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function findImageUrls(html) {
  const set = new Set();
  let m;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(html))) set.add(m[1]);
  return [...set];
}

function nameFor(url, ext) {
  const base = new URL(url).pathname.split('/').pop().replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(-40);
  return 'html_' + base + '.' + ext;
}

async function downloadMissing(urls, map) {
  let added = 0;
  for (const u of urls) {
    if (map[u]) continue;
    try {
      const r = await fetch(u);
      if (!r.ok) { console.log('  ! 下载失败 ' + r.status + ' ' + u); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      let ext = 'jpg';
      const em = new URL(u).pathname.match(/\.([A-Za-z0-9]+)$/);
      if (em) ext = em[1].toLowerCase().replace('jpeg', 'jpg');
      const name = nameFor(u, ext);
      fs.writeFileSync(path.join(ASSETS, name), buf);
      map[u] = 'assets/' + name;
      added++;
      console.log('  + 本地化 HTML 外链图片 ' + name + ' (' + buf.length + ' B) <- ' + u);
    } catch (e) { console.log('  ! 下载异常 ' + u + ' :: ' + e.message); }
  }
  return added;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, e.name), t = path.join(to, e.name);
    if (e.isDirectory()) copyDir(f, t);
    else fs.copyFileSync(f, t);
  }
}

// 原站文件行尾有 CRLF 也有 LF，补丁锚点按目标文件的行尾自动适配
function applyPatches(text, patches, label) {
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  let applied = 0;
  for (const [from, to] of patches) {
    const f = from.replace(/\r?\n/g, eol);
    const t = to.replace(/\r?\n/g, eol);
    if (text.indexOf(f) === -1) {
      console.log('  ! ' + label + ' 未找到补丁锚点：' + from.split('\n')[0].slice(0, 56));
      continue;
    }
    text = text.split(f).join(t);
    applied++;
  }
  return { text, applied };
}

async function main() {
  console.log('=== 1. 准备目录 ===');
  for (const d of [ASSETS, path.join(OUT, 'offline'), path.join(OUT, 'db'), path.join(OUT, 'lib')]) fs.mkdirSync(d, { recursive: true });

  const mapPath = path.join(OUT, 'offline/asset-map.json');
  const assetMap = fs.existsSync(mapPath) ? readJson(mapPath) : {};
  console.log('  已有资源映射 ' + Object.keys(assetMap).length + ' 条');

  console.log('=== 2. 处理页面 ===');
  let patchedTotal = 0;
  for (const page of PAGES) {
    const srcFile = path.join(SRC, page);
    if (!fs.existsSync(srcFile)) { console.log('  ! 缺少 ' + page); continue; }
    let html = fs.readFileSync(srcFile, 'utf8');
    const before = html;

    // (a) 硬编码外链图片 → 本地
    const urls = findImageUrls(html);
    await downloadMissing(urls, assetMap);
    for (const u of urls) {
      if (assetMap[u]) html = html.split(u).join(assetMap[u]);
    }

    // (b) 注入离线引导脚本（必须早于页面自身的任何脚本）
    const i = html.indexOf('<script');
    if (i >= 0) html = html.slice(0, i) + INJECT + html.slice(i);
    else html = html.replace('</body>', INJECT + '</body>');

    // (c) 页面专属补丁
    const r = applyPatches(html, PATCHES[page] || [], page);
    html = r.text;
    patchedTotal += r.applied;

    fs.writeFileSync(path.join(OUT, page), html);
    console.log('  ✓ ' + page + (html !== before ? '（已注入/改写）' : ''));
  }
  console.log('  页面补丁应用 ' + patchedTotal + ' 处');

  console.log('=== 3. 复制静态资源 ===');
  copyDir(path.join(SRC, 'css'), path.join(OUT, 'css'));
  copyDir(path.join(SRC, 'js'), path.join(OUT, 'js'));
  fs.copyFileSync(path.join(SRC, 'favicon.png'), path.join(OUT, 'favicon.png'));
  console.log('  ✓ css/ js/ favicon.png');

  console.log('=== 4. 打补丁 js/server.js ===');
  const sj = path.join(OUT, 'js/server.js');
  let sjs = fs.readFileSync(sj, 'utf8');
  const sjr = applyPatches(sjs, SERVER_JS_PATCH, 'js/server.js');
  sjs = sjr.text;
  fs.writeFileSync(sj, sjs);
  console.log('  ✓ js/server.js 已加离线状态卡片（' + sjr.applied + ' 处）');

  console.log('=== 5. 生成构建产物 ===');
  fs.writeFileSync(mapPath, JSON.stringify(assetMap, null, 1));
  const builtAt = (() => {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  })();
  fs.writeFileSync(path.join(OUT, 'offline/asset-map.js'),
    '/* 构建产物：外链资源 → 本地路径 映射；同时携带构建时间 */\n' +
    'window.__JSSJ_ASSET_MAP__ = ' + JSON.stringify(assetMap, null, 1) + ';\n' +
    "window.__JSSJ_OFFLINE_BUILT_AT__ = " + JSON.stringify(builtAt) + ';\n');
  console.log('  ✓ offline/asset-map.js（' + Object.keys(assetMap).length + ' 条映射，构建于 ' + builtAt + '）');

  // ---- 下载项 → GitHub Release 资源链接 ----
  // tag 为空表示「暂时不发布 Release」：下载项会回落到线上服务器地址
  const relCfgPath = path.join(OUT, '_build/release-config.json');
  const relCfgDefault = { repo: 'szkele1145/jssj-web-nonet', tag: 'offline-v1', releaseBase: '' };
  let relCfg = Object.assign({}, relCfgDefault);
  if (fs.existsSync(relCfgPath)) Object.assign(relCfg, readJson(relCfgPath));
  else fs.writeFileSync(relCfgPath, JSON.stringify(relCfgDefault, null, 2));
  const releaseBase = relCfg.releaseBase ||
    (relCfg.repo && relCfg.tag ? 'https://github.com/' + relCfg.repo + '/releases/download/' + relCfg.tag + '/' : '');

  const initSqlJs = require(path.join(OUT, 'lib/sql-asm.js'));
  const SQL2 = await initSqlJs();
  const tmpDb = new SQL2.Database(new Uint8Array(fs.readFileSync(path.join(OUT, 'db/backup.db'))));
  const dlRows = [];
  (function () {
    const st = tmpDb.prepare('SELECT * FROM downloads');
    while (st.step()) dlRows.push(st.getAsObject());
    st.free();
  })();
  tmpDb.close();

  const downloadMap = {};
  for (const r of dlRows) {
    if (!/\/downloads\//.test(String(r.url || ''))) continue;
    const asset = r.filename || String(r.url).split('/').pop();
    if (releaseBase) downloadMap[r.url] = releaseBase + encodeURIComponent(asset);
  }
  fs.writeFileSync(path.join(OUT, 'offline/download-map.js'),
    '/* 构建产物：下载项 → GitHub Release 资源 映射（见 _build/release-config.json） */\n' +
    'window.__JSSJ_DOWNLOAD_MAP__ = ' + JSON.stringify(downloadMap, null, 1) + ';\n');
  if (Object.keys(downloadMap).length) {
    console.log('  ✓ offline/download-map.js（' + Object.keys(downloadMap).length + ' 个下载项指向 ' + releaseBase + '）');
  } else {
    console.log('  ⚠ offline/download-map.js 为空：_build/release-config.json 里没填 repo/tag，下载链接仍指向线上服务器');
  }

  const dbBytes = fs.readFileSync(path.join(OUT, 'db/backup.db'));
  const b64 = dbBytes.toString('base64');
  fs.writeFileSync(path.join(OUT, 'db/backup-embedded.js'),
    '/* 构建产物：backup.db 的 base64 内嵌副本（file:// 直接双击打开时使用；\n' +
    '   http(s) 环境优先读取同目录的 backup.db 原文件） */\n' +
    'window.__JSSJ_DB_BASE64__ = "' + b64 + '";\n');
  console.log('  ✓ db/backup-embedded.js（' + (b64.length / 1024).toFixed(1) + ' KB，源库 ' + (dbBytes.length / 1024).toFixed(1) + ' KB）');

  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log('  ✓ .nojekyll（GitHub Pages 关闭 Jekyll 处理）');

  console.log('=== 6. 汇总 ===');
  const walk = (dir) => {
    let n = 0, bytes = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '_build' || e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = walk(p); n += r.n; bytes += r.bytes; }
      else { n++; bytes += fs.statSync(p).size; }
    }
    return { n, bytes };
  };
  const t = walk(OUT);
  console.log('  站点文件 ' + t.n + ' 个，合计 ' + (t.bytes / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  最大文件：');
  const files = [];
  (function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '_build' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else files.push([path.relative(OUT, p).replace(/\\/g, '/'), fs.statSync(p).size]);
    }
  })(OUT);
  files.sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([f, s]) => console.log('    ' + (s / 1024).toFixed(0).padStart(6) + ' KB  ' + f));
  const oversize = files.filter(([, s]) => s > 90 * 1024 * 1024);
  if (oversize.length) console.log('  ⚠ 有文件超过 GitHub Pages 单文件 100MB 上限：' + oversize.map(f => f[0]).join(', '));
}

main().catch(e => { console.error('构建失败: ' + (e && e.stack || e)); process.exit(1); });
