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


let serverRefreshTimer = null;

function showError(msg) {
  const container = document.getElementById('serverStatusContent');
  container.innerHTML = `
    <div class="mc-card">
      <div class="mc-state state-error">
        <i class="fas fa-exclamation-triangle"></i>
        <div class="mc-state-text">${msg}</div>
        <button class="mc-refresh" onclick="fetchServerStatus()"><i class="fas fa-redo"></i> 重试</button>
      </div>
    </div>`;
  scheduleRefresh();
}

function renderServerStatus(data) {
  const container = document.getElementById('serverStatusContent');
  // [离线版] 无后端，不做实时查询，展示静态说明卡片
  if (data && data.proto === 'offline') {
    const s = data.server || {};
    container.innerHTML = `
      <div class="mc-card">
        <div class="mc-head">
          <div class="mc-live"><span class="mc-live-text mc-live-off">离线版</span></div>
          <div class="mc-online"><i class="fas fa-box-archive"></i> 静态数据</div>
        </div>
        <div class="mc-meta"><span class="mc-proto proto-ping"><i class="fas fa-plug"></i>不查询实时状态</span></div>
        <div class="mc-body">
          <div class="mc-motd">本页是<b>离线静态版</b>：站内所有数据都来自随站点分发的 backup.db，页面不依赖任何后端，因此这里不显示实时在线人数。<br>
服务器地址 <b>${s.srv || 'jssj.cc.cd'}</b>，Java 版 SRV 指向 <b>${s.host || ''}:${s.port || ''}</b>，Query 端口 <b>${s.queryPort || ''}</b>。<br>
需要实时状态请到线上站点查看。</div>
        </div>
      </div>`;
    return;
  }
  const protoMap = {
    'query': { text: 'Query 协议', cls: 'proto-query', icon: 'fas fa-bolt' },
    'ping': { text: 'Java Ping', cls: 'proto-ping', icon: 'fas fa-satellite-dish' },
    'bedrock': { text: '基岩 RakNet', cls: 'proto-bedrock', icon: 'fas fa-mobile-alt' },
    'third-party': { text: '第三方 API', cls: 'proto-third', icon: 'fas fa-cloud' },
  };
  const p = protoMap[data.proto] || { text: data.proto || '未知', cls: 'proto-ping', icon: 'fas fa-circle-question' };
  const protoTag = `<span class="mc-proto ${p.cls}">${p.icon ? `<i class="${p.icon}"></i>` : ''}${p.text}</span>`;
  const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  if (!data.online) {
    container.innerHTML = `
      <div class="mc-card mc-card-off">
        <div class="mc-state state-off">
          <div class="mc-live"><span class="mc-live-text mc-live-off">已关闭</span></div>
          <div class="mc-state-sub">当前无法连接到 MC 服务器</div>
          <div class="mc-state-proto">${protoTag}</div>
        </div>
      </div>
      <div class="mc-foot">
        <span><i class="fas fa-sync-alt"></i> 更新于 ${timeStr}</span>
        <button class="mc-refresh" onclick="fetchServerStatus()"><i class="fas fa-redo"></i> 刷新</button>
      </div>`;
    scheduleRefresh();
    return;
  }

  const count = data.players?.online ?? 0;
  const maxCount = data.players?.max ?? 0;
  const javaPlayers = data.players?.java || [];
  const bedrockPlayers = data.players?.bedrock || [];
  const botCount = data.players?.bots ?? 0;

  let motdHtml = '';
  if (data.motd?.html?.length) motdHtml = data.motd.html.join('<br>');
  else if (data.motd?.clean?.length) motdHtml = data.motd.clean.join('<br>');
  else motdHtml = '<span class="mc-motd-empty">无 MOTD</span>';

  // 玩家区块
  let playerSections = '';
  if (javaPlayers.length + bedrockPlayers.length + botCount === 0) {
    playerSections = '<div class="mc-players-empty">暂无玩家在线</div>';
  } else {
    let cols = '';
    if (javaPlayers.length > 0) cols += `<div class="mc-psec"><div class="mc-plabel"><span class="mc-plabel-badge pl-java">Java</span>${javaPlayers.length} 人</div><div class="mc-plist">${javaPlayers.map(n => `<span class="mc-player">${n}</span>`).join('')}</div></div>`;
    if (bedrockPlayers.length > 0) cols += `<div class="mc-psec"><div class="mc-plabel"><span class="mc-plabel-badge pl-bedrock">BE</span>${bedrockPlayers.length} 人</div><div class="mc-plist">${bedrockPlayers.map(n => `<span class="mc-player">${n}</span>`).join('')}</div></div>`;
    if (botCount > 0) cols += `<div class="mc-psec"><div class="mc-plabel"><span class="mc-plabel-badge pl-bot">Bot</span>${botCount} 个</div></div>`;
    playerSections = cols ? `<div class="mc-pgrid">${cols}</div>` : '<div class="mc-players-empty">暂无玩家在线</div>';
  }

  // 在线率进度条已移除
  container.innerHTML = `
    <div class="mc-card">
      <div class="mc-head">
        <div class="mc-live"><span class="mc-live-text">在线</span></div>
        <div class="mc-online"><i class="fas fa-users"></i> ${count}${maxCount ? ` / ${maxCount}` : ''} 人在线</div>
      </div>
      <div class="mc-meta">
        <span>${protoTag}</span>
      </div>
      <div class="mc-body">
        ${playerSections}
        <div class="mc-motd">${motdHtml}</div>
      </div>
    </div>
    <div class="mc-foot">
      <span><i class="fas fa-sync-alt"></i> 更新于 ${timeStr}</span>
      <button class="mc-refresh" onclick="fetchServerStatus()"><i class="fas fa-redo"></i> 刷新</button>
    </div>`;
  scheduleRefresh();
}

function scheduleRefresh() {
  if (serverRefreshTimer) clearTimeout(serverRefreshTimer);
  serverRefreshTimer = setTimeout(fetchServerStatus, 30000);
}

async function fetchServerStatus() {
  const container = document.getElementById('serverStatusContent');
  // Worker 代理
  try {
    const resp = await fetchApi('/api/mc-status');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.success) { renderServerStatus(data); return; }
    throw new Error(data.error || 'Worker 返回失败');
  } catch (err) {
    console.warn('[服务器状态] Worker 代理失败:', err.message);
  }

  // 降级：直连 mcsrvstat.us v3+v2
    console.log('[服务器状态] 尝试直连...');
  try {
    let online = false, maxP = 0, maxOnline = 0, real = [], extra = [], motd = null;
    for (const ver of ['3', '2']) {
      try {
        const ctrl = new AbortController();
        const tm = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(`https://api.mcsrvstat.us/${ver}/jssj.cc.cd`, { signal: ctrl.signal });
        clearTimeout(tm);
        if (!resp.ok) { console.warn('[服务器状态] v' + ver + ' HTTP ' + resp.status); continue; }
        const d = await resp.json();
        console.log('[服务器状态] v' + ver + ' 返回:', JSON.stringify(d).slice(0, 300));
        if (d.online) online = true;
        if (d.motd && !motd) motd = d.motd;
        if (d.players) {
          maxP = Math.max(maxP, d.players.max ?? 0);
          maxOnline = Math.max(maxOnline, d.players.online ?? 0);
          const raw = d.players.list || [];
          const names = raw.length && typeof raw[0] === 'object' ? raw.map(p => p.name) : raw;
          real = [...new Set([...real, ...names])];
          const info = d.info?.clean || d.info?.raw || [];
          extra = [...new Set([...extra, ...info])];
        }
      } catch (e) { console.warn('[服务器状态] v' + ver + ' 异常:', e.message); }
    }
    const java = real.filter(n => n && !n.startsWith('.'));
    const bedrock = [...new Set([
      ...real.filter(n => n && n.startsWith('.')).map(n => n.slice(1)),
      ...extra.filter(n => n && n.startsWith('.')).map(n => n.slice(1)),
    ])];
    const totalOnline = Math.max(java.length + bedrock.length, maxOnline);
    const bots = Math.max(0, totalOnline - java.length - bedrock.length);
    console.log('[服务器状态] 直连合并结果:', JSON.stringify({ online, players: { online: totalOnline, max: maxP, java: java.length, bedrock: bedrock.length, bots } }));
    renderServerStatus({
      success: true, online,
      players: { online: totalOnline, max: maxP, java, bedrock, bots },
      motd,
    });
  } catch (e) {
    console.error('[服务器状态] 直连完全失败:', e);
    showError('无法获取数据');
  }
}

fetchServerStatus();
