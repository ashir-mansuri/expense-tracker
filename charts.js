// SVG charts in the metallic palette. All functions return an HTML string.
export const PALETTE = ['#E6C76A', '#7F8694', '#F3E3A6', '#A8742A', '#D9DDE3', '#6A7180'];
export const OTHER = '#3A3E46';
export const GOLD = '#D4AF37', GOLD_BRIGHT = '#F5DF8E', GOLD_DEEP = '#9C7A22';
export const SILVER = '#C9CDD5', SILVER_MUTED = '#8B919C', WARNING = '#E5484D', TRACK = 'rgba(255,255,255,0.10)';

export const slotColor = (slot) => (slot === null || slot === undefined ? OTHER : PALETTE[slot % PALETTE.length]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function donut(slices, { size = 136, thickness = 20, centerTop = '', centerMain = '' } = {}) {
  const total = slices.reduce((a, s) => a + s.total, 0);
  const r = size / 2 - thickness / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const gap = total > 0 && slices.length > 1 ? 2.5 : 0;
  const parts = slices.map((s) => {
    const len = total > 0 ? (s.total / total) * circ : 0;
    const dash = Math.max(len - gap, 0);
    const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${slotColor(s.slot)}" stroke-width="${thickness}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset + circ / 4}" stroke-linecap="butt" class="donut-seg"></circle>`;
    offset += len;
    return el;
  });
  if (total === 0) parts.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${thickness}"></circle>`);
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">${parts.join('')}
    <text x="${c}" y="${c - 6}" text-anchor="middle" class="donut-top">${esc(centerTop)}</text>
    <text x="${c}" y="${c + 14}" text-anchor="middle" class="donut-main">${esc(centerMain)}</text></svg>`;
}

export function bar(ratio, { fill = 'gold', height = 6 } = {}) {
  const w = Math.max(0, Math.min(ratio, 1)) * 100;
  const cls = fill === 'gold' ? 'bar-gold' : fill === 'silver' ? 'bar-silver' : fill === 'warn' ? 'bar-warn' : '';
  return `<div class="bar" style="height:${height}px"><div class="bar-fill ${cls}" style="width:${w.toFixed(1)}%"></div></div>`;
}

export function columns(points, { height = 190, formatY = (v) => String(v) } = {}) {
  // grouped income / expense columns, one group per label
  const w = 320, padL = 8, padR = 44, padT = 12, padB = 24;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
  const niceMax = niceCeil(max);
  const groupW = innerW / points.length;
  const barW = Math.min(groupW * 0.3, 18);
  const y = (v) => padT + innerH - (v / niceMax) * innerH;
  const ticks = [0, 0.5, 1].map((f) => f * niceMax);
  let out = `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" class="chart" role="img">`;
  for (const t of ticks) out += `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${w - padR + 6}" y="${y(t) + 4}" class="axis">${esc(formatY(t))}</text>`;
  points.forEach((p, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const ih = innerH * (p.income / niceMax), eh = innerH * (p.expense / niceMax);
    out += `<rect x="${cx - barW - 1.5}" y="${y(p.income)}" width="${barW}" height="${ih}" rx="3" fill="url(#g-gold)" class="col"></rect>`;
    out += `<rect x="${cx + 1.5}" y="${y(p.expense)}" width="${barW}" height="${eh}" rx="3" fill="url(#g-silver)" class="col"></rect>`;
    out += `<text x="${cx}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.label)}</text>`;
  });
  return out + defs() + '</svg>';
}

export function dailyBars(points, average, { height = 150, formatY = (v) => String(v) } = {}) {
  const w = 320, padL = 4, padR = 40, padT = 10, padB = 22;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.total), average);
  const niceMax = niceCeil(max);
  const slot = innerW / points.length;
  const barW = Math.max(slot * 0.55, 2);
  const y = (v) => padT + innerH - (v / niceMax) * innerH;
  let out = `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" class="chart" role="img">`;
  for (const f of [0, 0.5, 1]) { const t = f * niceMax; out += `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${w - padR + 6}" y="${y(t) + 4}" class="axis">${esc(formatY(t))}</text>`; }
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const hot = p.total > average * 2;
    out += `<rect x="${x}" y="${y(p.total)}" width="${barW}" height="${innerH * (p.total / niceMax)}" rx="1.5" fill="${hot ? 'url(#g-gold)' : 'url(#g-silver-v)'}" class="col"></rect>`;
    if ([1, 8, 15, 22, 29].includes(p.day)) out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${p.day}</text>`;
  });
  if (average > 0) out += `<line x1="${padL}" x2="${w - padR}" y1="${y(average)}" y2="${y(average)}" class="avg"></line>`;
  return out + defs() + '</svg>';
}

export function weekdayBars(points, { height = 140, formatY = (v) => String(v) } = {}) {
  const w = 320, padL = 4, padR = 40, padT = 10, padB = 22;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.average));
  const niceMax = niceCeil(max);
  const busiest = points.reduce((a, b) => (b.average > a.average ? b : a), points[0]);
  const slot = innerW / points.length, barW = slot * 0.6;
  const y = (v) => padT + innerH - (v / niceMax) * innerH;
  let out = `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" class="chart" role="img">`;
  for (const f of [0, 0.5, 1]) { const t = f * niceMax; out += `<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${w - padR + 6}" y="${y(t) + 4}" class="axis">${esc(formatY(t))}</text>`; }
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    out += `<rect x="${x}" y="${y(p.average)}" width="${barW}" height="${innerH * (p.average / niceMax)}" rx="3" fill="${p === busiest && p.average > 0 ? 'url(#g-gold)' : 'url(#g-silver-v)'}" class="col"></rect>`;
    out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.name)}</text>`;
  });
  return out + defs() + '</svg>';
}

export function balanceBars(points, { height = 170, format = (v) => String(v) } = {}) {
  const w = 320, padL = 4, padR = 40, padT = 18, padB = 22;
  const innerW = w - padL - padR, innerH = height - padT - padB;
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.balance)));
  const niceMax = niceCeil(maxAbs);
  const zero = padT + innerH / 2;
  const scale = (innerH / 2) / niceMax;
  const slot = innerW / points.length, barW = slot * 0.55;
  let out = `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" class="chart" role="img">`;
  out += `<line x1="${padL}" x2="${w - padR}" y1="${zero}" y2="${zero}" class="grid strong"></line>`;
  out += `<text x="${w - padR + 6}" y="${zero + 4}" class="axis">0</text>`;
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const h = Math.abs(p.balance) * scale;
    const yTop = p.balance >= 0 ? zero - h : zero;
    out += `<rect x="${x}" y="${yTop}" width="${barW}" height="${h}" rx="3" fill="${p.balance >= 0 ? 'url(#g-gold)' : WARNING}" class="col"></rect>`;
    const ly = p.balance >= 0 ? yTop - 4 : yTop + h + 10;
    out += `<text x="${x + barW / 2}" y="${ly}" text-anchor="middle" class="axis tiny">${esc(format(p.balance))}</text>`;
    out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.label)}</text>`;
  });
  return out + defs() + '</svg>';
}

export function ring(rate, { size = 68, text = '', sub = 'kept' } = {}) {
  const r = size / 2 - 5, c = size / 2, circ = 2 * Math.PI * r;
  const clamped = Math.max(Math.min(rate, 1), 0);
  const color = rate >= 0 ? 'url(#g-gold)' : WARNING;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring" role="img">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="7"></circle>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${clamped * circ} ${circ}" transform="rotate(-90 ${c} ${c})" class="ring-fill"></circle>
    <text x="${c}" y="${c + 1}" text-anchor="middle" class="ring-main" fill="${rate >= 0 ? GOLD : WARNING}">${esc(text)}</text>
    <text x="${c}" y="${c + 13}" text-anchor="middle" class="ring-sub">${esc(sub)}</text>${defs()}</svg>`;
}

function defs() {
  return `<defs>
    <linearGradient id="g-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD_BRIGHT}"/><stop offset="1" stop-color="${GOLD_DEEP}"/></linearGradient>
    <linearGradient id="g-silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SILVER}"/><stop offset="1" stop-color="${SILVER_MUTED}" stop-opacity="0.7"/></linearGradient>
    <linearGradient id="g-silver-v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E4E7EC"/><stop offset="1" stop-color="${SILVER_MUTED}"/></linearGradient>
  </defs>`;
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}
