(() => {
  'use strict';

  const STORAGE_KEY = 'forexCampaignTracker.v1';
  const VERSION = 1;
  const TODAY = new Date();

  const CAMPAIGNS = {
    gaikaex: {
      name: 'GMO外貨 999円キャッシュバック大抽選会',
      short: 'GMO外貨 999円',
      start: '2026-08-03',
      end: '2026-10-30',
      url: 'https://www.gaikaex.com/campaign/gaikaex/fxcashback_202608/'
    },
    clickfx: {
      name: 'GMOクリック FX / CFD 毎週抽選',
      short: 'GMOクリック FX / CFD',
      start: '2026-06-29',
      end: '2026-09-25',
      url: 'https://www.click-sec.com/corp/campaign/fx_2607/'
    },
    oneaccount: {
      name: 'GMOクリック 1アカウント 投信抽選',
      short: '1アカウント 投信',
      start: '2026-06-01',
      end: '2026-08-29',
      url: 'https://www.click-sec.com/corp/campaign/1account_2606/'
    }
  };

  const CLICK_WEEKS = [
    ['2026-06-29','2026-07-03'], ['2026-07-06','2026-07-10'], ['2026-07-13','2026-07-17'],
    ['2026-07-20','2026-07-24'], ['2026-07-27','2026-07-31'], ['2026-08-03','2026-08-07'],
    ['2026-08-10','2026-08-14'], ['2026-08-17','2026-08-21'], ['2026-08-24','2026-08-28'],
    ['2026-08-31','2026-09-04'], ['2026-09-07','2026-09-11'], ['2026-09-14','2026-09-18'],
    ['2026-09-21','2026-09-25']
  ];

  const ONE_WEEKS = [
    ['2026-06-01','2026-06-06'], ['2026-06-08','2026-06-13'], ['2026-06-15','2026-06-20'],
    ['2026-06-22','2026-06-27'], ['2026-06-29','2026-07-04'], ['2026-07-06','2026-07-11'],
    ['2026-07-13','2026-07-18'], ['2026-07-20','2026-07-25'], ['2026-07-27','2026-08-01'],
    ['2026-08-03','2026-08-08'], ['2026-08-10','2026-08-15'], ['2026-08-17','2026-08-22'],
    ['2026-08-24','2026-08-29']
  ];

  const defaultState = () => ({
    version: VERSION,
    updatedAt: null,
    settings: { gaikaexEntered: false, oneAccountLinked: false },
    gaikaex: {}, clickfx: {}, oneaccount: {}
  });

  let state = loadState();
  let saveTimer = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
    } catch (e) {
      console.warn('Failed to load local data', e);
      return defaultState();
    }
  }

  function saveState(showSaved = false) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (showSaved) toast('保存しました');
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(false), 120);
  }

  function yen(value) {
    const n = Number(value) || 0;
    return `${n < 0 ? '-' : ''}¥${Math.abs(Math.round(n)).toLocaleString('ja-JP')}`;
  }

  function num(value) { return Number(value) || 0; }
  function isoDate(d) { return d.toISOString().slice(0,10); }
  function parseDate(s) { return new Date(`${s}T12:00:00+09:00`); }
  function fmtDate(s) { return new Intl.DateTimeFormat('ja-JP', { month:'numeric', day:'numeric', weekday:'short' }).format(parseDate(s)); }
  function fmtRange(a,b) { return `${fmtDate(a)} — ${fmtDate(b)}`; }
  function isToday(s) { return s === new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Tokyo' }).format(TODAY); }
  function inRangeNow(c) {
    const now = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Tokyo' }).format(TODAY);
    return now >= c.start && now <= c.end;
  }

  function businessDays(start, end) {
    const result = [];
    const d = parseDate(start);
    const stop = parseDate(end);
    while (d <= stop) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) result.push(isoDate(d));
      d.setDate(d.getDate() + 1);
    }
    return result;
  }

  function getRecord(bucket, key) {
    if (!state[bucket][key]) state[bucket][key] = {};
    return state[bucket][key];
  }

  function calcGaika(r) {
    const fx = num(r.fxVolume);
    const recFx = num(r.recFxVolume);
    const cfd = num(r.recCfdLots);
    const eligible = fx >= 50000;
    const entries = eligible ? 1 + (recFx >= 1000 ? 4 : 0) + (cfd >= 0.1 ? 4 : 0) : 0;
    const cost = num(r.cost);
    const reward = num(r.reward);
    return { eligible, entries, cost, reward, net: reward - cost };
  }

  function calcClick(r) {
    const fxEligible = !!r.entered && num(r.fxVolume) >= 50000;
    const cfdEligible = !!r.entered && num(r.cfdLots) >= 5;
    const bonus = !!r.bonusTraded;
    const cost = num(r.fxCost) + num(r.cfdCost);
    const reward = num(r.fxReward) + num(r.cfdReward);
    return { fxEligible, cfdEligible, bonus, cost, reward, net: reward - cost };
  }

  function calcOne(r) {
    const eligible = state.settings.oneAccountLinked && !!r.entered && num(r.purchase) >= 10000;
    const cost = num(r.cost);
    const pointValue = num(r.pointValueYen);
    return { eligible, cost, points: num(r.points), pointValue, net: pointValue - cost };
  }

  function totals() {
    let cost = 0, cash = 0, pointValue = 0;
    Object.values(state.gaikaex).forEach(r => { const c = calcGaika(r); cost += c.cost; cash += c.reward; });
    Object.values(state.clickfx).forEach(r => { const c = calcClick(r); cost += c.cost; cash += c.reward; });
    Object.values(state.oneaccount).forEach(r => { const c = calcOne(r); cost += c.cost; pointValue += c.pointValue; });
    return { cost, cash, pointValue, net: cash + pointValue - cost };
  }

  function updateKpis() {
    const t = totals();
    document.querySelector('#totalCost').textContent = yen(t.cost);
    document.querySelector('#totalCashReward').textContent = yen(t.cash);
    document.querySelector('#totalPointValue').textContent = yen(t.pointValue);
    const netEl = document.querySelector('#netProfit');
    netEl.textContent = yen(t.net);
    netEl.classList.toggle('negative', t.net < 0);
    netEl.classList.toggle('positive', t.net > 0);
    document.querySelector('#roiText').textContent = t.cost > 0 ? `回収率 ${(((t.cash + t.pointValue) / t.cost) * 100).toFixed(1)}%` : '回収率 —';
  }

  function campaignHeader(key, title, subtitle) {
    const c = CAMPAIGNS[key];
    const live = inRangeNow(c);
    return `<div class="campaign-head">
      <div class="campaign-title-wrap"><div class="logo-chip">${key === 'gaikaex' ? 'G' : 'C'}</div><div>
        <h2>${title}</h2>
        <div class="campaign-meta"><span class="meta-chip ${live ? 'live' : 'ended'}">${live ? '開催中' : '期間終了'}</span><span class="meta-chip">${c.start.replaceAll('-','/')} → ${c.end.replaceAll('-','/')}</span><span class="meta-chip">${subtitle}</span></div>
      </div></div>
      <a class="official-link" href="${c.url}" target="_blank" rel="noopener noreferrer">公式ページ ↗</a>
    </div>`;
  }

  function gaikaSummary() {
    let days = 0, eligible = 0, entries = 0, cost = 0, reward = 0;
    Object.values(state.gaikaex).forEach(r => {
      if (Object.keys(r).length) days++;
      const c = calcGaika(r); if (c.eligible) eligible++; entries += c.entries; cost += c.cost; reward += c.reward;
    });
    return `<div class="summary-strip">
      <div class="summary-item"><span>参加対象日</span><strong>${eligible}日</strong></div>
      <div class="summary-item"><span>累計応募口数</span><strong>${entries}口</strong></div>
      <div class="summary-item"><span>コスト</span><strong>${yen(cost)}</strong></div>
      <div class="summary-item"><span>ネット</span><strong class="${reward-cost >= 0 ? 'positive':'negative'}">${yen(reward-cost)}</strong></div>
    </div>`;
  }

  function renderGaikaex() {
    const rows = businessDays(CAMPAIGNS.gaikaex.start, CAMPAIGNS.gaikaex.end).map(date => {
      const r = state.gaikaex[date] || {};
      const c = calcGaika(r);
      const hasInput = Object.values(r).some(v => v !== '' && v !== false && v != null && Number(v) !== 0);
      let status = '<span class="status pending">未入力</span>';
      if (hasInput && !c.eligible) status = '<span class="status ineligible">条件未達</span>';
      if (c.eligible && c.reward <= 0) status = `<span class="status ok">${c.entries}口</span>`;
      if (c.reward > 0) status = '<span class="status win">999円当選</span>';
      return `<tr data-date="${date}" class="${isToday(date) ? 'today-row' : ''} ${c.eligible ? 'done-row' : ''}">
        <td class="date-cell"><strong>${fmtDate(date)}</strong><span>${date}</span></td>
        <td><input class="qty-input" type="number" min="0" step="1000" data-bucket="gaikaex" data-key="${date}" data-field="fxVolume" value="${r.fxVolume ?? ''}" placeholder="50,000"></td>
        <td><input class="qty-input" type="number" min="0" step="1000" data-bucket="gaikaex" data-key="${date}" data-field="recFxVolume" value="${r.recFxVolume ?? ''}" placeholder="1,000"></td>
        <td><input class="qty-input" type="number" min="0" step="0.1" data-bucket="gaikaex" data-key="${date}" data-field="recCfdLots" value="${r.recCfdLots ?? ''}" placeholder="0.1"></td>
        <td class="status-cell">${status}</td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="gaikaex" data-key="${date}" data-field="cost" value="${r.cost ?? ''}" placeholder="0"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="gaikaex" data-key="${date}" data-field="reward" value="${r.reward ?? ''}" placeholder="0 / 999"></td>
        <td class="inline-result"><strong class="${c.net >= 0 ? 'positive':'negative'}">${yen(c.net)}</strong></td>
        <td><input type="text" data-bucket="gaikaex" data-key="${date}" data-field="note" value="${escapeAttr(r.note || '')}" placeholder="メモ"></td>
      </tr>`;
    }).join('');

    document.querySelector('#view-gaikaex').innerHTML = campaignHeader('gaikaex', '毎日500名に999円', '1 / 5 / 9口を自動判定') + gaikaSummary() + `
      <div class="rule-grid">
        <div class="rule-card"><strong>FX 5万通貨以上</strong><span>その営業日の抽選対象。達成で1口。</span></div>
        <div class="rule-card"><strong>おすすめFX 1,000通貨以上</strong><span>5万通貨条件達成時に+4口。</span></div>
        <div class="rule-card"><strong>おすすめCFD 0.1枚以上</strong><span>5万通貨条件達成時に+4口。最大9口。</span></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>キャンペーン設定</h3><p>期間中のエントリーは最初の1回だけ</p></div></div>
        <div class="setting-row"><div class="setting-copy"><strong>エントリー済み</strong><span>参加条件の確認用。日次判定とは別に記録します。</span></div><label class="toggle"><input type="checkbox" data-setting="gaikaexEntered" ${state.settings.gaikaexEntered ? 'checked':''}><span class="slider"></span></label></div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h3>営業日ごとの実績</h3><p>数量・コスト・当選額を入力すると自動保存されます。</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>営業日</th><th>FX新規通貨</th><th>おすすめFX</th><th>おすすめCFD</th><th>判定</th><th>コスト ¥</th><th>当選 ¥</th><th>ネット</th><th>メモ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }

  function clickSummary() {
    let fx = 0, cfd = 0, cost = 0, reward = 0;
    Object.values(state.clickfx).forEach(r => { const c = calcClick(r); if(c.fxEligible) fx++; if(c.cfdEligible) cfd++; cost += c.cost; reward += c.reward; });
    return `<div class="summary-strip">
      <div class="summary-item"><span>FX抽選参加</span><strong>${fx}回</strong></div>
      <div class="summary-item"><span>CFD抽選参加</span><strong>${cfd}回</strong></div>
      <div class="summary-item"><span>コスト</span><strong>${yen(cost)}</strong></div>
      <div class="summary-item"><span>ネット</span><strong class="${reward-cost >= 0 ? 'positive':'negative'}">${yen(reward-cost)}</strong></div>
    </div>`;
  }

  function renderClickfx() {
    const rows = CLICK_WEEKS.map((w, i) => {
      const key = `week${i+1}`;
      const r = state.clickfx[key] || {};
      const c = calcClick(r);
      return `<tr class="${c.fxEligible || c.cfdEligible ? 'done-row':''}">
        <td class="date-cell"><strong>第${i+1}回</strong><span>${fmtRange(w[0], w[1])}</span></td>
        <td><input class="mini-check" type="checkbox" data-bucket="clickfx" data-key="${key}" data-field="entered" ${r.entered ? 'checked':''}></td>
        <td><input class="qty-input" type="number" min="0" step="1000" data-bucket="clickfx" data-key="${key}" data-field="fxVolume" value="${r.fxVolume ?? ''}" placeholder="50,000"></td>
        <td>${c.fxEligible ? '<span class="status ok">FX対象</span>' : '<span class="status pending">—</span>'}</td>
        <td><input class="qty-input" type="number" min="0" step="0.1" data-bucket="clickfx" data-key="${key}" data-field="cfdLots" value="${r.cfdLots ?? ''}" placeholder="5"></td>
        <td>${c.cfdEligible ? '<span class="status ok">CFD対象</span>' : '<span class="status pending">—</span>'}</td>
        <td><input class="mini-check" type="checkbox" data-bucket="clickfx" data-key="${key}" data-field="bonusTraded" ${r.bonusTraded ? 'checked':''} title="追加条件銘柄を1枚以上取引"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="fxCost" value="${r.fxCost ?? ''}" placeholder="FX"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="cfdCost" value="${r.cfdCost ?? ''}" placeholder="CFD"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="fxReward" value="${r.fxReward ?? ''}" placeholder="0"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="clickfx" data-key="${key}" data-field="cfdReward" value="${r.cfdReward ?? ''}" placeholder="0"></td>
        <td class="inline-result"><strong class="${c.net >= 0 ? 'positive':'negative'}">${yen(c.net)}</strong></td>
      </tr>`;
    }).join('');
    document.querySelector('#view-clickfx').innerHTML = campaignHeader('clickfx', 'ハズレなし・毎週最大4,000円', '13週 / FX・CFD別抽選') + clickSummary() + `
      <div class="rule-grid">
        <div class="rule-card"><strong>FXネオ 5万通貨以上</strong><span>週ごとにエントリー必須。FX抽選へ参加。</span></div>
        <div class="rule-card"><strong>商品・株価指数CFD 5枚以上</strong><span>合計5枚以上でCFD抽選へ参加。</span></div>
        <div class="rule-card"><strong>追加条件銘柄 1枚以上</strong><span>FX/CFDそれぞれの1等・2等当選確率が5倍。</span></div>
      </div>
      <div class="panel"><div class="panel-head"><div><h3>開催回ごとの実績</h3><p>FXとCFDを別々に記録し、コストと当選額を合算します。</p></div></div><div class="table-wrap"><table>
        <thead><tr><th>開催回</th><th>Entry</th><th>FX通貨</th><th>FX判定</th><th>CFD枚数</th><th>CFD判定</th><th>5倍</th><th>FXコスト</th><th>CFDコスト</th><th>FX当選</th><th>CFD当選</th><th>ネット</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }

  function oneSummary() {
    let eligible = 0, points = 0, cost = 0, value = 0;
    Object.values(state.oneaccount).forEach(r => { const c = calcOne(r); if(c.eligible) eligible++; points += c.points; cost += c.cost; value += c.pointValue; });
    return `<div class="summary-strip">
      <div class="summary-item"><span>条件達成</span><strong>${eligible}回</strong></div>
      <div class="summary-item"><span>獲得ポイント</span><strong>${Math.round(points).toLocaleString('ja-JP')} pt</strong></div>
      <div class="summary-item"><span>評価額</span><strong>${yen(value)}</strong></div>
      <div class="summary-item"><span>評価額−コスト</span><strong class="${value-cost >= 0 ? 'positive':'negative'}">${yen(value-cost)}</strong></div>
    </div>`;
  }

  function renderOneAccount() {
    const rows = ONE_WEEKS.map((w, i) => {
      const key = `week${i+1}`;
      const r = state.oneaccount[key] || {};
      const c = calcOne(r);
      return `<tr class="${c.eligible ? 'done-row':''}">
        <td class="date-cell"><strong>第${i+1}回</strong><span>${fmtRange(w[0],w[1])}</span></td>
        <td><input class="mini-check" type="checkbox" data-bucket="oneaccount" data-key="${key}" data-field="entered" ${r.entered ? 'checked':''}></td>
        <td><input class="qty-input" type="number" min="0" step="1000" data-bucket="oneaccount" data-key="${key}" data-field="purchase" value="${r.purchase ?? ''}" placeholder="10,000"></td>
        <td>${c.eligible ? '<span class="status ok">抽選対象</span>' : '<span class="status pending">—</span>'}</td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="oneaccount" data-key="${key}" data-field="cost" value="${r.cost ?? ''}" placeholder="0"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="oneaccount" data-key="${key}" data-field="points" value="${r.points ?? ''}" placeholder="200 / 10000"></td>
        <td><input class="money-input" type="number" min="0" step="1" data-bucket="oneaccount" data-key="${key}" data-field="pointValueYen" value="${r.pointValueYen ?? ''}" placeholder="円換算"></td>
        <td><input type="text" data-bucket="oneaccount" data-key="${key}" data-field="note" value="${escapeAttr(r.note || '')}" placeholder="メモ"></td>
      </tr>`;
    }).join('');
    document.querySelector('#view-oneaccount').innerHTML = campaignHeader('oneaccount', '毎週25名に10,000ポイント', '終了済み / 過去実績入力') + oneSummary() + `
      <div class="panel">
        <div class="panel-head"><div><h3>キャンペーン設定</h3><p>1アカウント連携は全開催回の共通条件として扱います。</p></div></div>
        <div class="setting-row"><div class="setting-copy"><strong>1アカウント連携済み</strong><span>各週のエントリー＋投信10,000円以上と合わせて判定。</span></div><label class="toggle"><input type="checkbox" data-setting="oneAccountLinked" ${state.settings.oneAccountLinked ? 'checked':''}><span class="slider"></span></label></div>
      </div>
      <div class="panel"><div class="panel-head"><div><h3>開催回ごとの実績</h3><p>ポイントはそのまま記録し、総損益に含めたい場合だけ円評価額を入力します。</p></div></div><div class="table-wrap"><table>
        <thead><tr><th>開催回</th><th>Entry</th><th>投信購入 ¥</th><th>判定</th><th>コスト ¥</th><th>当選 pt</th><th>評価額 ¥</th><th>メモ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }

  function historyItems() {
    const items = [];
    Object.entries(state.gaikaex).forEach(([date,r]) => {
      const c = calcGaika(r); if (!c.cost && !c.reward) return;
      items.push({ date, name: `GMO外貨 · ${c.entries}口`, cost:c.cost, reward:c.reward, net:c.net });
    });
    Object.entries(state.clickfx).forEach(([key,r]) => {
      const idx = Number(key.replace('week','')) - 1; const c = calcClick(r); if (!c.cost && !c.reward) return;
      items.push({ date: CLICK_WEEKS[idx]?.[1] || key, name:`GMOクリック FX/CFD · 第${idx+1}回`, cost:c.cost, reward:c.reward, net:c.net });
    });
    Object.entries(state.oneaccount).forEach(([key,r]) => {
      const idx = Number(key.replace('week','')) - 1; const c = calcOne(r); if (!c.cost && !c.pointValue) return;
      items.push({ date: ONE_WEEKS[idx]?.[1] || key, name:`1アカウント · 第${idx+1}回`, cost:c.cost, reward:c.pointValue, net:c.net });
    });
    return items.sort((a,b) => b.date.localeCompare(a.date));
  }

  function renderHistory() {
    const items = historyItems();
    document.querySelector('#view-history').innerHTML = `<div class="campaign-head"><div class="campaign-title-wrap"><div class="logo-chip">Σ</div><div><h2>損益履歴</h2><div class="campaign-meta"><span class="meta-chip">コストまたは還元額を入力した記録のみ</span></div></div></div></div>
      <div class="history-list">${items.length ? items.map(i => `<div class="history-row">
        <div class="date">${i.date}</div><div class="name">${i.name}</div>
        <div class="metric"><span>コスト</span>${yen(i.cost)}</div>
        <div class="metric"><span>還元</span>${yen(i.reward)}</div>
        <div class="metric ${i.net >= 0 ? 'positive':'negative'}"><span>ネット</span>${yen(i.net)}</div>
      </div>`).join('') : '<div class="empty">コストまたは当選額を入力すると、ここに履歴が表示されます。</div>'}</div>`;
  }

  function escapeAttr(s) {
    return String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  function renderAll() {
    renderGaikaex(); renderClickfx(); renderOneAccount(); renderHistory(); updateKpis(); bindDynamicInputs();
  }

  function updateRowOnly(el) {
    const bucket = el.dataset.bucket;
    if (bucket === 'gaikaex') renderGaikaex();
    if (bucket === 'clickfx') renderClickfx();
    if (bucket === 'oneaccount') renderOneAccount();
    renderHistory(); updateKpis(); bindDynamicInputs();
  }

  function bindDynamicInputs() {
    document.querySelectorAll('[data-bucket]').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const r = getRecord(el.dataset.bucket, el.dataset.key);
        r[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value;
        queueSave();
        if (el.type === 'checkbox' || el.dataset.field !== 'note') {
          const active = document.activeElement;
          const position = (active && typeof active.selectionStart === 'number') ? active.selectionStart : null;
          updateRowOnly(el);
          const selector = `[data-bucket="${el.dataset.bucket}"][data-key="${el.dataset.key}"][data-field="${el.dataset.field}"]`;
          const replacement = document.querySelector(selector);
          if (replacement && el.type !== 'checkbox') {
            replacement.focus();
            if (position != null && replacement.setSelectionRange) replacement.setSelectionRange(position, position);
          }
        } else {
          updateKpis();
        }
      });
    });
    document.querySelectorAll('[data-setting]').forEach(el => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('change', () => {
        state.settings[el.dataset.setting] = el.checked;
        saveState(false);
        renderAll();
      });
    });
  }

  function toast(msg) {
    const el = document.querySelector('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function exportData() {
    saveState(false);
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `forex-campaign-tracker-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url); toast('バックアップを書き出しました');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
        state = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
        saveState(false); renderAll(); toast('バックアップを復元しました');
      } catch (_) { alert('JSONを読み込めませんでした。Forex Campaign Trackerから書き出したファイルを選択してください。'); }
    };
    reader.readAsText(file);
  }

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`#view-${tab.dataset.view}`).classList.add('active');
  }));

  document.querySelector('#exportBtn').addEventListener('click', exportData);
  document.querySelector('#importInput').addEventListener('change', e => { if (e.target.files?.[0]) importData(e.target.files[0]); e.target.value = ''; });
  document.querySelector('#resetBtn').addEventListener('click', () => {
    if (!confirm('このブラウザに保存したキャンペーン記録をすべて削除します。先にJSONを書き出すことをおすすめします。続けますか？')) return;
    localStorage.removeItem(STORAGE_KEY); state = defaultState(); renderAll(); toast('初期化しました');
  });

  window.addEventListener('beforeunload', () => saveState(false));
  renderAll();
})();
