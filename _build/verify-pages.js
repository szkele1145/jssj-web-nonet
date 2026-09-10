/* ============================================================
 * 离线版页面端到端验证（Edge 无头模式抓最终 DOM）
 * 前置：node _build/serve.js 8123 已在运行
 * 运行：node 离线版/_build/verify-pages.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LIVE_BASE = process.argv[2] || '';
const BASE = LIVE_BASE || 'http://127.0.0.1:8123';
const OUT = path.join(ROOT, '_build', LIVE_BASE ? 'dumps-live' : 'dumps');
fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(os.tmpdir(), 'edge-offline-' + Math.random().toString(36).slice(2, 10));

const PAGES = ['index.html', 'server.html', 'forum.html', 'votes.html', 'legends.html', 'bans.html',
  'donate.html', 'download.html', 'members.html', 'newcomer.html', 'about.html', 'search.html', 'admin.html'];

let edgeMissing = !fs.existsSync(EDGE);

// msedge.exe 是 GUI 子系统程序：不能管道捕获 stdout，
// 但把「已打开的文件句柄」当作 stdout 传给它时，它会正常写入（等价于 cmd 的 > 重定向）
function runEdge(args, outFile) {
  let fd = null;
  const opts = { stdio: ['ignore', 'ignore', 'ignore'], timeout: 150000 };
  if (outFile) {
    fd = fs.openSync(outFile, 'w');
    opts.stdio[1] = fd;
  }
  try {
    const r = spawnSync(EDGE, args, opts);
    return { status: r.status, error: r.error };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} }
  }
}

const COMMON = ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + profile, '--virtual-time-budget=15000'];

console.log('=== 抓取各页面最终 DOM（Edge 无头）===');
for (const p of PAGES) {
  const file = path.join(OUT, p.replace(/\.html$/, '.dom.html'));
  if (edgeMissing) break;
  const r = runEdge(COMMON.concat(['--dump-dom', BASE + '/' + p]), file);
  const sz = fs.existsSync(file) ? fs.statSync(file).size : 0;
  console.log('  ' + (sz > 1500 ? '✓' : '!') + ' ' + p + ' → ' + (sz / 1024).toFixed(0) + ' KB' +
    (sz <= 1500 ? ' (status=' + r.status + (r.error ? ' ' + r.error.message : '') + ')' : ''));
}

console.log('=== 抓取截图（人工核对）===');
for (const p of ['index.html', 'forum.html', 'legends.html', 'server.html', 'download.html', 'votes.html', 'donate.html', 'admin.html']) {
  const png = path.join(OUT, p.replace(/\.html$/, '.png'));
  runEdge(COMMON.concat(['--window-size=1400,1000', '--screenshot=' + png, BASE + '/' + p]));
  console.log('  ' + (fs.existsSync(png) ? '✓' : '!') + ' ' + path.basename(png));
}

const read = (f) => {
  const p = path.join(OUT, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const has = (f, re) => new RegExp(re).test(read(f));

const checks = [
  ['index.dom.html', 'jssjOfflineBadge', '离线浮标已注入'],
  ['index.dom.html', 'uptimeDays">\\d+<', '首页运行天数由浏览器内 SQLite 算出'],
  ['index.dom.html', 'sitePv">\\d+<', '首页访问量来自备份库（不是 --）'],
  ['forum.dom.html', '欢迎来到建设世界', '动态页渲染出帖子'],
  ['forum.dom.html', '捐赠资金流向', '动态页渲染出全部帖子'],
  ['forum.dom.html', 'assets/0\\d_', '动态图片已改走本地 assets/'],
  ['votes.dom.html', '关于用户女装的决定投票', '投票页渲染出投票'],
  ['votes.dom.html', '截止', '投票截止信息正常'],
  ['legends.dom.html', 'story-gallery', '神人榜渲染出图片画廊'],
  ['legends.dom.html', 'assets/1\\d_', '神人榜图片本地化'],
  ['bans.dom.html', '封挂榜', '封挂榜页面渲染'],
  ['donate.dom.html', 'assets/html_6a6891', '捐赠收款码已本地化'],
  ['donate.dom.html', '叄四宋|2555xwei|Psyduckck', '捐赠名单来自数据库'],
  ['download.dom.html', '整合包', '下载页渲染出下载项'],
  ['download.dom.html', 'releases/download/offline-v1', '下载链接指向 GitHub Release'],
  ['server.dom.html', '离线静态版', '服务器页展示离线说明卡片'],
  ['server.dom.html', 'yd1\\.yizexiaomu\\.com', '离线卡片含服务器地址'],
  ['search.dom.html', 'jssjOfflineBadge', '搜索页可加载'],
  ['admin.dom.html', 'authOverlay', '后台登录界面存在'],
  ['admin.dom.html', 'jssjOfflineBadge', '后台已挂离线浮标'],
];

const negatives = [
  ['server.dom.html', '已关闭', '服务器页不应显示「已关闭」'],
  ['index.dom.html', 'img\\.xwyue\\.com', '首页不应残留外链图床地址'],
  ['donate.dom.html', 'img\\.xwyue\\.com', '捐赠页外链已本地化'],
  ['forum.dom.html', 'api\\.jssj\\.cc\\.cd/uploads', '动态图片不应再指向线上 API'],
];

let pass = 0, fail = 0;
console.log('\n=== 正向检查 ===');
for (const [f, re, desc] of checks) {
  const ok = has(f, re);
  if (ok) { pass++; console.log('[PASS] ' + desc); }
  else { fail++; console.log('[FAIL] ' + desc + '   (' + f + ' 期望 /' + re + '/)'); }
}
console.log('\n=== 负向检查 ===');
for (const [f, re, desc] of negatives) {
  const bad = has(f, re);
  if (bad) { fail++; console.log('[FAIL] ' + desc); }
  else { pass++; console.log('[PASS] ' + desc); }
}
console.log('\n通过 ' + pass + ' · 失败 ' + fail);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
