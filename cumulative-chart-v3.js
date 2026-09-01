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
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
      add(date, num(r.reward) - fxCost - num(r.cfdCost));
    });

    Object.entries(state.clickfx || {}).forEach(([key, r]) => {
      const index = Number(String(key).replace('week', '')) - 1;
      const date = CLICK_ENDS[index];
      add(date, num(r.fxReward) + num(r.cfdReward) - num(r.fxCost) - num(r.cfdCost));
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

  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const dx = p2.x - p1.x;
      const safeDx1 = Math.max(1e-6, p2.x - p0.x);
      const safeDx2 = Math.max(1e-6, p3.x - p1.x);
      const slope1 = (p2.y - p0.y) / safeDx1;
      const slope2 = (p3.y - p1.y) / safeDx2;
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      const cp1x = p1.x + dx * 0.34;
      const cp2x = p2.x - dx * 0.34;
      const cp1y = clamp(p1.y + slope1 * dx * 0.34, minY, maxY);
      const cp2y = clamp(p2.y - slope2 * dx * 0.34, minY, maxY);
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
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
    const linePath = smoothPath(coords);
    const baseline = y(0);
    const areaPath = `${linePath} L ${coords[coords.length-1].x.toFixed(2)} ${baseline.toFixed(2)} L ${coords[0].x.toFixed(2)} ${baseline.toFixed(2)} Z`;

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
        <div><h3>時系列累積収支</h3><p>なぞって詳細表示・実日付間隔 / 1pt=1円換算</p></div>
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
          <svg class="cumulative-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" tabindex="0" aria-label="時系列累積収支グラフ。左右キーで記録点を移動できます。">
            <defs>
              <linearGradient id="chart-area-gradient-v3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.12"></stop>
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"></stop>
              </linearGradient>
            </defs>
            ${grid}
            <line class="chart-zero-line" x1="${MARGIN.left}" y1="${baseline.toFixed(1)}" x2="${WIDTH-MARGIN.right}" y2="${baseline.toFixed(1)}"></line>
            <path class="chart-area" d="${areaPath}"></path>
            <path class="chart-line" d="${linePath}"></path>
            ${dots}
            <line class="chart-crosshair chart-crosshair-x" x1="0" y1="${MARGIN.top}" x2="0" y2="${HEIGHT-MARGIN.bottom}"></line>
            <line class="chart-crosshair chart-crosshair-y" x1="${MARGIN.left}" y1="0" x2="${WIDTH-MARGIN.right}" y2="0"></line>
            <circle class="chart-focus-halo" cx="0" cy="0" r="11"></circle>
            <circle class="chart-focus-dot" cx="0" cy="0" r="5.7"></circle>
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
    const stage = panel.querySelector('.chart-stage');
    if (!svg || !hit || !tooltip || !stage || !series.length) return;

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
    const focusHalo = panel.querySelector('.chart-focus-halo');
    const dateEl = panel.querySelector('.chart-tooltip-date');
    const dailyEl = panel.querySelector('.chart-tooltip-daily');
    const cumulativeEl = panel.querySelector('.chart-tooltip-cumulative');

    let activeIndex = Math.max(0, points.length - 1);
    let visible = false;
    let pinned = false;
    let dragging = false;
    let raf = 0;
    let tooltipMeasured = false;
    let tipW = 154;
    let tipH = 72;

    const motion = {
      x: points[activeIndex].x,
      y: points[activeIndex].y,
      cursorX: points[activeIndex].x,
      tipX: 0,
      tipY: 0,
      vx: 0,
      vy: 0,
      vcx: 0,
      vtx: 0,
      vty: 0,
      targetX: points[activeIndex].x,
      targetY: points[activeIndex].y,
      targetCursorX: points[activeIndex].x,
      targetTipX: 0,
      targetTipY: 0
    };

    function nearestIndex(svgX) {
      let lo = 0, hi = points.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (points[mid].x < svgX) lo = mid + 1;
        else hi = mid;
      }
      if (lo === 0) return 0;
      const a = points[lo - 1], b = points[lo];
      return Math.abs(svgX - a.x) <= Math.abs(b.x - svgX) ? lo - 1 : lo;
    }

    function setTooltipData(index) {
      const p = points[index];
      dateEl.textContent = fullDateLabel(p.data.date);
      dailyEl.textContent = signedYen(p.data.net);
      dailyEl.classList.toggle('positive', p.data.net > 0);
      dailyEl.classList.toggle('negative', p.data.net < 0);
      cumulativeEl.textContent = yen(p.data.cumulative);
      cumulativeEl.classList.toggle('positive', p.data.cumulative > 0);
      cumulativeEl.classList.toggle('negative', p.data.cumulative < 0);
    }

    function positionTooltipTarget() {
      const svgRect = svg.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      if (!tooltipMeasured && !tooltip.hidden) {
        tipW = tooltip.offsetWidth || tipW;
        tipH = tooltip.offsetHeight || tipH;
        tooltipMeasured = true;
      }
      const px = (motion.targetX / WIDTH) * svgRect.width + svgRect.left - stageRect.left;
      const py = (motion.targetY / HEIGHT) * svgRect.height + svgRect.top - stageRect.top;
      const preferLeft = px + tipW + 26 > stageRect.width;
      motion.targetTipX = clamp(preferLeft ? px - tipW - 16 : px + 16, 8, Math.max(8, stageRect.width - tipW - 8));
      const above = py - tipH - 14;
      motion.targetTipY = above >= 8 ? above : py + 16;
      if (!Number.isFinite(motion.tipX) || motion.tipX === 0) {
        motion.tipX = motion.targetTipX;
        motion.tipY = motion.targetTipY;
      }
    }

    function setTarget(index, cursorX, persist = false) {
      if (!points.length) return;
      activeIndex = clamp(index, 0, points.length - 1);
      if (persist) pinned = true;
      const p = points[activeIndex];
      motion.targetX = p.x;
      motion.targetY = p.y;
      motion.targetCursorX = Number.isFinite(cursorX) ? clamp(cursorX, MARGIN.left, WIDTH - MARGIN.right) : p.x;
      points.forEach((item, i) => item.el.classList.toggle('is-active', i === activeIndex));
      setTooltipData(activeIndex);
      if (!visible) {
        visible = true;
        tooltip.hidden = false;
        panel.classList.add('chart-active');
        motion.x = p.x;
        motion.y = p.y;
        motion.cursorX = motion.targetCursorX;
      }
      positionTooltipTarget();
      startAnimation();
    }

    function spring(current, velocity, target, stiffness, damping) {
      const nextVelocity = (velocity + (target - current) * stiffness) * damping;
      return [current + nextVelocity, nextVelocity];
    }

    function frame() {
      raf = 0;
      if (!visible) return;

      [motion.x, motion.vx] = spring(motion.x, motion.vx, motion.targetX, 0.17, 0.72);
      [motion.y, motion.vy] = spring(motion.y, motion.vy, motion.targetY, 0.17, 0.72);
      [motion.cursorX, motion.vcx] = spring(motion.cursorX, motion.vcx, motion.targetCursorX, 0.24, 0.68);
      [motion.tipX, motion.vtx] = spring(motion.tipX, motion.vtx, motion.targetTipX, 0.15, 0.72);
      [motion.tipY, motion.vty] = spring(motion.tipY, motion.vty, motion.targetTipY, 0.15, 0.72);

      crossX.setAttribute('x1', motion.cursorX.toFixed(2));
      crossX.setAttribute('x2', motion.cursorX.toFixed(2));
      crossY.setAttribute('y1', motion.y.toFixed(2));
      crossY.setAttribute('y2', motion.y.toFixed(2));
      focusDot.setAttribute('cx', motion.x.toFixed(2));
      focusDot.setAttribute('cy', motion.y.toFixed(2));
      focusHalo.setAttribute('cx', motion.x.toFixed(2));
      focusHalo.setAttribute('cy', motion.y.toFixed(2));
      tooltip.style.transform = `translate3d(${motion.tipX.toFixed(2)}px, ${motion.tipY.toFixed(2)}px, 0)`;

      const error = Math.abs(motion.x-motion.targetX)+Math.abs(motion.y-motion.targetY)+Math.abs(motion.cursorX-motion.targetCursorX)+Math.abs(motion.tipX-motion.targetTipX)+Math.abs(motion.tipY-motion.targetTipY)+Math.abs(motion.vx)+Math.abs(motion.vy)+Math.abs(motion.vcx)+Math.abs(motion.vtx)+Math.abs(motion.vty);
      if (error > 0.08) raf = requestAnimationFrame(frame);
    }

    function startAnimation() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function hide(force = false) {
      if (pinned && !force) return;
      visible = false;
      tooltip.hidden = true;
      panel.classList.remove('chart-active');
      points.forEach(p => p.el.classList.remove('is-active'));
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      motion.vx = motion.vy = motion.vcx = motion.vtx = motion.vty = 0;
    }

    function eventSvgX(event) {
      const rect = svg.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * WIDTH;
    }

    function scrub(event, persist = false) {
      const sx = clamp(eventSvgX(event), MARGIN.left, WIDTH - MARGIN.right);
      setTarget(nearestIndex(sx), sx, persist);
    }

    hit.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse' && !pinned) scrub(e, false);
    });
    hit.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' || dragging) scrub(e, false);
    });
    hit.addEventListener('pointerleave', () => {
      if (!dragging) hide(false);
    });
    hit.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') e.preventDefault();
      dragging = true;
      pinned = true;
      try { hit.setPointerCapture(e.pointerId); } catch (_) {}
      scrub(e, true);
    });
    hit.addEventListener('pointerup', e => {
      dragging = false;
      try { hit.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    hit.addEventListener('pointercancel', () => { dragging = false; });

    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pinned = true;
        const next = Math.max(0, activeIndex - 1);
        setTarget(next, points[next].x, true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        pinned = true;
        const next = Math.min(points.length - 1, activeIndex + 1);
        setTarget(next, points[next].x, true);
      } else if (e.key === 'Escape') {
        pinned = false;
        hide(true);
      }
    });

    svg.addEventListener('dblclick', () => {
      pinned = false;
      hide(true);
    });
  }

  function replaceChart(series) {
    const view = document.querySelector('#view-history');
    if (!view) return;
    const old = view.querySelector('.cumulative-chart-panel');
    if (old) old.remove();
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    head.insertAdjacentHTML('afterend', makeChart(series, activeRange));
    const panel = view.querySelector('.cumulative-chart-panel');
    if (panel) {
      panel.classList.add('chart-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('chart-entering')));
    }
    bindChart(panel, series);
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