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


let allStories = [];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderStories(list) {
  const container = document.getElementById('storyContainer');
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="server-status-card" style="text-align:center;padding:3rem;"><div style="opacity:0.3;">' + (allStories.length > 0 ? '无匹配结果' : '暂无记录') + '</div></div>';
    return;
  }
  container.innerHTML = list.map(s => {
    let content = s.content || '';
    if (content.includes('img.remit.ee')) {
      content = content.replace(/https?:\/\/img\.remit\.ee[^\s<>"]+/g, function(u) {
        return API_BASE + '/api/img?url=' + encodeURIComponent(u);
      });
    }
    if (content.includes('/api/img')) {
      content = content.replace(/(src=["'])\/api\/img/g, '$1' + API_BASE + '/api/img');
    }
    if (!content.includes('story-gallery')) content = content.replace(/(<img[^>]*>(?:\s*(?:<br\s*\/?>)?\s*<img[^>]*>)*)/gi, function(m) { return '<div class="story-gallery">' + m.replace(/<br\s*\/?>/gi, '') + '</div>'; });
    content = content.replace(/<img /gi, '<img loading="lazy" ');
    return '<div class="story-card" id="story-' + esc(s.id) + '"><div class="story-title">' + esc(s.title) + '</div><div class="story-meta">' + esc((s.date || '').split('T')[0]) + '</div><div class="story-content">' + content + '</div></div>';
  }).join('');
}

async function loadStories() {
  const container = document.getElementById('storyContainer');
  try {
    const resp = await fetchApi('/api/stories');
    const data = await resp.json();
    if (!data.success || !data.stories || data.stories.length === 0) {
      container.innerHTML = '<div class="server-status-card" style="text-align:center;padding:3rem;"><div style="opacity:0.3;">暂无记录</div></div>';
      return;
    }
    allStories = data.stories.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    renderStories(allStories);
    // 深链接：从搜索结果带 #story-id 跳转时，滚动到对应条目并高亮
    if (location.hash && location.hash.startsWith('#story-')) {
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
  } catch {
    container.innerHTML = '<div class="server-status-card" style="text-align:center;padding:3rem;"><div style="opacity:0.3;">加载失败</div></div>';
  }
}

loadStories();

const sidebar=document.getElementById('sidebar'),st=document.getElementById('sidebarToggle'),sc=document.getElementById('sidebarClose'),tt=document.getElementById('themeToggle'),ti=document.getElementById('themeIcon'),bd=document.body;
function openSidebar(){sidebar.classList.add('open')}
function closeSidebar(){sidebar.classList.remove('open')}
st.addEventListener('click',openSidebar);sc.addEventListener('click',closeSidebar);
document.addEventListener('click',function(e){if(sidebar.classList.contains('open')&&!sidebar.contains(e.target)&&e.target!==st&&!st.contains(e.target))closeSidebar()});
sidebar.addEventListener('click',function(e){e.stopPropagation()});
var savedTheme=localStorage.getItem('theme');if(savedTheme==='light'){bd.classList.add('light-mode');ti.className='fas fa-sun'}else if(!savedTheme&&!window.matchMedia('(prefers-color-scheme:dark)').matches){bd.classList.add('light-mode');ti.className='fas fa-sun';localStorage.setItem('theme','light')}
tt.addEventListener('click',function(){bd.classList.toggle('light-mode');document.documentElement.classList.toggle('light-mode');var isLight=bd.classList.contains('light-mode');localStorage.setItem('theme',isLight?'light':'dark');ti.className=isLight?'fas fa-sun':'fas fa-moon'});
