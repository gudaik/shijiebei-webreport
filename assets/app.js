const state = { data: null, allMatches: [], exporting: false, autoRefreshTimer: null, chartInstance: null, betChartInstance: null, countdownTimer: null };
const $ = (id) => document.getElementById(id);

function fmtDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}
function scoreText(m){ return m.home_score === null || m.away_score === null ? 'vs' : `${m.home_score}-${m.away_score}`; }
function empty(text){ return `<div class="empty">${text}</div>`; }
function rowLogo(url, name){ return url ? `<img class="row-logo" src="${esc(url)}" alt="${esc(name)}" loading="lazy" onerror="this.style.display='none'">` : ''; }
function matchRowCls(m){
  if(m.completed) return 'completed-row';
  const isLive = m.status && !['Scheduled','Pre Game','TBD',''].includes(m.status || '');
  if(isLive) return 'live-row';
  const msTil = new Date(m.date_bj).getTime() - Date.now();
  if(msTil <= 0) return 'live-row';
  if(msTil < 2 * 3600 * 1000) return 'soon-row';
  return 'upcoming-row';
}
function matchHalfFullDetail(m){
  if(!m.half_time_score || !m.half_full){
    const pendingText = m.completed ? '半场比分源更新后显示' : (matchRowCls(m) === 'live-row' ? '比赛结束后统计' : '待赛');
    return `<div class="match-hf pending"><span>半全场</span><b>待统计</b><em>${pendingText}</em></div>`;
  }
  const ht = esc(m.half_time_score);
  const sh = esc(m.second_half_score || '—');
  const ft = esc(scoreText(m));
  return `<div class="match-hf">
    <span>半全场</span><b>${esc(m.half_full)}</b><em>半 ${ht} · 下 ${sh} · 全 ${ft}</em>
  </div>`;
}
function matchRow(m){
  const score = scoreText(m);
  const cls = matchRowCls(m);
  const isLive = cls === 'live-row';
  const scoreClass = score === 'vs' ? 'badge' : isLive ? 'score live-score' : 'score';
  return `<div class="match-row ${cls}">
    <div class="time">${fmtDateTime(m.date_bj)}${isLive ? ' <span class="live-pip"></span>' : ''}</div>
    <div class="row-info">
      <div class="teams">${rowLogo(m.home_logo,m.home_zh)}${esc(m.home_zh)} <span class="mini">vs</span> ${esc(m.away_zh)}${rowLogo(m.away_logo,m.away_zh)}</div>
      <div class="meta">${esc(m.status)}${m.status_detail ? ' · '+esc(m.status_detail) : ''} · ${esc(m.venue || '场地待核实')}</div>
      ${matchHalfFullDetail(m)}
    </div>
    <div class="${scoreClass}">${score}</div>
  </div>`;
}
function renderList(id, rows, fallback){ $(id).innerHTML = rows.length ? rows.map(matchRow).join('') : empty(fallback); }
function pct(v){ return v === null || v === undefined ? '待统计' : `${v}%`; }
function esc(v){ return String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function normScore(s){ return String(s || '').replace(/[：:]/g,'-').replace(/\s+/g,'').trim(); }
function scoreChips(scores, actualScore){
  const actual = normScore(actualScore);
  const list = Array.isArray(scores) ? scores : [];
  if(!list.length) return '<span class="score-chip muted">无预测比分</span>';
  return list.map((s, idx)=>{
    const hit = actual && normScore(s) === actual;
    return `<span class="score-chip predicted ${hit ? 'hit-score' : ''}" title="预测比分${idx+1}">${esc(s)}</span>`;
  }).join('');
}
function actualScoreChip(score, exactHit){
  const ready = score && score !== '待';
  return `<span class="score-chip actual ${exactHit ? 'hit-score' : ''} ${ready ? '' : 'muted'}" title="实际比分">${esc(ready ? score : '待赛')}</span>`;
}
function normHalfFull(s){ return String(s || '').replace(/\s+/g,'').replace(/[＋+]/g,'+').trim(); }
function halfFullChips(items, actualHalfFull){
  const actual = normHalfFull(actualHalfFull);
  const list = Array.isArray(items) ? items : [];
  if(!list.length) return '<span class="score-chip hf-chip muted">无半全场预测</span>';
  return list.map((s, idx)=>{
    const hit = actual && normHalfFull(s) === actual;
    return `<span class="score-chip hf-chip predicted ${hit ? 'hit-score' : ''}" title="半全场预测${idx+1}">${esc(s)}</span>`;
  }).join('');
}
function actualHalfFullChip(actualHalfFull, hit){
  const ready = actualHalfFull && actualHalfFull !== '待';
  return `<span class="score-chip hf-chip actual ${hit === true ? 'hit-score' : ''} ${ready ? '' : 'muted'}" title="实际半全场">${esc(ready ? actualHalfFull : '待统计')}</span>`;
}
function halfFullCompare(r){
  const h = r.hit || {}; const a = r.actual || {}; const p = r.prediction || {};
  return `<div class="score-compare hf-compare" aria-label="半全场预测与实际结果对照">
    <div class="score-side">
      <div class="score-label red-dot">预测半全场</div>
      <div class="score-chip-row">${halfFullChips(p.half_full, a.half_full)}</div>
    </div>
    <div class="score-arrow">→</div>
    <div class="score-side actual-side">
      <div class="score-label white-dot">实际半全场</div>
      <div class="score-chip-row">${actualHalfFullChip(a.half_full, h.half_full)}</div>
    </div>
  </div>`;
}
function outcomeBadge(label, ok){
  const cls = ok === true ? 'hit' : ok === false ? 'miss' : 'pending';
  return `<span class="result-badge ${cls}">${esc(label)}</span>`;
}
function parseScorePair(score){
  const m = String(score || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function halfFullScoreTable(r){
  const a = r.actual || {};
  const ht = parseScorePair(a.half_time_score);
  const ft = parseScorePair(a.score);
  if(!ht || !ft) return '';
  const sh = [ft[0] - ht[0], ft[1] - ht[1]];
  const parts = String(r.title || '').split(/\s+vs\s+/i);
  const home = parts[0] || r.home_zh || '主队';
  const away = parts[1] || r.away_zh || '客队';
  return `<div class="hf-score-card">
    <div class="hf-title">半全场比分详情</div>
    <div class="hf-grid hf-head"><div>队伍</div><div>上半场</div><div>下半场</div><div>总比分</div></div>
    <div class="hf-grid"><div class="hf-team">${esc(home)}</div><div>${ht[0]}</div><div>${sh[0]}</div><div>${ft[0]}</div></div>
    <div class="hf-grid"><div class="hf-team">${esc(away)}</div><div>${ht[1]}</div><div>${sh[1]}</div><div>${ft[1]}</div></div>
  </div>`;
}
function setupAutoRefresh(shouldRefresh){
  // 后台定时任务已取消：页面不再每 5 分钟轮询，只在用户点击“生成最新数据并刷新”时重新生成。
  if(state.autoRefreshTimer){ clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
}
function renderLiveStatsNotice(data){
  const st = data.stats || {}; const today = data.dates?.today; const yesterday = data.dates?.yesterday;
  // For an in-progress day, show the audit trail from yesterday's report:
  // yesterday's predictions for today's matches + today's matches that already have results.
  const isYesterdayPrediction = r => !yesterday || r.source_report_date === yesterday;
  const pendingToday = (st.pending || []).filter(r => r.date === today && isYesterdayPrediction(r));
  const todayCompleted = (st.recent || []).filter(r => r.date === today && isYesterdayPrediction(r)).length;
  const todayTotal = todayCompleted + pendingToday.length;
  const names = pendingToday.slice(0,3).map(r => `${r.time || ''} ${r.title || ''}`.trim()).filter(Boolean);
  const extra = pendingToday.length > 3 ? ` 等 ${pendingToday.length} 场` : names.join('、');
  if(todayTotal && pendingToday.length){
    $('liveStatsNotice').innerHTML = `<div class="live-dot"></div><div><strong>${today} 的预测赛果正在结算中</strong><p>当前已出结果 ${todayCompleted}/${todayTotal} 场，还有 ${pendingToday.length} 场没出结果${extra ? `：${esc(extra)}` : ''}。后台定时刷新已取消；需要最新结果时，请点击页面右上角“生成最新数据并刷新”。</p></div>`;
    setupAutoRefresh(true);
  }else if(todayTotal){
    $('liveStatsNotice').innerHTML = `<div class="live-dot done"></div><div><strong>${today} 的预测赛果已全部结算</strong><p>今日 ${todayCompleted}/${todayTotal} 场已出结果，命中率已按最新完赛比分统计。</p></div>`;
    setupAutoRefresh(false);
  }else{
    $('liveStatsNotice').innerHTML = `<div class="live-dot"></div><div><strong>暂无今日已结算预测</strong><p>如果今日比赛尚未开始或报告中没有对应预测，完赛后会在这里显示统计进度。</p></div>`;
    setupAutoRefresh(Boolean(st.pending_total));
  }
}

function renderNextCountdown(data){
  const el = $('nextMatchCountdown');
  if(!el) return;
  if(state.countdownTimer){ clearInterval(state.countdownTimer); state.countdownTimer = null; }
  const all = (data.sections.all_known_matches || []);
  const now = Date.now();
  const next = all.filter(m => !m.completed && new Date(m.date_bj).getTime() > now)
                   .sort((a,b) => new Date(a.date_bj) - new Date(b.date_bj))[0];
  if(!next){ el.innerHTML = ''; return; }
  const target = new Date(next.date_bj).getTime();
  function tick(){
    const diff = target - Date.now();
    if(diff <= 0){
      el.innerHTML = `<span class="cd-live">⚽ ${esc(next.home_zh)} vs ${esc(next.away_zh)} 比赛可能已开始</span>`;
      clearInterval(state.countdownTimer); state.countdownTimer = null; return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const timeStr = (h ? `${h}时` : '') + `${m}分${String(s).padStart(2,'0')}秒`;
    el.innerHTML = `<span class="cd-label">距下一场</span><span class="cd-teams">${esc(next.home_zh)} vs ${esc(next.away_zh)}</span><span class="cd-time">${timeStr}</span>`;
  }
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}
function renderSummary(data){
  const s = data.summary;
  $('generatedAt').textContent = data.generated_at_label;
  $('sourceLink').innerHTML = `<a href="${esc(data.source.url)}" target="_blank" rel="noopener">ESPN 数据源</a>`;
  $('summaryCards').innerHTML = [
    ['今日比赛', s.today_count, data.dates.today],
    ['明日比赛', s.tomorrow_count, data.dates.tomorrow],
    ['明天预测', s.prediction_count, data.dates.prediction_target],
  ].map(([label,num,hint])=>`<div class="summary-card"><div class="label">${label}</div><div class="num">${num}</div><div class="hint">${esc(hint)} 北京时间</div></div>`).join('');
  renderNextCountdown(data);
  renderList('yesterdayResults', data.sections.yesterday_results, '暂无昨日赛果。');
  renderList('todayMatches', data.sections.today_matches, '今日暂无已确认世界杯比赛。');
  renderList('tomorrowMatches', data.sections.tomorrow_matches, '明日暂无已确认世界杯比赛。');
}

function predConfidence(pred){
  const t=pred?.tendency||'';
  const sp=pred?.score_pairs?.[0];
  const diff=sp?Math.abs(sp[0]-sp[1]):0;
  if((t==='主胜'||t==='客胜')&&diff>=2) return {label:'优势明显',cls:'conf-high'};
  if(t.includes('防平')) return {label:'防平注意',cls:'conf-warn'};
  if(t.includes('平局')) return {label:'均势对决',cls:'conf-low'};
  return {label:'小胜倾向',cls:'conf-warn'};
}
function renderPredictions(data){
  const rows = data.sections.day_after_predictions || [];
  $('predictionTitle').textContent = `${data.dates.prediction_target} 明天${rows.length || ''}场预测（北京时间）`;
  $('predictionCards').innerHTML = rows.length ? rows.map((m, i)=>{
    const p = m.prediction;
    const odds = p.odds || {};
    const conf=predConfidence(p);
    const logoHtml=(url,name)=>url?`<img class="pred-logo" src="${esc(url)}" alt="${esc(name)}" loading="lazy" onerror="this.style.display='none'">`:`<div class="pred-logo-ph">${esc((name||'?').slice(0,2))}</div>`;
    return `<article class="prediction-card">
  <div class="prediction-head">
    <div>
      <div class="pred-header-row">
        <div class="label">第 ${i+1} 场 · ${fmtDateTime(m.date_bj)}</div>
        ${conf?`<span class="conf-badge ${conf.cls}">${conf.label}</span>`:''}
      </div>
      <div class="pred-teams-visual">
        ${logoHtml(m.home_logo,m.home_zh)}
        <h3>${esc(m.home_zh)} <span class="vs-mini">vs</span> ${esc(m.away_zh)}</h3>
        ${logoHtml(m.away_logo,m.away_zh)}
      </div>
      <div class="meta">${esc(m.note||'世界杯')} · ${esc(m.venue)}</div>
    </div>
    <div class="badge">${esc(m.status)}</div>
  </div>
  <p class="tendency">胜平负倾向：${esc(p.tendency)}</p>
  <div class="label">${(p.scores||[]).length || 4}个比分预测</div><div class="pill-row">${(p.scores||[]).map(x=>oddsPill(x)).join('')}</div>
  ${Array.isArray(p.upset_scores) && p.upset_scores.length ? `<div class="upset-score-block"><div class="label">防爆冷比分小选项</div><div class="pill-row upset-row">${p.upset_scores.map(x=>oddsPill(x)).join('')}</div><div class="upset-note">小注防冷：用于补平局/反向小胜等冷门比分，不改变主预测方向。</div></div>` : ''}
  <div class="label">${(p.half_full||[]).length || 4}个半全场预测</div><div class="pill-row hf">${(p.half_full||[]).map(x=>oddsPill(x)).join('')}</div>
  ${Array.isArray(p.upset_half_full) && p.upset_half_full.length ? `<div class="upset-score-block upset-hf-block"><div class="label">防爆冷半全场小选项</div><div class="pill-row upset-row hf">${p.upset_half_full.map(x=>oddsPill(x)).join('')}</div><div class="upset-note">小注防冷：用于补慢热、反转或弱队爆冷走势，不改变主半全场预测方向。</div></div>` : ''}
  <p class="analysis">${esc(p.analysis)}</p>
  <a href="${esc(m.link)}" target="_blank" rel="noopener">ESPN 比赛页</a>
</article>`;
  }).join('') : empty('明天暂未检索到可确认比赛，数据源更新后会自动显示。');
}

function renderUpsets(data){
  const st = data.stats?.upset || {};
  const rows = data.sections?.day_after_predictions || [];
  const cards = [
    ['爆冷综合命中率', pct(st.rate), `${st.hits ?? 0}/${st.total ?? 0} 场`],
    ['防冷比分命中率', pct(st.score_rate), `${st.score_hits ?? 0}/${st.score_total ?? 0}`],
    ['防冷半全场命中率', pct(st.half_full_rate), `${st.half_full_hits ?? 0}/${st.half_full_total ?? 0}`],
  ];
  $('upsetStatCards').innerHTML = cards.map(([label,num,hint])=>`<div class="stat-card upset-stat"><div class="label">${label}</div><div class="num">${num}</div><div class="hint">${hint}</div></div>`).join('');
  $('upsetStatsNote').textContent = st.note || '爆冷命中率只统计包含防爆冷选项的已结算比赛。';
  $('upsetCards').innerHTML = rows.length ? rows.map((m,i)=>{
    const p=m.prediction||{}; const odds=p.odds||{};
    const scoreMax = Math.max(...(p.upset_scores||[]).map(x=>Number(odds.upset_scores?.[x]||0)), 0);
    const hfMax = Math.max(...(p.upset_half_full||[]).map(x=>Number(odds.upset_half_full?.[x]||0)), 0);
    return `<article class="upset-card">
      <div class="upset-card-head"><span>第 ${i+1} 场 · ${fmtDateTime(m.date_bj)}</span><b>${esc(m.home_zh)} vs ${esc(m.away_zh)}</b></div>
      <div class="upset-mainline">主方向：${esc(p.tendency || p.primary_outcome || '待')}</div>
      <div class="upset-pick-block"><div class="label">防爆冷比分</div><div class="pill-row upset-row">${(p.upset_scores||[]).map(x=>oddsPill(x)).join('') || '<span class="score-chip muted">暂无</span>'}</div></div>
      <div class="upset-pick-block"><div class="label">防爆冷半全场</div><div class="pill-row upset-row hf">${(p.upset_half_full||[]).map(x=>oddsPill(x)).join('') || '<span class="score-chip muted">暂无</span>'}</div></div>
      <div class="upset-risk-line">建议只作小注防冷观察，不改变主预测方向。</div>
    </article>`;
  }).join('') : empty('暂无可展示的爆冷预测。');
  const byDate = (st.by_date || []).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  $('upsetDateBars').innerHTML = byDate.length ? byDate.map(d=>`<div class="bar-row rich upset-bar">
    <div class="bar-date"><strong>${esc(d.date)}</strong><span>${d.total} 场</span></div>
    <div class="bar-metric"><span>综合 ${d.combo_hits}/${d.total}</span><div class="track"><div class="fill hf-fill" style="width:${d.combo_rate ?? 0}%"></div></div><b>${d.combo_rate == null ? '待' : `${d.combo_rate}%`}</b></div>
    <div class="bar-metric"><span>比分 ${d.score_hits}/${d.score_total}</span><div class="track"><div class="fill score-fill" style="width:${d.score_rate ?? 0}%"></div></div><b>${d.score_rate == null ? '待' : `${d.score_rate}%`}</b></div>
    <div class="bar-metric"><span>半全场 ${d.half_full_hits}/${d.half_full_total}</span><div class="track"><div class="fill outcome" style="width:${d.half_full_rate ?? 0}%"></div></div><b>${d.half_full_rate == null ? '待' : `${d.half_full_rate}%`}</b></div>
  </div>`).join('') : empty('暂无已结算的爆冷预测统计；后续含防爆冷字段的比赛完赛后自动累计。');
  $('upsetRecent').innerHTML = (st.recent || []).length ? (st.recent || []).map(r=>{
    const p=r.prediction||{}; const a=r.actual||{}; const u=r.upset_hit||{};
    return `<article class="settled-card upset-audit-card ${u.any ? 'settled-hit' : ''}">
      <div class="settled-main"><div class="time">${esc((r.date_bj||'').slice(5,16).replace('T',' '))}</div><div><div class="teams">${esc(r.title)}</div><div class="meta">实际：${esc(a.score||'待')} · 半全场 ${esc(a.half_full||'待统计')}</div></div></div>
      <div class="score-compare hf-compare"><div class="score-side"><div class="score-label red-dot">防冷比分</div><div class="score-chip-row">${scoreChips(p.upset_scores, a.score)}</div></div><div class="score-arrow">→</div><div class="score-side actual-side"><div class="score-label white-dot">实际比分</div><div class="score-chip-row">${actualScoreChip(a.score, u.score)}</div></div></div>
      <div class="score-compare hf-compare"><div class="score-side"><div class="score-label red-dot">防冷半全场</div><div class="score-chip-row">${halfFullChips(p.upset_half_full, a.half_full)}</div></div><div class="score-arrow">→</div><div class="score-side actual-side"><div class="score-label white-dot">实际半全场</div><div class="score-chip-row">${actualHalfFullChip(a.half_full, u.half_full)}</div></div></div>
      <div class="stat-outcomes">${outcomeBadge(`爆冷综合${u.any ? '命中' : '未中'}`, u.any)}${outcomeBadge(`防冷比分${u.score ? '命中' : '未中'}`, u.score)}${outcomeBadge(a.half_full ? `防冷半全场${u.half_full ? '命中' : '未中'}` : '半全场待统计', a.half_full ? u.half_full : null)}</div>
    </article>`;
  }).join('') : empty('暂无已结算爆冷预测。');
}

function settledCard(r){
  const h = r.hit || {}; const a = r.actual || {}; const p = r.prediction || {};
  const exact = h.exact_score === true;
  const outcomeKnown = h.outcome === true || h.outcome === false;
  return `<article class="settled-card ${exact ? 'settled-hit' : ''}">
    <div class="settled-main">
      <div class="time">${esc((r.date_bj||'').slice(5,16).replace('T',' '))}</div>
      <div>
        <div class="teams">${esc(r.title)}</div>
        <div class="meta">来源：${esc(r.source_file_name || 'reports')} · ${esc(r.status_detail || r.status || '已结算')}</div>
      </div>
    </div>
    <div class="score-compare" aria-label="预测比分与实际比分对照">
      <div class="score-side">
        <div class="score-label red-dot">预测比分</div>
        <div class="score-chip-row">${scoreChips(p.scores, a.score)}</div>
      </div>
      <div class="score-arrow">→</div>
      <div class="score-side actual-side">
        <div class="score-label white-dot">实际比分</div>
        <div class="score-chip-row">${actualScoreChip(a.score, exact)}</div>
      </div>
    </div>
    <div class="stat-outcomes">
      ${outcomeBadge(`比分${exact ? '命中' : '未中'}`, exact)}
      ${outcomeBadge(`胜平负：${p.primary_outcome || '待'} → ${a.outcome || '待'}`, outcomeKnown ? h.outcome : null)}
      ${outcomeBadge(a.half_full ? `半全场：${a.half_full}` : '半全场待统计', h.half_full)}
    </div>
    ${halfFullCompare(r)}
    ${halfFullScoreTable(r)}
  </article>`;
}
function renderSettledGroups(rows, fallback){
  if(!rows || !rows.length) return empty(fallback || '暂无统计。');
  const groups = rows.reduce((acc, r)=>{
    const key = r.date || String(r.date_bj || '').slice(0,10) || '未标日期';
    (acc[key] ||= []).push(r);
    return acc;
  }, {});
  return Object.entries(groups)
    .sort(([a],[b]) => String(b).localeCompare(String(a)))
    .map(([date, items])=>{
      const total = items.length;
      const scoreHits = items.filter(r => r.hit?.exact_score === true).length;
      const outcomeHits = items.filter(r => r.hit?.outcome === true).length;
      const hfHits = items.filter(r => r.hit?.half_full === true).length;
      return `<section class="settled-day-panel">
        <div class="settled-day-head">
          <div><div class="label">比赛日</div><h3>${esc(date)}</h3></div>
          <div class="settled-day-kpis">
            <span>共 ${total} 场</span><span>比分 ${scoreHits}/${total}</span><span>胜平负 ${outcomeHits}/${total}</span><span>半全场 ${hfHits}/${total}</span>
          </div>
        </div>
        <div class="settled-day-matches">${items.map(settledCard).join('')}</div>
      </section>`;
    }).join('');
}

function renderStats(data){
  const st = data.stats;
  const src = data.report_source || {};
  const noteEl = $('dateBarsNote');
  if(noteEl && src.windows_directory) noteEl.innerHTML = `统计从 <code>${esc(src.windows_directory)}</code> 下的 Markdown 预测报告开始，自动解析比分/胜平负/半全场预测，并与 ESPN 完赛比分核对。`;
  $('statCards').innerHTML = [
    ['预测审计总数', st.audited_predictions_total ?? st.report_predictions_total ?? 0, `来源：${src.windows_directory || st.source_label || 'reports'}；报告 ${st.report_predictions_total ?? 0} 条 / 自动历史 ${st.dashboard_history_predictions_total ?? 0} 条`],
    ['已结算场次', st.completed_total, `待结算 ${st.pending_total ?? 0} 场`],
    ['比分命中率', pct(st.exact_score_rate), `${st.exact_score_hits}/${st.completed_total}`],
    ['胜平负命中率', pct(st.outcome_rate), `${st.outcome_hits}/${st.completed_total}`],
    ['半全场命中率', pct(st.half_full_rate), `${st.half_full_hits ?? 0}/${st.half_full_total ?? 0}`],
  ].map(([label,num,hint])=>`<div class="stat-card"><div class="label">${label}</div><div class="num">${num}</div><div class="hint">${hint}</div></div>`).join('');
  renderLiveStatsNotice(data);
  const byDateDesc = (st.by_date || []).slice().sort((a,b)=>String(b.date || '').localeCompare(String(a.date || '')));
  $('dateBars').innerHTML = byDateDesc.length ? `<div class="source-note">${src.description || '命中率统计以本地 reports 报告为主数据源。'} 半全场：${st.half_full_note || '待统计'}</div>` + byDateDesc.map(d=>`<div class="bar-row rich">
    <div class="bar-date"><strong>${d.date}</strong><span>${d.total} 场</span></div>
    <div class="bar-metric"><span>胜平负 ${d.outcome_hits}/${d.total}</span><div class="track"><div class="fill outcome" style="width:${d.outcome_rate}%"></div></div><b>${d.outcome_rate}%</b></div>
    <div class="bar-metric"><span>比分 ${d.score_hits}/${d.total}</span><div class="track"><div class="fill score-fill" style="width:${d.score_rate}%"></div></div><b>${d.score_rate}%</b></div>
    <div class="bar-metric"><span>半全场 ${d.half_full_hits ?? 0}/${d.total ?? d.half_full_total ?? 0}${d.half_full_missing ? `（缺半场${d.half_full_missing}）` : ''}</span><div class="track"><div class="fill hf-fill" style="width:${d.half_full_rate ?? 0}%"></div></div><b>${d.half_full_rate == null ? '待' : `${d.half_full_rate}%`}</b></div>
  </div>`).join('') : empty('暂无已结算历史预测；reports 中的预测比赛完赛后会自动累计。');
  $('recentStats').innerHTML = renderSettledGroups(st.recent, st.half_full_note || '暂无统计。');
  renderAccuracyChart(data);
}

function betCategoryLabel(cat){
  return {main:'主线推荐', upset:'防爆冷推荐', parlay:'串关补充'}[cat] || cat || '未分类';
}
function renderBetStats(data){
  const st = data.bet_stats || {};
  const cards = $('betStatCards');
  if(cards){
    const cat = st.by_category || {}; const typ = st.by_type || {};
    cards.innerHTML = [
      ['购买推荐总命中率', pct(st.rate), `${st.hits ?? 0}/${st.settled_total ?? 0}，待结算 ${st.pending_total ?? 0} 项`],
      ['主线推荐命中率', pct(cat.main?.rate), `${cat.main?.hits ?? 0}/${cat.main?.total ?? 0}`],
      ['防爆冷推荐命中率', pct(cat.upset?.rate), `${cat.upset?.hits ?? 0}/${cat.upset?.total ?? 0}`],
      ['胜平负命中率', pct(typ['胜平负']?.rate), `${typ['胜平负']?.hits ?? 0}/${typ['胜平负']?.total ?? 0}`],
      ['比分推荐命中率', pct(typ['比分']?.rate), `${typ['比分']?.hits ?? 0}/${typ['比分']?.total ?? 0}`],
      ['半全场命中率', pct(typ['半全场']?.rate), `${typ['半全场']?.hits ?? 0}/${typ['半全场']?.total ?? 0}`],
    ].map(([label,num,hint])=>`<div class="stat-card"><div class="label">${label}</div><div class="num">${num}</div><div class="hint">${hint}</div></div>`).join('');
  }
  const note = $('betStatsNote');
  if(note) note.textContent = st.note || '每日自动记录购买推荐，完赛后逐项结算命中率。';
  const rows = (st.by_date || []).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const bars = $('betDateBars');
  if(bars){
    bars.innerHTML = rows.length ? rows.map(d=>`<div class="bar-row rich">
      <div class="bar-date"><strong>${esc(d.date || '')}</strong><span>${d.total || 0} 项${d.pending ? ` · 待${d.pending}` : ''}</span></div>
      <div class="bar-metric"><span>总体 ${d.hits || 0}/${d.total || 0}</span><div class="track"><div class="fill outcome" style="width:${d.rate || 0}%"></div></div><b>${d.rate == null ? '待' : `${d.rate}%`}</b></div>
      <div class="bar-metric"><span>主线 ${d.main?.hits || 0}/${d.main?.total || 0}</span><div class="track"><div class="fill hf-fill" style="width:${d.main?.rate || 0}%"></div></div><b>${d.main?.rate == null ? '待' : `${d.main.rate}%`}</b></div>
      <div class="bar-metric"><span>防冷 ${d.upset?.hits || 0}/${d.upset?.total || 0}</span><div class="track"><div class="fill score-fill" style="width:${d.upset?.rate || 0}%"></div></div><b>${d.upset?.rate == null ? '待' : `${d.upset.rate}%`}</b></div>
    </div>`).join('') : empty('暂无购买推荐结算记录；今天起会每天自动记录，完赛后显示趋势。');
  }
  const suggestions = $('betSuggestions');
  if(suggestions){
    suggestions.innerHTML = (st.suggestions || []).length ? (st.suggestions || []).map(x=>`<div class="match-row"><div class="row-info"><div class="teams">${esc(x)}</div></div></div>`).join('') : empty('样本不足，等待更多购买推荐结算后生成加强建议。');
  }
  const recent = $('betRecent');
  if(recent){
    recent.innerHTML = renderBetRecentGroups(st.recent || []);
  }
  renderBetAccuracyChart(data);
}

function renderBetRecentGroups(rows){
  if(!rows.length) return empty('暂无已结算购买推荐。');
  const dayGroups = {};
  rows.forEach(c=>{
    const d = c.record_date || '未分日期';
    (dayGroups[d] ||= []).push(c);
  });
  return Object.entries(dayGroups).sort((a,b)=>String(b[0]).localeCompare(String(a[0]))).map(([date,items])=>{
    const hits = items.filter(x=>x.hit).length;
    const matchGroups = groupBetItemsByMatch(items);
    return `<section class="bet-audit-day match-mode">
      <div class="bet-audit-day-head">
        <div><span>购买日</span><strong>${esc(date)}</strong></div>
        <div class="bet-audit-kpis">
          <b>场次 ${matchGroups.length}</b>
          <b>推荐项 ${items.length}</b>
          <b>命中 ${hits}/${items.length}</b>
        </div>
      </div>
      <div class="bet-match-audit-list">${matchGroups.map(renderBetMatchPanel).join('')}</div>
    </section>`;
  }).join('');
}

function groupBetItemsByMatch(items){
  const groups = new Map();
  items.forEach(c=>{
    if(c.leg_results && c.leg_results.length){
      const key = `__parlay__${c.title || c.pick || c.id}`;
      if(!groups.has(key)) groups.set(key, {title:c.title || '串关补充', type:'parlay', items:[]});
      groups.get(key).items.push(c);
      return;
    }
    const key = c.match_id || c.title || c.id || '未知场次';
    if(!groups.has(key)) groups.set(key, {title:c.title || '未知场次', type:'match', items:[]});
    groups.get(key).items.push(c);
  });
  return Array.from(groups.values()).sort((a,b)=>{
    const ap = a.type === 'parlay' ? 1 : 0;
    const bp = b.type === 'parlay' ? 1 : 0;
    if(ap !== bp) return ap - bp;
    return String(a.title).localeCompare(String(b.title), 'zh-CN');
  });
}

function renderBetMatchPanel(group){
  const items = group.items || [];
  const hits = items.filter(x=>x.hit).length;
  const first = items[0] || {};
  const actual = first.actual || {};
  const isParlay = group.type === 'parlay';
  const main = items.filter(x=>x.category === 'main');
  const upset = items.filter(x=>x.category === 'upset');
  const parlay = items.filter(x=>x.category === 'parlay');
  const resultText = isParlay ? renderBetLegSummary(first.leg_results || []) : `${esc(actual.score || '—')}${actual.outcome ? ` · ${esc(actual.outcome)}` : ''}${actual.half_full ? ` · 半全场 ${esc(actual.half_full)}` : ''}`;
  return `<article class="bet-match-audit-panel ${isParlay ? 'parlay' : ''} ${hits ? 'has-hit' : 'no-hit'}">
    <div class="bet-match-audit-head">
      <div>
        <div class="bet-match-audit-eyebrow">${isParlay ? '串关补充' : '单场核对'}</div>
        <h3>${esc(group.title || '')}</h3>
      </div>
      <div class="bet-match-audit-score">
        <span>实际结果</span>
        <strong>${resultText}</strong>
      </div>
      <div class="bet-match-audit-hit ${hits ? 'ok' : 'bad'}">
        <span>本场命中</span>
        <b>${hits}/${items.length}</b>
      </div>
    </div>
    <div class="bet-match-audit-sections">
      ${renderBetPickSection('主线预测', main, 'main')}
      ${renderBetPickSection('防爆冷预测', upset, 'upset')}
      ${renderBetPickSection('串关补充', parlay, 'parlay')}
    </div>
  </article>`;
}

function renderBetPickSection(title, items, kind){
  if(!items.length) return '';
  const hits = items.filter(x=>x.hit).length;
  return `<section class="bet-pick-section ${kind}">
    <div class="bet-pick-section-head"><strong>${esc(title)}</strong><span>${hits}/${items.length}</span></div>
    <div class="bet-pick-rows">${items.map(renderBetPickRow).join('')}</div>
  </section>`;
}

function renderBetPickRow(c){
  const hit = c.hit === true;
  const actual = c.leg_results ? renderBetLegSummary(c.leg_results) : renderBetActualInline(c.actual || {}, c.type);
  return `<div class="bet-pick-row ${hit ? 'is-hit' : 'is-miss'}">
    <div class="pick-type">${esc(c.type || c.play || '')}</div>
    <div class="pick-main"><span>预测</span><b>${esc(c.pick || '')}</b><em>${esc(c.reason || '')}</em></div>
    <div class="pick-vs">→</div>
    <div class="pick-actual"><span>命中详情</span><b>${actual}</b></div>
    <div class="pick-status">${hit ? '✓ 命中' : '× 未中'}</div>
  </div>`;
}

function renderBetActualInline(actual, type){
  if(!actual || (!actual.score && !actual.half_full && !actual.outcome)) return '—';
  if(type === '胜平负') return esc(actual.outcome || '—');
  if(type === '半全场') return esc(actual.half_full || '待统计');
  return `${esc(actual.score || '—')}${actual.half_full ? ` · ${esc(actual.half_full)}` : ''}`;
}

function renderBetLegSummary(legs){
  return (legs || []).map(leg=>`<em class="leg ${leg.hit ? 'ok' : 'bad'}">${esc(leg.title || '')} ${esc(leg.pick || '')} ${leg.hit ? '✓' : '×'}</em>`).join('') || '—';
}

function outcomeShort(pred){
  const raw = String(pred?.primary_outcome || pred?.tendency || '');
  if(raw.includes('客胜')) return '负';
  if(raw.includes('平')) return '平';
  return '胜';
}
function betPlanConfig(risk){
  return {
    safe: { label:'稳健型', desc:'优先覆盖胜平负主方向，少量比分和半全场防冷，尽量降低波动。', weights:{outcome:1.55, score:0.55, halfFull:0.35, parlay:0.25}, maxScores:1, maxHalfFull:1 },
    balanced: { label:'平衡型', desc:'胜平负做底仓，比分/半全场做增强，再加入少量2串1提升回报。', weights:{outcome:1.15, score:0.75, halfFull:0.62, parlay:0.75}, maxScores:2, maxHalfFull:1 },
    aggressive: { label:'激进型', desc:'增加比分、半全场和串关占比，追求更高回报，但命中难度明显上升。', weights:{outcome:0.72, score:0.95, halfFull:0.9, parlay:1.05}, maxScores:2, maxHalfFull:2 }
  }[risk] || betPlanConfig('balanced');
}
function playTypeLabel(playType){
  return {all:'全部玩法', outcome:'胜平负', score:'比分', halfFull:'半全场'}[playType] || '全部玩法';
}
function betModeConfig(mode){
  return {
    standard: { label:'常规均衡', desc:'主方向打底，少量比分/半全场增强。', scoreDepth:2, hfDepth:1, upsetCount:0, parlayDepth:3, parlayBoost:1, longshotBias:1 },
    upset: { label:'博冷防平', desc:'增加平局/反向胜平负小注，适合防冷门。', scoreDepth:2, hfDepth:1, upsetCount:1, parlayDepth:3, parlayBoost:1.08, longshotBias:1.15 },
    scoreBomb: { label:'比分高赔', desc:'优先覆盖首选+次选比分，小额博精确比分。', scoreDepth:3, hfDepth:1, upsetCount:0, parlayDepth:3, parlayBoost:1.15, longshotBias:1.35 },
    halfFullBomb: { label:'半全场高赔', desc:'增加半全场次选，适合看走势反转/慢热。', scoreDepth:1, hfDepth:3, upsetCount:0, parlayDepth:3, parlayBoost:1.18, longshotBias:1.35 },
    ladder: { label:'串关阶梯', desc:'保留单关，同时给2串1/3串1/4串1阶梯小注。', scoreDepth:2, hfDepth:2, upsetCount:0, parlayDepth:4, parlayBoost:1.45, longshotBias:1.25 },
    moonshot: { label:'极限以小博大', desc:'压低底仓，集中比分、半全场、4-6场串关。', scoreDepth:3, hfDepth:3, upsetCount:1, parlayDepth:6, parlayBoost:2.2, longshotBias:1.75 }
  }[mode] || betModeConfig('standard');
}
function fmtOdds(v){
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
function normalizeOutcomePick(pick){
  const raw = String(pick || '');
  if(raw.includes('负') || raw.includes('客胜')) return '负';
  if(raw.includes('平')) return '平';
  if(raw.includes('胜') || raw.includes('主胜')) return '胜';
  return '';
}
function outcomeCode(pred){
  const raw = String(pred?.primary_outcome || pred?.tendency || '');
  if(raw.includes('客胜')) return '负';
  if(raw.includes('平')) return '平';
  return '胜';
}
function candidateOdds(match, type, pick){
  const odds = match?.prediction?.odds || {};
  if(type === '胜平负') return odds.outcome?.[normalizeOutcomePick(pick) || outcomeCode(match?.prediction)];
  if(type === '比分') return odds.scores?.[pick] ?? odds.upset_scores?.[pick];
  if(type === '半全场') return odds.half_full?.[pick] ?? odds.upset_half_full?.[pick];
  return null;
}
function oddsBadge(v){
  return '';
}
function oddsPill(label, v){
  return `<span class="pill odds-pill"><span>${esc(label)}</span></span>`;
}
function estimatedReturn(c){
  const n = Number(c?.odds);
  return Number.isFinite(n) ? (c.units * 2 * n).toFixed(1) : '—';
}
function parlayOddsFromLegs(legs){
  const vals = (legs || []).map(x=>Number(x)).filter(Number.isFinite);
  return vals.length ? Number(vals.reduce((a,b)=>a*b,1).toFixed(2)) : null;
}
function sortedByOdds(items, getOdds, desc=true){
  return [...items].sort((a,b)=> desc ? Number(getOdds(b)||0)-Number(getOdds(a)||0) : Number(getOdds(a)||0)-Number(getOdds(b)||0));
}
function buildBetCandidates(matches, risk, parlayMode, passType, playType='all', betMode='standard'){
  const cfg = betPlanConfig(risk);
  const mode = betModeConfig(betMode);
  const candidates = [];
  const rows = (matches || []);
  const useOutcome = playType === 'all' || playType === 'outcome';
  const useScore = playType === 'all' || playType === 'score';
  const useHalfFull = playType === 'all' || playType === 'halfFull';
  const scoreDepth = Math.max(cfg.maxScores || 1, mode.scoreDepth || 1);
  const hfDepth = Math.max(cfg.maxHalfFull || 1, mode.hfDepth || 1);
  const isLongshot = ['upset','scoreBomb','halfFullBomb','ladder','moonshot'].includes(betMode);
  rows.forEach((m, idx)=>{
    const p = m.prediction || {}; const title = `${m.home_zh} vs ${m.away_zh}`;
    const confidence = p.primary_outcome === '主胜' ? 1.08 : p.primary_outcome === '客胜' ? 0.96 : 0.86;
    const matchNo = `周${'日一二三四五六'[new Date(m.date_bj).getDay()]}${String(idx+1).padStart(3,'0')}`;
    const primaryPick = p.primary_outcome || p.tendency || outcomeShort(p);
    const primaryCode = outcomeCode(p);
    if(useOutcome){
      const baseWeight = cfg.weights.outcome * confidence * (betMode === 'moonshot' ? 0.42 : 1);
      candidates.push({type:'胜平负', play:'单关', title, matchNo, matchIndex:idx, pick:primaryPick, odds:candidateOdds(m, '胜平负', primaryPick), weight:baseWeight, reason:'作为主预测方向，适合承担基础仓位。'});
      const outcomeOdds = m.prediction?.odds?.outcome || {};
      sortedByOdds(['胜','平','负'].filter(x=>x!==primaryCode), x=>outcomeOdds[x]).slice(0, mode.upsetCount || 0).forEach((code,j)=>{
        const label = code === '胜' ? '主胜' : code === '负' ? '客胜' : '平局';
        candidates.push({type:'胜平负', play:'单关', title, matchNo, matchIndex:idx, pick:`防冷${label}`, odds:outcomeOdds[code], weight:cfg.weights.outcome * 0.32 * mode.longshotBias / (j+1), reason:'小注防冷门方向，命中率低但回报弹性更高。'});
      });
    }
    if(useScore) (p.scores || []).slice(0,scoreDepth).forEach((s, j)=>{
      const boost = betMode === 'scoreBomb' || betMode === 'moonshot' ? mode.longshotBias : 1;
      candidates.push({type:'比分', play:'单关', title, matchNo, matchIndex:idx, pick:s, odds:candidateOdds(m, '比分', s), weight:cfg.weights.score * boost * (j ? 0.62/(j+0.15) : 1), reason:j ? '高赔比分小额覆盖，适合以小博大。' : '首选比分，用于提高潜在回报。'});
    });
    if(useScore) (p.upset_scores || []).slice(0, Math.max(1, Math.min(2, mode.upsetCount || 1))).forEach((s, j)=>{
      const odds = p.odds?.upset_scores?.[s] ?? candidateOdds(m, '比分', s);
      candidates.push({type:'比分', play:'单关', title, matchNo, matchIndex:idx, pick:`防冷比分 ${s}`, odds, weight:cfg.weights.score * 1.05 * mode.longshotBias / (j+1), reason:'防爆冷比分小注，补平局或反向小胜，命中率低但回报弹性高。'});
    });
    if(useHalfFull) (p.half_full || []).slice(0,hfDepth).forEach((h, j)=>{
      const boost = betMode === 'halfFullBomb' || betMode === 'moonshot' ? mode.longshotBias : 1;
      candidates.push({type:'半全场', play:'单关', title, matchNo, matchIndex:idx, pick:h, odds:candidateOdds(m, '半全场', h), weight:cfg.weights.halfFull * boost * (j ? 0.58/(j+0.15) : 1), reason:j ? '半全场高赔小注，搏走势变化。' : '半全场主选，配合比分方向。'});
    });
    if(useHalfFull) (p.upset_half_full || []).slice(0, Math.max(1, Math.min(2, mode.upsetCount || 1))).forEach((h, j)=>{
      const odds = p.odds?.upset_half_full?.[h] ?? candidateOdds(m, '半全场', h);
      candidates.push({type:'半全场', play:'单关', title, matchNo, matchIndex:idx, pick:`防冷半全场 ${h}`, odds, weight:cfg.weights.halfFull * 1.20 * mode.longshotBias / (j+1), reason:'防爆冷半全场小注，覆盖慢热、反转或弱队爆冷走势。'});
    });
  });
  const allowParlay = parlayMode === 'parlay' || (parlayMode === 'auto' && (risk !== 'safe' || isLongshot));
  const selectedSamePick = (m, depthIdx=0) => {
    const p = m.prediction || {};
    if(playType === 'score') return `${m.home_zh} ${p.scores?.[depthIdx] || p.scores?.[0] || '首选比分'}`;
    if(playType === 'halfFull') return `${m.home_zh} ${p.half_full?.[depthIdx] || p.half_full?.[0] || '半全场主选'}`;
    return `${m.home_zh}${outcomeShort(p)}`;
  };
  const selectedSameOdds = (m, depthIdx=0) => {
    const p = m.prediction || {};
    if(playType === 'score') return candidateOdds(m, '比分', p.scores?.[depthIdx] || p.scores?.[0]);
    if(playType === 'halfFull') return candidateOdds(m, '半全场', p.half_full?.[depthIdx] || p.half_full?.[0]);
    return candidateOdds(m, '胜平负', p.primary_outcome || outcomeShort(p));
  };
  const selectedSameType = playType === 'score' ? '比分' : playType === 'halfFull' ? '半全场' : '胜平负';
  const pushParlay = (play, title, pick, legs, weight, reason) => {
    const odds = parlayOddsFromLegs(legs);
    if(odds) candidates.push({type:title.includes('混合')?'混合过关':'同种过关', play, title, pick, odds, weight, reason});
  };
  if(allowParlay && rows.length >= 2){
    if(passType === 'mixed' && playType === 'all'){
      const m1 = rows[0], m2 = rows[1];
      const p2 = m2.prediction || {};
      const leg1 = `胜平负 ${m1.home_zh}${outcomeShort(m1.prediction)}`;
      const leg2 = `比分 ${m2.home_zh} ${p2.scores?.[0] || outcomeShort(p2)}`;
      pushParlay('2串1','混合过关组合',`${leg1} × ${leg2}`,[candidateOdds(m1, '胜平负', m1.prediction?.primary_outcome), candidateOdds(m2, '比分', p2.scores?.[0])], cfg.weights.parlay * 1.15 * mode.parlayBoost, '不同玩法混合串关，回报弹性更高，风险也高于同种过关。');
    }else{
      const legs2 = rows.slice(0,2).map(m=>selectedSamePick(m)).join(' × ');
      pushParlay('2串1','同种过关组合',`${selectedSameType}：${legs2}`, rows.slice(0,2).map(m=>selectedSameOdds(m)), cfg.weights.parlay * 1.15 * mode.parlayBoost, `只使用${selectedSameType}玩法串关，结构更清晰。`);
    }
  }
  if(allowParlay && rows.length >= 3){
    if(passType === 'mixed' && playType === 'all'){
      const [m1,m2,m3] = rows;
      const pick = `胜平负 ${m1.home_zh}${outcomeShort(m1.prediction)} × 比分 ${m2.home_zh} ${m2.prediction?.scores?.[0] || outcomeShort(m2.prediction)} × 半全场 ${m3.home_zh} ${m3.prediction?.half_full?.[0] || outcomeShort(m3.prediction)}`;
      pushParlay('3串1','进取混合过关',pick,[candidateOdds(m1, '胜平负', m1.prediction?.primary_outcome), candidateOdds(m2, '比分', m2.prediction?.scores?.[0]), candidateOdds(m3, '半全场', m3.prediction?.half_full?.[0])], cfg.weights.parlay * 0.9 * mode.parlayBoost, '胜平负、比分、半全场混合，适合小仓位博高回报。');
    }else{
      const legs3 = rows.slice(0,3).map(m=>selectedSamePick(m)).join(' × ');
      pushParlay('3串1','进取同种过关',`${selectedSameType}：${legs3}`, rows.slice(0,3).map(m=>selectedSameOdds(m)), cfg.weights.parlay * 0.9 * mode.parlayBoost, `${selectedSameType}同种3串1，风险较高，建议只用小仓位。`);
    }
  }
  if(allowParlay && mode.parlayDepth >= 4 && rows.length >= 4){
    const depthRows = rows.slice(0, Math.min(mode.parlayDepth, rows.length));
    const scoreLegs = depthRows.map((m,i)=>`比分 ${m.home_zh} ${m.prediction?.scores?.[i%2] || m.prediction?.scores?.[0] || outcomeShort(m.prediction)}`);
    const scoreOdds = depthRows.map((m,i)=>candidateOdds(m, '比分', m.prediction?.scores?.[i%2] || m.prediction?.scores?.[0]));
    pushParlay(`${depthRows.length}串1`, '比分阶梯长串', scoreLegs.join(' × '), scoreOdds, cfg.weights.parlay * 0.42 * mode.parlayBoost, '多场比分长串，命中难度极高，只适合极小仓位以小博大。');
  }
  if(allowParlay && betMode === 'moonshot' && rows.length >= 4){
    const hfRows = rows.slice(-Math.min(4, rows.length));
    const hfLegs = hfRows.map((m,i)=>`半全场 ${m.home_zh} ${m.prediction?.half_full?.[i%2] || m.prediction?.half_full?.[0] || outcomeShort(m.prediction)}`);
    const hfOdds = hfRows.map((m,i)=>candidateOdds(m, '半全场', m.prediction?.half_full?.[i%2] || m.prediction?.half_full?.[0]));
    pushParlay(`${hfRows.length}串1`, '半全场极限长串', hfLegs.join(' × '), hfOdds, cfg.weights.parlay * 0.34 * mode.parlayBoost, '半全场长串属于极高风险票，仅建议少量娱乐。');
  }
  if(parlayMode === 'single') return candidates.filter(c=>c.play === '单关');
  return candidates;
}
function allocateBetUnits(totalUnits, candidates){
  if(!totalUnits || !candidates.length) return [];
  const weights = candidates.map(c=>Math.max(0.05, c.weight || 0.1));
  const sum = weights.reduce((a,b)=>a+b,0);
  const rows = candidates.map((c,i)=>{
    const raw = totalUnits * weights[i] / sum;
    return {...c, units:Math.floor(raw), fraction:raw - Math.floor(raw)};
  });
  let used = rows.reduce((a,c)=>a+c.units,0);
  rows.sort((a,b)=>b.fraction-a.fraction).forEach(r=>{ if(used < totalUnits){ r.units += 1; used += 1; } });
  return rows.filter(r=>r.units > 0).sort((a,b)=> b.units-a.units || b.weight-a.weight);
}
// ── 帮助函数 ───────────────────────────────────────────────
const BET_TYPE_CLS = {胜平负:'opt-blue', 比分:'opt-yellow', 半全场:'opt-green'};
const BET_TYPE_FILL = {胜平负:'outcome', 比分:'score-fill', 半全场:'hf-fill'};
function unitDots(n){ return n<=6 ? '<span class="udot"></span>'.repeat(n) : `<span class="udot"></span>×${n}`; }
function isUpsetCandidate(c){ return /防冷|防爆冷/.test(String(c?.pick || '')) || /防冷|爆冷/.test(String(c?.reason || '')); }

// ── 明细面板（按主线/防爆冷拆分）────────────────────────────
function groupedBetPanels(plan){
  const singles = plan.filter(c=>c.play === '单关');
  const parlays = plan.filter(c=>c.play !== '单关');
  const renderCategory = (title, desc, rows) => {
    const groups = [];
    rows.forEach(c=>{
      let g = groups.find(x=>x.title === c.title);
      if(!g){ g = {title:c.title, matchNo:c.matchNo||'', matchIndex:c.matchIndex??99, rows:[]}; groups.push(g); }
      g.rows.push(c);
    });
    groups.sort((a,b)=>a.matchIndex-b.matchIndex);
    if(!groups.length) return '';
    return `<section class="bet-category"><h3>${title}</h3><p class="section-note">${desc}</p>${groups.map(g=>`<section class="bet-match-panel">
      <div class="bet-match-head"><span class="bet-match-no">${esc(g.matchNo)}</span><strong>${esc(g.title)}</strong></div>
      <div class="bet-options">${g.rows.map(c=>`<div class="bet-option ${BET_TYPE_CLS[c.type]||''}">
        <div class="bet-opt-main">
          <span class="bet-type">${esc(c.type)}</span>
          <span class="bet-choice-lg">${esc(c.pick)}</span>
        </div>
        <div class="bet-opt-stake">
          <div class="bet-udots">${unitDots(c.units)}</div>
          <div class="bet-stake-row"><b>${c.units}</b>注 <span class="bet-yuan">${c.units*2}元</span></div>
          <div class="bet-return">按预算控制</div>
        </div>
      </div>`).join('')}</div>
    </section>`).join('')}</section>`;
  };
  const mainPanels = renderCategory('主线推荐', '跟随胜平负主方向、首选比分和半全场的基础方案。', singles.filter(c=>!isUpsetCandidate(c)));
  const upsetPanels = renderCategory('防爆冷推荐', '只作为小注防平/防冷门补充，不改变主线判断。', singles.filter(isUpsetCandidate));
  const parlayPanel = parlays.length ? `<section class="bet-category"><h3>串关补充</h3><p class="section-note">串关风险显著更高，建议小仓位。</p><section class="bet-match-panel parlay-panel">
    <div class="bet-match-head"><span class="bet-match-no">串关</span><strong>过关组合</strong></div>
    <div class="bet-options">${parlays.map(c=>`<div class="bet-option opt-parlay">
      <div class="bet-opt-main">
        <span class="bet-type">${esc(c.play)}</span>
        <span class="bet-choice-lg">${esc(c.pick)}</span>
      </div>
      <div class="bet-opt-stake">
        <div class="bet-udots">${unitDots(c.units)}</div>
        <div class="bet-stake-row"><b>${c.units}</b>注 <span class="bet-yuan">${c.units*2}元</span></div>
        <div class="bet-return">按预算控制</div>
      </div>
    </div>`).join('')}</div>
  </section></section>` : '';
  return mainPanels + upsetPanels + parlayPanel;
}

// ── 一览表（核心：一行=一场比赛，三列=三种玩法）─────────────
function betQuickTable(plan, matches){
  const singles = plan.filter(c=>c.play==='单关');
  const parlays  = plan.filter(c=>c.play!=='单关');
  const groups = [];
  singles.forEach(c=>{
    let g=groups.find(x=>x.title===c.title);
    if(!g){ g={title:c.title,matchNo:c.matchNo||'',matchIndex:c.matchIndex??99,byType:{}}; groups.push(g); }
    g.byType[c.type]=c;
  });
  groups.sort((a,b)=>a.matchIndex-b.matchIndex);

  const cell=(c,cls)=>c
    ? `<td class="qt-cell ${cls}"><div class="qt-pick">${esc(c.pick)}</div><div class="qt-units">${c.units}注·${c.units*2}元</div></td>`
    : `<td class="qt-cell qt-nil">—</td>`;

  const bodyRows = groups.map((g,i)=>{
    const sub = Object.values(g.byType).reduce((a,c)=>a+c.units*2,0);
    const m = matches.find(m=>`${m.home_zh} vs ${m.away_zh}`===g.title)||{};
    const lg=(url,nm)=>url?`<img class="qt-logo" src="${esc(url)}" alt="${esc(nm)}" onerror="this.style.display='none'">`:'';
    return `<tr>
      <td class="qt-match">${lg(m.home_logo,m.home_zh)}<span>${esc(g.title)}</span>${lg(m.away_logo,m.away_zh)}</td>
      ${cell(g.byType['胜平负'],'qt-blue')}
      ${cell(g.byType['比分'],'qt-yellow')}
      ${cell(g.byType['半全场'],'qt-green')}
      <td class="qt-sub">${sub}元</td>
    </tr>`;
  }).join('');

  const parlayRows = parlays.map(c=>`<tr class="qt-parlay-row">
    <td class="qt-match" colspan="3"><span class="qt-parlay-tag">${esc(c.play)}</span>${esc(c.pick)}</td>
    <td class="qt-cell qt-yellow"><div class="qt-pick">${c.units}注</div><div class="qt-units">串关小注</div></td>
    <td class="qt-sub">${c.units*2}元</td>
  </tr>`).join('');

  // 合计行
  const sumByType = (t)=>{ const r=singles.filter(c=>c.type===t); const n=r.reduce((a,c)=>a+c.units,0); const y=r.reduce((a,c)=>a+c.units*2,0); return n?`${n}注·${y}元`:'—'; };
  const totalN=plan.reduce((a,c)=>a+c.units,0), totalY=plan.reduce((a,c)=>a+c.units*2,0);

  return `<div class="qt-wrap">
  <table class="bet-qt">
    <thead><tr>
      <th class="qt-th-match">场次</th>
      <th class="qt-th qt-blue">胜平负</th>
      <th class="qt-th qt-yellow">比分</th>
      <th class="qt-th qt-green">半全场</th>
      <th class="qt-th">小计</th>
    </tr></thead>
    <tbody>${bodyRows}${parlayRows}</tbody>
    <tfoot><tr>
      <td class="qt-foot-label">合计</td>
      <td class="qt-foot qt-blue">${sumByType('胜平负')}</td>
      <td class="qt-foot qt-yellow">${sumByType('比分')}</td>
      <td class="qt-foot qt-green">${sumByType('半全场')}</td>
      <td class="qt-foot-total"><b>${totalN}注</b><br>${totalY}元</td>
    </tr></tfoot>
  </table></div>`;
}

function longshotHighlights(plan){
  const rows = plan
    .filter(c=>Number.isFinite(Number(c.odds)) && (c.type !== '胜平负' || String(c.pick).includes('防冷')))
    .sort((a,b)=>Number(b.odds)-Number(a.odds))
    .slice(0,6);
  if(!rows.length) return '';
  return `<article class="panel longshot-panel">
    <div class="bet-quick-head"><div><h2 style="margin:0">以小博大精选</h2><p class="section-note" style="margin:4px 0 0">从当前方案里挑出比分/半全场/防冷等高风险项，建议小注娱乐，不建议重仓。</p></div></div>
    <div class="longshot-grid">${rows.map(c=>`<div class="longshot-card">
      <div class="longshot-top"><span>${esc(c.play)}</span><span>小注</span></div>
      <strong>${esc(c.title)}</strong>
      <div class="longshot-pick">${esc(c.type)} · ${esc(c.pick)}</div>
      <div class="longshot-money">${c.units}注 / ${c.units*2}元 · 高风险防冷项</div>
    </div>`).join('')}</div>
  </article>`;
}

// ── 拷贝文本生成 ────────────────────────────────────────────
function buildBetCopyText(plan, budget, spent, cfg, data, modeCfg){
  const date = data?.dates?.prediction_target || '';
  const singles = plan.filter(c=>c.play==='单关');
  const parlays  = plan.filter(c=>c.play!=='单关');
  const groupRows = (rows) => {
    const groups = [];
    rows.forEach(c=>{
      let g=groups.find(x=>x.title===c.title);
      if(!g){ g={title:c.title,matchIndex:c.matchIndex??99,rows:[]}; groups.push(g); }
      g.rows.push(c);
    });
    return groups.sort((a,b)=>a.matchIndex-b.matchIndex);
  };
  const pushGroups = (lines, heading, rows) => {
    const groups = groupRows(rows);
    if(!groups.length) return;
    lines.push('');
    lines.push(heading);
    groups.forEach((g,i)=>{
      lines.push(`${i+1}. ${g.title}`);
      g.rows.forEach(c=>{
        const pad = c.type==='半全场'?'  ': c.type.length===3?'    ':'      ';
        lines.push(`   ${c.type}${pad}${c.pick}   ×${c.units}注/${c.units*2}元`);
      });
    });
  };
  const lines=[
    `🏆 世界杯购买推荐 ${date}`,
    `💰 预算 ${budget}元  策略：${cfg.label} · ${modeCfg?.label || '常规均衡'}  实际分配 ${spent}元`,
  ];
  pushGroups(lines, '✅ 主线预测', singles.filter(c=>!isUpsetCandidate(c)));
  pushGroups(lines, '🧊 防爆冷预测（小注补充）', singles.filter(isUpsetCandidate));
  if(parlays.length){
    lines.push('');
    lines.push('🔗 串关补充');
    parlays.forEach(c=>lines.push(`   ${c.play}：${c.pick}   ×${c.units}注/${c.units*2}元`));
  }
  const totalN=plan.reduce((a,c)=>a+c.units,0), totalY=plan.reduce((a,c)=>a+c.units*2,0);
  const byT=plan.reduce((acc,c)=>{ if(c.play==='单关'){acc[c.type]=(acc[c.type]||{n:0,y:0});acc[c.type].n+=c.units;acc[c.type].y+=c.units*2;} return acc;},{});
  lines.push('');
  lines.push(`📊 合计：${totalN}注 / ${totalY}元`);
  lines.push('   '+Object.entries(byT).map(([k,v])=>`${k} ${v.n}注·${v.y}元`).join('  |  '));
  lines.push('⚠️ 仅供赛前分析和预算拆分参考，不展示回报系数或返奖估算。');
  return lines.join('\n');
}

async function copyBetText(plan, budget, spent, cfg, data, modeCfg){
  const text = buildBetCopyText(plan, budget, spent, cfg, data, modeCfg);
  const btn = $('copyBetBtn');
  const ok = ()=>{ if(btn){btn.textContent='✅ 已复制！';btn.classList.add('copied');setTimeout(()=>{btn.textContent='📋 拷贝文本';btn.classList.remove('copied');},2200);} };
  try{ await navigator.clipboard.writeText(text); ok(); }
  catch{
    const ta=document.createElement('textarea'); ta.value=text;
    ta.style.cssText='position:fixed;opacity:0;top:0;left:0;width:1px;height:1px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); ta.remove(); ok();
  }
}

// ── 主渲染函数（新布局）────────────────────────────────────
function renderBetAdvisor(data){
  const box = $('betRecommendation');
  if(!box) return;
  const budgetInput = Number($('betBudget')?.value || 52);
  const budget = Math.max(2, Math.floor(budgetInput / 2) * 2);
  const units  = Math.floor(budget / 2);
  const risk      = $('betRisk')?.value    || 'balanced';
  const betMode   = $('betMode')?.value    || 'standard';
  const parlayMode= $('betParlay')?.value  || 'auto';
  const passType  = $('betPassType')?.value|| 'mixed';
  const playType  = $('betPlayType')?.value|| 'all';
  const passTypeLabel = passType==='same'?'同种过关':'混合过关';
  const cfg = betPlanConfig(risk);
  const modeCfg = betModeConfig(betMode);
  const matches = data.sections?.day_after_predictions || [];
  if(!matches.length){ box.innerHTML = empty('暂无明天预测，无法生成购买推荐。'); return; }
  const plan  = allocateBetUnits(units, buildBetCandidates(matches, risk, parlayMode, passType, playType, betMode));
  const spent = plan.reduce((a,c)=>a+c.units*2,0);
  const totalN= plan.reduce((a,c)=>a+c.units,0);
  const byType= plan.reduce((acc,c)=>{ if(c.play==='单关'){acc[c.type]=(acc[c.type]||{n:0,y:0});acc[c.type].n+=c.units;acc[c.type].y+=c.units*2;} return acc;},{});

  // 资金结构迷你条
  const allocBar=(t,fill)=>{
    const d=byType[t]; if(!d) return '';
    const w=Math.round(d.y/spent*100);
    return `<div class="alloc-row"><span>${t}</span><div class="alloc-track"><div class="fill ${fill}" style="width:${w}%"></div></div><b>${d.y}元</b></div>`;
  };

  box.innerHTML = `
  <article class="panel bet-overview">
    <div class="bet-kpi-row">
      <div class="bet-kpi"><div class="label">总预算</div><div class="bet-kpi-num">${budget}<em>元</em></div><div class="hint">${units}注上限</div></div>
      <div class="bet-kpi"><div class="label">实际分配</div><div class="bet-kpi-num">${spent}<em>元</em></div><div class="hint">${totalN}注合计</div></div>
      <div class="bet-kpi"><div class="label">策略</div><div class="bet-kpi-tag ${risk}">${cfg.label}</div><div class="hint">${modeCfg.label} · ${playTypeLabel(playType)} · ${passTypeLabel}</div></div>
      <div class="bet-alloc"><div class="label">资金结构</div>
        ${allocBar('胜平负','outcome')}${allocBar('比分','score-fill')}${allocBar('半全场','hf-fill')}
      </div>
    </div>
  </article>

  <article class="panel bet-mode-note">
    <strong>${esc(modeCfg.label)}：</strong>${esc(modeCfg.desc)} <span>以小博大票命中难度高，建议只占小仓位。</span>
  </article>

  <article class="panel">
    <div class="bet-quick-head">
      <div><h2 style="margin:0">一览投注单</h2><p class="section-note" style="margin:4px 0 0">每行一场比赛，三列对应三种玩法，串关在底部。</p></div>
      <button id="copyBetBtn" class="btn bet-copy-btn" type="button">📋 拷贝文本</button>
    </div>
    ${betQuickTable(plan, matches)}
  </article>

  ${longshotHighlights(plan)}

  <article class="panel bet-ticket grouped">
    <h2>逐场明细</h2>
    <div class="bet-match-list">${groupedBetPanels(plan)}</div>
  </article>

  <article class="panel bet-warning">
    <strong>说明：</strong>模拟推荐，不是官方投注指令；本页仅保留玩法、选择和预算分配，不展示回报系数或返奖估算。实际购买前请以官方渠道信息为准，请勿超预算。
  </article>`;

  $('copyBetBtn')?.addEventListener('click', ()=>copyBetText(plan, budget, spent, cfg, data, modeCfg));
}
function bindBetAdvisor(){
  ['betBudget','betRisk','betMode','betParlay','betPlayType','betPassType'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('input',()=>state.data && renderBetAdvisor(state.data)); });
  const btn = $('calcBetBtn'); if(btn) btn.addEventListener('click',()=>state.data && renderBetAdvisor(state.data));
}

function renderMatches(data){
  state.allMatches = data.sections.all_known_matches || [];
  const draw = () => {
    const q = $('matchFilter').value.trim().toLowerCase();
    const rows = state.allMatches.filter(m => !q || `${m.date} ${m.time} ${m.home_zh} ${m.away_zh} ${m.home} ${m.away}`.toLowerCase().includes(q));
    if(!rows.length){ $('allMatches').innerHTML = empty('没有匹配的赛程。'); return; }
    // 按日期分组，组内正序（按时间），组间倒序（最新日期在前）
    const groups = {};
    rows.forEach(m => { const d = m.date || String(m.date_bj||'').slice(0,10); (groups[d]||=[]).push(m); });
    const html = Object.entries(groups)
      .sort(([a],[b]) => b.localeCompare(a))
      .map(([date, ms]) => {
        const doneN = ms.filter(m => m.completed).length;
        const liveN = ms.filter(m => matchRowCls(m) === 'live-row').length;
        const soonN = ms.filter(m => matchRowCls(m) === 'soon-row').length;
        const upN   = ms.filter(m => matchRowCls(m) === 'upcoming-row').length;
        const badges = [
          doneN ? `<span class="ms-badge done-badge">${doneN} 场已完赛</span>` : '',
          liveN ? `<span class="ms-badge live-badge"><span class="live-pip" style="margin:0 4px 0 0"></span>${liveN} 场进行中</span>` : '',
          soonN ? `<span class="ms-badge soon-badge">⏳ ${soonN} 场即将开赛</span>` : '',
          upN   ? `<span class="ms-badge up-badge">${upN} 场待赛</span>` : '',
        ].filter(Boolean).join('');
        return `<div class="match-day-group">
          <div class="match-day-head"><strong>${esc(date)}</strong><div class="ms-badges">${badges}</div></div>
          <div class="list">${ms.map(matchRow).join('')}</div>
        </div>`;
      }).join('');
    $('allMatches').innerHTML = html;
  };
  $('matchFilter').oninput = draw;
  draw();
}

function bindTabs(){
  document.querySelectorAll('.tabs button').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active'); $(btn.dataset.tab).classList.add('active');
  }));
}
function ensureHtml2Canvas(){
  if(window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject)=>{
    const existing = document.querySelector('script[data-lib="html2canvas"]');
    if(existing){ existing.addEventListener('load',()=>resolve(window.html2canvas)); existing.addEventListener('error',reject); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.async = true;
    script.dataset.lib = 'html2canvas';
    script.onload = ()=> window.html2canvas ? resolve(window.html2canvas) : reject(new Error('图片导出组件加载失败'));
    script.onerror = ()=> reject(new Error('无法加载图片导出组件，请检查网络后重试'));
    document.head.appendChild(script);
  });
}
function ensureJsPdf(){
  if(window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject)=>{
    const existing = document.querySelector('script[data-lib="jspdf"]');
    if(existing){ existing.addEventListener('load',()=>resolve(window.jspdf.jsPDF)); existing.addEventListener('error',reject); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    script.async = true;
    script.dataset.lib = 'jspdf';
    script.onload = ()=> window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF导出组件加载失败'));
    script.onerror = ()=> reject(new Error('无法加载PDF导出组件，请检查网络后重试'));
    document.head.appendChild(script);
  });
}
function ensureChartJs(){
  if(window.Chart) return Promise.resolve(window.Chart);
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.async=true; script.dataset.lib='chartjs';
    script.onload=()=>window.Chart?resolve(window.Chart):reject(new Error('Chart.js 加载失败'));
    script.onerror=()=>reject(new Error('无法加载 Chart.js，请检查网络'));
    document.head.appendChild(script);
  });
}
async function renderAccuracyChart(data){
  const canvas=$('accuracyChart');
  if(!canvas) return;
  const st=data.stats||{};
  const byDate=(st.by_date||[]).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  if(!byDate.length){ canvas.parentElement.insertAdjacentHTML('beforeend','<p class="empty">暂无多日数据</p>'); return; }
  try{
    const ChartJs=await ensureChartJs();
    if(state.chartInstance){state.chartInstance.destroy();state.chartInstance=null;}
    const labels=byDate.map(d=>String(d.date||'').slice(5));
    const mkAvgLine=(val,len)=>val==null?[]:Array(len).fill(val);
    state.chartInstance=new ChartJs(canvas,{
      type:'line',
      data:{
        labels,
        datasets:[
          {label:`胜平负 (均值 ${st.outcome_rate??'-'}%)`,data:byDate.map(d=>d.outcome_rate??null),borderColor:'#5dd7ff',backgroundColor:'rgba(93,215,255,0.07)',pointBackgroundColor:'#5dd7ff',fill:true,tension:0.35,pointRadius:5,pointHoverRadius:7,borderWidth:2.5},
          {label:`比分命中 (均值 ${st.exact_score_rate??'-'}%)`,data:byDate.map(d=>d.score_rate??null),borderColor:'#ffd166',backgroundColor:'rgba(255,209,102,0.07)',pointBackgroundColor:'#ffd166',fill:true,tension:0.35,pointRadius:5,pointHoverRadius:7,borderWidth:2.5},
          {label:`半全场 (均值 ${st.half_full_rate??'-'}%)`,data:byDate.map(d=>d.half_full_rate??null),borderColor:'#55e39b',backgroundColor:'rgba(85,227,155,0.07)',pointBackgroundColor:'#55e39b',fill:true,tension:0.35,pointRadius:5,pointHoverRadius:7,borderWidth:2.5,spanGaps:true},
          {label:'胜平负均线',data:mkAvgLine(st.outcome_rate,labels.length),borderColor:'rgba(93,215,255,0.4)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0},
          {label:'比分均线',data:mkAvgLine(st.exact_score_rate,labels.length),borderColor:'rgba(255,209,102,0.4)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0},
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'top',labels:{color:'#9fb2d1',padding:16,font:{size:12,weight:'bold'},usePointStyle:true,filter:item=>!item.text.includes('均线')}},
          tooltip:{backgroundColor:'rgba(6,16,35,0.94)',titleColor:'#eaf2ff',bodyColor:'#9fb2d1',borderColor:'rgba(93,215,255,0.3)',borderWidth:1,padding:12,
            callbacks:{
              title:items=>`${items[0].label} 比赛日`,
              label:ctx=>{
                const d=byDate[ctx.dataIndex]||{};
                if(ctx.dataset.borderDash) return '';
                if(ctx.datasetIndex===0) return ` 胜平负 ${ctx.parsed.y??'-'}%  (${d.outcome_hits??'-'}/${d.total??'-'})`;
                if(ctx.datasetIndex===1) return ` 比分 ${ctx.parsed.y??'-'}%  (${d.score_hits??'-'}/${d.total??'-'})`;
                if(ctx.datasetIndex===2){const hft=d.half_full_total??0;return ` 半全场 ${ctx.parsed.y??'-'}%  (${d.half_full_hits??'-'}/${hft})`;}
                return '';
              },
              filter:item=>!item.dataset.borderDash
            }
          }
        },
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.06)'},ticks:{color:'#9fb2d1',font:{size:12}},border:{color:'rgba(255,255,255,0.12)'}},
          y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.06)'},ticks:{color:'#9fb2d1',font:{size:12},callback:v=>`${v}%`,stepSize:25},border:{color:'rgba(255,255,255,0.12)'}}
        }
      }
    });
  }catch(e){
    canvas.insertAdjacentHTML('afterend',`<p class="empty">图表加载失败：${e.message}</p>`);
  }
}

async function renderBetAccuracyChart(data){
  const canvas = $('betAccuracyChart');
  if(!canvas) return;
  const st = data.bet_stats || {};
  const byDate = (st.by_date || []).slice().filter(d=>d.total || d.pending).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  if(!byDate.length){ canvas.parentElement.insertAdjacentHTML('beforeend','<p class="empty">暂无购买推荐趋势数据</p>'); return; }
  try{
    const ChartJs = await ensureChartJs();
    if(state.betChartInstance){ state.betChartInstance.destroy(); state.betChartInstance = null; }
    const labels = byDate.map(d=>String(d.date||'').slice(5));
    const avgLine = (val)=> val == null ? [] : Array(labels.length).fill(val);
    state.betChartInstance = new ChartJs(canvas, {
      type:'line',
      data:{ labels, datasets:[
        {label:`总体 (均值 ${st.rate ?? '-'}%)`,data:byDate.map(d=>d.rate??null),borderColor:'#b388ff',backgroundColor:'rgba(179,136,255,0.08)',pointBackgroundColor:'#b388ff',fill:true,tension:0.35,pointRadius:5,borderWidth:2.5,spanGaps:true},
        {label:`主线`,data:byDate.map(d=>d.main?.rate??null),borderColor:'#55e39b',backgroundColor:'rgba(85,227,155,0.06)',pointBackgroundColor:'#55e39b',fill:true,tension:0.35,pointRadius:5,borderWidth:2.2,spanGaps:true},
        {label:`防爆冷`,data:byDate.map(d=>d.upset?.rate??null),borderColor:'#ffd166',backgroundColor:'rgba(255,209,102,0.06)',pointBackgroundColor:'#ffd166',fill:true,tension:0.35,pointRadius:5,borderWidth:2.2,spanGaps:true},
        {label:'总体均线',data:avgLine(st.rate),borderColor:'rgba(179,136,255,0.42)',borderDash:[5,4],borderWidth:1.4,pointRadius:0,fill:false,tension:0},
      ]},
      options:{
        responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{position:'top',labels:{color:'#9fb2d1',padding:16,font:{size:12,weight:'bold'},usePointStyle:true,filter:item=>!item.text.includes('均线')}},
          tooltip:{backgroundColor:'rgba(6,16,35,0.94)',titleColor:'#eaf2ff',bodyColor:'#9fb2d1',borderColor:'rgba(179,136,255,0.3)',borderWidth:1,padding:12,
            callbacks:{
              title:items=>`${items[0].label} 购买日`,
              label:ctx=>{
                if(ctx.dataset.borderDash) return '';
                const d=byDate[ctx.dataIndex]||{};
                if(ctx.datasetIndex===0) return ` 总体 ${ctx.parsed.y??'-'}% (${d.hits??0}/${d.total??0})`;
                if(ctx.datasetIndex===1) return ` 主线 ${ctx.parsed.y??'-'}% (${d.main?.hits??0}/${d.main?.total??0})`;
                if(ctx.datasetIndex===2) return ` 防爆冷 ${ctx.parsed.y??'-'}% (${d.upset?.hits??0}/${d.upset?.total??0})`;
                return '';
              },
              filter:item=>!item.dataset.borderDash
            }
          }
        },
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.06)'},ticks:{color:'#9fb2d1',font:{size:12}},border:{color:'rgba(255,255,255,0.12)'}},
          y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.06)'},ticks:{color:'#9fb2d1',font:{size:12},callback:v=>`${v}%`,stepSize:25},border:{color:'rgba(255,255,255,0.12)'}}
        }
      }
    });
  }catch(e){ canvas.insertAdjacentHTML('afterend',`<p class="empty">购买推荐趋势图加载失败：${e.message}</p>`); }
}
async function renderSectionCanvas(sectionId){
  const html2canvas = await ensureHtml2Canvas();
  const node = $(sectionId);
  node.classList.add('is-exporting');
  await new Promise(requestAnimationFrame);
  try{
    return await html2canvas(node, {
      backgroundColor: '#07111f',
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
      logging: false,
      ignoreElements: el => el?.dataset?.html2canvasIgnore === 'true'
    });
  }finally{
    node.classList.remove('is-exporting');
  }
}
async function renderStatsCanvas(){
  return renderSectionCanvas('stats');
}
async function withExportButton(btnId, loadingText, task){
  const btn = $(btnId);
  if(state.exporting) return;
  state.exporting = true;
  const oldText = btn.textContent;
  btn.textContent = loadingText; btn.disabled = true;
  try{ await task(); }
  catch(e){ alert('导出失败：' + e.message); }
  finally{ btn.textContent = oldText; btn.disabled = false; state.exporting = false; }
}
async function exportStatsImage(){
  await withExportButton('exportStatsBtn', '正在生成PNG…', async()=>{
    const canvas = await renderStatsCanvas();
    const date = state.data?.dates?.today || new Date().toISOString().slice(0,10);
    const link = document.createElement('a');
    link.download = `worldcup-prediction-stats-${date}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove();
  });
}
async function exportPredictionsImage(){
  await withExportButton('exportPredictionsBtn', '正在生成图片…', async()=>{
    const canvas = await renderSectionCanvas('predictions');
    const date = state.data?.dates?.prediction_target || state.data?.dates?.today || new Date().toISOString().slice(0,10);
    const count = state.data?.summary?.prediction_count || state.data?.sections?.day_after_predictions?.length || 0;
    const link = document.createElement('a');
    link.download = `worldcup-predictions-${date}-${count}matches.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove();
  });
}
async function saveCanvasPdf(canvas, filename){
  const jsPDF = await ensureJsPdf();
  const img = canvas.toDataURL('image/jpeg', 0.94);
  const margin = 18;
  const pageW = 595.28, pageH = 841.89; // A4 portrait pt
  const imgW = pageW - margin * 2;
  const imgH = canvas.height * imgW / canvas.width;
  const pdf = new jsPDF('p', 'pt', 'a4');
  let y = margin, remaining = imgH;
  pdf.addImage(img, 'JPEG', margin, y, imgW, imgH);
  remaining -= (pageH - margin * 2);
  while(remaining > 0){
    pdf.addPage();
    y = margin - (imgH - remaining);
    pdf.addImage(img, 'JPEG', margin, y, imgW, imgH);
    remaining -= (pageH - margin * 2);
  }
  pdf.save(filename);
}
async function exportStatsPdf(){
  await withExportButton('exportStatsPdfBtn', '正在生成PDF…', async()=>{
    const canvas = await renderStatsCanvas();
    const date = state.data?.dates?.today || new Date().toISOString().slice(0,10);
    await saveCanvasPdf(canvas, `worldcup-prediction-stats-${date}.pdf`);
  });
}
async function exportBetImage(){
  await withExportButton('exportBetBtn', '正在生成PNG…', async()=>{
    const canvas = await renderSectionCanvas('betAdvisor');
    const date = state.data?.dates?.prediction_target || state.data?.dates?.today || new Date().toISOString().slice(0,10);
    const budget = Math.max(2, Math.floor(Number($('betBudget')?.value || 52) / 2) * 2);
    const link = document.createElement('a');
    link.download = `worldcup-bet-recommendation-${date}-${budget}yuan.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link); link.click(); link.remove();
  });
}
async function exportBetPdf(){
  await withExportButton('exportBetPdfBtn', '正在生成PDF…', async()=>{
    const canvas = await renderSectionCanvas('betAdvisor');
    const date = state.data?.dates?.prediction_target || state.data?.dates?.today || new Date().toISOString().slice(0,10);
    const budget = Math.max(2, Math.floor(Number($('betBudget')?.value || 52) / 2) * 2);
    await saveCanvasPdf(canvas, `worldcup-bet-recommendation-${date}-${budget}yuan.pdf`);
  });
}
async function refreshDataFromBridge(){
  const btn = $('refreshBtn');
  const status = $('refreshStatus');
  const oldText = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '正在生成数据…'; }
  if(status) status.textContent = '正在调用本地刷新服务，生成最新赛程/赛果/预测数据…';
  try{
    const res = await fetch('http://127.0.0.1:8765/refresh', { method: 'POST' });
    let info = {};
    try{ info = await res.json(); }catch(_){ info = {}; }
    if(!res.ok || !info.ok) throw new Error(info.message || `HTTP ${res.status}`);
    if(status) status.textContent = `刷新完成，用时 ${info.elapsed_seconds || '?'} 秒；页面数据已重新读取。`;
    await load();
  }catch(e){
    if(status) status.textContent = '本地刷新服务未启动或刷新失败；已改为只重读当前 JSON。可重新打开仪表盘启动刷新服务。';
    await load();
    alert('自动生成最新数据失败：' + e.message + '\n\n我已先重读当前本地 JSON。如果需要按钮直接生成数据，请重新打开世界杯仪表盘启动本地刷新服务。');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = oldText || '生成最新数据并刷新'; }
  }
}
async function load(){
  const res = await fetch(`data/current.json?ts=${Date.now()}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json(); state.data = data;
  renderSummary(data); renderPredictions(data); renderUpsets(data); renderStats(data); renderBetAdvisor(data); renderBetStats(data); renderMatches(data);
}
$('refreshBtn').addEventListener('click',()=>refreshDataFromBridge().catch(e=>alert('刷新失败：'+e.message)));
$('exportPredictionsBtn').addEventListener('click', exportPredictionsImage);
$('exportStatsBtn').addEventListener('click', exportStatsImage);
$('exportStatsPdfBtn').addEventListener('click', exportStatsPdf);
$('exportBetBtn').addEventListener('click', exportBetImage);
$('exportBetPdfBtn').addEventListener('click', exportBetPdf);
bindBetAdvisor();
bindTabs();
load().catch(e=>{ document.body.insertAdjacentHTML('afterbegin', `<div class="empty" style="margin:20px">数据加载失败：${e.message}。请先运行 generate_web_data.py。</div>`); });
