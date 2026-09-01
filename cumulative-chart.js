(() => {
  'use strict';

  const STORAGE_KEY = 'forexCampaignTracker.v1';
  const WIDTH = 1000;
  const HEIGHT = 350;
  const MARGIN = { left: 82, right: 30, top: 24, bottom: 50 };
  const CLICK_ENDS = ['2026-07-03','2026-07-10','2026-07-17','2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28','2026-09-04','2026-09-11','2026-09-18','2026-09-25'];
  const ONE_ENDS = ['2026-06-06','2026-06-13','2026-06-20','2026-06-27','2026-07-04','2026-07-11','2026-07-18','2026-07-25','2026-08-01','2026-08-08','2026-08-15','2026-08-22','2026-08-29'];

  let activeRange = 'all';
  let scheduled = false;

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
  const fullDateLabel = s => s.replaceAll('-', '/');

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
      add(date, num(r.reward) - fxCost - cfdCost);
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
      add(date, pnl + num(r.points));
    });

    let cumulative = 0;
    return [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, net]) => {
        cumulative += net;
        return { date, net, cumulative };
      });
  }

  function rangeSeries(series, range) {
    if (range === 'all' || series.length <= 1) return series;
    const days = range === '7d' ? 7 : 30;
    const end = dateMs(series[series.length - 1].date);
    const cutoff = end - (days - 1) * 86400000;
    const filtered = series.filter(p => dateMs(p.date) >= cutoff);
    return filtered.length ? filtered : [series[series.length - 1]];
  }

  function niceStep(span, targetTicks = 5) {
    if (!Number.isFinite(span) || span <= 0) return 100;
    const rough = span / targetTicks;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * power;
  }

  function niceDomain(values) {
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) {
      const bump = Math.max(100, Math.abs(min) * 0.2 || 100);
      min -= bump;
      max += bump;
    }

    let step = niceStep(max - min, 5);
    let niceMin = Math.floor(min / step) * step;
    let niceMax = Math.ceil(max / step) * step;
    if (niceMin === niceMax) niceMax = niceMin + step;

    let tickCount = Math.round((niceMax - niceMin) / step) + 1;
    if (tickCount > 8) {
      step = niceStep(max - min, 4);
      niceMin = Math.floor(min / step) * step;
      niceMax = Math.ceil(max / step) * step;
      tickCount = Math.round((niceMax - niceMin) / step) + 1;
    }

    const ticks = [];
    for (let i = 0; i < tickCount && i < 12; i++) {
      const value = niceMin + step * i;
      ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
    }
    return { min: niceMin, max: niceMax, step, ticks };
  }

  function emptyChart() {
    return `<section class="cumulative-chart-panel panel">
      <div class="chart-head"><div><h3>時系列累積収支</h3><p>全キャンペーン合算・1pt=1円換算</p></div></div>
      <div class="chart-empty">コスト・当選額・投信損益・ポイントを入力すると累積収支が表示されます。</div>
    </section>`;
  }

  function makeChart(allSeries, range = activeRange) {
    if (!allSeries.length) return emptyChart();
    const series = rangeSeries(allSeries, range);
    const plotW = WIDTH - MARGIN.left - MARGIN.right;
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const times = series.map(p => dateMs(p.date));
    let minT = Math.min(...times), maxT = Math.max(...times);
    if (minT === maxT) { minT -= 86400000; maxT += 86400000; }

    const domain = niceDomain(series.map(p => p.cumulative));
    const x = date => MARGIN.left + ((dateMs(date) - minT) / (maxT - minT)) * plotW;
    const y = value => MARGIN.top + ((domain.max - value) / (domain.max - domain.min)) * plotH;

    const coords = series.map((p, index) => ({ ...p, index, x:x(p.date), y:y(p.cumulative) }));
    const polyline = coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const zeroY = y(0);

    const grid = domain.ticks.slice().reverse().map(v => {
      const yy = y(v);
      return `<g class="chart-grid-line ${v === 0 ? 'zero-grid' : ''}"><line x1="${MARGIN.left}" y1="${yy.toFixed(1)}" x2="${WIDTH-MARGIN.right}" y2="${yy.toFixed(1)}"></line><text x="${MARGIN.left-12}" y="${(yy+4).toFixed(1)}" text-anchor="end">${compactYen(v)}</text></g>`;
    }).join('');

    const xTickCount = Math.min(6, coords.length);
    const xTickIndices = xTickCount === 1 ? [0] : Array.from({length:xTickCount}, (_,i) => Math.round((coords.length-1) * i / (xTickCount-1)));
    const xTicks = [...new Set(xTickIndices)].map(i => {
      const p = coords[i];
      return `<text class="chart-x-label" x="${p.x.toFixed(1)}" y="${HEIGHT-17}" text-anchor="middle">${dateLabel(p.date)}</text>`;
    }).join('');

    const dots = coords.map(p => `<circle class="chart-point" data-chart-index="${p.index}" data-x="${p.x.toFixed(2)}" data-y="${p.y.toFixed(2)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.4"></circle>`).join('');
    const last = allSeries[allSeries.length-1];
    const peak = Math.max(...allSeries.map(p => p.cumulative));
    const trough = Math.min(...allSeries.map(p => p.cumulative));

    return `<section class="cumulative-chart-panel panel" data-chart-range="${range}">
      <div class="chart-head">
        <div><h3>時系列累積収支</h3><p>ホバー / タップで詳細表示・実日付間隔 / 1pt=1円換算</p></div>
        <div class="chart-stats">
          <div><span>現在</span><strong class="${last.cumulative >= 0 ? 'positive':'negative'}">${yen(last.cumulative)}</strong></div>
          <div><span>最高</span><strong>${yen(peak)}</strong></div>
          <div><span>最低</span><strong>${yen(trough)}</strong></div>
        </div>
      </div>
      <div class="chart-toolbar" aria-label="グラフ表示期間">
        <button type="button" class="chart-range-btn ${range === 'all' ? 'active' : ''}" data-range="all">全期間</button>
        <button type="button" class="chart-range-btn ${range === '30d' ? 'active' : ''}" data-range="30d">30日</button>
        <button type="button" class="chart-range-btn ${range === '7d' ? 'active' : ''}" data-range="7d">7日</button>
        <span class="chart-axis-note">縦軸 ${compactYen(domain.step)} 刻み</span>
      </div>
      <div class="chart-wrap">
        <div class="chart-stage">
          <svg class="cumulative-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" tabindex="0" aria-label="時系列累積収支グラフ。左右キーでデータ点を移動できます。">
            ${grid}
            <line class="chart-zero-line" x1="${MARGIN.left}" y1="${zeroY.toFixed(1)}" x2="${WIDTH-MARGIN.right}" y2="${zeroY.toFixed(1)}"></line>
            <polyline class="chart-line" points="${polyline}"></polyline>
            ${dots}
            <line class="chart-crosshair chart-crosshair-x" x1="0" y1="${MARGIN.top}" x2="0" y2="${HEIGHT-MARGIN.bottom}"></line>
            <line class="chart-crosshair chart-crosshair-y" x1="${MARGIN.left}" y1="0" x2="${WIDTH-MARGIN.right}" y2="0"></line>
            <circle class="chart-focus-dot" cx="0" cy="0" r="6.2"></circle>
            <rect class="chart-hit-area" x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
            ${xTicks}
          </svg>
          <div class="chart-tooltip" role="status" aria-live="polite" hidden>
            <div class="chart-tooltip-date"></div>
            <div class="chart-tooltip-grid">
              <span>当日</span><strong class="chart-tooltip-daily"></strong>
              <span>累積</span><strong class="chart-tooltip-cumulative"></strong>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }

  function bindChart(panel, allSeries) {
    if (!panel || panel.dataset.chartBound === '1') return;
    panel.dataset.chartBound = '1';
    const range = panel.dataset.chartRange || activeRange;
    const series = rangeSeries(allSeries, range);

    panel.querySelectorAll('.chart-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeRange = btn.dataset.range || 'all';
        replaceChart(allSeries);
      });
    });

    const svg = panel.querySelector('.cumulative-chart');
    const hit = panel.querySelector('.chart-hit-area');
    const tooltip = panel.querySelector('.chart-tooltip');
    if (!svg || !hit || !tooltip || !series.length) return;

    const points = [...panel.querySelectorAll('.chart-point')].map((el, index) => ({
      el,
      index,
      x:num(el.dataset.x),
      y:num(el.dataset.y),
      data:series[index]
    }));
    const crossX = panel.querySelector('.chart-crosshair-x');
    const crossY = panel.querySelector('.chart-crosshair-y');
    const focusDot = panel.querySelector('.chart-focus-dot');
    const dateEl = panel.querySelector('.chart-tooltip-date');
    const dailyEl = panel.querySelector('.chart-tooltip-daily');
    const cumulativeEl = panel.querySelector('.chart-tooltip-cumulative');
    const stage = panel.querySelector('.chart-stage');
    let activeIndex = Math.max(0, points.length - 1);
    let locked = false;

    function nearestIndex(svgX) {
      let best = 0, bestDistance = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(p.x - svgX);
        if (d < bestDistance) { best = i; bestDistance = d; }
      });
      return best;
    }

    function select(index, persist = false) {
      if (!points.length) return;
      activeIndex = Math.max(0, Math.min(points.length - 1, index));
      if (persist) locked = true;
      const p = points[activeIndex];
      points.forEach((item, i) => item.el.classList.toggle('is-active', i === activeIndex));
      crossX.setAttribute('x1', p.x); crossX.setAttribute('x2', p.x);
      crossY.setAttribute('y1', p.y); crossY.setAttribute('y2', p.y);
      focusDot.setAttribute('cx', p.x); focusDot.setAttribute('cy', p.y);
      crossX.classList.add('visible'); crossY.classList.add('visible'); focusDot.classList.add('visible');

      dateEl.textContent = fullDateLabel(p.data.date);
      dailyEl.textContent = signedYen(p.data.net);
      dailyEl.classList.toggle('positive', p.data.net > 0);
      dailyEl.classList.toggle('negative', p.data.net < 0);
      cumulativeEl.textContent = yen(p.data.cumulative);
      cumulativeEl.classList.toggle('positive', p.data.cumulative > 0);
      cumulativeEl.classList.toggle('negative', p.data.cumulative < 0);
      tooltip.hidden = false;

      const svgRect = svg.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const px = (p.x / WIDTH) * svgRect.width + svgRect.left - stageRect.left;
      const py = (p.y / HEIGHT) * svgRect.height + svgRect.top - stageRect.top;
      const tipW = tooltip.offsetWidth || 150;
      const tipH = tooltip.offsetHeight || 72;
      const left = Math.max(8, Math.min(stageRect.width - tipW - 8, px + 14));
      const above = py - tipH - 12;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${above >= 8 ? above : py + 14}px`;
    }

    function hide() {
      if (locked) return;
      tooltip.hidden = true;
      points.forEach(p => p.el.classList.remove('is-active'));
      crossX.classList.remove('visible'); crossY.classList.remove('visible'); focusDot.classList.remove('visible');
    }

    function eventSvgX(event) {
      const rect = svg.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * WIDTH;
    }

    hit.addEventListener('pointermove', e => {
      if (locked && e.pointerType !== 'mouse') return;
      select(nearestIndex(eventSvgX(e)), false);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointerdown', e => {
      e.preventDefault();
      select(nearestIndex(eventSvgX(e)), true);
    });
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault(); locked = true; select(activeIndex - 1, true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault(); locked = true; select(activeIndex + 1, true);
      } else if (e.key === 'Escape') {
        locked = false; hide();
      }
    });
    svg.addEventListener('dblclick', () => { locked = false; hide(); });
  }

  function replaceChart(series) {
    const view = document.querySelector('#view-history');
    if (!view) return;
    const old = view.querySelector('.cumulative-chart-panel');
    if (old) old.remove();
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    head.insertAdjacentHTML('afterend', makeChart(series, activeRange));
    bindChart(view.querySelector('.cumulative-chart-panel'), series);
  }

  function injectChart() {
    scheduled = false;
    const view = document.querySelector('#view-history');
    if (!view || view.querySelector('.cumulative-chart-panel')) return;
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    const series = dailySeries();
    head.insertAdjacentHTML('afterend', makeChart(series, activeRange));
    bindChart(view.querySelector('.cumulative-chart-panel'), series);
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