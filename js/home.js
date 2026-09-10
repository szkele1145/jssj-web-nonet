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

/* 标记为「拿不到真实数据」，不再伪造数字。
 * 原实现在接口失败时会用硬编码的 2024-06-28 现算一个天数顶上去，
 * 看起来像真的，实际是编的 —— 已改为显示占位符 + 悬浮说明。 */
function markUnknown(el, hint) {
  if (!el) return;
  el.textContent = '--';
  el.setAttribute('title', hint || '暂时无法获取');
  el.classList.add('is-unknown');
}

async function fetchUptime() {
  const el = document.getElementById('uptimeDays');
  try {
    const resp = await fetchApi('/api/uptime');
    const data = await resp.json();
    if (!data.success || data.days == null) throw new Error('API returned failure');
    el.textContent = data.days;
    el.removeAttribute('title');
    el.classList.remove('is-unknown');
  } catch (e) {
    markUnknown(el, '运行天数暂时取不到（接口未响应），请稍后刷新');
  }
}
fetchUptime();

async function fetchSiteStats() {
  const pv = document.getElementById('sitePv');
  try {
    const resp = await fetchApi('/api/stats/public');
    const data = await resp.json();
    if (!data.success) throw new Error('API returned failure');
    pv.textContent = data.pv || 0;
    pv.removeAttribute('title');
    pv.classList.remove('is-unknown');
  } catch (e) {
    markUnknown(pv, '访问量暂时取不到（接口未响应），请稍后刷新');
  }
}
fetchSiteStats();
