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


let showHistory = false;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDesc(text) {
  if (!text) return '';
  // 先转义全部文本，再把图床链接还原成图片标签（IMG_ALLOW_HOSTS 白名单）
  let t = esc(text);
  if (t.includes('img.remit.ee')) t = t.replace(/https?:\/\/img\.remit\.ee[^\s<>"]+/g, function(u) { return '<img src="' + API_BASE + '/api/img?url=' + encodeURIComponent(u) + '" style="max-width:100%;height:auto;border-radius:8px;margin:.4rem 0;display:block;" loading="lazy">'; });
  return t;
}

function renderAgreeCard(v, active) {
  const total = (v.yesCount || 0) + (v.noCount || 0);
  const yesPct = total > 0 ? ((v.yesCount || 0) / total * 100).toFixed(0) : 0;
  const noPct = total > 0 ? ((v.noCount || 0) / total * 100).toFixed(0) : 0;
  const hasVoted = v.myVote || null;
  if (active) {
    return '<div class="vote-card" id="vote-' + esc(v.id) + '"><div class="vote-title">' + esc(v.title) + '</div>' + (v.description ? '<div class="vote-desc">' + formatDesc(v.description) + '</div>' : '') + '<div class="vote-actions"><button class="vote-btn yes' + (hasVoted === 'yes' ? ' voted' : '') + '" onclick="castVote(\'' + esc(v.id) + '\',\'yes\')"' + (hasVoted ? ' disabled' : '') + '><i class="fas fa-check"></i> 同意 (' + (v.yesCount || 0) + ')</button><button class="vote-btn no' + (hasVoted === 'no' ? ' voted' : '') + '" onclick="castVote(\'' + esc(v.id) + '\',\'no\')"' + (hasVoted ? ' disabled' : '') + '><i class="fas fa-times"></i> 反对 (' + (v.noCount || 0) + ')</button></div>' + (total > 0 ? '<div class="vote-bar"><div class="fill-yes" style="width:' + yesPct + '%"></div><div class="fill-no" style="width:' + noPct + '%"></div></div>' : '') + '<div class="vote-meta"><span>' + esc((v.date || '').split('T')[0]) + '</span><span>' + (v.deadline ? '截止 ' + esc(v.deadline) : '') + (total > 0 ? ' · ' + total + ' 票' : '') + '</span></div></div>';
  }
  const yesWin = (v.yesCount || 0) > (v.noCount || 0);
  const noWin = (v.noCount || 0) > (v.yesCount || 0);
  const draw = !yesWin && !noWin && total > 0;
  const resultLabel = yesWin ? '✓同意' : noWin ? '✗反对' : draw ? '—平局' : '';
  return '<div class="vote-card" id="vote-' + esc(v.id) + '"><div class="vote-title">' + esc(v.title) + '</div><div class="vote-result-badge' + (yesWin ? ' result-yes' : '') + (noWin ? ' result-no' : '') + (draw ? ' result-draw' : '') + '">' + resultLabel + '</div>' + (v.description ? '<div class="vote-desc">' + formatDesc(v.description) + '</div>' : '') + '<div class="vote-result' + (yesWin ? ' win-yes' : '') + (noWin ? ' win-no' : '') + '"><span>同意 ' + (v.yesCount || 0) + ' <span class="vote-pct">' + yesPct + '%</span></span><span>反对 ' + (v.noCount || 0) + ' <span class="vote-pct">' + noPct + '%</span></span></div>' + (total > 0 ? '<div class="vote-bar"><div class="fill-yes" style="width:' + yesPct + '%"></div><div class="fill-no" style="width:' + noPct + '%"></div></div>' : '') + '<div class="vote-meta"><span>' + esc((v.date || '').split('T')[0]) + '</span><span>' + total + ' 票</span></div></div>';
}

function parseOpt(s) {
  const i = s.lastIndexOf('|');
  if (i > 0) {
    const label = s.slice(0, i).trim();
    const imgs = s.slice(i + 1).split(',').map(u => u.trim()).filter(u => u.startsWith('http')).map(u => u.includes('img.remit.ee') ? API_BASE + '/api/img?url=' + encodeURIComponent(u) : u);
    return { label, imgs, key: s };
  }
  return { label: s, imgs: [], key: s };
}

function renderChoiceCard(v, active) {
  const hasVoted = v.myVote || null;
  const total = Object.values(v.counts || {}).reduce((a, b) => a + b, 0);
  const parsed = v.options.map(parseOpt);
  function imgGrid(imgs) { return imgs.length > 0 ? '<div class="opt-gallery">' + imgs.map(u => "<img src='" + esc(u.replace(/'/g, '')) + "' loading='lazy'>").join('') + '</div>' : ''; }
  function thumbs(imgs) { return imgs.length > 0 ? '<div class="opt-thumbs">' + imgs.map(u => "<img src='" + esc(u.replace(/'/g, '')) + "' loading='lazy'>").join('') + '</div>' : ''; }
  if (active) {
    let btns = parsed.map(p => {
      const selected = hasVoted === p.key;
      const count = v.counts?.[p.key] || 0;
      const optJs = esc(p.key).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return '<button class="vote-btn choice' + (selected ? ' voted' : '') + '" onclick="castVote(\'' + esc(v.id) + '\',\'' + optJs + '\')"' + (hasVoted ? ' disabled' : '') + '>' + imgGrid(p.imgs) + '<span>' + esc(p.label) + (total > 0 ? ' (' + count + ')' : '') + '</span></button>';
    }).join('');
    return '<div class="vote-card" id="vote-' + esc(v.id) + '"><div class="vote-title">' + esc(v.title) + '</div>' + (v.description ? '<div class="vote-desc">' + formatDesc(v.description) + '</div>' : '') + '<div class="vote-actions" style="flex-direction:column;">' + btns + '</div>' + (total > 0 ? parsed.map(p => { const pct = total > 0 ? ((v.counts?.[p.key] || 0) / total * 100).toFixed(0) : 0; return '<div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem;font-size:.85rem;"><span style="min-width:4rem;opacity:.7;">' + esc(p.label) + '</span><div style="flex:1;height:6px;border-radius:3px;background:rgba(160,175,190,.06);overflow:hidden;"><div style="width:' + pct + '%;height:100%;border-radius:3px;background:#5ab0e0;transition:width .3s;"></div></div><span style="min-width:2.5rem;text-align:right;opacity:.5;font-size:.8rem;">' + pct + '%</span></div>'; }).join('') : '') + '<div class="vote-meta"><span>' + esc((v.date || '').split('T')[0]) + '</span><span>' + (v.deadline ? '截止 ' + esc(v.deadline) : '') + (total > 0 ? ' · ' + total + ' 票' : '') + '</span></div></div>';
  }
  let maxCount = 0, winnerKey = '', draw = false;
  for (const p of parsed) { const c = v.counts?.[p.key] || 0; if (c > maxCount) maxCount = c; }
  const winners = parsed.filter(p => (v.counts?.[p.key] || 0) === maxCount && maxCount > 0);
  if (winners.length === 1) winnerKey = winners[0].key;
  if (winners.length > 1 && total > 0) draw = true;
  const winLabel = winners.length === 1 ? winners[0].label : '';
  const resultLabel = winLabel ? '✓' + esc(winLabel) : draw ? '—平局' : '';
  return '<div class="vote-card" id="vote-' + esc(v.id) + '"><div class="vote-title">' + esc(v.title) + '</div><div class="vote-result-badge' + (winLabel ? ' result-choice' : '') + (draw ? ' result-draw' : '') + '">' + resultLabel + '</div>' + (v.description ? '<div class="vote-desc">' + formatDesc(v.description) + '</div>' : '') + (total > 0 ? parsed.map(p => { const pct = ((v.counts?.[p.key] || 0) / total * 100).toFixed(0); const isWinner = p.key === winnerKey && !draw; return '<div class="vote-result' + (isWinner ? ' win-choice' : '') + '" style="flex-direction:column;align-items:stretch;gap:.3rem;"><div style="display:flex;align-items:center;justify-content:space-between;"><span>' + thumbs(p.imgs) + esc(p.label) + ' <span class="vote-pct">' + (v.counts?.[p.key] || 0) + ' 票</span></span><span style="opacity:.6;">' + pct + '%</span></div></div>'; }).join('') : '<div style="opacity:.3;text-align:center;padding:.5rem 0;">暂无投票</div>') + '<div class="vote-meta"><span>' + esc((v.date || '').split('T')[0]) + '</span><span>' + (total > 0 ? total + ' 票' : '') + '</span></div></div>';
}

async function loadVotes() {
  const container = document.getElementById('voteContainer');
  try {
    const resp = await fetchApi('/api/votes');
    const data = await resp.json();
    if (!data.success || !data.votes || data.votes.length === 0) {
      container.innerHTML = '<div class="server-status-card" style="text-align:center;padding:3rem;"><div style="opacity:0.3;">暂无投票</div></div>';
      return;
    }

    const today = (function(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    data.votes.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const activeVotes = data.votes.filter(v => v.active && (!v.deadline || v.deadline >= today));
    const historyVotes = data.votes.filter(v => !v.active || (v.deadline && v.deadline < today));

    // 搜索结果深链接或没有进行中的投票时，自动展开历史
    if (location.hash && location.hash.startsWith('#vote-')) showHistory = true;
    if (activeVotes.length === 0 && historyVotes.length > 0) showHistory = true;

    let html = '';

    if (activeVotes.length > 0 || historyVotes.length > 0) {
      html += '<div class="vote-section-header">';
      if (activeVotes.length > 0) html += '<span>进行中的投票</span>';
      if (historyVotes.length > 0 && activeVotes.length > 0) {
        // 有进行中的才显示折叠按钮
        html += '<button onclick="toggleHistory()" class="history-toggle" id="historyToggleBtn">📜 历史投票 <span id="historyCount">' + historyVotes.length + '</span></button>';
      } else if (historyVotes.length > 0 && activeVotes.length === 0) {
        html += '<span style="opacity:.5;">📜 历史投票</span>';
      }
      html += '</div>';
    }

    for (const v of activeVotes) {
      html += v.type === 'choice' ? renderChoiceCard(v, true) : renderAgreeCard(v, true);
    }

    if (historyVotes.length > 0) {
      html += '<div id="historySection" style="display:' + (showHistory ? 'block' : 'none') + ';">';
      html += '<div class="history-divider">📜 历史投票</div>';
      for (const v of historyVotes) {
        html += v.type === 'choice' ? renderChoiceCard(v, false) : renderAgreeCard(v, false);
      }
      html += '</div>';
    }

    container.innerHTML = html;
    // 深链接：从搜索结果带 #vote-id 跳转时，滚动到对应投票并高亮
    if (location.hash && location.hash.startsWith('#vote-')) {
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
  } catch (e) {
    console.error('[投票] 加载失败:', e);
    container.innerHTML = '<div class="server-status-card" style="text-align:center;padding:3rem;"><div style="opacity:0.3;">加载失败</div></div>';
  }
}

function toggleHistory() {
  showHistory = !showHistory;
  const section = document.getElementById('historySection');
  const btn = document.getElementById('historyToggleBtn');
  if (section) section.style.display = showHistory ? 'block' : 'none';
  if (btn) btn.style.borderColor = showHistory ? 'rgba(90,176,224,.3)' : '';
}

async function castVote(id, option) {
  try {
    const resp = await fetchApi('/api/votes/' + id + '/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option }),
    });
    const data = await resp.json();
    if (data.success) {
      loadVotes();
    } else {
      alert(data.error || '投票失败');
    }
  } catch {
    alert('网络错误');
  }
}

loadVotes();
