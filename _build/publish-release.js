/* ============================================================
 * 把下载中心的大文件发到 GitHub Release（无后端站点靠它提供下载）
 * ------------------------------------------------------------
 * 1) 从线上服务器把两个整合包拉下来（缓存到 _build/release-files/）
 * 2) 用 GitHub API 建 Release（存在则复用）
 * 3) 逐个上传为 Release 资源（用原始文件名，下载回来的名字才对）
 * 4) 把真实地址写进 _build/release-config.json，并重新构建页面
 *
 * 用法：node 离线版/_build/publish-release.js
 * 令牌来源（按顺序）：环境变量 GH_TOKEN / GITHUB_TOKEN，
 *   或从旧仓库 git remote 里取（本机 建设世界/.git/config）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const BUILD = path.join(ROOT, '_build');
const CACHE = path.join(BUILD, 'release-files');
const MAIN_REPO = 'C:/Users/一只屑/Desktop/建设世界';
const GIT = 'C:/Program Files/Git/bin/git.exe';

// ---------- 令牌 ----------
function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const url = execFileSync(GIT, ['-C', MAIN_REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/https:\/\/([^@\/]+)@github\.com/);
    if (m && m[1]) {
      const parts = m[1].split(':');
      return parts.length > 1 ? parts[1] : parts[0];
    }
  } catch (e) {}
  return '';
}

const TOKEN = getToken();
if (!TOKEN) { console.error('没有拿到 GitHub 令牌：设置 GH_TOKEN 环境变量，或在旧仓库 remote 里保留 token'); process.exit(1); }

const cfgPath = path.join(BUILD, 'release-config.json');
const cfg = Object.assign({ repo: 'szkele1145/jssj-web-nonet', tag: 'offline-v1', releaseBase: '' },
  fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {});

const API = 'https://api.github.com';
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'jssj-offline-build', 'X-GitHub-Api-Version': '2022-11-28' };

// ---------- 待发布文件：来自数据库的下载项 ----------
const initSqlJs = require(path.join(ROOT, 'lib/sql-asm.js'));

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.join(ROOT, 'db/backup.db'))));
  const rows = [];
  const st = db.prepare('SELECT * FROM downloads');
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  db.close();

  const items = rows
    .filter(r => /\/downloads\//.test(String(r.url || '')))
    .map(r => ({
      name: r.filename || String(r.url).split('/').pop(),
      size: r.size || '',
      remote: 'https://api.jssj.cc.cd' + (String(r.url).startsWith('/') ? '' : '/') + r.url,
    }));

  if (!items.length) { console.log('数据库里没有指向服务器 /downloads/ 的下载项，无需发布'); return; }
  console.log('待发布文件：');
  items.forEach(i => console.log('  · ' + i.name + '（' + i.size + '）'));

  fs.mkdirSync(CACHE, { recursive: true });

  // ---------- 1. 下载 ----------
  console.log('\n① 从线上服务器拉取文件…');
  for (const it of items) {
    const local = path.join(CACHE, it.name);
    if (fs.existsSync(local) && fs.statSync(local).size > 0) {
      console.log('  ✓ ' + it.name + '（本地已有 ' + (fs.statSync(local).size / 1048576).toFixed(1) + ' MB，跳过下载）');
      continue;
    }
    const t0 = Date.now();
    const r = await fetch(it.remote);
    if (!r.ok) { console.error('  ✗ 下载失败 HTTP ' + r.status + ' ' + it.remote); process.exit(1); }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(local, buf);
    console.log('  ✓ ' + it.name + ' ' + (buf.length / 1048576).toFixed(1) + ' MB（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  }

  // ---------- 2. 建 Release ----------
  console.log('\n② 确保 Release 存在…');
  let release = null;
  let r = await fetch(API + '/repos/' + cfg.repo + '/releases/tags/' + cfg.tag, { headers: H });
  if (r.status === 200) {
    release = await r.json();
    console.log('  ✓ 已存在：' + release.name + '（id ' + release.id + '）');
  } else {
    r = await fetch(API + '/repos/' + cfg.repo + '/releases', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({
        tag_name: cfg.tag,
        name: '离线版大文件（下载中心）',
        body: '建设世界官网离线静态版所用的下载文件。\n\n站点本身不含这些大文件，下载页的链接直接指向这里。',
      }),
    });
    if (!r.ok) { console.error('  ✗ 创建 Release 失败 HTTP ' + r.status + '：' + (await r.text()).slice(0, 300)); process.exit(1); }
    release = await r.json();
    console.log('  ✓ 已创建：' + release.name + '（id ' + release.id + '）');
  }

  const existing = new Set((release.assets || []).map(a => a.name));

  // ---------- 3. 上传资源 ----------
  console.log('\n③ 上传资源…');
  for (const it of items) {
    if (existing.has(it.name)) { console.log('  ✓ ' + it.name + '（Release 里已有，跳过）'); continue; }
    const local = path.join(CACHE, it.name);
    const buf = fs.readFileSync(local);
    const url = 'https://uploads.github.com/repos/' + cfg.repo + '/releases/' + release.id +
      '/assets?name=' + encodeURIComponent(it.name);
    const t0 = Date.now();
    const up = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) }, H),
      body: buf,
    });
    if (!up.ok) { console.error('  ✗ ' + it.name + ' 上传失败 HTTP ' + up.status + '：' + (await up.text()).slice(0, 300)); process.exit(1); }
    const j = await up.json();
    console.log('  ✓ ' + it.name + ' ' + (buf.length / 1048576).toFixed(1) + ' MB（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）→ ' + j.browser_download_url);
  }

  // ---------- 4. 更新配置并重建 ----------
  const base = 'https://github.com/' + cfg.repo + '/releases/download/' + cfg.tag + '/';
  const newCfg = Object.assign({}, cfg, { releaseBase: base });
  fs.writeFileSync(cfgPath, JSON.stringify(newCfg, null, 2));
  console.log('\n④ 已写入 release-config.json，releaseBase = ' + base);
  console.log('   重新构建页面…');
  execFileSync(process.execPath, [path.join(BUILD, 'build-site.js')], { stdio: 'inherit' });
  console.log('\n完成。记得把 offline/download-map.js 一起提交推送。');
})().catch(e => { console.error('发布失败：' + (e && e.stack || e)); process.exit(1); });
