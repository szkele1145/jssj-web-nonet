const API_BASE = location.hostname === 'sh.jssj.cc.cd' ? 'https://shapi.jssj.cc.cd' : 'https://api.jssj.cc.cd';
const SHAPI_BASE = 'https://shapi.jssj.cc.cd';
async function fetchApi(path, options) {
  try {
    const resp = await fetch(API_BASE + path, options);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp;
  } catch (e) {
    if (API_BASE !== SHAPI_BASE) {
      const fallback = await fetch(SHAPI_BASE + path, options);
      if (!fallback.ok) throw new Error('HTTP ' + fallback.status);
      return fallback;
    }
    throw e;
  }
}



function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchForumPosts() {
  try {
    const resp = await fetchApi('/api/posts');
    const data = await resp.json();
    renderPosts(data.success ? data.posts : null);
  } catch {
    renderPosts(null);
  }
}

function renderPosts(posts) {
  const container = document.getElementById('forumPosts');
  if (!container) return;
  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="forum-post"><div class="post-excerpt" style="text-align:center;opacity:0.3;">暂无动态</div></div>';
    return;
  }
  container.innerHTML = posts.map(p => `
    <div class="forum-post" id="post-${esc(p.id)}">
      <div class="post-title">${esc(p.title) || '未命名'}${p.pinned ? '<span class="pin-badge">置顶</span>' : ''}</div>
      <div class="post-meta">${esc(p.author) || '匿名'} · ${esc(p.date || '')}</div>
      <div class="post-excerpt">${esc(p.excerpt || p.content || '')}</div>
      ${(p.images && p.images.length) ? `<div class="post-images">${p.images.map(u => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
    </div>`).join('');
  // 深链接：从搜索结果带 #post-id 跳转时，滚动到对应帖子并高亮
  if (location.hash && location.hash.startsWith('#post-')) {
    setTimeout(() => {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.style.outline = '2px solid rgba(90,176,224,.55)';
        el.style.outlineOffset = '2px';
        setTimeout(() => { el.style.outline = 'none'; }, 3000);
      }
    }, 150);
  }
}

fetchForumPosts();
