// 导出 backup.db 全部表为 JSON（供构建与校验用）
const fs = require('fs');
const Database = require('C:/Users/一只屑/Desktop/建设世界/云服务器/node_modules/better-sqlite3');

const SRC = 'C:/Users/一只屑/Desktop/backup.db';
const OUT = 'C:/Users/一只屑/Desktop/建设世界/离线版/_build/dump.json';

const db = new Database(SRC, { readonly: true });
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all()
  .map(r => r.name).filter(n => n !== 'sqlite_sequence');

const out = {};
for (const t of tables) out[t] = db.prepare('select * from "' + t + '"').all();
db.close();

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('wrote ' + OUT);
for (const t of tables) console.log('  ' + t + ': ' + out[t].length);
console.log('--- sample ---');
console.log('posts[0] title=' + (out.posts[0] && out.posts[0].title) + ' images=' + (out.posts[0] && out.posts[0].images));
console.log('posts images all: ' + JSON.stringify(out.posts.map(p => p.images)));
console.log('stories images all: ' + JSON.stringify(out.stories.map(p => p.images)));
console.log('stories content null?: ' + JSON.stringify(out.stories.map(p => p.content === null)));
console.log('downloads url: ' + JSON.stringify(out.downloads.map(p => p.url)));
console.log('votes: ' + JSON.stringify(out.votes));
console.log('visits day range: ' + out.visits[0].day + ' .. ' + out.visits[out.visits.length - 1].day);
console.log('oplog sample: ' + JSON.stringify(out.oplog.slice(0, 3)));
