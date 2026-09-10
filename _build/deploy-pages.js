/* ============================================================
 * 部署到 GitHub Pages（无后端静态站点）
 * ------------------------------------------------------------
 * 1) 确保公开仓库存在（默认 szkele1145/jssj-web-nonet）
 * 2) git init / commit / push（推送 离线版/ 的内容作为仓库根目录）
 * 3) 打开 Pages（main 分支根目录）
 * 4) 轮询 Pages 构建状态并访问首页验证
 *
 * 用法：node 离线版/_build/deploy-pages.js
 * 令牌：环境变量 GH_TOKEN / GITHUB_TOKEN，或旧仓库 remote 里的 token
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const MAIN_REPO = 'C:/Users/一只屑/Desktop/建设世界';
const GIT = 'C:/Program Files/Git/bin/git.exe';
const OWNER = 'szkele1145';
const REPO = 'jssj-web-nonet';
const API = 'https://api.github.com';

function git(args, opts) {
  return execFileSync(GIT, ['-C', ROOT].concat(args), Object.assign({ encoding: 'utf8' }, opts || {}));
}

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const url = execFileSync(GIT, ['-C', MAIN_REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/https:\/\/([^@\/]+)@github\.com/);
    if (m) { const parts = m[1].split(':'); return parts.length > 1 ? parts[1] : parts[0]; }
  } catch (e) {}
  return '';
}

const TOKEN = getToken();
if (!TOKEN) { console.error('没有拿到 GitHub 令牌'); process.exit(1); }
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'jssj-offline-deploy', 'X-GitHub-Api-Version': '2022-11-28' };

(async () => {
  // ---------- 0. 令牌信息 ----------
  let me = await fetch(API + '/user', { headers: H });
  if (!me.ok) { console.error('令牌无效：HTTP ' + me.status); process.exit(1); }
  const scopes = me.headers.get('x-oauth-scopes') || '(未返回，可能是细粒度令牌)';
  const user = await me.json();
  console.log('① 令牌身份：' + user.login + '　权限范围：' + scopes);

  // ---------- 1. 仓库 ----------
  console.log('\n② 检查仓库 ' + OWNER + '/' + REPO + ' …');
  let r = await fetch(API + '/repos/' + OWNER + '/' + REPO, { headers: H });
  if (r.status === 200) {
    const j = await r.json();
    console.log('  ✓ 已存在（' + (j.private ? '私有' : '公开') + '，默认分支 ' + j.default_branch + '）');
    if (j.private) console.log('  ⚠ 仓库是私有的：免费账号无法用 Pages，请到仓库设置里改成 Public');
  } else if (r.status === 404) {
    console.log('  不存在，创建公开仓库…');
    r = await fetch(API + '/user/repos', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({
        name: REPO,
        description: '建设世界官网 · 离线静态版（无后端，数据库内嵌，浏览器内跑 SQLite）',
        homepage: 'https://' + OWNER + '.github.io/' + REPO + '/',
        private: false, has_issues: true, has_wiki: false, has_projects: false, auto_init: false,
      }),
    });
    if (!r.ok) { console.error('  ✗ 创建失败 HTTP ' + r.status + '：' + (await r.text()).slice(0, 400)); process.exit(1); }
    console.log('  ✓ 已创建公开仓库');
  } else {
    console.error('  ✗ 查询仓库失败 HTTP ' + r.status + '：' + (await r.text()).slice(0, 300));
    process.exit(1);
  }

  // ---------- 2. git 提交推送 ----------
  console.log('\n③ 提交并推送…');
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    git(['init', '-b', 'main']);
    console.log('  ✓ git init（分支 main）');
  }
  // 沿用主仓库的提交者信息
  let uname = 'szkele1145', uemail = 'szkele1145@users.noreply.github.com';
  try {
    uname = execFileSync(GIT, ['-C', MAIN_REPO, 'config', 'user.name'], { encoding: 'utf8' }).trim() || uname;
    uemail = execFileSync(GIT, ['-C', MAIN_REPO, 'config', 'user.email'], { encoding: 'utf8' }).trim() || uemail;
  } catch (e) {}
  git(['config', 'user.name', uname]);
  git(['config', 'user.email', uemail]);
  // 带令牌的 remote：本机免密推送（.git/config 不会入库）
  try { git(['remote', 'remove', 'origin'], { stdio: 'ignore' }); } catch (e) {}
  execFileSync(GIT, ['-C', ROOT, 'remote', 'add', 'origin',
    'https://' + OWNER + ':' + TOKEN + '@github.com/' + OWNER + '/' + REPO + '.git']);

  git(['add', '-A']);
  const staged = git(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean);
  console.log('  待提交文件 ' + staged.length + ' 个');
  if (staged.length) {
    try { git(['commit', '-m', '建设世界官网 · 离线静态版（无后端，SQLite 内嵌，数据 ' + new Date().toISOString().slice(0, 10) + '）']); }
    catch (e) { console.log('  （没有新变更需要提交）'); }
  } else {
    console.log('  （工作区干净，跳过提交）');
  }
  try {
    const out = git(['push', '-u', 'origin', 'main'], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('  ✓ 推送完成' + (out ? '：' + out.trim().split('\n').slice(-1)[0] : ''));
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    if (/up-to-date|Everything up-to-date/i.test(msg)) console.log('  ✓ 已是最新');
    else { console.error('  ✗ 推送失败：' + msg.slice(0, 500)); process.exit(1); }
  }

  // ---------- 3. 打开 Pages ----------
  console.log('\n④ 配置 GitHub Pages…');
  const pagesUrl = 'https://' + OWNER + '.github.io/' + REPO + '/';
  r = await fetch(API + '/repos/' + OWNER + '/' + REPO + '/pages', { headers: H });
  if (r.status === 200) {
    const j = await r.json();
    console.log('  ✓ Pages 已开启（' + (j.status || '') + '）→ ' + (j.html_url || pagesUrl));
  } else {
    r = await fetch(API + '/repos/' + OWNER + '/' + REPO + '/pages', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
    });
    if (r.ok) {
      const j = await r.json();
      console.log('  ✓ 已开启 Pages → ' + (j.html_url || pagesUrl));
    } else {
      const t = await r.text();
      console.error('  ✗ 开启 Pages 失败 HTTP ' + r.status + '：' + t.slice(0, 400));
      console.error('    （可以在仓库 Settings → Pages 里手动选 main / (root)）');
    }
  }

  // ---------- 4. 轮询构建结果 ----------
  console.log('\n⑤ 等待 Pages 构建（最多 5 分钟）…');
  const deadline = Date.now() + 5 * 60 * 1000;
  let live = false;
  while (Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 15000));
    let status = '';
    try {
      const pr = await fetch(API + '/repos/' + OWNER + '/' + REPO + '/pages', { headers: H });
      if (pr.ok) status = (await pr.json()).status || '';
    } catch (e) {}
    let code = 0, body = '';
    try {
      const hr = await fetch(pagesUrl + 'index.html', { cache: 'no-store' });
      code = hr.status;
      body = code === 200 ? await hr.text() : '';
    } catch (e) {}
    console.log('  Pages 状态=' + (status || '?') + '　首页 HTTP=' + (code || '失败') +
      (body ? '　含离线层=' + (body.indexOf('offline/offline.js') >= 0 ? '是' : '否') + '　大小=' + (body.length / 1024).toFixed(0) + 'KB' : ''));
    if (code === 200 && body.indexOf('offline/offline.js') >= 0) { live = true; break; }
  }

  console.log('\n' + (live ? '✅ 部署完成：' + pagesUrl : '⚠ 还没上线，稍等片刻再刷新 ' + pagesUrl));
})().catch(e => { console.error('部署失败：' + (e && e.stack || e)); process.exit(1); });
