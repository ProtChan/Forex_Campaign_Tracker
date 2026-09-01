(() => {
  'use strict';

  const STORAGE_KEY = 'forexCampaignTracker.v1';
  const CLICK_ENDS = ['2026-07-03','2026-07-10','2026-07-17','2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28','2026-09-04','2026-09-11','2026-09-18','2026-09-25'];
  const ONE_ENDS = ['2026-06-06','2026-06-13','2026-06-20','2026-06-27','2026-07-04','2026-07-11','2026-07-18','2026-07-25','2026-08-01','2026-08-08','2026-08-15','2026-08-22','2026-08-29'];

  const num = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const has = v => v !== undefined && v !== null && v !== '';
  const yen = v => {
    const n = Math.round(num(v));
    return `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;
  };
  const signedYen = v => {
    const n = Math.round(num(v));
    if (n === 0) return '¥0';
    return `${n > 0 ? '+' : '-'}¥${Math.abs(n).toLocaleString('ja-JP')}`;
  };
  const compactYen = v => {
    const n = Math.round(num(v));
    const a = Math.abs(n);
    if (a >= 1000000) return `${n < 0 ? '-' : ''}¥${(a / 1000000).toFixed(a >= 10000000 ? 0 : 1)}M`;
    if (a >= 10000) return `${n < 0 ? '-' : ''}¥${(a / 10000).toFixed(a >= 100000 ? 0 : 1)}万`;
    return yen(n);
  };
  const dateMs = s => new Date(`${s}T12:00:00+09:00`).getTime();
  const dateLabel = s => {
    const [,m,d] = s.split('-');
    return `${Number(m)}/${Number(d)}`;
  };

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function dailySeries() {
    const state = readState();
    const daily = new Map();
    const add = (date, net) => {
      if (!date || !Number.isFinite(net) || net === 0) return;
      daily.set(date, (daily.get(date) || 0) + net);
    };

    Object.entries(state.gaikaex || {}).forEach(([date, r]) => {
      const fxCost = has(r.fxCost) ? num(r.fxCost) : num(r.cost);
      const cfdCost = num(r.cfdCost);
      const reward = num(r.reward);
      add(date, reward - fxCost - cfdCost);
    });

    Object.entries(state.clickfx || {}).forEach(([key, r]) => {
      const index = Number(String(key).replace('week', '')) - 1;
      const date = CLICK_ENDS[index];
      const cost = num(r.fxCost) + num(r.cfdCost);
      const reward = num(r.fxReward) + num(r.cfdReward);
      add(date, reward - cost);
    });

    Object.entries(state.oneaccount || {}).forEach(([key, r]) => {
      const index = Number(String(key).replace('week', '')) - 1;
      const date = ONE_ENDS[index];
      const pnl = has(r.investmentPnl) ? num(r.investmentPnl) : (has(r.cost) ? -num(r.cost) : 0);
      const points = num(r.points);
      add(date, pnl + points);
    });

    let cumulative = 0;
    return [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, net]) => {
        cumulative += net;
        return { date, net, cumulative };
      });
  }

  function makeChart(series) {
    if (!series.length) {
      return `<section class="cumulative-chart-panel panel">
        <div class="chart-head"><div><h3>時系列累積収支</h3><p>全キャンペーン合算・1pt=1円換算</p></div></div>
        <div class="chart-empty">コスト・当選額・投信損益・ポイントを入力すると累積収支が表示されます。</div>
      </section>`;
    }

    const width = 1000, height = 330;
    const margin = { left: 76, right: 26, top: 24, bottom: 46 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const times = series.map(p => dateMs(p.date));
    let minT = Math.min(...times), maxT = Math.max(...times);
    if (minT === maxT) { minT -= 86400000; maxT += 86400000; }

    const values = [0, ...series.map(p => p.cumulative)];
    let minY = Math.min(...values), maxY = Math.max(...values);
    if (minY === maxY) { minY -= 100; maxY += 100; }
    const pad = Math.max((maxY - minY) * 0.12, 50);
    minY -= pad; maxY += pad;

    const x = date => margin.left + ((dateMs(date) - minT) / (maxT - minT)) * plotW;
    const y = value => margin.top + ((maxY - value) / (maxY - minY)) * plotH;

    const coords = series.map(p => ({ ...p, x:x(p.date), y:y(p.cumulative) }));
    const polyline = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const zeroY = y(0);

    const yTicks = Array.from({length:5}, (_,i) => maxY - ((maxY-minY) * i / 4));
    const grid = yTicks.map(v => {
      const yy = y(v);
      return `<g class="chart-grid-line"><line x1="${margin.left}" y1="${yy.toFixed(1)}" x2="${width-margin.right}" y2="${yy.toFixed(1)}"></line><text x="${margin.left-12}" y="${(yy+4).toFixed(1)}" text-anchor="end">${compactYen(v)}</text></g>`;
    }).join('');

    const xTickCount = Math.min(5, series.length);
    const xTickIndices = xTickCount === 1 ? [0] : Array.from({length:xTickCount}, (_,i) => Math.round((series.length-1) * i / (xTickCount-1)));
    const xTicks = [...new Set(xTickIndices)].map(i => {
      const p = coords[i];
      return `<text class="chart-x-label" x="${p.x.toFixed(1)}" y="${height-15}" text-anchor="middle">${dateLabel(p.date)}</text>`;
    }).join('');

    const dots = coords.map(p => `<circle class="chart-point" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2"><title>${p.date.replaceAll('-','/')}  当日 ${signedYen(p.net)} / 累積 ${yen(p.cumulative)}</title></circle>`).join('');

    const last = series[series.length-1];
    const peak = Math.max(...series.map(p => p.cumulative));
    const trough = Math.min(...series.map(p => p.cumulative));

    return `<section class="cumulative-chart-panel panel">
      <div class="chart-head">
        <div><h3>時系列累積収支</h3><p>全キャンペーン合算・実日付間隔 / 1pt=1円換算</p></div>
        <div class="chart-stats">
          <div><span>現在</span><strong class="${last.cumulative >= 0 ? 'positive':'negative'}">${yen(last.cumulative)}</strong></div>
          <div><span>最高</span><strong>${yen(peak)}</strong></div>
          <div><span>最低</span><strong>${yen(trough)}</strong></div>
        </div>
      </div>
      <div class="chart-wrap" role="img" aria-label="時系列累積収支グラフ。現在 ${yen(last.cumulative)}">
        <svg class="cumulative-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          ${grid}
          <line class="chart-zero-line" x1="${margin.left}" y1="${zeroY.toFixed(1)}" x2="${width-margin.right}" y2="${zeroY.toFixed(1)}"></line>
          <polyline class="chart-line" points="${polyline}"></polyline>
          ${dots}
          ${xTicks}
        </svg>
      </div>
    </section>`;
  }

  let scheduled = false;
  function injectChart() {
    scheduled = false;
    const view = document.querySelector('#view-history');
    if (!view || view.querySelector('.cumulative-chart-panel')) return;
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    head.insertAdjacentHTML('afterend', makeChart(dailySeries()));
  }
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(injectChart);
  }

  const view = document.querySelector('#view-history');
  if (view) new MutationObserver(scheduleInject).observe(view, { childList:true, subtree:false });
  document.querySelectorAll('[data-view="history"]').forEach(el => el.addEventListener('click', scheduleInject));
  window.addEventListener('storage', scheduleInject);
  scheduleInject();
})();