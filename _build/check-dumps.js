/* 对已抓取的 DOM 做负向检查 + 打印关键渲染值（配合 verify-pages.js 使用） */
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/一只屑/Desktop/建设世界/离线版/_build/dumps';

const read = (f) => {
  const p = path.join(DIR, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

const negatives = [
  ['server.dom.html', '已关闭', '服务器页不应显示「已关闭」'],
  ['index.dom.html', 'img\\.xwyue\\.com', '首页不应残留外链图床'],
  ['donate.dom.html', 'img\\.xwyue\\.com', '捐赠页外链已本地化'],
  ['forum.dom.html', 'api\\.jssj\\.cc\\.cd/uploads', '动态图片不应指向线上 API'],
  ['legends.dom.html', 'img\\.xwyue\\.com', '神人榜外链已本地化'],
  ['download.dom.html', 'api\\.jssj\\.cc\\.cd/downloads', '下载项不应指向线上文件'],
  ['votes.dom.html', 'img\\.xwyue\\.com', '投票页外链已本地化'],
];

let pass = 0, fail = 0;
console.log('=== 负向检查（DOM 中不应出现的东西）===');
for (const [f, re, desc] of negatives) {
  const bad = new RegExp(re).test(read(f));
  if (bad) { fail++; console.log('[FAIL] ' + desc); }
  else { pass++; console.log('[PASS] ' + desc); }
}

console.log('\n=== 关键渲染值 ===');
const idx = read('index.dom.html');
const pick = (html, re) => { const m = html.match(re); return m ? m[1] : '(未匹配)'; };
console.log('首页运行天数   = ' + pick(idx, /uptimeDays">([^<]*)</));
console.log('首页访问量     = ' + pick(idx, /sitePv">([^<]*)</));
console.log('离线浮标文案   = ' + pick(idx, /id="jssjOfflinePill">([\s\S]{0,80}?)<\/div>/).replace(/\s+/g, ' '));

const dl = read('download.dom.html');
const links = [...dl.matchAll(/href="(https:\/\/github\.com[^"]+)"/g)].map(m => m[1]);
console.log('下载链接（应指向 Release）:');
links.forEach(l => console.log('  ' + decodeURIComponent(l)));

const srv = read('server.dom.html');
console.log('\n服务器页卡片文本:');
const card = srv.match(/<div class="mc-card">[\s\S]{0,600}?<\/div>\s*<\/div>/);
console.log('  ' + (card ? card[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260) : '(未匹配)'));

const forum = read('forum.dom.html');
const imgs = [...forum.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
console.log('\n动态页图片 src: ' + JSON.stringify(imgs));

const votes = read('votes.dom.html');
console.log('投票页票数片段: ' + (votes.match(/同意 \d+[\s\S]{0,80}?反对 \d+/) || ['(未匹配)'])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

console.log('\n负向 通过 ' + pass + ' · 失败 ' + fail);
