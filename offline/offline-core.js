/* ============================================================
 * 建设世界 · 离线版 API 核心
 * ------------------------------------------------------------
 * 用 sql.js（纯 JS 的 SQLite）在本地打开随站点分发的 backup.db，
 * 并按 云服务器/server.js 的**完全相同**的响应格式，在纯前端复刻
 * 全部 /api/* 路由。配合 offline.js 的 fetch 拦截，页面代码无需改动。
 *
 * 环境无关：浏览器 <script> 或 Node require 都能加载，便于自动化测试。
 * ============================================================ */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.JSSJOfflineCore = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ----------------------------------------------------------
  // 配置默认值（与 云服务器/ecosystem.config.js 保持一致）
  // ----------------------------------------------------------
  var DEFAULT_CONFIG = {
    serverStartDate: '2024-06-28',
    adminKey: 'kelejssjapi',
    mcHost: 'yd1.yizexiaomu.com',
    mcPort: 25081,
    queryPort: 25082,
    mcSrv: 'jssj.cc.cd',
    imgAllowHosts: ['img.remit.ee', 'img.xwyue.com', 'jssj.cc.cd', 'www.jssj.cc.cd', 'api.jssj.cc.cd'],
    clientIP: 'offline-local',      // 离线版没有真实 IP，投票防刷按本浏览器记名
    dbName: 'backup.db',
    dbSize: 0,
    builtAt: '',
  };

  // ----------------------------------------------------------
  // 工具
  // ----------------------------------------------------------
  function toU8(v) {
    if (v instanceof Uint8Array) return v;
    if (v && v.buffer) return new Uint8Array(v.buffer, v.byteOffset || 0, v.length);
    if (typeof v === 'string') return base64ToBytes(v);
    return new Uint8Array(v || []);
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(bytes).toString('base64');
    var s = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined' && Buffer.from) return new Uint8Array(Buffer.from(String(b64), 'base64'));
    var bin = atob(String(b64)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function parseJSON(s, fb) { try { return JSON.parse(s); } catch (e) { return fb; } }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localStamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 与 server.js 相同的魔数校验（离线版上传图片时用）
  function looksLikeImage(buf, ext) {
    function latin(a, b) { var s = ''; for (var i = a; i < b && i < buf.length; i++) s += String.fromCharCode(buf[i]); return s; }
    return (ext === 'png' && buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
      ((ext === 'jpg' || ext === 'jpeg') && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
      (ext === 'gif' && buf.length >= 6 && latin(0, 6) === 'GIF89a') ||
      (ext === 'webp' && buf.length >= 12 && latin(0, 4) === 'RIFF' && latin(8, 12) === 'WEBP') ||
      (ext === 'bmp' && buf.length >= 2 && latin(0, 2) === 'BM') ||
      (ext === 'ico' && buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0);
  }

  var ALLOWED_UPLOAD_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'];

  // ----------------------------------------------------------
  // 建表语句（与 server.js 一致；用于兼容较旧的 backup.db）
  // ----------------------------------------------------------
  var SCHEMA = [
    "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, excerpt TEXT DEFAULT '', content TEXT DEFAULT '', images TEXT DEFAULT '[]', pinned INTEGER DEFAULT 0, date TEXT)",
    "CREATE TABLE IF NOT EXISTS votes (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', deadline TEXT, type TEXT DEFAULT 'agree', options TEXT DEFAULT '[]', counts TEXT DEFAULT '{}', yesCount INTEGER DEFAULT 0, noCount INTEGER DEFAULT 0, voters TEXT DEFAULT '{}', active INTEGER DEFAULT 1, date TEXT)",
    "CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, text TEXT DEFAULT '', images TEXT DEFAULT '[]', content TEXT, date TEXT)",
    "CREATE TABLE IF NOT EXISTS bans (id TEXT PRIMARY KEY, player TEXT NOT NULL, reason TEXT DEFAULT '', date TEXT)",
    "CREATE TABLE IF NOT EXISTS donors (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT)",
    "CREATE TABLE IF NOT EXISTS downloads (id TEXT PRIMARY KEY, name TEXT NOT NULL, desc TEXT DEFAULT '', url TEXT NOT NULL, size TEXT DEFAULT '', filename TEXT DEFAULT '', date TEXT)",
    "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, vid TEXT DEFAULT '', page TEXT DEFAULT '', t TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day)",
    "CREATE TABLE IF NOT EXISTS oplog (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '')"
  ];

  // ----------------------------------------------------------
  // 核心
  // ----------------------------------------------------------
  function createOfflineApi(opts) {
    opts = opts || {};
    var SQL = opts.SQL;
    if (!SQL || !SQL.Database) throw new Error('createOfflineApi: 缺少 sql.js (SQL) 实例');

    var config = Object.assign({}, DEFAULT_CONFIG, opts.config || {});
    var assetMap = opts.assetMap || {};
    var downloadMap = opts.downloadMap || {};   // 下载项 → GitHub Release 资源地址
    var storage = opts.storage || null;
    var DB_KEY = opts.dbKey || 'jssj_offline_db';
    var IMG_KEY = opts.imgKey || 'jssj_offline_images';

    var originalBytes = toU8(opts.dbBytes);
    config.dbSize = originalBytes.length;
    if (!config.builtAt) config.builtAt = localStamp(new Date());

    var mapKeys = Object.keys(assetMap).sort(function (a, b) { return b.length - a.length; });
    var db = null;
    var source = 'file';          // file=原始 backup.db / saved=浏览器本地保存过的版本
    var storageError = null;
    var images = {};              // 离线图床：name -> { data, size, mtime }

    function openDb(bytes, src) {
      var inst = new SQL.Database(bytes);
      try { inst.exec(SCHEMA.join(';\n') + ';'); } catch (e) { /* 老库结构差异忽略 */ }
      try { inst.exec("ALTER TABLE posts ADD COLUMN images TEXT DEFAULT '[]'"); } catch (e) {}
      try { inst.exec("ALTER TABLE downloads ADD COLUMN filename TEXT DEFAULT ''"); } catch (e) {}
      db = inst;
      source = src;
      return inst;
    }

    // 优先使用浏览器里保存过的版本（用户改过数据）
    (function boot() {
      var saved = null;
      try { saved = storage && storage.getItem(DB_KEY); } catch (e) { saved = null; }
      if (saved) {
        try { openDb(base64ToBytes(saved), 'saved'); return; } catch (e) { storageError = '本地保存的数据库损坏，已回退到原始 backup.db'; }
      }
      openDb(originalBytes, 'file');
      try { images = parseJSON(storage && storage.getItem(IMG_KEY), {}) || {}; } catch (e) { images = {}; }
    })();

    // ---------------- 基础查询封装 ----------------
    function q(sql, params) {
      var st = db.prepare(sql), rows = [];
      try {
        if (params) st.bind(params);
        while (st.step()) rows.push(st.getAsObject());
      } finally { st.free(); }
      return rows;
    }

    var suspendPersist = 0;

    function exec(sql, params) {
      db.run(sql, params || []);
      if (!suspendPersist) persist();
    }

    // 批量写（如导入）：内部不落盘，结束后统一保存一次
    function batch(fn) {
      suspendPersist++;
      try { return fn(); } finally { suspendPersist--; persist(); }
    }

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(DB_KEY, bytesToBase64(db.export()));
      } catch (e) {
        storageError = '浏览器本地存储写入失败（可能超限）：' + (e && e.message ? e.message : e);
      }
    }

    function saveImages() {
      if (!storage) return;
      try { storage.setItem(IMG_KEY, JSON.stringify(images)); } catch (e) {
        storageError = '图床数据过大，未能保存到浏览器本地：' + (e && e.message ? e.message : e);
      }
    }

    function logAction(action, detail) {
      try {
        exec('INSERT INTO oplog (t, action, detail) VALUES (?,?,?)',
          [new Date().toISOString(), String(action).slice(0, 50), String(detail == null ? '' : detail).slice(0, 200)]);
      } catch (e) {}
    }

    // ---------------- 外链图片 → 本地资源 ----------------
    function loc(v) {
      if (typeof v !== 'string' || !v || !mapKeys.length) return v;
      var out = v;
      for (var i = 0; i < mapKeys.length; i++) {
        if (out.indexOf(mapKeys[i]) !== -1) out = out.split(mapKeys[i]).join(assetMap[mapKeys[i]]);
      }
      return out;
    }
    function locList(arr) {
      return Array.isArray(arr) ? arr.map(loc) : arr;
    }

    // 下载项的 URL：优先用 Release 地址（无后端站点上的大文件）
    function dlUrl(u) {
      if (typeof u !== 'string') return u;
      if (downloadMap[u]) return downloadMap[u];
      return loc(u);
    }

    // ---------------- 响应封装 ----------------
    function jsonRes(status, data, headers) {
      var h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {});
      return { status: status, headers: h, text: JSON.stringify(data) };
    }
    function ok(data) { return jsonRes(200, data); }
    function fail(status, error) { return jsonRes(status, { success: false, error: error }); }
    function unauth() { return fail(401, 'Unauthorized'); }

    function parseBody(raw) {
      if (raw == null || raw === '') return {};
      if (typeof raw === 'object') return raw;
      return parseJSON(raw, {});
    }

    // ---------------- 业务：读取 ----------------
    function postsList() {
      var rows = q('SELECT * FROM posts');
      var posts = rows.map(function (r) {
        return {
          id: r.id, title: r.title, author: r.author,
          excerpt: loc(r.excerpt), content: loc(r.content),
          images: locList(parseJSON(r.images, [])),
          pinned: !!r.pinned, date: r.date,
        };
      });
      posts.sort(function (a, b) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.date) - new Date(a.date);
      });
      return posts;
    }

    function votesList() {
      var ip = config.clientIP;
      var rows = q('SELECT * FROM votes');
      var votes = rows.map(function (r) {
        var voters = parseJSON(r.voters, {});
        return {
          id: r.id, title: r.title, description: loc(r.description),
          deadline: r.deadline, type: r.type,
          options: parseJSON(r.options, []), counts: parseJSON(r.counts, {}),
          yesCount: r.yesCount, noCount: r.noCount,
          voters: voters, active: !!r.active, date: r.date,
          hasVoted: !!voters[ip], myVote: voters[ip] || null,
        };
      });
      votes.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
      return votes;
    }

    function storiesList() {
      var rows = q('SELECT * FROM stories');
      var stories = rows.map(function (r) {
        var s = {
          id: r.id, title: r.title, text: loc(r.text),
          images: locList(parseJSON(r.images, [])), date: r.date,
        };
        if (r.content !== null && r.content !== undefined) {
          // 与 server.js 一致：把写死的绝对 API 地址改回相对路径，再做本地资源替换
          s.content = loc(String(r.content)
            .replace(/https:\/\/api\.jssj\.cc\.cd\/api\/img/g, '/api/img')
            .replace(/https:\/\/api\.jssj\.cc\.cd/g, ''));
          return s;
        }
        var html = String(r.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        var imgs = locList(parseJSON(r.images, []));
        if (imgs.length > 0) {
          html += '<div class="story-gallery">' + imgs.map(function (url) {
            var src = url.indexOf('img.remit.ee') !== -1 ? '/api/img?url=' + encodeURIComponent(url) : String(url).replace(/'/g, '');
            return "<img src='" + src + "'>";
          }).join('') + '</div>';
        }
        return Object.assign(s, { content: html });
      });
      stories.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      return stories;
    }

    function mapVote(r) {
      return {
        id: r.id, title: r.title, description: r.description, deadline: r.deadline, type: r.type,
        options: parseJSON(r.options, []), counts: parseJSON(r.counts, {}),
        yesCount: r.yesCount, noCount: r.noCount, voters: parseJSON(r.voters, {}),
        active: !!r.active, date: r.date,
      };
    }

    function statsData() {
      var since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      var since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      return {
        total: q('SELECT COUNT(*) as pv, COUNT(DISTINCT vid) as uv FROM visits')[0],
        daily: q('SELECT day, COUNT(*) as pv, COUNT(DISTINCT vid) as uv FROM visits WHERE day >= ? GROUP BY day ORDER BY day DESC LIMIT 30', [since30]),
        pages: q('SELECT page, COUNT(*) as cnt FROM visits WHERE day >= ? GROUP BY page ORDER BY cnt DESC LIMIT 20', [since7]),
      };
    }

    function searchData(rawQ, fuzzy) {
      var text = String(rawQ || '').trim();
      if (text.length < 1) return { posts: [], stories: [], bans: [], votes: [], downloads: [] };
      var like = '%' + text + '%';
      var likeFuzzy = '%' + text.replace(/\s+/g, '').split('').join('%') + '%';
      var p = fuzzy ? likeFuzzy : like;
      return {
        posts: q('SELECT id, title, author, excerpt, date, images FROM posts WHERE title LIKE ? OR excerpt LIKE ? OR content LIKE ? ORDER BY date DESC LIMIT 20', [p, p, p])
          .map(function (r) { return { id: r.id, title: r.title, author: r.author, excerpt: loc(r.excerpt), date: r.date, images: locList(parseJSON(r.images, [])) }; }),
        stories: q('SELECT id, title, text, images, date FROM stories WHERE title LIKE ? OR text LIKE ? ORDER BY date DESC LIMIT 20', [p, p])
          .map(function (r) { return { id: r.id, title: r.title, text: loc(r.text), images: locList(parseJSON(r.images, [])), date: r.date }; }),
        bans: q('SELECT id, player, reason, date FROM bans WHERE player LIKE ? OR reason LIKE ? ORDER BY date DESC LIMIT 10', [p, p]),
        votes: q('SELECT id, title, description, type, yesCount, noCount, date FROM votes WHERE title LIKE ? OR description LIKE ? ORDER BY date DESC LIMIT 20', [p, p])
          .map(function (r) { return { id: r.id, title: r.title, description: loc(r.description), type: r.type, yesCount: r.yesCount, noCount: r.noCount, date: r.date }; }),
        downloads: q('SELECT id, name, desc, url, size, date FROM downloads WHERE name LIKE ? OR desc LIKE ? OR url LIKE ? ORDER BY date DESC LIMIT 20', [p, p, p])
          .map(function (r) { return { id: r.id, name: r.name, desc: loc(r.desc), url: dlUrl(r.url), size: r.size, date: r.date }; }),
      };
    }

    function exportData() {
      return {
        exportedAt: new Date().toISOString(),
        offline: true,
        posts: q('SELECT * FROM posts ORDER BY date').map(function (r) {
          return { id: r.id, title: r.title, author: r.author, excerpt: r.excerpt, content: r.content, images: parseJSON(r.images, []), pinned: !!r.pinned, date: r.date };
        }),
        votes: q('SELECT * FROM votes ORDER BY date').map(mapVote),
        stories: q('SELECT * FROM stories ORDER BY date').map(function (r) {
          return { id: r.id, title: r.title, text: r.text, images: parseJSON(r.images, []), content: r.content, date: r.date };
        }),
        bans: q('SELECT * FROM bans ORDER BY date DESC, rowid DESC').map(function (r) { return { id: r.id, player: r.player, reason: r.reason, date: r.date }; }),
        donors: q('SELECT * FROM donors ORDER BY rowid').map(function (r) { return { id: r.id, name: r.name, date: r.date }; }),
        downloads: q('SELECT * FROM downloads ORDER BY date DESC, rowid DESC').map(function (r) {
          return { id: r.id, name: r.name, desc: r.desc, url: dlUrl(r.url), size: r.size, filename: r.filename, date: r.date };
        }),
      };
    }

    // ---------------- 路由 ----------------
    function handle(method, rawUrl, req) {
      req = req || {};
      var M = String(method || 'GET').toUpperCase();
      var u;
      try { u = new URL(String(rawUrl), 'http://offline.local'); } catch (e) { return fail(400, 'bad url'); }
      var path = u.pathname.replace(/\/+$/, '') || '/';
      var query = u.searchParams;
      var admin = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '') === ('Bearer ' + config.adminKey);
      var body = parseBody(req.body);

      // ===== 基础 =====
      if (M === 'GET' && path === '/api/health') return ok({ success: true, offline: true });

      if (M === 'POST' && path === '/api/auth') {
        if (body.password === config.adminKey) return ok({ success: true, message: '验证通过（离线版）' });
        return fail(401, '密码错误');
      }

      if (M === 'GET' && path === '/api/uptime') {
        var start = new Date(config.serverStartDate);
        var days = Math.ceil(Math.abs(new Date() - start) / 86400000);
        return ok({ success: true, days: days, startDate: config.serverStartDate, offline: true });
      }

      if (M === 'GET' && path === '/api/mc-status') {
        var note = '离线静态版：不查询实时状态';
        return ok({
          success: true, online: false,
          players: { online: 0, max: 0, java: [], bedrock: [], bots: 0 },
          motd: { html: [note], clean: [note] },
          queryActive: false, proto: 'offline', offline: true,
          server: { srv: config.mcSrv, host: config.mcHost, port: config.mcPort, queryPort: config.queryPort },
        });
      }

      // 离线版不做埋点：保留原库里的历史 PV，避免每次刷新都改数据
      if (M === 'POST' && path === '/api/track') return { status: 204, headers: {}, text: null };

      // ===== 动态 =====
      if (path === '/api/posts') {
        if (M === 'GET') return ok({ success: true, posts: postsList() });
        if (M === 'POST') {
          if (!admin) return unauth();
          var title = body.title, author = body.author;
          if (!title || !author) return fail(400, '标题和发布人为必填项');
          var imgList = (Array.isArray(body.images) ? body.images : [])
            .filter(function (x) { return x && (x.indexOf('http') === 0 || x.indexOf('data:image/') === 0); }).slice(0, 30);
          var newPost = {
            id: Date.now().toString(), title: title, author: author,
            excerpt: body.excerpt || body.content || '',
            content: body.content || body.excerpt || '',
            images: imgList, pinned: body.pinned || false,
            date: new Date().toISOString().split('T')[0],
          };
          exec('INSERT INTO posts (id, title, author, excerpt, content, images, pinned, date) VALUES (?,?,?,?,?,?,?,?)',
            [newPost.id, newPost.title, newPost.author, newPost.excerpt, newPost.content, JSON.stringify(newPost.images), newPost.pinned ? 1 : 0, newPost.date]);
          logAction('post_create', newPost.title);
          return ok({ success: true, message: '帖子发布成功（离线版已保存到本浏览器）', post: newPost });
        }
      }
      var mPost = path.match(/^\/api\/posts\/(.+)$/);
      if (mPost && M === 'DELETE') {
        if (!admin) return unauth();
        var pid = decodeURIComponent(mPost[1]);
        if (!q('SELECT id FROM posts WHERE id = ?', [pid]).length) return fail(404, '帖子不存在');
        exec('DELETE FROM posts WHERE id = ?', [pid]);
        logAction('post_delete', pid);
        return ok({ success: true, message: '帖子已删除' });
      }

      // ===== 投票 =====
      if (path === '/api/votes') {
        if (M === 'GET') return ok({ success: true, votes: votesList() });
        if (M === 'POST') {
          if (!admin) return unauth();
          if (!body.title) return fail(400, '标题为必填项');
          var voteType = body.type || 'agree';
          var opts = body.options;
          if (voteType === 'choice' && (!opts || opts.length < 2)) return fail(400, '选择类型至少需要2个选项');
          var newVote = {
            id: Date.now().toString(), title: body.title, description: body.description || '',
            deadline: body.deadline || null, type: voteType,
            options: voteType === 'choice' ? opts : [],
            counts: voteType === 'choice' ? Object.fromEntries(opts.map(function (o) { return [o, 0]; })) : {},
            yesCount: voteType === 'agree' ? 0 : null,
            noCount: voteType === 'agree' ? 0 : null,
            voters: {}, active: true, date: new Date().toISOString(),
          };
          exec('INSERT INTO votes (id, title, description, deadline, type, options, counts, yesCount, noCount, voters, active, date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            [newVote.id, newVote.title, newVote.description, newVote.deadline, newVote.type, JSON.stringify(newVote.options),
              JSON.stringify(newVote.counts), newVote.yesCount, newVote.noCount, JSON.stringify(newVote.voters), 1, newVote.date]);
          logAction('vote_create', newVote.title);
          return ok({ success: true, message: '投票创建成功（离线版已保存到本浏览器）', vote: newVote });
        }
      }

      var mVoteCast = path.match(/^\/api\/votes\/([^/]+)\/vote$/);
      if (mVoteCast && M === 'POST') {
        var vid = decodeURIComponent(mVoteCast[1]);
        var option = body.option;
        if (!option) return fail(400, '选项无效');
        var row = q('SELECT * FROM votes WHERE id = ?', [vid])[0];
        if (!row) return fail(404, '投票不存在');
        if (!row.active) return fail(400, '投票已关闭');
        if (row.deadline && row.deadline < todayLocal()) return fail(400, '投票已截止');
        var voters = parseJSON(row.voters, {});
        var ip = config.clientIP;
        if (voters[ip]) return fail(400, '你已经投过票了');
        voters[ip] = option;
        if (row.type === 'choice') {
          var options = parseJSON(row.options, []);
          if (options.indexOf(option) === -1) return fail(400, '选项无效');
          var counts = parseJSON(row.counts, {});
          counts[option] = (counts[option] || 0) + 1;
          exec('UPDATE votes SET voters = ?, counts = ? WHERE id = ?', [JSON.stringify(voters), JSON.stringify(counts), vid]);
        } else {
          if (['yes', 'no'].indexOf(option) === -1) return fail(400, '选项无效');
          exec('UPDATE votes SET voters = ?, yesCount = ?, noCount = ? WHERE id = ?',
            [JSON.stringify(voters), row.yesCount + (option === 'yes' ? 1 : 0), row.noCount + (option === 'no' ? 1 : 0), vid]);
        }
        var updated = q('SELECT * FROM votes WHERE id = ?', [vid])[0];
        return ok({ success: true, message: '投票成功', vote: mapVote(updated) });
      }

      var mVote = path.match(/^\/api\/votes\/(.+)$/);
      if (mVote && (M === 'PUT' || M === 'DELETE')) {
        if (!admin) return unauth();
        var idv = decodeURIComponent(mVote[1]);
        var rv = q('SELECT * FROM votes WHERE id = ?', [idv])[0];
        if (!rv) return fail(404, '投票不存在');
        if (M === 'DELETE') {
          exec('DELETE FROM votes WHERE id = ?', [idv]);
          logAction('vote_delete', idv);
          return ok({ success: true, message: '投票已删除' });
        }
        var patch = {};
        if (body.title !== undefined) patch.title = body.title;
        if (body.description !== undefined) patch.description = body.description;
        if (body.deadline !== undefined) patch.deadline = body.deadline;
        if (body.options !== undefined && rv.type === 'choice') {
          patch.options = JSON.stringify(body.options);
          var old = parseJSON(rv.counts, {});
          patch.counts = JSON.stringify(Object.fromEntries(body.options.map(function (o) { return [o, old[o] || 0]; })));
        }
        var keys = Object.keys(patch);
        if (keys.length) {
          exec('UPDATE votes SET ' + keys.map(function (k) { return k + ' = ?'; }).join(', ') + ' WHERE id = ?',
            keys.map(function (k) { return patch[k]; }).concat([idv]));
        }
        var upd = q('SELECT * FROM votes WHERE id = ?', [idv])[0];
        logAction('vote_update', idv);
        return ok({ success: true, message: '投票已更新', vote: mapVote(upd) });
      }

      // ===== 图片代理：离线版直接指向本地资源 / 原图 =====
      if (M === 'GET' && path === '/api/img') {
        var target = query.get('url');
        if (!target) return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, text: 'missing url' };
        var host;
        try { host = new URL(target).hostname.toLowerCase(); } catch (e) { return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, text: 'invalid url' }; }
        if (config.imgAllowHosts.indexOf(host) === -1) return { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, text: 'host not allowed' };
        var local = loc(target);
        return { status: 302, headers: { Location: local }, text: null, redirect: local };
      }

      // ===== 神人榜 =====
      if (path === '/api/stories') {
        if (M === 'GET') return ok({ success: true, stories: storiesList() });
        if (M === 'POST') {
          if (!admin) return unauth();
          if (body.content !== undefined) {
            if (!body.title || !body.content) return fail(400, '标题和内容为必填项');
            var imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
            var content = String(body.content).split('\n').map(function (line) {
              var t = line.trim();
              if (t.indexOf('http') === 0 && imgExts.some(function (ext) { return t.toLowerCase().endsWith('.' + ext) || t.toLowerCase().indexOf('.' + ext + '?') !== -1; })) {
                if (t.indexOf('img.remit.ee') !== -1) t = '/api/img?url=' + encodeURIComponent(t);
                return "<img src='" + t + "' style='width:100%;height:auto;display:block;margin:0.6rem 0;border-radius:10px;'>";
              }
              return line;
            }).join('\n').replace(/\n/g, '<br>');
            var ns = { id: Date.now().toString(), title: body.title, content: content, text: '', images: [], date: new Date().toISOString() };
            exec('INSERT INTO stories (id, title, text, images, content, date) VALUES (?,?,?,?,?,?)',
              [ns.id, ns.title, ns.text, JSON.stringify(ns.images), ns.content, ns.date]);
            logAction('story_create', ns.title);
            return ok({ success: true, message: '添加成功', story: ns });
          }
          if (!body.title || !body.text) return fail(400, '标题和事件描述为必填项');
          var imgList2 = (body.images || []).filter(function (x) { return x && (x.indexOf('http') === 0 || x.indexOf('data:image/') === 0); });
          var ns2 = { id: Date.now().toString(), title: body.title, text: body.text, images: imgList2, date: new Date().toISOString() };
          exec('INSERT INTO stories (id, title, text, images, content, date) VALUES (?,?,?,?,?,?)',
            [ns2.id, ns2.title, ns2.text, JSON.stringify(ns2.images), null, ns2.date]);
          logAction('story_create', ns2.title);
          return ok({ success: true, message: '添加成功', story: ns2 });
        }
      }
      var mStory = path.match(/^\/api\/stories\/(.+)$/);
      if (mStory && M === 'DELETE') {
        if (!admin) return unauth();
        var sid = decodeURIComponent(mStory[1]);
        if (!q('SELECT id FROM stories WHERE id = ?', [sid]).length) return fail(404, '记录不存在');
        exec('DELETE FROM stories WHERE id = ?', [sid]);
        logAction('story_delete', sid);
        return ok({ success: true, message: '已删除' });
      }

      // ===== 封挂榜 =====
      if (path === '/api/bans') {
        if (M === 'GET') {
          var brows = q('SELECT * FROM bans ORDER BY date DESC, rowid DESC');
          return ok({ success: true, bans: brows.map(function (r) { return { id: r.id, player: r.player, reason: r.reason, date: r.date }; }) });
        }
        if (M === 'POST') {
          if (!admin) return unauth();
          if (!body.player) return fail(400, '玩家名为必填项');
          var nb = { id: Date.now().toString(), player: String(body.player).trim(), reason: body.reason || '', date: body.date || new Date().toISOString().split('T')[0] };
          exec('INSERT INTO bans (id, player, reason, date) VALUES (?,?,?,?)', [nb.id, nb.player, nb.reason, nb.date]);
          logAction('ban_create', nb.player);
          return ok({ success: true, message: '已添加封禁记录', ban: nb });
        }
      }
      var mBan = path.match(/^\/api\/bans\/(.+)$/);
      if (mBan && M === 'DELETE') {
        if (!admin) return unauth();
        var bid = decodeURIComponent(mBan[1]);
        if (!q('SELECT id FROM bans WHERE id = ?', [bid]).length) return fail(404, '记录不存在');
        exec('DELETE FROM bans WHERE id = ?', [bid]);
        logAction('ban_delete', bid);
        return ok({ success: true, message: '已删除' });
      }

      // ===== 捐赠名单 =====
      if (path === '/api/donors') {
        if (M === 'GET') {
          var drows = q('SELECT * FROM donors ORDER BY rowid');
          return ok({ success: true, donors: drows.map(function (r) { return { id: r.id, name: r.name, date: r.date }; }) });
        }
        if (M === 'POST') {
          if (!admin) return unauth();
          if (!body.name) return fail(400, '名字为必填项');
          var nd = { id: Date.now().toString(), name: String(body.name).trim(), date: new Date().toISOString().split('T')[0] };
          exec('INSERT INTO donors (id, name, date) VALUES (?,?,?)', [nd.id, nd.name, nd.date]);
          logAction('donor_create', nd.name);
          return ok({ success: true, message: '已添加捐赠人', donor: nd });
        }
      }
      var mDonor = path.match(/^\/api\/donors\/(.+)$/);
      if (mDonor && M === 'DELETE') {
        if (!admin) return unauth();
        var did = decodeURIComponent(mDonor[1]);
        if (!q('SELECT id FROM donors WHERE id = ?', [did]).length) return fail(404, '记录不存在');
        exec('DELETE FROM donors WHERE id = ?', [did]);
        logAction('donor_delete', did);
        return ok({ success: true, message: '已删除' });
      }

      // ===== 下载中心 =====
      if (path === '/api/downloads/files' && M === 'GET') {
        if (!admin) return unauth();
        // 无后端站点没有可上传的实体文件：这里列出数据库里指向 /downloads/ 的条目，
        // 链接在构建期已指向 GitHub Release 资源
        var parseSize = function (s) {
          var m = String(s || '').match(/([\d.]+)\s*(KB|MB|GB|B)/i);
          if (!m) return 0;
          var n = parseFloat(m[1]), u = m[2].toUpperCase();
          return Math.round(n * (u === 'GB' ? 1073741824 : u === 'MB' ? 1048576 : u === 'KB' ? 1024 : 1));
        };
        var files = q("SELECT id, name, url, size, filename, date FROM downloads WHERE url LIKE '%/downloads/%' OR url LIKE '%/releases/download/%'")
          .map(function (r) {
            var m = String(r.url).match(/(?:\/downloads\/)([^\/?#]+)/);
            var base = m ? m[1] : String(r.url).split('/').pop();
            return {
              filename: r.filename || base,
              url: dlUrl(r.url),
              size: parseSize(r.size),
              mtime: r.date || '',
              offlineLink: true,
            };
          });
        return ok({ success: true, files: files, offline: true });
      }
      if (path === '/api/downloads/upload' && M === 'POST') {
        if (!admin) return unauth();
        return fail(400, '离线静态版无法上传文件到站点，请在「添加下载项」里填外部链接（在线版后台可上传）');
      }
      var mDlFile = path.match(/^\/api\/downloads\/file\/(.+)$/);
      if (mDlFile && M === 'DELETE') {
        if (!admin) return unauth();
        return fail(400, '离线版没有可删除的服务器文件');
      }
      if (path === '/api/downloads') {
        if (M === 'GET') {
          var lrows = q('SELECT * FROM downloads ORDER BY date DESC, rowid DESC');
          return ok({
            success: true, downloads: lrows.map(function (r) {
              return { id: r.id, name: r.name, desc: loc(r.desc), url: dlUrl(r.url), size: r.size, filename: r.filename, date: r.date };
            })
          });
        }
        if (M === 'POST') {
          if (!admin) return unauth();
          if (!body.name || !body.url) return fail(400, '名称和下载链接为必填项');
          var ni = {
            id: Date.now().toString(), name: String(body.name).trim(), desc: body.desc || '',
            url: String(body.url).trim(), size: body.size || '', filename: body.filename || '',
            date: new Date().toISOString().split('T')[0],
          };
          exec('INSERT INTO downloads (id, name, desc, url, size, filename, date) VALUES (?,?,?,?,?,?,?)',
            [ni.id, ni.name, ni.desc, ni.url, ni.size, ni.filename, ni.date]);
          logAction('download_create', ni.name);
          return ok({ success: true, message: '已添加下载项', item: ni });
        }
      }
      var mDl = path.match(/^\/api\/downloads\/(.+)$/);
      if (mDl && M === 'DELETE') {
        if (!admin) return unauth();
        var dlid = decodeURIComponent(mDl[1]);
        if (!q('SELECT id FROM downloads WHERE id = ?', [dlid]).length) return fail(404, '记录不存在');
        exec('DELETE FROM downloads WHERE id = ?', [dlid]);
        logAction('download_delete', dlid);
        return ok({ success: true, message: '已删除' });
      }

      // ===== 图床（离线版：图片以 dataURL 存在浏览器本地） =====
      if (path === '/api/upload' && M === 'POST') {
        if (!admin) return unauth();
        var data = body.data;
        if (!data) return fail(400, '缺少图片数据');
        var base64 = data, ext = '';
        if (typeof data === 'string' && data.indexOf('data:') === 0) {
          var mm = data.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]*)$/);
          if (!mm) return fail(400, '图片格式不支持');
          ext = mm[1].toLowerCase();
          base64 = mm[2];
        } else if (body.name) {
          var em = String(body.name).match(/\.(\w+)$/);
          if (em) ext = em[1].toLowerCase();
        }
        if (ALLOWED_UPLOAD_EXT.indexOf(ext) === -1) return fail(400, '图片格式不支持（允许 png/jpg/gif/webp/bmp/ico）');
        var buf;
        try { buf = base64ToBytes(base64); } catch (e) { return fail(400, '数据无效'); }
        if (!buf || buf.length === 0) return fail(400, '文件为空');
        if (buf.length > 20 * 1024 * 1024) return fail(400, '文件过大（最大 20MB）');
        if (!looksLikeImage(buf, ext)) return fail(400, '文件内容与扩展名不匹配（疑似伪造）');
        if (data.length > 3.5 * 1024 * 1024) return fail(400, '离线版图床受浏览器存储限制，单张图片请小于约 2MB');
        var fname = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
        images[fname] = { data: data, size: buf.length, mtime: new Date().toISOString() };
        saveImages();
        logAction('upload', fname);
        return ok({ success: true, message: '上传成功（离线版保存在本浏览器）', url: data, filename: fname, offline: true });
      }
      if (path === '/api/images' && M === 'GET') {
        if (!admin) return unauth();
        var list = Object.keys(images).map(function (k) {
          return { filename: k, url: images[k].data, size: images[k].size, mtime: images[k].mtime };
        }).sort(function (a, b) { return String(b.mtime).localeCompare(String(a.mtime)); });
        return ok({ success: true, images: list, offline: true });
      }
      var mImg = path.match(/^\/api\/images\/(.+)$/);
      if (mImg && M === 'DELETE') {
        if (!admin) return unauth();
        var delName = decodeURIComponent(mImg[1]);
        if (!images[delName]) return fail(404, '文件不存在');
        delete images[delName];
        saveImages();
        logAction('image_delete', delName);
        return ok({ success: true, message: '已删除' });
      }

      // ===== 流量统计 =====
      if (path === '/api/stats/public' && M === 'GET') {
        var t = q('SELECT COUNT(*) as pv, COUNT(DISTINCT vid) as uv FROM visits')[0] || { pv: 0, uv: 0 };
        return ok({ success: true, pv: t.pv || 0, uv: t.uv || 0 });
      }
      if (path === '/api/stats' && M === 'GET') {
        if (!admin) return unauth();
        var s = statsData();
        return ok({ success: true, total: s.total, daily: s.daily, pages: s.pages });
      }

      // ===== 备份（离线版 = 下载当前库 / 恢复为原始 backup.db） =====
      if (path === '/api/backup' && M === 'GET') {
        if (!admin) return unauth();
        logAction('backup', '离线版导出数据库');
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="jssj-offline-' + new Date().toISOString().slice(0, 10) + '.db"',
          },
          bytes: db.export(),
        };
      }
      if (path === '/api/backups' && M === 'GET') {
        if (!admin) return unauth();
        return ok({
          success: true,
          backups: [{ name: config.dbName, size: originalBytes.length, mtime: config.builtAt, offline: true, source: source }],
          offline: true,
        });
      }
      if (path === '/api/backup/restore' && M === 'POST') {
        if (!admin) return unauth();
        var nm = String(body.name || '');
        if (nm && nm !== config.dbName) return fail(404, '备份文件不存在（离线版只有随站点分发的 ' + config.dbName + '）');
        resetToOriginal();
        return ok({ success: true, message: '已恢复为随站点分发的 ' + config.dbName + '（浏览器里保存的修改已清除）' });
      }

      // ===== 操作日志 =====
      if (path === '/api/oplog' && M === 'GET') {
        if (!admin) return unauth();
        return ok({ success: true, logs: q('SELECT * FROM oplog ORDER BY id DESC LIMIT 100') });
      }

      // ===== 全站搜索 =====
      if (path === '/api/search' && M === 'GET') {
        var sq = query.get('q') || '';
        var fuzzy = query.get('fuzzy') === '1';
        var sr = searchData(sq, fuzzy);
        return ok(Object.assign({ success: true, q: sq, fuzzy: !!fuzzy }, sr));
      }

      // ===== 导出 / 导入 =====
      if (path === '/api/export' && M === 'GET') {
        if (!admin) return unauth();
        var ts = new Date().toISOString().slice(0, 10);
        return jsonRes(200, exportData(), { 'Content-Disposition': 'attachment; filename="jssj-backup-' + ts + '.json"' });
      }
      if (path === '/api/import' && M === 'POST') {
        if (!admin) return unauth();
        var counts = { posts: 0, votes: 0, stories: 0, bans: 0, donors: 0, downloads: 0 };
        var jS = function (v) { return v === undefined || v === null ? null : (typeof v === 'string' ? v : JSON.stringify(v)); };
        var jA = function (v) { return JSON.stringify(Array.isArray(v) ? v : (v || [])); };
        var jO = function (v) { return JSON.stringify(v && typeof v === 'object' ? v : {}); };
        batch(function () {
        (Array.isArray(body.posts) ? body.posts : []).forEach(function (p) {
          if (!p || !p.id) return;
          exec("INSERT INTO posts (id,title,author,excerpt,content,images,pinned,date) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author, excerpt=excluded.excerpt, content=excluded.content, images=excluded.images, pinned=excluded.pinned, date=excluded.date",
            [String(p.id), String(p.title || ''), String(p.author || ''), String(p.excerpt || ''), String(p.content || ''), jA(p.images), p.pinned ? 1 : 0, jS(p.date)]);
          counts.posts++;
        });
        (Array.isArray(body.votes) ? body.votes : []).forEach(function (v) {
          if (!v || !v.id) return;
          exec("INSERT INTO votes (id,title,description,deadline,type,options,counts,yesCount,noCount,voters,active,date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, deadline=excluded.deadline, type=excluded.type, options=excluded.options, counts=excluded.counts, yesCount=excluded.yesCount, noCount=excluded.noCount, voters=excluded.voters, active=excluded.active, date=excluded.date",
            [String(v.id), String(v.title || ''), String(v.description || ''), jS(v.deadline), String(v.type || 'agree'), jA(v.options), jO(v.counts),
              v.yesCount == null ? 0 : v.yesCount, v.noCount == null ? 0 : v.noCount, jO(v.voters), v.active === false ? 0 : 1, jS(v.date)]);
          counts.votes++;
        });
        (Array.isArray(body.stories) ? body.stories : []).forEach(function (s) {
          if (!s || !s.id) return;
          exec("INSERT INTO stories (id,title,text,images,content,date) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, text=excluded.text, images=excluded.images, content=excluded.content, date=excluded.date",
            [String(s.id), String(s.title || ''), String(s.text || ''), jA(s.images), jS(s.content), jS(s.date)]);
          counts.stories++;
        });
        (Array.isArray(body.bans) ? body.bans : []).forEach(function (b) {
          if (!b || !b.id) return;
          exec("INSERT INTO bans (id,player,reason,date) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET player=excluded.player, reason=excluded.reason, date=excluded.date",
            [String(b.id), String(b.player || ''), String(b.reason || ''), jS(b.date)]);
          counts.bans++;
        });
        (Array.isArray(body.donors) ? body.donors : []).forEach(function (d) {
          if (!d || !d.id) return;
          exec("INSERT INTO donors (id,name,date) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, date=excluded.date",
            [String(d.id), String(d.name || ''), jS(d.date)]);
          counts.donors++;
        });
        (Array.isArray(body.downloads) ? body.downloads : []).forEach(function (dl) {
          if (!dl || !dl.id) return;
          exec("INSERT INTO downloads (id,name,desc,url,size,filename,date) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, desc=excluded.desc, url=excluded.url, size=excluded.size, filename=excluded.filename, date=excluded.date",
            [String(dl.id), String(dl.name || ''), String(dl.desc || ''), String(dl.url || ''), String(dl.size || ''), String(dl.filename || ''), jS(dl.date)]);
          counts.downloads++;
        });
        });
        logAction('import', 'posts:' + counts.posts + ' votes:' + counts.votes + ' stories:' + counts.stories + ' bans:' + counts.bans + ' donors:' + counts.donors + ' downloads:' + counts.downloads);
        return ok({ success: true, message: '导入完成（离线版）', imported: counts });
      }

      // ===== 404 =====
      if (path.indexOf('/api/') === 0) return fail(404, 'Not Found');
      return fail(404, 'Not Found');
    }

    // ---------------- 对外辅助 ----------------
    function resetToOriginal() {
      try { db.close(); } catch (e) {}
      openDb(originalBytes, 'file');
      images = {};
      if (storage) {
        try { storage.removeItem(DB_KEY); } catch (e) {}
        try { storage.removeItem(IMG_KEY); } catch (e) {}
      }
      storageError = null;
    }

    function info() {
      var counts = {};
      ['posts', 'votes', 'stories', 'bans', 'donors', 'downloads', 'visits', 'oplog'].forEach(function (t) {
        try { counts[t] = q('SELECT COUNT(*) as c FROM "' + t + '"')[0].c; } catch (e) { counts[t] = 0; }
      });
      var s = statsData();
      return {
        dbName: config.dbName,
        dbSize: originalBytes.length,
        builtAt: config.builtAt,
        source: source,
        hasLocalChanges: source === 'saved',
        counts: counts,
        pv: (s.total && s.total.pv) || 0,
        uv: (s.total && s.total.uv) || 0,
        images: Object.keys(images).length,
        storageError: storageError,
        assetCount: mapKeys.length,
        offline: true,
      };
    }

    return {
      handle: handle,
      info: info,
      reset: resetToOriginal,
      exportBytes: function () { return db.export(); },
      exportJson: function () { return JSON.stringify(exportData(), null, 2); },
      localize: loc,
      config: config,
      assetMap: assetMap,
    };
  }

  return {
    createOfflineApi: createOfflineApi,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
  };
});
