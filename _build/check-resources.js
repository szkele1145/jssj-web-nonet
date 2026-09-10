/* ============================================================
 * 资源加载检查：用 Edge 打开各页面后，分析自测服务器的访问日志
 * 目的是抓 DOM 看不出来的问题：CSS / 字体 / 图片 / 数据库 是否 404
 * 前置：node _build/serve.js 8123（带日志）已在运行
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const LOG = path.join(ROOT, '_build/access.log');
const profile = path.join(os.tmpdir(), 'edge-res-' + Math.random().toString(36).slice(2, 10));

// 先清空日志，只统计这一轮
fs.writeFileSync(LOG, '');

const PAGES = ['index.html', 'server.html', 'forum.html', 'votes.html', 'legends.html',
  'bans.html', 'donate.html', 'download.html', 'search.html', 'admin.html'];

console.log('=== 用 Edge 打开 ' + PAGES.length + ' 个页面 ===');
for (const p of PAGES) {
  const r = spawnSync(EDGE, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--user-data-dir=' + profile, '--virtual-time-budget=15000', '--dump-dom', BASE + '/' + p],
    { stdio: ['ignore', 'ignore', 'ignore'], timeout: 150000 });
  process.stdout.write('  ' + p + ' ');
}
console.log('\n');

const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean);
// 浏览器会自动探测 /favicon.ico（页面里声明的是 favicon.png），这个 404 无影响，属正常现象
const benign = /^404 \/favicon\.ico$/;
const ok = lines.filter(l => l.startsWith('200 '));
const bad = lines.filter(l => !l.startsWith('200 ') && !benign.test(l));
const benignHits = lines.filter(l => benign.test(l));

console.log('=== 请求总数 ' + lines.length + ' · 成功 ' + ok.length + ' · 失败 ' + bad.length + ' ===');
if (benignHits.length) console.log('（浏览器自动探测 /favicon.ico 共 ' + benignHits.length + ' 次 404，页面声明的是 favicon.png，无影响）');
if (bad.length) {
  console.log('❌ 以下资源加载失败（页面里会出现裂图 / 无样式）：');
  [...new Set(bad)].forEach(l => console.log('   ' + l));
}

const hit = (re) => ok.filter(l => re.test(l));
const need = [
  [/css\/style\.css/, '全局样式'],
  [/css\/fontawesome\/all\.min\.css/, 'Font Awesome 样式'],
  [/css\/webfonts\/.+\.(woff2|woff|ttf)/, '图标字体文件'],
  [/offline\/offline\.js/, '离线引导层'],
  [/offline\/offline-core\.js/, '离线 API 核心'],
  [/offline\/asset-map\.js/, '资源映射'],
  [/offline\/download-map\.js/, '下载映射'],
  [/lib\/sql-asm\.js/, 'SQLite 引擎（sql.js）'],
  [/db\/backup\.db/, '内嵌数据库 backup.db'],
  [/^200 \/assets\//, '本地化图片'],
  [/favicon\.png/, '站点图标'],
];
console.log('\n=== 关键资源加载情况 ===');
let fail = 0;
for (const [re, name] of need) {
  const hits = hit(re);
  if (hits.length) {
    console.log('  ✓ ' + name + '（' + hits.length + ' 个请求，例：' + hits[0].split(' ')[1] + '）');
  } else {
    console.log('  ✗ ' + name + '：没有被请求到');
    fail++;
  }
}

const assetHits = new Set(hit(/^200 \/assets\//).map(l => l.split(' ')[1]));
console.log('\n  本次实际加载的本地图片 ' + assetHits.size + ' 张：');
[...assetHits].slice(0, 12).forEach(a => console.log('    ' + a));

const dbs = hit(/db\/backup\.db/);
console.log('\n  数据库加载次数 ' + dbs.length + '（每个页面各取一次，大小 ' +
  (dbs[0] ? dbs[0].split(' ')[2] : '?') + ' 字节）');

console.log('\n资源检查 ' + (fail === 0 && bad.length === 0 ? '全部通过 ✅' : '存在问题 ❌'));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(fail === 0 && bad.length === 0 ? 0 : 1);
