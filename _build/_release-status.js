/* 查看 Release 现有资源 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const GIT = 'C:/Program Files/Git/bin/git.exe';
const MAIN_REPO = 'C:/Users/一只屑/Desktop/建设世界';

let TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
if (!TOKEN) {
  const url = execFileSync(GIT, ['-C', MAIN_REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = url.match(/https:\/\/([^@\/]+)@github\.com/);
  if (m) { const p = m[1].split(':'); TOKEN = p.length > 1 ? p[1] : p[0]; }
}
const H = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'jssj', 'X-GitHub-Api-Version': '2022-11-28' };

(async () => {
  const r = await fetch('https://api.github.com/repos/szkele1145/jssj-web-nonet/releases', { headers: H });
  const list = await r.json();
  if (!Array.isArray(list)) { console.log('返回异常：' + JSON.stringify(list).slice(0, 300)); return; }
  for (const rel of list) {
    console.log('Release: ' + rel.name + '　tag=' + rel.tag_name + '　id=' + rel.id);
    for (const a of (rel.assets || [])) {
      console.log('   · ' + a.name + '　' + (a.size / 1048576).toFixed(1) + ' MB　state=' + a.state +
        '　下载数=' + a.download_count);
      console.log('     ' + a.browser_download_url);
    }
  }
})().catch(e => console.error(e.message));
