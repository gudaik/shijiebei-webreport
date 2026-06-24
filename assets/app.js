const state = { data: null, allMatches: [], exporting: false, autoRefreshTimer: null, chartInstance: null, countdownTimer: null };
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
  if(shouldRefresh && !state.autoRefreshTimer){
    state.autoRefreshTimer = setInterval(()=>load().catch(()=>{}), 5 * 60 * 1000);
  }else if(!shouldRefresh && state.autoRefreshTimer){
    clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null;
  }
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
    $('liveStatsNotice').innerHTML = `<div class="live-dot"></div><div><strong>${today} 的预测赛果正在结算中</strong><p>当前已出结果 ${todayCompleted}/${todayTotal} 场，还有 ${pendingToday.length} 场没出结果${extra ? `：${esc(extra)}` : ''}。页面会每 5 分钟自动刷新；后台数据更新后，这里会自动纳入最新完赛结果。</p></div>`;
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
  <div class="label">3个比分预测</div><div class="pill-row">${p.scores.map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>
  <div class="label">3个半全场预测</div><div class="pill-row hf">${p.half_full.map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>
  <p class="analysis">${esc(p.analysis)}</p>
  <a href="${esc(m.link)}" target="_blank" rel="noopener">ESPN 比赛页</a>
</article>`;
  }).join('') : empty('明天暂未检索到可确认比赛，数据源更新后会自动显示。');
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
    ['报告预测总数', st.report_predictions_total ?? 0, `来源：${src.windows_directory || st.source_label || 'reports'}；${st.report_files_total ?? 0} 个报告文件 / ${st.report_files_with_predictions ?? 0} 个含预测`],
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
    <div class="bar-metric"><span>半全场 ${d.half_full_hits ?? 0}/${d.half_full_total ?? 0}</span><div class="track"><div class="fill hf-fill" style="width:${d.half_full_rate ?? 0}%"></div></div><b>${d.half_full_rate == null ? '待' : `${d.half_full_rate}%`}</b></div>
  </div>`).join('') : empty('暂无已结算历史预测；reports 中的预测比赛完赛后会自动累计。');
  $('recentStats').innerHTML = renderSettledGroups(st.recent, st.half_full_note || '暂无统计。');
  renderAccuracyChart(data);
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
function buildBetCandidates(matches, risk, parlayMode, passType, playType='all'){
  const cfg = betPlanConfig(risk);
  const candidates = [];
  const rows = (matches || []);
  const useOutcome = playType === 'all' || playType === 'outcome';
  const useScore = playType === 'all' || playType === 'score';
  const useHalfFull = playType === 'all' || playType === 'halfFull';
  rows.forEach((m, idx)=>{
    const p = m.prediction || {}; const title = `${m.home_zh} vs ${m.away_zh}`;
    const confidence = p.primary_outcome === '主胜' ? 1.08 : p.primary_outcome === '客胜' ? 0.96 : 0.86;
    const matchNo = `周${'日一二三四五六'[new Date(m.date_bj).getDay()]}${String(idx+1).padStart(3,'0')}`;
    if(useOutcome) candidates.push({type:'胜平负', play:'单关', title, matchNo, matchIndex:idx, pick:p.primary_outcome || p.tendency || outcomeShort(p), weight:cfg.weights.outcome * confidence, reason:'作为主预测方向，适合承担基础仓位。'});
    if(useScore) (p.scores || []).slice(0,cfg.maxScores).forEach((s, j)=>candidates.push({type:'比分', play:'单关', title, matchNo, matchIndex:idx, pick:s, weight:cfg.weights.score * (j ? 0.72 : 1), reason:j ? '次选比分，小额覆盖波动。' : '首选比分，用于提高潜在回报。'}));
    if(useHalfFull) (p.half_full || []).slice(0,cfg.maxHalfFull).forEach((h, j)=>candidates.push({type:'半全场', play:'单关', title, matchNo, matchIndex:idx, pick:h, weight:cfg.weights.halfFull * (j ? 0.7 : 1), reason:j ? '半全场次选，小额博高赔。' : '半全场主选，配合比分方向。'}));
  });
  const allowParlay = parlayMode === 'parlay' || (parlayMode === 'auto' && risk !== 'safe');
  const selectedSamePick = (m) => {
    const p = m.prediction || {};
    if(playType === 'score') return `${m.home_zh} ${p.scores?.[0] || '首选比分'}`;
    if(playType === 'halfFull') return `${m.home_zh} ${p.half_full?.[0] || '半全场主选'}`;
    return `${m.home_zh}${outcomeShort(p)}`;
  };
  const selectedSameType = playType === 'score' ? '比分' : playType === 'halfFull' ? '半全场' : '胜平负';
  if(allowParlay && rows.length >= 2){
    if(passType === 'mixed' && playType === 'all'){
      const m1 = rows[0], m2 = rows[1];
      const p2 = m2.prediction || {};
      const leg1 = `胜平负 ${m1.home_zh}${outcomeShort(m1.prediction)}`;
      const leg2 = `比分 ${m2.home_zh} ${p2.scores?.[0] || outcomeShort(p2)}`;
      candidates.push({type:'混合过关', play:'2串1', title:'混合过关组合', pick:`${leg1} × ${leg2}`, weight:cfg.weights.parlay * 1.15, reason:'不同玩法混合串关，回报弹性更高，风险也高于同种过关。'});
    }else{
      const legs2 = rows.slice(0,2).map(selectedSamePick).join(' × ');
      candidates.push({type:'同种过关', play:'2串1', title:'同种过关组合', pick:`${selectedSameType}：${legs2}`, weight:cfg.weights.parlay * 1.15, reason:`只使用${selectedSameType}玩法串关，结构更清晰。`});
    }
  }
  if(allowParlay && risk === 'aggressive' && rows.length >= 3){
    if(passType === 'mixed' && playType === 'all'){
      const m1 = rows[0], m2 = rows[1], m3 = rows[2];
      const leg1 = `胜平负 ${m1.home_zh}${outcomeShort(m1.prediction)}`;
      const leg2 = `比分 ${m2.home_zh} ${m2.prediction?.scores?.[0] || outcomeShort(m2.prediction)}`;
      const leg3 = `半全场 ${m3.home_zh} ${m3.prediction?.half_full?.[0] || outcomeShort(m3.prediction)}`;
      candidates.push({type:'混合过关', play:'3串1', title:'进取混合过关', pick:`${leg1} × ${leg2} × ${leg3}`, weight:cfg.weights.parlay * 0.9, reason:'胜平负、比分、半全场混合，适合小仓位博高回报。'});
    }else{
      const legs3 = rows.slice(0,3).map(selectedSamePick).join(' × ');
      candidates.push({type:'同种过关', play:'3串1', title:'进取同种过关', pick:`${selectedSameType}：${legs3}`, weight:cfg.weights.parlay * 0.9, reason:`${selectedSameType}同种3串1，风险较高，建议只用小仓位。`});
    }
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
function groupedBetPanels(plan){
  const singles = plan.filter(c=>c.play === '单关');
  const parlays = plan.filter(c=>c.play !== '单关');
  const groups = [];
  singles.forEach(c=>{
    let g = groups.find(x=>x.title === c.title);
    if(!g){ g = {title:c.title, matchNo:c.matchNo || '', matchIndex:c.matchIndex ?? 99, rows:[]}; groups.push(g); }
    g.rows.push(c);
  });
  groups.sort((a,b)=>a.matchIndex-b.matchIndex);
  const matchPanels = groups.map(g=>`<section class="bet-match-panel">
    <div class="bet-match-head"><span>${esc(g.matchNo)}</span><strong>${esc(g.title)}</strong></div>
    <div class="bet-options">${g.rows.map(c=>`<div class="bet-option">
      <div><span class="bet-type">${esc(c.type)}</span><span class="bet-choice">${esc(c.pick)}</span></div>
      <div class="bet-stake"><b>${c.units}</b>注 / ${c.units*2}元</div>
      <div class="bet-reason">${esc(c.reason)}</div>
    </div>`).join('')}</div>
  </section>`).join('');
  const parlayPanel = parlays.length ? `<section class="bet-match-panel parlay-panel">
    <div class="bet-match-head"><span>串关</span><strong>过关组合</strong></div>
    <div class="bet-options">${parlays.map(c=>`<div class="bet-option">
      <div><span class="bet-type">${esc(c.play)}</span><span class="bet-choice">${esc(c.pick)}</span></div>
      <div class="bet-stake"><b>${c.units}</b>注 / ${c.units*2}元</div>
      <div class="bet-reason">${esc(c.reason)}</div>
    </div>`).join('')}</div>
  </section>` : '';
  return matchPanels + parlayPanel;
}

function renderBetAdvisor(data){
  const box = $('betRecommendation');
  if(!box) return;
  const budgetInput = Number($('betBudget')?.value || 52);
  const budget = Math.max(2, Math.floor(budgetInput / 2) * 2);
  const units = Math.floor(budget / 2);
  const risk = $('betRisk')?.value || 'balanced';
  const parlayMode = $('betParlay')?.value || 'auto';
  const passType = $('betPassType')?.value || 'mixed';
  const playType = $('betPlayType')?.value || 'all';
  const passTypeLabel = passType === 'same' ? '同种过关' : '混合过关';
  const cfg = betPlanConfig(risk);
  const matches = data.sections?.day_after_predictions || [];
  if(!matches.length){ box.innerHTML = empty('暂无明天预测，无法生成购买推荐。'); return; }
  const plan = allocateBetUnits(units, buildBetCandidates(matches, risk, parlayMode, passType, playType));
  const spent = plan.reduce((a,c)=>a+c.units*2,0);
  const byType = plan.reduce((acc,c)=>{ acc[c.type]=(acc[c.type]||0)+c.units*2; return acc; },{});
  box.innerHTML = `<article class="panel bet-summary">
    <div><div class="label">总预算</div><div class="num">${budget} 元</div><div class="hint">${units} 注 · 2元/注 · 实际分配 ${spent} 元</div></div>
    <div><div class="label">策略</div><div class="num">${cfg.label}</div><div class="hint">${cfg.desc} 当前玩法：${playTypeLabel(playType)}；过关类型：${passTypeLabel}。</div></div>
    <div><div class="label">资金结构</div><div class="bet-tags">${Object.entries(byType).map(([k,v])=>`<span>${k} ${v}元</span>`).join('')}</div></div>
  </article>
  <article class="panel bet-ticket grouped">
    <h2>按场次推荐投注单</h2>
    <p class="section-note">同一场比赛的胜平负、比分、半全场集中在一个面板里，方便像体彩计算器一样逐场查看；串关单独放在底部。</p>
    <div class="bet-match-list">${groupedBetPanels(plan)}</div>
  </article>
  <article class="panel bet-warning">
    <strong>说明：</strong>这是基于当前预测的模拟推荐，不是官方投注指令；赔率、临场首发、伤停、盘口变化会明显影响最优分配。请勿超预算投注。
  </article>`;
}
function bindBetAdvisor(){
  ['betBudget','betRisk','betParlay','betPlayType','betPassType'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('input',()=>state.data && renderBetAdvisor(state.data)); });
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
async function load(){
  const res = await fetch(`data/current.json?ts=${Date.now()}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json(); state.data = data;
  renderSummary(data); renderPredictions(data); renderStats(data); renderBetAdvisor(data); renderMatches(data);
}
$('refreshBtn').addEventListener('click',()=>load().catch(e=>alert('刷新失败：'+e.message)));
$('exportPredictionsBtn').addEventListener('click', exportPredictionsImage);
$('exportStatsBtn').addEventListener('click', exportStatsImage);
$('exportStatsPdfBtn').addEventListener('click', exportStatsPdf);
$('exportBetBtn').addEventListener('click', exportBetImage);
$('exportBetPdfBtn').addEventListener('click', exportBetPdf);
bindBetAdvisor();
bindTabs();
load().catch(e=>{ document.body.insertAdjacentHTML('afterbegin', `<div class="empty" style="margin:20px">数据加载失败：${e.message}。请先运行 generate_web_data.py。</div>`); });
