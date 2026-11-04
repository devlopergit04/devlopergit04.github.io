/* charts.js — dependency-free canvas charts (sparkline, donut, bars).
   Colours are read from the live CSS custom properties so both themes match. */

function cssVar(name, fallback = '#10b981') {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function prepare(canvas) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(40, Math.round(rect.width));
  const h = Math.max(30, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Speed history: samples = [{ts, bps}] */
export function drawSparkline(canvas, samples, opts = {}) {
  const { ctx, w, h } = prepare(canvas);
  const pad = { t: 8, r: 6, b: 16, l: 6 };
  const accent = cssVar('--accent', '#34d399');
  const grid = cssVar('--border', '#064e3b');
  const dim = cssVar('--muted', '#6ee7b7');

  const data = (samples || []).slice(-(opts.points || 60));
  const max = Math.max(1, ...data.map((d) => d.bps || 0));

  // grid + peak label
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.globalAlpha = .55;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / 3;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = dim;
  ctx.textAlign = 'left';
  ctx.fillText(fmt(max), pad.l + 2, pad.t + 9);
  ctx.textAlign = 'right';
  ctx.fillText('0', w - pad.r - 2, h - pad.b + 11);

  if (data.length < 2) {
    ctx.fillStyle = dim;
    ctx.textAlign = 'center';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(opts.emptyText || '—', w / 2, h / 2);
    return;
  }

  const x = (i) => pad.l + ((w - pad.l - pad.r) * i) / (data.length - 1);
  const y = (v) => h - pad.b - ((h - pad.t - pad.b) * (v / max));

  // area
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, hexA(accent, .38));
  grad.addColorStop(1, hexA(accent, 0));
  ctx.beginPath();
  ctx.moveTo(x(0), h - pad.b);
  data.forEach((d, i) => ctx.lineTo(x(i), y(d.bps || 0)));
  ctx.lineTo(x(data.length - 1), h - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.bps || 0)) : ctx.moveTo(x(i), y(d.bps || 0))));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // head dot
  const last = data[data.length - 1];
  ctx.beginPath();
  ctx.arc(x(data.length - 1), y(last.bps || 0), 2.8, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = hexA(accent, .35);
  ctx.lineWidth = 5;
  ctx.stroke();
}

/** slices = [{label, value, color}] */
export function drawDonut(canvas, slices, opts = {}) {
  const { ctx, w, h } = prepare(canvas);
  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = size / 2 - 6;
  const inner = r * (opts.inner ?? 0.62);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const dim = cssVar('--muted');

  if (!total) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r + inner) / 2, 0, Math.PI * 2);
    ctx.strokeStyle = cssVar('--border');
    ctx.lineWidth = r - inner;
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(opts.emptyText || '—', cx, cy + 4);
    return;
  }

  let angle = -Math.PI / 2;
  slices.forEach((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.arc(cx, cy, inner, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = cssVar('--bg-2', '#022c22');
    ctx.lineWidth = 2;
    ctx.stroke();
    angle += sweep;
  });

  ctx.fillStyle = cssVar('--text');
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.round(size * 0.16)}px system-ui, sans-serif`;
  ctx.fillText(String(opts.centerValue ?? total), cx, cy + 2);
  if (opts.centerLabel) {
    ctx.fillStyle = dim;
    ctx.font = `10px system-ui, sans-serif`;
    ctx.fillText(opts.centerLabel, cx, cy + size * 0.14);
  }
}

/** bars = [{label, value, color}] — horizontal engine/kind breakdown */
export function drawBars(canvas, bars, opts = {}) {
  const { ctx, w, h } = prepare(canvas);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const rowH = Math.min(26, h / Math.max(1, bars.length));
  const labelW = opts.labelW ?? 74;
  ctx.font = '11px system-ui, sans-serif';
  bars.forEach((b, i) => {
    const y = i * rowH + rowH * 0.22;
    const bh = rowH * 0.5;
    ctx.fillStyle = cssVar('--muted');
    ctx.textAlign = 'left';
    ctx.fillText(b.label, 2, y + bh - 3);
    const trackX = labelW;
    const trackW = w - labelW - 34;
    ctx.fillStyle = cssVar('--border');
    roundRect(ctx, trackX, y, trackW, bh, 4); ctx.fill();
    const v = (b.value / max) * trackW;
    if (v > 0) {
      ctx.fillStyle = b.color || cssVar('--primary');
      roundRect(ctx, trackX, y, Math.max(4, v), bh, 4); ctx.fill();
    }
    ctx.fillStyle = cssVar('--text-dim');
    ctx.textAlign = 'right';
    ctx.fillText(String(b.value), w - 2, y + bh - 3);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex, alpha) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function fmt(bps) {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(0)} KiB/s`;
  return `${(bps / 1048576).toFixed(1)} MiB/s`;
}

/** Re-draw every visible chart after a resize / theme change. */
export function redrawAll() {
  document.querySelectorAll('canvas.chart[data-chart]').forEach((c) => {
    const evt = new CustomEvent('chart:redraw', { bubbles: false });
    c.dispatchEvent(evt);
  });
}
