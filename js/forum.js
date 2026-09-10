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
  const container = document.getElementById('forumPosts');
  if (!container) return;
  renderSkeleton(container);
  try {
    const resp = await fetchApi('/api/posts');
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || '接口返回失败');
    renderPosts(data.posts);
  } catch (e) {
    // 原实现在这里渲染「暂无动态」，于是「服务器挂了」和「确实没内容」长得一模一样
    renderError(container, e);
  }
}

/* 加载骨架：避免空白等待 */
function renderSkeleton(container) {
  container.innerHTML =
    '<div class="forum-post">' +
      '<div class="skeleton skeleton-line w-40"></div>' +
      '<div class="skeleton skeleton-line w-70"></div>' +
      '<div class="skeleton skeleton-line"></div>' +
    '</div>' +
    '<div class="forum-post">' +
      '<div class="skeleton skeleton-line w-40"></div>' +
      '<div class="skeleton skeleton-line"></div>' +
    '</div>';
  container.setAttribute('aria-busy', 'true');
  container.setAttribute('aria-live', 'polite');
}

function renderError(container, err) {
  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-live', 'polite');
  container.innerHTML =
    '<div class="forum-post">' +
      '<div class="empty-state">' +
        '<i class="fas fa-cloud-exclamation"></i>' +
        '<div>动态加载失败，请检查网络后重试</div>' +
        '<div style="margin-top:.35rem;font-size:.75rem;opacity:.75;">' +
          esc(err && err.message ? err.message : '未知错误') +
        '</div>' +
        '<button class="btn btn-sm" type="button" style="margin-top:1rem;" onclick="fetchForumPosts()">' +
          '<i class="fas fa-redo"></i> 重试' +
        '</button>' +
      '</div>' +
    '</div>';
}

function renderPosts(posts) {
  const container = document.getElementById('forumPosts');
  if (!container) return;
  container.setAttribute('aria-busy', 'false');
  container.setAttribute('aria-live', 'polite');

  if (!posts || posts.length === 0) {
    container.innerHTML =
      '<div class="forum-post">' +
        '<div class="empty-state"><i class="far fa-folder-open"></i><div>暂无动态</div></div>' +
      '</div>';
    return;
  }

  container.innerHTML = posts.map(p => `
    <div class="forum-post" id="post-${esc(p.id)}">
      <div class="post-title">${esc(p.title) || '未命名'}${p.pinned ? '<span class="pin-badge">置顶</span>' : ''}</div>
      <div class="post-meta">${esc(p.author) || '匿名'} · ${esc(p.date || '')}</div>
      <div class="post-excerpt">${esc(p.excerpt || p.content || '')}</div>
      ${(p.images && p.images.length) ? `<div class="post-images">${p.images.map(u => `<img src="${esc(u)}" alt="动态配图" loading="lazy">`).join('')}</div>` : ''}
    </div>`).join('');

  // 深链接：从搜索结果带 #post-id 跳转时，滚动到对应帖子并高亮
  if (location.hash && location.hash.startsWith('#post-')) {
    setTimeout(() => {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('is-target');
        setTimeout(() => el.classList.remove('is-target'), 3000);
      }
    }, 150);
  }
}

fetchForumPosts();
