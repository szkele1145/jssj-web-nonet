/* ============================================================
 * 一键更新：拿最新的 backup.db 重新生成整个离线站点
 * ------------------------------------------------------------
 * 用法：
 *   node 离线版/_build/update.js                  # 用桌面 backup.db
 *   node 离线版/_build/update.js D:\别的库.db      # 指定数据库
 *
 * 做四件事：换库 → 导出数据清单 → 下载新出现的外链图片 → 重新构建页面
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/一只屑/Desktop/建设世界/离线版';
const BUILD = path.join(ROOT, '_build');
const src = process.argv[2] || 'C:/Users/一只屑/Desktop/backup.db';

if (!fs.existsSync(src)) {
  console.error('找不到数据库文件：' + src);
  process.exit(1);
}

const before = fs.statSync(path.join(ROOT, 'db/backup.db')).size;
const buf = fs.readFileSync(src);
fs.writeFileSync(path.join(ROOT, 'db/backup.db'), buf);
console.log('① 已更新数据库：' + src + ' → db/backup.db（' + before + ' → ' + buf.length + ' 字节）');
console.log('   数据库指纹：' + require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 12));

const run = (file) => {
  console.log('\n② 运行 ' + path.basename(file));
  const out = execFileSync(process.execPath, [path.join(BUILD, file)], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  process.stdout.write(out.split('\n').map(l => '   ' + l).join('\n'));
};

run('dump.js');
run('fetch-assets.js');
execFileSync(process.execPath, [path.join(BUILD, 'build-site.js')], { stdio: 'inherit' });

console.log('\n完成。接下来：');
console.log('  本地看效果：node 离线版/_build/serve.js 8123 → http://127.0.0.1:8123/');
console.log('  自检：node 离线版/_build/test-core.js && node 离线版/_build/verify-pages.js');
console.log('  发布：在 离线版 目录里 git add -A && git commit -m "更新数据" && git push');
