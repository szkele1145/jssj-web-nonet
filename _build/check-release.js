/* ============================================================
 * 校验下载链接：确认 download-map 里每个 Release 地址都能下到真文件
 * 用法：node 离线版/_build/check-release.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const mapSrc = fs.readFileSync(path.join(ROOT, 'offline/download-map.js'), 'utf8');
const map = JSON.parse(mapSrc.slice(mapSrc.indexOf('{'), mapSrc.lastIndexOf('}') + 1));

const entries = Object.entries(map);
if (!entries.length) { console.log('download-map 为空：下载链接还指向线上服务器'); process.exit(0); }

(async () => {
  let fail = 0;
  console.log('=== 下载链接校验（' + entries.length + ' 个）===');
  for (const [dbUrl, releaseUrl] of entries) {
    const name = decodeURIComponent(releaseUrl.split('/').pop());
    try {
      const r = await fetch(releaseUrl, { method: 'GET', headers: { Range: 'bytes=0-511' } });
      const buf = Buffer.from(await r.arrayBuffer());
      const len = r.headers.get('content-length');
      const total = r.status === 206 ? (r.headers.get('content-range') || '').split('/')[1] : len;
      if (r.status !== 200 && r.status !== 206) {
        fail++;
        console.log('[FAIL] HTTP ' + r.status + '  ' + name);
        console.log('       ' + releaseUrl);
      } else {
        console.log('[PASS] ' + name + '　HTTP ' + r.status +
          '　总大小 ' + (total ? (total / 1048576).toFixed(1) + ' MB' : '未知') +
          '　首字节 ' + buf.subarray(0, 2).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
        console.log('       数据库里: ' + dbUrl);
        console.log('       实际链接: ' + releaseUrl);
      }
    } catch (e) {
      fail++;
      console.log('[FAIL] 请求异常 ' + name + ' :: ' + e.message);
    }
  }
  console.log('\n' + (fail ? '有 ' + fail + ' 个链接不可用' : '全部链接可用 ✅'));
  process.exit(fail ? 1 : 0);
})();
