# 建设世界 · 离线静态版

**在线地址：<https://szkele1145.github.io/jssj-web-nonet/>**

官网的**无后端**版本：没有服务器、没有 Node、没有 pm2、没有数据库服务。
整站就是一堆静态文件，数据放在站点里的**真 SQLite 文件**中，由浏览器自己打开查询。

---

## 一、这是什么

| | 线上版 | 离线版（本站） |
|---|---|---|
| 部署 | 云服务器 + Nginx + Node + pm2 + SQLite | **纯静态**，GitHub Pages 即可 |
| 数据 | `data.db` 由后端读写 | **`db/backup.db` 原样内嵌**，浏览器内用 SQLite 引擎打开 |
| 接口 | `api.jssj.cc.cd/api/*` | 在浏览器内**复刻同一套接口**，页面代码零改动 |
| 联网 | 必须 | **不需要**（下载大文件时除外，走 GitHub Release） |

数据不是"抄进 HTML"的静态快照，而是把一个**真的 SQLite 数据库文件**放在站点里，
页面通过真 SQL 查询它 —— 你把新的 `backup.db` 换进去，站点内容就更新了。

---

## 二、工作原理

```
页面（原站 HTML/JS 一字未改）
  │  照常请求 https://api.jssj.cc.cd/api/posts
  ▼
offline/offline.js          劫持 window.fetch / XMLHttpRequest
  │  只拦 /api/*，其它请求（css/js/图片/db）原样放行
  ▼
offline/offline-core.js     复刻 server.js 的全部路由
  │  相同的 JSON 结构、相同的排序、相同的 401/404、相同的 IP 防刷与截止校验
  ▼
lib/sql-asm.js              浏览器里的 SQLite 引擎（sql.js，纯 JS，无需 wasm 文件）
  ▼
db/backup.db                桌面 backup.db 的原样副本（124 KB）
                            动态 / 投票 / 神人榜 / 封挂榜 / 捐赠 / 下载 / 访问统计 / 操作日志
```

**两处细节**

- **双击本地打开也能用**：`file://` 下浏览器禁止 `fetch` 读本地文件，此时自动退回到
  `db/backup-embedded.js`（同一份数据库的 base64 内嵌副本）。
- **图片全部本地化**：数据里引用的 21 张外链图（服务器 `uploads/` + `img.xwyue.com` 图床 +
  捐赠页两张收款码）都已下载到 `assets/`，由 `offline/asset-map.js` 在接口层改写成相对路径，
  所以断网也不缺图。用相对路径也意味着站点放在 `/<仓库名>/` 子路径下同样正常。

---

## 三、与线上版的差异

| 功能 | 离线版表现 |
|---|---|
| 首页、动态、投票、神人榜、封挂榜、捐赠、下载、搜索、流量统计、成员、新人须知、关于 | ✅ **与线上完全一致**（已逐接口比对，见第五节） |
| MC 服务器实时状态 | ⚪ 显示「离线静态版」说明卡片（含服务器地址/端口），不做实时查询 |
| 访问埋点 `POST /api/track` | ⚪ 不写入，保留原库历史 PV（621）与 UV（70） |
| 下载中心大文件 | 🔗 指向 **GitHub Release**（站点本身不放 111 MB 的大文件） |
| 图床上传 | ⚪ 图片以 dataURL 存在浏览器本地，单张建议 ≤ 2 MB |
| 后台增删改 | ⚪ 写入浏览器 localStorage，页脚浮标里可一键还原为原始数据 |
| 后台备份 / 一键回档 | ⚪ 换成「下载当前数据库」与「还原为随站点分发的 backup.db」 |
| 上传文件（图床/下载） | ❌ 无后端，无法接收文件，界面会给出提示 |

> 页面源码里的 `API_BASE = 'https://api.jssj.cc.cd'` 没有改 —— 请求被拦截层接走了，
> 不会真的发到线上服务器。

---

## 四、目录结构

```
离线版/（= 仓库 jssj-web-nonet 的根目录）
├── index.html … about.html      13 个页面（原站文件 + 注入 1 行脚本 + 少量适配补丁）
├── admin.html                   管理后台（入口，密码同线上 ADMIN_KEY）
├── css/  js/  favicon.png       原站样式、脚本、图标
├── assets/                      21 张本地化图片
├── db/
│   ├── backup.db                ★ 内嵌数据库（原样副本，换它即更新数据）
│   └── backup-embedded.js       base64 副本（file:// 双击打开时用）
├── lib/sql-asm.js               SQLite 引擎（sql.js，纯 JS）
├── offline/
│   ├── offline.js               引导层：拦截 fetch/XHR、右下角浮标
│   ├── offline-core.js          API 核心：复刻 server.js 的全部路由
│   ├── asset-map.js             【构建产物】外链图片 → 本地路径
│   ├── asset-map.json           同上（JSON 版，便于脚本读取）
│   └── download-map.js          【构建产物】下载项 → GitHub Release 资源
├── _build/                      构建与自检脚本（详见第七节）
├── .nojekyll                    GitHub Pages 关闭 Jekyll
└── .gitignore
```

---

## 五、验证记录

**1. 接口逐条比对（`_build/test-core.js`）：36 项通过 / 0 失败**

把离线核心的响应与线上真实 `api.jssj.cc.cd` 的响应做**逐字节比较**（图片地址先反向还原）：

```
[PASS] /api/posts        [PASS] /api/votes       [PASS] /api/stories
[PASS] /api/bans         [PASS] /api/donors      [PASS] /api/downloads
[PASS] /api/stats/public [PASS] /api/stats       [PASS] /api/export
[PASS] /api/search ×4（含模糊搜索、空结果）
[PASS] 鉴权：正确/错误密码、未授权 401、未知路由 404
[PASS] 写入、持久化、重载保留、还原、导入、图片魔数校验…
```

**2. 页面端到端（`_build/verify-pages.js`）：用 Edge 无头抓 13 个页面的最终 DOM，20 项断言全过**

```
首页运行天数 = 805（由浏览器内 SQLite 按 2024-06-28 算出）
首页访问量   = 621（来自 backup.db）
投票票数     = 同意 24（92%）· 反对 2
动态图片     = assets/02_img_…png（已本地化）
下载链接     = github.com/szkele1145/jssj-web-nonet/releases/download/offline-v1/…
```

**3. 资源加载（`_build/check-resources.js`）：10 个页面 125 个请求，124 成功**

CSS、Font Awesome 字体、21 张图片、SQLite 引擎、内嵌数据库全部 200；
唯一 404 是浏览器自动探测的 `/favicon.ico`（页面声明的是 `favicon.png`，无影响）。

**4. 负向断言（`_build/check-dumps.js`）：7 项全过**

DOM 中不再残留 `img.xwyue.com`、`api.jssj.cc.cd/uploads`、`api.jssj.cc.cd/downloads`
等线上外链，服务器页也不会误显示「已关闭」。

---

## 六、怎么用

**在线看**：<https://szkele1145.github.io/jssj-web-nonet/>

**本地双击看**：打开 `离线版/index.html`（推荐 Edge / Chrome；`file://` 下自动使用 base64 内嵌数据库）

**本地起服务看**（更接近线上行为）：
```bash
node _build/serve.js 8123
# → http://127.0.0.1:8123/
```

**管理后台**：`admin.html`，密码与线上一致（`ecosystem.config.js` 里的 `ADMIN_KEY`）。
改动只存在你这台浏览器里；右下角「离线版」浮标里可以**下载当前数据库 / 导出 JSON / 还原原始数据**。

---

## 七、更新与部署

### 换了新的 backup.db 之后（最常用）

```bash
node _build/update.js                 # 默认读 C:\Users\一只屑\Desktop\backup.db
node _build/update.js D:\其他库.db     # 也可以指定
```
它会：换库 → 导出数据清单 → 下载新出现的外链图片 → 重新构建全部页面。
然后 `git add -A && git commit -m "更新数据" && git push` 即可。

### 重新部署 / 首次部署

```bash
node _build/deploy-pages.js       # 建仓库（若不存在）+ 推送 + 开启 Pages + 等待构建
node _build/publish-release.js    # 拉取大文件并上传到 GitHub Release，再回填链接
```

### 全部脚本

| 脚本 | 作用 |
|---|---|
| `update.js` | 一键更新：换库 + 重新构建 |
| `build-site.js` | 只重新构建页面（注入引导层、本地化图片、打适配补丁） |
| `fetch-assets.js` | 下载数据中引用的外链图片到 `assets/` |
| `dump.js` | 导出数据库全部表为 `_build/dump.json`（供上一步使用） |
| `deploy-pages.js` | 部署到 GitHub Pages |
| `publish-release.js` | 把下载中心的大文件发到 GitHub Release |
| `serve.js` | 本地自测静态服务器（带访问日志） |
| `test-core.js` | 接口层与线上 API 逐条比对 |
| `verify-pages.js` | Edge 无头抓 DOM 做页面断言（可传线上地址） |
| `check-resources.js` | 分析访问日志，查资源 404 |
| `check-dumps.js` | DOM 负向断言 |

---

## 八、注意事项

- **仓库是公开的**：GitHub Pages 免费账号只能用公开仓库。站点内容本来就是官网的公开内容，
  但请注意 `db/backup.db` 里含游客 IP（投票 `voters` 字段）——如需隐藏，可在换库前清理该字段。
- 站点里的数据是 `backup.db` 的**快照**（构建于 2026-09-10），不是实时数据。
- 想在离线站点上看实时 MC 状态，需要后端，做不到；服务器页已改为展示连接信息。
- 若数据里引用了后来被删掉的图片，离线版会显示裂图（与线上表现一致）。
- 站点文件共 58 个、约 5.5 MB（其中 SQLite 引擎 1.3 MB、图片 2.5 MB）。
