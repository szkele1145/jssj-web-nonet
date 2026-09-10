/* ============================================================
 * 把下载中心的大文件发到 GitHub Release（无后端站点靠它提供下载）
 * ------------------------------------------------------------
 * · 源站下载：断点续传 + 停滞超时 + 重试，边下边写磁盘（不会把 95MB 憋在内存里）
 * · GitHub 上传：走 HTTPS_PROXY（Node 24 需 NODE_USE_ENV_PROXY=1 才认环境变量代理）
 * · 已经上传过的资源自动跳过，可反复重跑
 *
 * 用法（带代理，源站走直连）：
 *   $env:NODE_USE_ENV_PROXY='1'
 *   $env:HTTPS_PROXY='http://127.0.0.1:7888'
 *   $env:NO_PROXY='api.jssj.cc.cd,127.0.0.1,localhost'
 *   node 离线版/_build/publish-release.js
 *
 * 令牌：环境变量 GH_TOKEN / GITHUB_TOKEN，或旧仓库 remote 里的 token
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const BUILD = path.join(ROOT, '_build');
const CACHE = path.join(BUILD, 'release-files');
const MAIN_REPO = 'C:/Users/一只屑/Desktop/建设世界';
const GIT = 'C:/Program Files/Git/bin/git.exe';

const STALL_MS = 90000;          // 90 秒没有任何数据就判定停滞
const DOWNLOAD_TRIES = 8;
const UPLOAD_TRIES = 3;
const UPLOAD_TIMEOUT_MS = 25 * 60 * 1000;

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const url = execFileSync(GIT, ['-C', MAIN_REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/https:\/\/([^@\/]+)@github\.com/);
    if (m) { const p = m[1].split(':'); return p.length > 1 ? p[1] : p[0]; }
  } catch (e) {}
  return '';
}

const TOKEN = getToken();
if (!TOKEN) { console.error('没有拿到 GitHub 令牌：设置 GH_TOKEN，或在旧仓库 remote 里保留 token'); process.exit(1); }

const cfgPath = path.join(BUILD, 'release-config.json');
const cfg = Object.assign({ repo: 'szkele1145/jssj-web-nonet', tag: 'offline-v1', releaseBase: '' },
  fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')) : {});
// tag 为空表示「离线站点暂时回落到线上服务器」，发布时补上默认 tag
const TAG = cfg.tag || 'offline-v1';

const API = 'https://api.github.com';
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'jssj-offline-build', 'X-GitHub-Api-Version': '2022-11-28' };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
console.log('GitHub 代理：' + (proxy || '（未设置，直连）') +
  '　NODE_USE_ENV_PROXY=' + (process.env.NODE_USE_ENV_PROXY || '未设置') +
  '　NO_PROXY=' + (process.env.NO_PROXY || process.env.no_proxy || '未设置'));
if (proxy && process.env.NODE_USE_ENV_PROXY !== '1' && process.env.NODE_USE_ENV_PROXY !== 'true') {
  console.log('⚠ Node 24 需要 NODE_USE_ENV_PROXY=1 才会使用环境变量里的代理，否则等于直连');
}

// ------------------------------------------------------------
// 断点续传下载
// 优先用 curl（实测从源站能跑满带宽，且续传/落盘可靠）；
// 没有 curl 时退回 Node 流式下载
// ------------------------------------------------------------
async function remoteSize(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const n = Number(r.headers.get('content-length') || 0);
    return r.ok && n > 0 ? n : 0;
  } catch (e) { return 0; }
}

function hasCurl() {
  try { execFileSync('curl.exe', ['--version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

async function downloadWithCurl(url, dest, label) {
  const part = dest + '.part';
  const total = await remoteSize(url);
  console.log('  目标大小 ' + (total ? mb(total) : '未知') + '（curl 续传下载）');
  for (let attempt = 1; attempt <= DOWNLOAD_TRIES; attempt++) {
    const before = fs.existsSync(part) ? fs.statSync(part).size : 0;
    try {
      execFileSync('curl.exe', [
        '-L', '--fail', '--retry', '3', '--retry-delay', '3',
        '--noproxy', 'api.jssj.cc.cd,jssj.cc.cd',   // 源站直连，不走梯子
        '-C', '-', '-o', part,
        '--connect-timeout', '20',
        url,
      ], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 60 * 60 * 1000 });
    } catch (e) {
      // curl 的 -C - 在文件已完整时可能报错，下面用大小判断，不直接失败
    }
    const now = fs.existsSync(part) ? fs.statSync(part).size : 0;
    console.log('    已下载 ' + mb(now) + (total ? ' / ' + mb(total) : '') + '　+' + mb(now - before));
    if (total && now >= total) { fs.renameSync(part, dest); console.log('  ✓ ' + label + ' 完成'); return dest; }
    if (!total && now > 0) { fs.renameSync(part, dest); console.log('  ✓ ' + label + ' 完成（大小未知）'); return dest; }
    if (now === before) { console.log('    没有进展，等待 5 秒重试…'); await new Promise(r => setTimeout(r, 5000)); }
  }
  throw new Error('下载失败：' + label + '（' + (fs.existsSync(part) ? mb(fs.statSync(part).size) : '0') + '）');
}

async function downloadResumable(url, dest, label) {
  const part = dest + '.part';
  const total = await remoteSize(url);
  console.log('  目标大小 ' + (total ? mb(total) : '未知'));

  for (let attempt = 1; attempt <= DOWNLOAD_TRIES; attempt++) {
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (total && have >= total) break;
    if (have && attempt > 1) console.log('  第 ' + attempt + ' 次尝试，从 ' + mb(have) + ' 继续…');

    const ctl = new AbortController();
    let stallTimer = null;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ctl.abort(new Error('停滞超时')), STALL_MS);
    };

    try {
      armStall();
      const r = await fetch(url, { headers: have ? { Range: 'bytes=' + have + '-' } : {}, signal: ctl.signal });
      if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status);
      if (have && r.status === 200) { have = 0; }   // 服务端不支持续传，从头来

      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let written = have;
      let lastLog = Date.now();
      const t0 = Date.now();
      for await (const chunk of r.body) {
        armStall();
        await new Promise((res) => out.write(chunk, res));
        written += chunk.length;
        if (Date.now() - lastLog > 4000) {
          const speed = (written - have) / ((Date.now() - t0) / 1000);
          process.stdout.write('\r    ' + mb(written) + (total ? ' / ' + mb(total) : '') +
            '　' + (total ? ((written / total) * 100).toFixed(1) + '%' : '') +
            '　' + mb(speed) + '/s   ');
          lastLog = Date.now();
        }
      }
      await new Promise((res) => out.end(res));
      if (stallTimer) clearTimeout(stallTimer);

      const size = fs.statSync(part).size;
      if (!total || size >= total) {
        fs.renameSync(part, dest);
        console.log('\r  ✓ ' + label + ' 下载完成 ' + mb(size) + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
        return dest;
      }
      console.log('\r  连接中断于 ' + mb(size) + '，准备续传…');
    } catch (e) {
      if (stallTimer) clearTimeout(stallTimer);
      console.log('\r  ! 第 ' + attempt + ' 次中断：' + (e.message || e) + '（已下 ' +
        (fs.existsSync(part) ? mb(fs.statSync(part).size) : '0 B') + '）');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!fs.existsSync(part)) throw new Error('下载失败：' + label);
  const size = fs.statSync(part).size;
  if (total && size < total) throw new Error('下载不完整：' + label + ' 只有 ' + mb(size) + ' / ' + mb(total));
  fs.renameSync(part, dest);
  return dest;
}

// ------------------------------------------------------------
// 上传（带重试）
// GitHub 会把资源名里的非 ASCII 字符清理掉（"建设世界…2.0.zip" → "2.0.zip"），
// 所以 Release 上用英文名；页面上显示的中文名来自数据库字段，不受影响。
// 上传过程中代理可能把响应弄丢（fetch failed），因此失败后先查资源是否已存在。
// ------------------------------------------------------------
async function listAssets(repo, releaseId) {
  const r = await fetch(API + '/repos/' + repo + '/releases/' + releaseId + '/assets?per_page=100', { headers: H });
  return r.ok ? (await r.json()) : [];
}

async function uploadAsset(repo, releaseId, name, file) {
  const buf = fs.readFileSync(file);
  const url = 'https://uploads.github.com/repos/' + repo + '/releases/' + releaseId +
    '/assets?name=' + encodeURIComponent(name);
  for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('上传超时')), UPLOAD_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) }, H),
        body: buf,
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (r.status === 422 && /already_exists/.test(await r.text().catch(() => ''))) {
        const hit = (await listAssets(repo, releaseId)).find(a => a.name === name && a.size === buf.length);
        if (hit) { console.log('  ✓ ' + name + '（服务端已存在，直接采用）'); return hit; }
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      console.log('  ✓ ' + name + ' ' + mb(buf.length) + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
      console.log('    → ' + j.browser_download_url);
      return j;
    } catch (e) {
      clearTimeout(timer);
      // 响应可能丢在路上，但资源其实已经建成 —— 先查一次
      const hit = (await listAssets(repo, releaseId)).find(a => a.name === name && a.size === buf.length);
      if (hit) {
        console.log('  ✓ ' + name + '（第 ' + attempt + ' 次尝试未收到响应，但服务端已存在 ' + mb(hit.size) + '，视为成功）');
        return hit;
      }
      console.log('  ! 第 ' + attempt + ' 次上传失败：' + (e.message || e) + '（已耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
      if (attempt < UPLOAD_TRIES) await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error('上传失败：' + name);
}

// ------------------------------------------------------------
// 从本地文件夹「认领」已经下好的文件（用户在浏览器里下好放过来）
// 匹配规则：文件名相同 → 直接采用；否则比对服务器上的大小，一致就用
// ------------------------------------------------------------
async function stageFromFolder(fromDir, items) {
  if (!fromDir) return 0;
  if (!fs.existsSync(fromDir)) { console.log('  ! 指定的文件夹不存在：' + fromDir); return 0; }
  const cands = fs.readdirSync(fromDir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.endsWith('.part'))
    .map(e => path.join(fromDir, e.name));
  if (!cands.length) { console.log('  ! 文件夹里没有文件：' + fromDir); return 0; }

  let staged = 0;
  for (const it of items) {
    const dest = path.join(CACHE, it.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;

    // 1) 同名
    let hit = cands.find(c => path.basename(c) === it.name);
    // 2) 浏览器下载下来的原始文件名（dl_xxxx.zip，出现在源站 URL 里）
    if (!hit) {
      let base = '';
      try { base = path.basename(new URL(it.remote).pathname); } catch (e) {}
      if (base) hit = cands.find(c => path.basename(c) === base);
    }
    // 3) 大小完全一致
    if (!hit) {
      const remote = await remoteSize(it.remote);
      hit = cands.find(c => remote && fs.statSync(c).size === remote);
    }
    if (hit) {
      fs.copyFileSync(hit, dest);
      console.log('  ✓ 采用本地文件 ' + path.basename(hit) + ' → ' + it.name +
        '（' + mb(fs.statSync(dest).size) + '）');
      staged++;
    } else {
      const remote = await remoteSize(it.remote);
      console.log('  · 文件夹里没找到 ' + it.name + '（应为 ' + (remote ? mb(remote) : '?') + '），将尝试下载');
    }
  }
  return staged;
}

// ------------------------------------------------------------
(async () => {
  const initSqlJs = require(path.join(ROOT, 'lib/sql-asm.js'));
  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(path.join(ROOT, 'db/backup.db'))));
  const rows = [];
  const st = db.prepare('SELECT * FROM downloads');
  while (st.step()) rows.push(st.getAsObject());
  st.free(); db.close();

  const items = rows
    .filter(r => /\/downloads\//.test(String(r.url || '')))
    .map(r => ({
      dbUrl: String(r.url),
      name: r.filename || String(r.url).split('/').pop(),
      size: r.size || '',
      remote: 'https://api.jssj.cc.cd' + (String(r.url).startsWith('/') ? '' : '/') + r.url,
    }));

  if (!items.length) { console.log('数据库里没有指向 /downloads/ 的下载项，无需发布'); return; }
  console.log('\n待发布文件：');
  items.forEach(i => console.log('  · ' + i.name + '（' + i.size + '）'));
  fs.mkdirSync(CACHE, { recursive: true });

  // ① 先用本地文件夹里的文件补齐（用户在浏览器下好的）
  const fromArg = process.argv.indexOf('--from');
  const fromDir = fromArg >= 0 ? process.argv[fromArg + 1] : (process.env.JSSJ_FILES_DIR || '');
  if (fromDir) {
    console.log('\n⓪ 从本地文件夹认领文件：' + fromDir);
    await stageFromFolder(fromDir, items);
  }

  console.log('\n① 准备文件（断点续传）');
  const useCurl = hasCurl();
  console.log('  下载方式：' + (useCurl ? 'curl（推荐）' : 'Node 内置 fetch 流'));
  for (const it of items) {
    const local = path.join(CACHE, it.name);
    if (fs.existsSync(local) && fs.statSync(local).size > 0) {
      console.log('  ✓ ' + it.name + '（本地已有 ' + mb(fs.statSync(local).size) + '，跳过）');
      continue;
    }
    if (useCurl) await downloadWithCurl(it.remote, local, it.name);
    else await downloadResumable(it.remote, local, it.name);
    const got = fs.statSync(local).size;
    console.log('  校验落盘大小：' + got + ' 字节');
    if (got === 0) throw new Error('下载文件为 0 字节：' + it.name);
  }

  console.log('\n② 确保 Release 存在');
  let release, r = await fetch(API + '/repos/' + cfg.repo + '/releases/tags/' + TAG, { headers: H });
  if (r.status === 200) {
    release = await r.json();
    console.log('  ✓ 已存在：' + release.name + '（id ' + release.id + '）');
  } else {
    r = await fetch(API + '/repos/' + cfg.repo + '/releases', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({
        tag_name: TAG,
        name: '离线版大文件（下载中心）',
        body: '建设世界官网离线静态版所用的下载文件。\n\n站点本身不含这些大文件，下载页的链接直接指向这里。',
      }),
    });
    if (!r.ok) throw new Error('创建 Release 失败 HTTP ' + r.status + '：' + (await r.text()).slice(0, 300));
    release = await r.json();
    console.log('  ✓ 已创建：' + release.name + '（id ' + release.id + '）');
  }

  // 目标资源名（必须是 ASCII，GitHub 会清掉中文）
  const assetNameOf = (it) => (cfg.assetNames && cfg.assetNames[it.dbUrl]) || it.name;

  console.log('\n③ 上传资源');
  const targets = new Set(items.map(assetNameOf));
  const downloadUrls = {};
  const localOf = (it) => path.join(CACHE, it.name);

  // 先处理名字不符的旧资源：能按大小对上号的直接改名复用（省一次上传），否则删掉
  for (const a of (release.assets || [])) {
    if (targets.has(a.name)) continue;
    const match = items.find(it => fs.existsSync(localOf(it)) && fs.statSync(localOf(it)).size === a.size);
    if (match) {
      const want = assetNameOf(match);
      const pr = await fetch(API + '/repos/' + cfg.repo + '/releases/assets/' + a.id, {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, H),
        body: JSON.stringify({ name: want }),
      });
      const pj = await pr.json();
      if (pj && pj.name === want) {
        console.log('  · 旧资源 ' + a.name + ' 已改名为 ' + want + '（复用，不用重传）');
        downloadUrls[match.dbUrl] = pj.browser_download_url;
        continue;
      }
      console.log('  · 旧资源 ' + a.name + ' 改名失败（返回 ' + (pj && pj.name) + '），将删除后重传');
    }
    const d = await fetch(API + '/repos/' + cfg.repo + '/releases/assets/' + a.id, { method: 'DELETE', headers: H });
    console.log('  · 删除无用资源 ' + a.name + '（HTTP ' + d.status + '）');
  }

  for (const it of items) {
    const name = assetNameOf(it);
    const local = localOf(it);
    const already = (await listAssets(cfg.repo, release.id)).find(a => a.name === name && a.size === fs.statSync(local).size);
    let asset = already;
    if (already) {
      console.log('  ✓ ' + name + '（Release 里已有同大小资源，跳过上传）');
    } else {
      asset = await uploadAsset(cfg.repo, release.id, name, local);
    }
    if (asset && asset.browser_download_url) downloadUrls[it.dbUrl] = asset.browser_download_url;
  }

  const base = 'https://github.com/' + cfg.repo + '/releases/download/' + TAG + '/';
  fs.writeFileSync(cfgPath, JSON.stringify(Object.assign({}, cfg, {
    tag: TAG, releaseBase: base, downloadUrls,
  }), null, 2));
  console.log('\n④ release-config.json 已更新（含真实资源地址）');
  for (const [k, v] of Object.entries(downloadUrls)) console.log('   ' + k + '\n     → ' + v);
  console.log('\n   重新构建页面…');
  execFileSync(process.execPath, [path.join(BUILD, 'build-site.js')], { stdio: 'inherit' });
  console.log('\n完成。提交推送：');
  console.log('  cd "' + ROOT + '" && git add -A && git commit -m "下载项指向 Release" && git push');
})().catch(e => { console.error('\n发布失败：' + (e && e.stack || e)); process.exit(1); });
