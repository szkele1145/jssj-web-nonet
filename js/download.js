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

async function loadDownloads() {
  const container = document.getElementById('downloadContainer');
  try {
    const resp = await fetchApi('/api/downloads');
    const data = await resp.json();
    if (!data.success || !data.downloads || data.downloads.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:3rem;opacity:0.3;">暂无下载内容</div>';
      return;
    }
    container.innerHTML = '<div class="download-list">' + data.downloads.map(d => {
      const full = fileUrl(d.url);
      const needsFn = d.filename && d.url && d.url.startsWith('/');
      const href = full + (needsFn ? (full.indexOf('?') >= 0 ? '&' : '?') + 'fn=' + encodeURIComponent(d.filename) : '');
      return '<div class="download-item">' +
        '<div class="download-icon"><i class="fas fa-file-archive"></i></div>' +
        '<div class="download-info">' +
          '<div class="download-name">' + esc(d.name) + (d.size ? '<span class="download-badge">' + esc(d.size) + '</span>' : '') + '</div>' +
          (d.desc ? '<div class="download-desc">' + esc(d.desc) + '</div>' : '') +
          '<div class="download-meta">' + esc(d.date || '') + '</div>' +
        '</div>' +
        '<a class="download-btn" href="' + esc(href) + '" target="_blank" rel="noopener"><i class="fas fa-download"></i> 下载</a>' +
      '</div>';
    }).join('') + '</div>';
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:3rem;opacity:0.3;">加载失败</div><div style="text-align:center;"><button class="download-btn" onclick="loadDownloads()" style="margin-top:.8rem;"><i class="fas fa-redo"></i> 重试</button></div>';
  }
}
loadDownloads();

const sidebar=document.getElementById('sidebar'),st=document.getElementById('sidebarToggle'),sc=document.getElementById('sidebarClose'),tt=document.getElementById('themeToggle'),ti=document.getElementById('themeIcon'),bd=document.body;
function openSidebar(){sidebar.classList.add('open')}
function closeSidebar(){sidebar.classList.remove('open')}
st.addEventListener('click',openSidebar);sc.addEventListener('click',closeSidebar);
document.addEventListener('click',function(e){if(sidebar.classList.contains('open')&&!sidebar.contains(e.target)&&e.target!==st&&!st.contains(e.target))closeSidebar()});
sidebar.addEventListener('click',function(e){e.stopPropagation()});
var savedTheme=localStorage.getItem('theme');if(savedTheme==='light'){bd.classList.add('light-mode');ti.className='fas fa-sun'}else if(!savedTheme&&!window.matchMedia('(prefers-color-scheme:dark)').matches){bd.classList.add('light-mode');ti.className='fas fa-sun';localStorage.setItem('theme','light')}
tt.addEventListener('click',function(){bd.classList.toggle('light-mode');document.documentElement.classList.toggle('light-mode');var isLight=bd.classList.contains('light-mode');localStorage.setItem('theme',isLight?'light':'dark');ti.className=isLight?'fas fa-sun':'fas fa-moon'});
