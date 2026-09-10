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

async function loadBans() {
  const container = document.getElementById('banList');
  try {
    const resp = await fetchApi('/api/bans');
    const data = await resp.json();
    if (!data.success || !data.bans || data.bans.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:1.5rem 0;opacity:0.3;">暂无封禁记录</div>';
      return;
    }
    container.innerHTML = data.bans.map(b => `
      <div class="ban-row">
        <span class="player">${esc(b.player)}</span>
        <span class="reason">${esc(b.reason)}</span>
        <span class="date">${esc(b.date)}</span>
      </div>`).join('');
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem 0;opacity:0.3;">加载失败</div>';
  }
}
loadBans();

const sidebar=document.getElementById('sidebar'),st=document.getElementById('sidebarToggle'),sc=document.getElementById('sidebarClose'),tt=document.getElementById('themeToggle'),ti=document.getElementById('themeIcon'),bd=document.body;
function openSidebar(){sidebar.classList.add('open')}
function closeSidebar(){sidebar.classList.remove('open')}
st.addEventListener('click',openSidebar);
sc.addEventListener('click',closeSidebar);
document.addEventListener('click',function(e){if(sidebar.classList.contains('open')&&!sidebar.contains(e.target)&&e.target!==st&&!st.contains(e.target))closeSidebar()});
sidebar.addEventListener('click',function(e){e.stopPropagation()});
var savedTheme=localStorage.getItem('theme');if(savedTheme==='light'){bd.classList.add('light-mode');ti.className='fas fa-sun'}else if(!savedTheme&&!window.matchMedia('(prefers-color-scheme:dark)').matches){bd.classList.add('light-mode');ti.className='fas fa-sun';localStorage.setItem('theme','light')}
tt.addEventListener('click',function(){bd.classList.toggle('light-mode');document.documentElement.classList.toggle('light-mode');var isLight=bd.classList.contains('light-mode');localStorage.setItem('theme',isLight?'light':'dark');ti.className=isLight?'fas fa-sun':'fas fa-moon'});
