(() => {
  'use strict';

  const STORAGE_KEY = 'forexCampaignTracker.v1';
  const TODAY = new Date();
  const CAMPAIGNS = {
    gaikaex: { start:'2026-08-03', end:'2026-10-30', url:'https://www.gaikaex.com/campaign/gaikaex/fxcashback_202608/' },
    clickfx: { start:'2026-06-29', end:'2026-09-25', url:'https://www.click-sec.com/corp/campaign/fx_2607/' },
    oneaccount: { start:'2026-06-01', end:'2026-08-29', url:'https://www.click-sec.com/corp/campaign/1account_2606/' }
  };
  const CLICK_WEEKS = [
    ['2026-06-29','2026-07-03'],['2026-07-06','2026-07-10'],['2026-07-13','2026-07-17'],['2026-07-20','2026-07-24'],
    ['2026-07-27','2026-07-31'],['2026-08-03','2026-08-07'],['2026-08-10','2026-08-14'],['2026-08-17','2026-08-21'],
    ['2026-08-24','2026-08-28'],['2026-08-31','2026-09-04'],['2026-09-07','2026-09-11'],['2026-09-14','2026-09-18'],['2026-09-21','2026-09-25']
  ];
  const ONE_WEEKS = [
    ['2026-06-01','2026-06-06'],['2026-06-08','2026-06-13'],['2026-06-15','2026-06-20'],['2026-06-22','2026-06-27'],
    ['2026-06-29','2026-07-04'],['2026-07-06','2026-07-11'],['2026-07-13','2026-07-18'],['2026-07-20','2026-07-25'],
    ['2026-07-27','2026-08-01'],['2026-08-03','2026-08-08'],['2026-08-10','2026-08-15'],['2026-08-17','2026-08-22'],['2026-08-24','2026-08-29']
  ];

  const defaultState = () => ({ version:2, updatedAt:null, settings:{ gaikaexEntered:false }, gaikaex:{}, clickfx:{}, oneaccount:{} });
  let state = loadState();
  let saveTimer;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return {
        ...defaultState(), ...parsed, version:2,
        settings:{ ...defaultState().settings, ...(parsed.settings || {}) },
        gaikaex:{ ...(parsed.gaikaex || {}) }, clickfx:{ ...(parsed.clickfx || {}) }, oneaccount:{ ...(parsed.oneaccount || {}) }
      };
    } catch (_) { return defaultState(); }
  }
  function saveState(show=false) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (show) toast('保存しました');
  }
  function queueSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveState(false), 120); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function yen(v) { const n=num(v); return `${n<0?'-':''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`; }
  function points(v) { return `${Math.round(num(v)).toLocaleString('ja-JP')} pt`; }
  function parseDate(s) { return new Date(`${s}T12:00:00+09:00`); }
  function isoDate(d) { return d.toISOString().slice(0,10); }
  function fmtDate(s) { return new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',weekday:'short'}).format(parseDate(s)); }
  function fmtRange(a,b) { return `${fmtDate(a)} — ${fmtDate(b)}`; }
  function todayJst() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(TODAY); }
  function isToday(s) { return s === todayJst(); }
  function inRangeNow(c) { const n=todayJst(); return n>=c.start && n<=c.end; }
  function businessDays(start,end) {
    const out=[], d=parseDate(start), stop=parseDate(end);
    while (d<=stop) { if (d.getDay()!==0 && d.getDay()!==6) out.push(isoDate(d)); d.setDate(d.getDate()+1); }
    return out;
  }
  function escapeAttr(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
  function rec(bucket,key) { if (!state[bucket][key]) state[bucket][key]={}; return state[bucket][key]; }

  function calcGaika(r={}) {
    const eligible=num(r.fxVolume)>=50000;
    const entries=eligible ? 1+(num(r.recFxVolume)>=1000?4:0)+(num(r.recCfdLots)>=0.1?4:0) : 0;
    const cost=num(r.cost), reward=num(r.reward);
    return {eligible,entries,cost,reward,net:reward-cost};
  }
  function clickFxDone(r={}) { return typeof r.fxAchieved==='boolean' ? r.fxAchieved : (!!r.entered && num(r.fxVolume)>=50000); }
  function clickCfdDone(r={}) { return typeof r.cfdAchieved==='boolean' ? r.cfdAchieved : (!!r.entered && num(r.cfdLots)>=5); }
  function calcClick(r={}) {
    const fxEligible=clickFxDone(r), cfdEligible=clickCfdDone(r);
    const cost=num(r.fxCost)+num(r.cfdCost), reward=num(r.fxReward)+num(r.cfdReward);
    return {fxEligible,cfdEligible,cost,reward,net:reward-cost};
  }
  function onePnl(r={}) {
    if (r.investmentPnl !== undefined && r.investmentPnl !== '') return num(r.investmentPnl);
    if (r.cost !== undefined && r.cost !== '') return -num(r.cost); // legacy: old cost -> loss
    return 0;
  }
  function calcOne(r={}) {
    const entered=!!r.entered, pnl=onePnl(r), pts=num(r.points);
    return {entered,pnl,points:pts,net:pnl+pts}; // 1pt=¥1換算で参考ネット
  }
  function totals() {
    let cost=0,cash=0,pts=0,oneInvestmentPnl=0;
    Object.values(state.gaikaex).forEach(r=>{const c=calcGaika(r);cost+=c.cost;cash+=c.reward;});
    Object.values(state.clickfx).forEach(r=>{const c=calcClick(r);cost+=c.cost;cash+=c.reward;});
    Object.values(state.oneaccount).forEach(r=>{const c=calcOne(r);pts+=c.points;oneInvestmentPnl+=c.pnl;});
    return {cost,cash,pts,oneInvestmentPnl,net:cash-cost+oneInvestmentPnl+pts};
  }
  function updateKpis() {
    const t=totals();
    document.querySelector('#totalCost').textContent=yen(t.cost);
    document.querySelector('#totalCashReward').textContent=yen(t.cash);
    document.querySelector('#totalPointValue').textContent=points(t.pts);
    const net=document.querySelector('#netProfit');
    net.textContent=yen(t.net); net.classList.toggle('positive',t.net>0); net.classList.toggle('negative',t.net<0);
    const base=Math.abs(t.cost)+Math.max(0,-t.oneInvestmentPnl);
    document.querySelector('#roiText').textContent=base>0?`参考回収率 ${(((t.cash+t.pts+Math.max(0,t.oneInvestmentPnl))/base)*100).toFixed(1)}%`:'参考回収率 —';
  }
  function campaignHeader(key,title,subtitle) {
    const c=CAMPAIGNS[key], live=inRangeNow(c);
    return `<div class="campaign-head"><div class="campaign-title-wrap"><div class="logo-chip">${key==='gaikaex'?'G':'C'}</div><div><h2>${title}</h2><div class="campaign-meta"><span class="meta-chip ${live?'live':'ended'}">${live?'開催中':'期間終了'}</span><span class="meta-chip">${c.start.replaceAll('-','/')} → ${c.end.replaceAll('-','/')}</span><span class="meta-chip">${subtitle}</span></div></div></div><a class="official-link" href="${c.url}" target="_blank" rel="noopener noreferrer">公式ページ ↗</a></div>`;
  }

  function renderGaikaex() {
    let eligible=0,entries=0,cost=0,reward=0;
    Object.values(state.gaikaex).forEach(r=>{const c=calcGaika(r);eligible+=c.eligible?1:0;entries+=c.entries;cost+=c.cost;reward+=c.reward;});
    const summary=`<div class="summary-strip"><div class="summary-item"><span>参加対象日</span><strong>${eligible}日</strong></div><div class="summary-item"><span>累計応募口数</span><strong>${entries}口</strong></div><div class="summary-item"><span>コスト</span><strong>${yen(cost)}</strong></div><div class="summary-item"><span>ネット</span><strong class="${reward-cost>=0?'positive':'negative'}">${yen(reward-cost)}</strong></div></div>`;
    const rows=businessDays(CAMPAIGNS.gaikaex.start,CAMPAIGNS.gaikaex.end).map(date=>{
      const r=state.gaikaex[date]||{}, c=calcGaika(r);
      const has=Object.values(r).some(v=>v!==''&&v!==false&&v!=null&&Number(v)!==0);
      let status='<span class="status pending">未入力</span>';
      if(has&&!c.eligible)status='<span class="status ineligible">条件未達</span>';
      if(c.eligible&&c.reward<=0)status=`<span class="status ok">${c.entries}口</span>`;
      if(c.reward>0)status='<span class="status win">999円当選</span>';
      return `<tr class="${isToday(date)?'today-row':''} ${c.eligible?'done-row':''}"><td class="date-cell"><strong>${fmtDate(date)}</strong><span>${date}</span></td><td><input class="qty-input" type="number" min="0" step="1000" data-bucket="gaikaex" data-key="${date}" data-field="fxVolume" value="${escapeAttr(r.fxVolume)}" placeholder="50000"></td><td><input class="qty-input" type="number" min="0" step="1000" data-bucket="gaikaex" data-key="${date}" data-field="recFxVolume" value="${escapeAttr(r.recFxVolume)}" placeholder="1000"></td><td><input class="qty-input" type="number" min="0" step="0.1" data-bucket="gaikaex" data-key="${date}" data-field="recCfdLots" value="${escapeAttr(r.recCfdLots)}" placeholder="0.1"></td><td>${status}</td><td><input class="money-input signed-number" type="number" step="1" data-bucket="gaikaex" data-key="${date}" data-field="cost" value="${escapeAttr(r.cost)}" placeholder="0"></td><td><input class="money-input" type="number" min="0" step="1" data-bucket="gaikaex" data-key="${date}" data-field="reward" value="${escapeAttr(r.reward)}" placeholder="0 / 999"></td><td class="inline-result"><strong class="${c.net>=0?'positive':'negative'}">${yen(c.net)}</strong></td><td><input type="text" data-bucket="gaikaex" data-key="${date}" data-field="note" value="${escapeAttr(r.note)}" placeholder="メモ"></td></tr>`;
    }).join('');
    document.querySelector('#view-gaikaex').innerHTML=campaignHeader('gaikaex','毎日500名に999円','1 / 5 / 9口を自動判定')+summary+`<div class="panel"><div class="panel-head"><div><h3>キャンペーン設定</h3><p>期間中のエントリーは最初の1回だけ</p></div></div><div class="setting-row"><div class="setting-copy"><strong>エントリー済み</strong></div><label class="toggle"><input type="checkbox" data-setting="gaikaexEntered" ${state.settings.gaikaexEntered?'checked':''}><span class="slider"></span></label></div></div><div class="panel"><div class="panel-head"><div><h3>営業日ごとの実績</h3><p>入力中は画面を再描画しません。コストはマイナス値も入力できます。</p></div></div><div class="table-wrap"><table><thead><tr><th>営業日</th><th>FX新規通貨</th><th>おすすめFX</th><th>おすすめCFD</th><th>判定</th><th>コスト ¥</th><th>当選 ¥</th><th>ネット</th><th>メモ</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function renderClickfx() {
    let fx=0,cfd=0,cost=0,reward=0;
    Object.values(state.clickfx).forEach(r=>{const c=calcClick(r);fx+=c.fxEligible?1:0;cfd+=c.cfdEligible?1:0;cost+=c.cost;reward+=c.reward;});
    const summary=`<div class="summary-strip"><div class="summary-item"><span>FX達成</span><strong>${fx}回</strong></div><div class="summary-item"><span>CFD達成</span><strong>${cfd}回</strong></div><div class="summary-item"><span>コスト</span><strong>${yen(cost)}</strong></div><div class="summary-item"><span>ネット</span><strong class="${reward-cost>=0?'positive':'negative'}">${yen(reward-cost)}</strong></div></div>`;
    const rows=CLICK_WEEKS.map((w,i)=>{
      const key=`week${i+1}`, r=state.clickfx[key]||{}, c=calcClick(r);
      return `<tr class="${c.fxEligible||c.cfdEligible?'done-row':''}"><td class="date-cell"><strong>第${i+1}回</strong><span>${fmtRange(w[0],w[1])}</span></td><td class="check-cell"><input class="mini-check" type="checkbox" data-bucket="clickfx" data-key="${key}" data-field="fxAchieved" ${c.fxEligible?'checked':''}></td><td><input class="money-input signed-number" type="number" step="1" data-bucket="clickfx" data-key="${key}" data-field="fxCost" value="${escapeAttr(r.fxCost)}" placeholder="0"></td><td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="fxReward" value="${escapeAttr(r.fxReward)}" placeholder="0"></td><td class="check-cell"><input class="mini-check" type="checkbox" data-bucket="clickfx" data-key="${key}" data-field="cfdAchieved" ${c.cfdEligible?'checked':''}></td><td><input class="money-input signed-number" type="number" step="1" data-bucket="clickfx" data-key="${key}" data-field="cfdCost" value="${escapeAttr(r.cfdCost)}" placeholder="0"></td><td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="cfdReward" value="${escapeAttr(r.cfdReward)}" placeholder="0"></td><td class="inline-result"><strong class="${c.net>=0?'positive':'negative'}">${yen(c.net)}</strong></td></tr>`;
    }).join('');
    document.querySelector('#view-clickfx').innerHTML=campaignHeader('clickfx','ハズレなし・毎週最大4,000円','FX / CFDを別々に記録')+summary+`<div class="panel"><div class="panel-head"><div><h3>開催回ごとの実績</h3><p>達成チェック・実コスト・当選額だけを記録します。コストは利益が出た場合、負数で入力できます。</p></div></div><div class="table-wrap compact-table"><table><thead><tr><th>開催回</th><th>FX達成</th><th>FXコスト</th><th>FX当選額</th><th>CFD達成</th><th>CFDコスト</th><th>CFD当選額</th><th>ネット</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function renderOneAccount() {
    let entered=0,pnl=0,pts=0;
    Object.values(state.oneaccount).forEach(r=>{const c=calcOne(r);entered+=c.entered?1:0;pnl+=c.pnl;pts+=c.points;});
    const summary=`<div class="summary-strip summary-three"><div class="summary-item"><span>エントリー</span><strong>${entered}回</strong></div><div class="summary-item"><span>投信損益</span><strong class="${pnl>=0?'positive':'negative'}">${yen(pnl)}</strong></div><div class="summary-item"><span>当選ポイント</span><strong>${points(pts)}</strong></div></div>`;
    const rows=ONE_WEEKS.map((w,i)=>{
      const key=`week${i+1}`, r=state.oneaccount[key]||{}, c=calcOne(r);
      const pnlValue = r.investmentPnl !== undefined && r.investmentPnl !== '' ? r.investmentPnl : (r.cost !== undefined && r.cost !== '' ? -num(r.cost) : '');
      return `<tr class="${c.entered?'done-row':''}"><td class="date-cell"><strong>第${i+1}回</strong><span>${fmtRange(w[0],w[1])}</span></td><td class="check-cell"><input class="mini-check" type="checkbox" data-bucket="oneaccount" data-key="${key}" data-field="entered" ${c.entered?'checked':''}></td><td><input class="money-input signed-number wide-number" type="number" step="1" data-bucket="oneaccount" data-key="${key}" data-field="investmentPnl" value="${escapeAttr(pnlValue)}" placeholder="例: -250 / 180"></td><td><input class="money-input wide-number" type="number" min="0" step="1" data-bucket="oneaccount" data-key="${key}" data-field="points" value="${escapeAttr(r.points)}" placeholder="200 / 10000"></td></tr>`;
    }).join('');
    document.querySelector('#view-oneaccount').innerHTML=campaignHeader('oneaccount','毎週25名に10,000ポイント','Entry / 投信損益 / 当選ptのみ')+summary+`<div class="panel"><div class="panel-head"><div><h3>開催回ごとの実績</h3><p>エントリー、投信の実損益、当選ポイントだけ入力します。投信損益はプラス・マイナスどちらも入力できます。</p></div></div><div class="table-wrap compact-table one-table"><table><thead><tr><th>開催回</th><th>Entry</th><th>投信損益 ¥</th><th>当選 pt</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  function historyItems() {
    const items=[];
    Object.entries(state.gaikaex).forEach(([date,r])=>{const c=calcGaika(r);if(!c.cost&&!c.reward)return;items.push({date,name:`GMO外貨 · ${c.entries}口`,cost:c.cost,reward:c.reward,net:c.net});});
    Object.entries(state.clickfx).forEach(([key,r])=>{const idx=Number(key.replace('week',''))-1,c=calcClick(r);if(!c.cost&&!c.reward)return;items.push({date:CLICK_WEEKS[idx]?.[1]||key,name:`GMOクリック FX/CFD · 第${idx+1}回`,cost:c.cost,reward:c.reward,net:c.net});});
    Object.entries(state.oneaccount).forEach(([key,r])=>{const idx=Number(key.replace('week',''))-1,c=calcOne(r);if(!c.pnl&&!c.points)return;items.push({date:ONE_WEEKS[idx]?.[1]||key,name:`1アカウント · 第${idx+1}回`,cost:-c.pnl,reward:c.points,net:c.net,one:true});});
    return items.sort((a,b)=>b.date.localeCompare(a.date));
  }
  function renderHistory() {
    const items=historyItems();
    document.querySelector('#view-history').innerHTML=`<div class="campaign-head"><div class="campaign-title-wrap"><div class="logo-chip">Σ</div><div><h2>損益履歴</h2><div class="campaign-meta"><span class="meta-chip">入力済みの記録</span></div></div></div></div><div class="history-list">${items.length?items.map(i=>`<div class="history-row"><div class="date">${i.date}</div><div class="name">${i.name}</div><div class="metric"><span>${i.one?'投信損益':'コスト'}</span>${i.one?yen(-i.cost):yen(i.cost)}</div><div class="metric"><span>${i.one?'ポイント':'還元'}</span>${i.one?points(i.reward):yen(i.reward)}</div><div class="metric ${i.net>=0?'positive':'negative'}"><span>参考ネット</span>${yen(i.net)}</div></div>`).join(''):'<div class="empty">入力すると、ここに履歴が表示されます。</div>'}</div>`;
  }

  function renderAll() { renderGaikaex(); renderClickfx(); renderOneAccount(); renderHistory(); updateKpis(); bindInputs(); }
  function refreshAfterEdit(bucket) {
    if(bucket==='gaikaex')renderGaikaex();
    if(bucket==='clickfx')renderClickfx();
    if(bucket==='oneaccount')renderOneAccount();
    renderHistory(); updateKpis(); bindInputs();
  }
  function bindInputs() {
    document.querySelectorAll('[data-bucket]').forEach(el=>{
      if(el.dataset.bound)return; el.dataset.bound='1';
      if(el.type==='checkbox') {
        el.addEventListener('change',()=>{rec(el.dataset.bucket,el.dataset.key)[el.dataset.field]=el.checked;saveState(false);refreshAfterEdit(el.dataset.bucket);});
      } else {
        el.addEventListener('input',()=>{rec(el.dataset.bucket,el.dataset.key)[el.dataset.field]=el.value;queueSave();});
        el.addEventListener('change',()=>{saveState(false);refreshAfterEdit(el.dataset.bucket);});
      }
    });
    document.querySelectorAll('[data-setting]').forEach(el=>{
      if(el.dataset.bound)return; el.dataset.bound='1';
      el.addEventListener('change',()=>{state.settings[el.dataset.setting]=el.checked;saveState(false);});
    });
  }
  function toast(msg) { const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('show'),1800); }
  function exportData() { saveState(false);const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`forex-campaign-tracker-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast('バックアップを書き出しました'); }
  function importData(file) { const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed||typeof parsed!=='object')throw new Error();state={...defaultState(),...parsed,version:2,settings:{...defaultState().settings,...(parsed.settings||{})},gaikaex:{...(parsed.gaikaex||{})},clickfx:{...(parsed.clickfx||{})},oneaccount:{...(parsed.oneaccount||{})}};saveState(false);renderAll();toast('バックアップを復元しました');}catch(_){alert('JSONを読み込めませんでした。');}};reader.readAsText(file); }

  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===tab));document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelector(`#view-${tab.dataset.view}`).classList.add('active');}));
  document.querySelector('#exportBtn').addEventListener('click',exportData);
  document.querySelector('#importInput').addEventListener('change',e=>{if(e.target.files?.[0])importData(e.target.files[0]);e.target.value='';});
  document.querySelector('#resetBtn').addEventListener('click',()=>{if(!confirm('このブラウザに保存したキャンペーン記録をすべて削除します。続けますか？'))return;localStorage.removeItem(STORAGE_KEY);state=defaultState();renderAll();toast('初期化しました');});
  window.addEventListener('beforeunload',()=>saveState(false));
  renderAll();
})();