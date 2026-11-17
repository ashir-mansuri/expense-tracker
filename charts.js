// SVG charts. Colours come from CSS variables (--c1 … --c8, --good, --bad) so light and dark mode both work.
export const OTHER = 'var(--c-other)';
export const slotColor = (slot) => (slot === null || slot === undefined ? OTHER : `var(--c${(slot % 8) + 1})`);

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
    const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${slotColor(s.slot)}" stroke-width="${thickness}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset + circ / 4}" stroke-linecap="butt" class="donut-seg"></circle>`;
    offset += len;
    return el;
  });
  if (total === 0) parts.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--surface-2)" stroke-width="${thickness}"></circle>`);
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
    out += `<rect x="${cx - barW - 1.5}" y="${y(p.income)}" width="${barW}" height="${ih}" rx="3" style="fill:var(--good)" class="col"></rect>`;
    out += `<rect x="${cx + 1.5}" y="${y(p.expense)}" width="${barW}" height="${eh}" rx="3" style="fill:var(--c1)" class="col"></rect>`;
    out += `<text x="${cx}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.label)}</text>`;
  });
  return out + '</svg>';
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
    out += `<rect x="${x}" y="${y(p.total)}" width="${barW}" height="${innerH * (p.total / niceMax)}" rx="1.5" style="fill:${hot ? 'var(--c2)' : 'var(--line-strong)'}" class="col"></rect>`;
    if ([1, 8, 15, 22, 29].includes(p.day)) out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${p.day}</text>`;
  });
  if (average > 0) out += `<line x1="${padL}" x2="${w - padR}" y1="${y(average)}" y2="${y(average)}" class="avg"></line>`;
  return out + '</svg>';
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
    out += `<rect x="${x}" y="${y(p.average)}" width="${barW}" height="${innerH * (p.average / niceMax)}" rx="3" style="fill:${p === busiest && p.average > 0 ? 'var(--c1)' : 'var(--line-strong)'}" class="col"></rect>`;
    out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.name)}</text>`;
  });
  return out + '</svg>';
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
    out += `<rect x="${x}" y="${yTop}" width="${barW}" height="${h}" rx="3" style="fill:${p.balance >= 0 ? 'var(--good)' : 'var(--bad)'}" class="col"></rect>`;
    const ly = p.balance >= 0 ? yTop - 4 : yTop + h + 10;
    out += `<text x="${x + barW / 2}" y="${ly}" text-anchor="middle" class="axis tiny">${esc(format(p.balance))}</text>`;
    out += `<text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="axis">${esc(p.label)}</text>`;
  });
  return out + '</svg>';
}

export function ring(rate, { size = 68, text = '', sub = 'kept' } = {}) {
  const r = size / 2 - 5, c = size / 2, circ = 2 * Math.PI * r;
  const clamped = Math.max(Math.min(rate, 1), 0);
  const color = rate >= 0 ? 'var(--good)' : 'var(--bad)';
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring" role="img">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:var(--surface-2)" stroke-width="7"></circle>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" style="stroke:${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${clamped * circ} ${circ}" transform="rotate(-90 ${c} ${c})" class="ring-fill"></circle>
    <text x="${c}" y="${c + 1}" text-anchor="middle" class="ring-main">${esc(text)}</text>
    <text x="${c}" y="${c + 13}" text-anchor="middle" class="ring-sub">${esc(sub)}</text></svg>`;
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

// Calendar heat-map of daily spending for one month. Cells carry data-day so taps can open that day.
export function heatmap(daily, key, { size = 40, gap = 6 } = {}) {
  const max = Math.max(...daily.map((d) => d.total), 0);
  const first = new Date(key.year, key.month - 1, 1).getDay(); // 0 = Sunday
  const offset = (first + 6) % 7; // Monday first
  const cells = [];
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => `<text x="${i * (size + gap) + size / 2}" y="12" class="axis tiny" text-anchor="middle">${l}</text>`).join('');
  daily.forEach((d, i) => {
    const pos = i + offset, col = pos % 7, row = Math.floor(pos / 7);
    const x = col * (size + gap), y = 22 + row * (size + gap);
    const ratio = max > 0 ? d.total / max : 0;
    const level = d.total === 0 ? 0 : ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;
    const fill = level === 0 ? 'var(--surface-2)' : 'var(--c1)';
    const op = [1, 0.28, 0.6, 1][level];
    const textColor = level === 3 ? '#FFFFFF' : 'var(--ink)';
    cells.push(`<g class="hm-cell" data-day="${d.day}" style="cursor:pointer"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" style="fill:${fill};fill-opacity:${op}"/><text x="${x + size / 2}" y="${y + size / 2 + 4}" text-anchor="middle" font-size="12" style="fill:${textColor}" font-weight="600">${d.day}</text></g>`);
  });
  const rows = Math.ceil((daily.length + offset) / 7);
  const w = 7 * size + 6 * gap, h = 22 + rows * (size + gap) - gap;
  return `<svg class="chart heatmap" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Spending by day">${labels}${cells.join('')}</svg>`;
}
