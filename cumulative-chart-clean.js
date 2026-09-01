(() => {
  'use strict';

  const STORAGE_KEY = 'forexCampaignTracker.v1';
  const CLICK_ENDS = ['2026-07-03','2026-07-10','2026-07-17','2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21','2026-08-28','2026-09-04','2026-09-11','2026-09-18','2026-09-25'];
  const ONE_ENDS = ['2026-06-06','2026-06-13','2026-06-20','2026-06-27','2026-07-04','2026-07-11','2026-07-18','2026-07-25','2026-08-01','2026-08-08','2026-08-15','2026-08-22','2026-08-29'];
  let activeRange = 'all';
  let scheduled = false;
  let cleanupChart = null;

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
    if (!n) return '¥0';
    return `${n > 0 ? '+' : '-'}¥${Math.abs(n).toLocaleString('ja-JP')}`;
  };
  const axisYen = v => {
    const n = Math.round(num(v));
    const abs = Math.abs(n);
    if (abs >= 100000) return `${n < 0 ? '-' : ''}¥${Math.round(abs / 10000)}万`;
    if (abs >= 10000) return `${n < 0 ? '-' : ''}¥${(abs / 10000).toFixed(abs % 10000 ? 1 : 0)}万`;
    return `${n < 0 ? '-' : ''}¥${abs.toLocaleString('ja-JP')}`;
  };
  const dateMs = s => new Date(`${s}T12:00:00+09:00`).getTime();
  const shortDate = s => {
    const [,m,d] = s.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
  const fullDate = s => s.replaceAll('-', '/');

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
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
      const i = Number(String(key).replace('week','')) - 1;
      const date = CLICK_ENDS[i];
      add(date, num(r.fxReward) + num(r.cfdReward) - num(r.fxCost) - num(r.cfdCost));
    });
    Object.entries(state.oneaccount || {}).forEach(([key, r]) => {
      const i = Number(String(key).replace('week','')) - 1;
      const date = ONE_ENDS[i];
      const pnl = has(r.investmentPnl) ? num(r.investmentPnl) : (has(r.cost) ? -num(r.cost) : 0);
      add(date, pnl + num(r.points));
    });

    let cumulative = 0;
    return [...daily.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([date, net]) => {
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

  function niceStep(span, target = 5) {
    if (!Number.isFinite(span) || span <= 0) return 100;
    const rough = span / target;
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * power;
  }

  function niceDomain(values) {
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (min === max) {
      const bump = Math.max(100, Math.abs(min) * .2 || 100);
      min -= bump; max += bump;
    }
    let step = niceStep(max - min, 5);
    let lo = Math.floor(min / step) * step;
    let hi = Math.ceil(max / step) * step;
    let count = Math.round((hi - lo) / step) + 1;
    if (count > 7) {
      step = niceStep(max - min, 4);
      lo = Math.floor(min / step) * step;
      hi = Math.ceil(max / step) * step;
      count = Math.round((hi - lo) / step) + 1;
    }
    const ticks = [];
    for (let i = 0; i < count && i < 10; i++) ticks.push(lo + i * step);
    return { min: lo, max: hi, step, ticks };
  }

  function panelHtml(series) {
    if (!series.length) {
      return `<section class="clean-chart-panel panel"><div class="clean-chart-head"><div><h3>時系列累積収支</h3><p>全キャンペーン合算・1pt=1円換算</p></div></div><div class="clean-chart-empty">収支を入力するとグラフが表示されます。</div></section>`;
    }
    const last = series[series.length - 1];
    const peak = Math.max(...series.map(p => p.cumulative));
    const trough = Math.min(...series.map(p => p.cumulative));
    return `<section class="clean-chart-panel panel" data-range="${activeRange}">
      <div class="clean-chart-head">
        <div class="clean-chart-title"><h3>時系列累積収支</h3><p>全キャンペーン合算・実日付間隔 / 1pt=1円</p></div>
        <div class="clean-chart-summary">
          <div><span>現在</span><strong class="${last.cumulative >= 0 ? 'positive':'negative'}">${yen(last.cumulative)}</strong></div>
          <div><span>最高</span><strong>${yen(peak)}</strong></div>
          <div><span>最低</span><strong>${yen(trough)}</strong></div>
        </div>
      </div>
      <div class="clean-chart-toolbar">
        <div class="clean-range-group" aria-label="表示期間">
          <button type="button" data-clean-range="all" class="${activeRange === 'all' ? 'active':''}">全期間</button>
          <button type="button" data-clean-range="30d" class="${activeRange === '30d' ? 'active':''}">30日</button>
          <button type="button" data-clean-range="7d" class="${activeRange === '7d' ? 'active':''}">7日</button>
        </div>
        <div class="clean-live-readout" aria-live="polite">
          <span class="clean-readout-date">—</span>
          <span>当日 <strong class="clean-readout-daily">—</strong></span>
          <span>累積 <strong class="clean-readout-total">—</strong></span>
        </div>
      </div>
      <div class="clean-canvas-wrap">
        <canvas class="clean-chart-canvas" aria-label="時系列累積収支グラフ"></canvas>
      </div>
    </section>`;
  }

  function mountCanvas(panel, allSeries) {
    if (!panel) return () => {};
    panel.querySelectorAll('[data-clean-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeRange = btn.dataset.cleanRange || 'all';
        replaceChart();
      });
    });

    const canvas = panel.querySelector('.clean-chart-canvas');
    if (!canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const range = panel.dataset.range || activeRange;
    const series = rangeSeries(allSeries, range);
    if (!series.length) return () => {};

    const dateEl = panel.querySelector('.clean-readout-date');
    const dailyEl = panel.querySelector('.clean-readout-daily');
    const totalEl = panel.querySelector('.clean-readout-total');
    let hoverX = null;
    let selectedIndex = series.length - 1;
    let raf = 0;
    let layout = null;

    function theme() {
      const css = getComputedStyle(document.documentElement);
      return {
        accent: css.getPropertyValue('--accent').trim() || '#b9ff66',
        text: css.getPropertyValue('--text').trim() || '#f5f7fa',
        muted: css.getPropertyValue('--muted-2').trim() || '#657080',
        surface: css.getPropertyValue('--surface').trim() || '#111419'
      };
    }

    function updateReadout(index) {
      const p = series[Math.max(0, Math.min(series.length - 1, index))];
      if (!p) return;
      dateEl.textContent = fullDate(p.date);
      dailyEl.textContent = signedYen(p.net);
      totalEl.textContent = yen(p.cumulative);
      dailyEl.classList.toggle('positive', p.net > 0);
      dailyEl.classList.toggle('negative', p.net < 0);
      totalEl.classList.toggle('positive', p.cumulative > 0);
      totalEl.classList.toggle('negative', p.cumulative < 0);
    }

    function nearestByX(x, points) {
      let best = 0, distance = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(p.x - x);
        if (d < distance) { distance = d; best = i; }
      });
      return best;
    }

    function draw() {
      raf = 0;
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const mobile = cssW < 560;
      const margin = { left: mobile ? 48 : 68, right: mobile ? 10 : 18, top: 14, bottom: mobile ? 30 : 34 };
      const plotW = Math.max(10, cssW - margin.left - margin.right);
      const plotH = Math.max(10, cssH - margin.top - margin.bottom);
      const times = series.map(p => dateMs(p.date));
      let minT = Math.min(...times), maxT = Math.max(...times);
      if (minT === maxT) { minT -= 86400000; maxT += 86400000; }
      const domain = niceDomain(series.map(p => p.cumulative));
      const x = date => margin.left + ((dateMs(date) - minT) / (maxT - minT)) * plotW;
      const y = value => margin.top + ((domain.max - value) / (domain.max - domain.min)) * plotH;
      const points = series.map(p => ({ ...p, x:x(p.date), y:y(p.cumulative) }));
      const colors = theme();
      layout = { margin, plotW, plotH, points };

      ctx.font = `${mobile ? 9 : 10}px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1;

      domain.ticks.forEach(v => {
        const yy = y(v);
        ctx.beginPath();
        ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,.15)' : 'rgba(255,255,255,.055)';
        ctx.setLineDash(v === 0 ? [4,4] : []);
        ctx.moveTo(margin.left, yy);
        ctx.lineTo(cssW - margin.right, yy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.muted;
        ctx.textAlign = 'right';
        ctx.fillText(axisYen(v), margin.left - 8, yy);
      });

      const xTickCount = Math.min(mobile ? 4 : 6, points.length);
      const indices = xTickCount <= 1 ? [0] : Array.from({length:xTickCount}, (_,i) => Math.round((points.length - 1) * i / (xTickCount - 1)));
      [...new Set(indices)].forEach(i => {
        const p = points[i];
        ctx.fillStyle = colors.muted;
        ctx.textAlign = i === 0 ? 'left' : i === points.length - 1 ? 'right' : 'center';
        ctx.fillText(shortDate(p.date), p.x, cssH - 12);
      });

      if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.lineTo(points[points.length - 1].x, margin.top + plotH);
        ctx.lineTo(points[0].x, margin.top + plotH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotH);
        grad.addColorStop(0, 'rgba(185,255,102,.12)');
        grad.addColorStop(1, 'rgba(185,255,102,0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = mobile ? 2 : 2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      if (hoverX !== null && layout) {
        const clamped = Math.max(margin.left, Math.min(cssW - margin.right, hoverX));
        selectedIndex = nearestByX(clamped, points);
        const p = points[selectedIndex];
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3,4]);
        ctx.moveTo(clamped, margin.top);
        ctx.lineTo(clamped, margin.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.fillStyle = colors.surface;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2.5;
        ctx.arc(p.x, p.y, mobile ? 4.5 : 5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        updateReadout(selectedIndex);
      } else {
        updateReadout(selectedIndex);
      }
    }

    function scheduleDraw() {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    function pointerX(event) {
      const rect = canvas.getBoundingClientRect();
      return event.clientX - rect.left;
    }

    canvas.addEventListener('pointermove', e => {
      hoverX = pointerX(e);
      scheduleDraw();
    });
    canvas.addEventListener('pointerdown', e => {
      hoverX = pointerX(e);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      scheduleDraw();
    });
    canvas.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse') {
        hoverX = null;
        scheduleDraw();
      }
    });
    canvas.addEventListener('pointerup', e => {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    const ro = new ResizeObserver(scheduleDraw);
    ro.observe(canvas);
    updateReadout(selectedIndex);
    scheduleDraw();

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }

  function replaceChart() {
    if (cleanupChart) { cleanupChart(); cleanupChart = null; }
    const view = document.querySelector('#view-history');
    if (!view) return;
    const old = view.querySelector('.clean-chart-panel');
    if (old) old.remove();
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    const all = dailySeries();
    head.insertAdjacentHTML('afterend', panelHtml(all));
    cleanupChart = mountCanvas(view.querySelector('.clean-chart-panel'), all);
  }

  function injectChart() {
    scheduled = false;
    const view = document.querySelector('#view-history');
    if (!view || view.querySelector('.clean-chart-panel')) return;
    const head = view.querySelector('.campaign-head');
    if (!head) return;
    const all = dailySeries();
    head.insertAdjacentHTML('afterend', panelHtml(all));
    cleanupChart = mountCanvas(view.querySelector('.clean-chart-panel'), all);
  }

  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(injectChart);
  }

  const historyView = document.querySelector('#view-history');
  if (historyView) new MutationObserver(scheduleInject).observe(historyView, { childList:true, subtree:false });
  document.querySelectorAll('[data-view="history"]').forEach(el => el.addEventListener('click', scheduleInject));
  window.addEventListener('storage', replaceChart);
  scheduleInject();
})();