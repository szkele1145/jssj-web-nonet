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

async function loadDonors() {
  const container = document.getElementById('donorList');
  try {
    const resp = await fetchApi('/api/donors');
    const data = await resp.json();
    if (!data.success || !data.donors || data.donors.length === 0) {
      container.innerHTML = '<span style="opacity:0.3;">暂无捐赠记录</span>';
      return;
    }
    container.innerHTML = data.donors.map(d => `<span class="donor">${esc(d.name)}</span>`).join('');
  } catch {
    container.innerHTML = '<span style="opacity:0.3;">加载失败</span>';
  }
}
loadDonors();

const sidebar=document.getElementById('sidebar'),st=document.getElementById('sidebarToggle'),sc=document.getElementById('sidebarClose'),tt=document.getElementById('themeToggle'),ti=document.getElementById('themeIcon'),bd=document.body;
function openSidebar(){sidebar.classList.add('open')}
function closeSidebar(){sidebar.classList.remove('open')}
st.addEventListener('click',openSidebar);
sc.addEventListener('click',closeSidebar);
document.addEventListener('click',function(e){if(sidebar.classList.contains('open')&&!sidebar.contains(e.target)&&e.target!==st&&!st.contains(e.target))closeSidebar()});
sidebar.addEventListener('click',function(e){e.stopPropagation()});
var savedTheme=localStorage.getItem('theme');if(savedTheme==='light'){bd.classList.add('light-mode');ti.className='fas fa-sun'}else if(!savedTheme&&!window.matchMedia('(prefers-color-scheme:dark)').matches){bd.classList.add('light-mode');ti.className='fas fa-sun';localStorage.setItem('theme','light')}
tt.addEventListener('click',function(){bd.classList.toggle('light-mode');document.documentElement.classList.toggle('light-mode');var isLight=bd.classList.contains('light-mode');localStorage.setItem('theme',isLight?'light':'dark');ti.className=isLight?'fas fa-sun':'fas fa-moon'});
