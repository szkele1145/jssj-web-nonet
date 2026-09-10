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



async function fetchUptime() {
  const el = document.getElementById('uptimeDays');
  try {
    const resp = await fetchApi('/api/uptime');
    const data = await resp.json();
    if (data.success) el.textContent = data.days;
    else throw new Error('API returned failure');
  } catch {
    const start = new Date('2024-06-28');
    const diff = Math.ceil(Math.abs(new Date() - start) / 86400000);
    el.textContent = diff;
  }
}
fetchUptime();

async function fetchSiteStats() {
  const pv = document.getElementById('sitePv');
  try {
    const resp = await fetchApi('/api/stats/public');
    const data = await resp.json();
    if (data.success) pv.textContent = data.pv || 0;
  } catch {
    pv.textContent = '-';
  }
}
fetchSiteStats();
