// 下载数据中引用的外链图片到 离线版/assets/，生成 asset-map.json，并探测下载中心 zip 体积
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const ASSETS = path.join(ROOT, 'assets');
const LIB = path.join(ROOT, 'lib');
for (const d of [ASSETS, LIB, path.join(ROOT, 'db'), path.join(ROOT, 'offline')]) fs.mkdirSync(d, { recursive: true });

const dump = JSON.parse(fs.readFileSync(path.join(ROOT, '_build/dump.json'), 'utf8'));

const urls = new Set();
const walk = (v) => {
  if (v == null) return;
  if (typeof v === 'string') { const m = v.match(/https?:\/\/[^\s"'<>()\\]+/g); if (m) m.forEach(u => urls.add(u)); return; }
  if (Array.isArray(v)) return v.forEach(walk);
  if (typeof v === 'object') return Object.values(v).forEach(walk);
};
walk(dump);

const isImage = (u) => /\.(png|jpe?g|gif|webp|bmp|ico)(\?|$)/i.test(u) || u.includes('/uploads/');
const imgUrls = [...urls].filter(u => isImage(u) && !u.includes('/downloads/'));
const zipUrls = [...urls].filter(u => u.includes('/downloads/'));

console.log('图片外链 ' + imgUrls.length + ' 个，下载文件外链 ' + zipUrls.length + ' 个');

const extOf = (u, ct) => {
  const m = new URL(u).pathname.match(/\.([A-Za-z0-9]+)$/);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (ct && ct.includes('png')) return 'png';
  if (ct && ct.includes('webp')) return 'webp';
  if (ct && ct.includes('gif')) return 'gif';
  return 'jpg';
};
const nameOf = (u, i, ext) => {
  const base = new URL(u).pathname.split('/').pop().replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(-40);
  return String(i + 1).padStart(2, '0') + '_' + base + '.' + ext;
};

(async () => {
  const map = {};
  let total = 0;
  for (let i = 0; i < imgUrls.length; i++) {
    const u = imgUrls[i];
    try {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 30000);
      const r = await fetch(u, { signal: c.signal }); clearTimeout(tm);
      if (!r.ok) { console.log('  FAIL ' + r.status + ' ' + u); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = extOf(u, r.headers.get('content-type'));
      const name = nameOf(u, i, ext);
      fs.writeFileSync(path.join(ASSETS, name), buf);
      map[u] = 'assets/' + name;
      total += buf.length;
      console.log('  OK ' + String(buf.length).padStart(8) + '  ' + name + '  <- ' + u);
    } catch (e) { console.log('  FAIL ' + u + ' :: ' + e.message); }
  }
  fs.writeFileSync(path.join(ROOT, 'offline/asset-map.json'), JSON.stringify(map, null, 1));
  console.log('图片合计 ' + (total / 1024 / 1024).toFixed(2) + ' MB，映射 ' + Object.keys(map).length + ' 条');

  console.log('=== 下载中心文件体积 ===');
  for (const u of zipUrls) {
    try {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 30000);
      const r = await fetch(u, { method: 'HEAD', signal: c.signal }); clearTimeout(tm);
      console.log('  ' + r.status + ' len=' + r.headers.get('content-length') + ' ' + u);
    } catch (e) { console.log('  FAIL ' + u + ' :: ' + e.message); }
  }

  console.log('=== 下载 sql.js (asm 版，无需 wasm 文件，file:// 也能跑) ===');
  for (const [u, dest] of [
    ['https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-asm.js', path.join(LIB, 'sql-asm.js')],
    ['https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-asm-memory-growth.js', path.join(LIB, 'sql-asm-memory-growth.js')],
  ]) {
    try {
      const r = await fetch(u);
      const txt = await r.text();
      fs.writeFileSync(dest, txt);
      console.log('  OK ' + txt.length + ' -> ' + dest);
    } catch (e) { console.log('  FAIL ' + u + ' :: ' + e.message); }
  }

  console.log('=== 复制 backup.db ===');
  fs.copyFileSync('C:/Users/一只屑/Desktop/backup.db', path.join(ROOT, 'db/backup.db'));
  console.log('  backup.db -> db/backup.db (' + fs.statSync(path.join(ROOT, 'db/backup.db')).size + ' bytes)');
})();
