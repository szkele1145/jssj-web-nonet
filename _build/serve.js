/* 本地静态服务器（仅用于离线版自测，不参与部署） */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve('C:/Users/一只屑/Desktop/建设世界/离线版');
const PORT = Number(process.argv[2] || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.db': 'application/octet-stream', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const LOG = path.join(ROOT, '_build/access.log');
fs.writeFileSync(LOG, '');

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + path.posix.normalize(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    fs.appendFileSync(LOG, '404 ' + p + '\n');
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 ' + p);
  }
  const size = fs.statSync(file).size;
  fs.appendFileSync(LOG, '200 ' + p + ' ' + size + '\n');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('离线版自测服务器 http://127.0.0.1:' + PORT + '（访问日志 _build/access.log）'));
