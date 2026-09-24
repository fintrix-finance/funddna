// CALCULATIONS layer: returns, risk, contribution, concentration. Pure functions.
const DAY = 864e5;
function valueAt(pts, t) { // last point on/before t
  let lo = 0, hi = pts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : pts[ans];
}
const PERIODS = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 1095, '5Y': 1826 };
function periodReturns(pts, keys = ['1M', '3M', '6M', '1Y']) {
  const out = {}; if (!pts || pts.length < 2) return out; const end = pts[pts.length - 1];
  for (const k of keys) { const s = valueAt(pts, end.t - PERIODS[k] * DAY); if (s && s.t >= pts[0].t && end.t - s.t > PERIODS[k] * DAY * .8) { const r = end.v / s.v; out[k] = +((k === '3Y' || k === '5Y' ? Math.pow(r, 365 / PERIODS[k]) - 1 : r - 1) * 100).toFixed(2); } }
  out.asOf = new Date(end.t).toISOString().slice(0, 10);
  return out;
}
function risk(pts, years = 3) {
  const end = pts[pts.length - 1].t, from = end - years * 365 * DAY;
  // weekly returns for stability
  const wk = []; for (let t = from; t <= end; t += 7 * DAY) { const p = valueAt(pts, t); if (p) wk.push(p.v); }
  const rets = []; for (let i = 1; i < wk.length; i++) rets.push(wk[i] / wk[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const vol = sd * Math.sqrt(52) * 100;
  let peak = 0, dd = 0; for (const p of pts) { if (p.t < from) continue; peak = Math.max(peak, p.v); dd = Math.min(dd, p.v / peak - 1); }
  return { vol: +vol.toFixed(2), dd: +(dd * 100).toFixed(2), weekly: rets };
}
function beta(fundPts, idxPts, years = 3) {
  const end = Math.min(fundPts[fundPts.length - 1].t, idxPts[idxPts.length - 1].t), from = end - years * 365 * DAY;
  const a = [], b = []; let pf, pi;
  for (let t = from; t <= end; t += 7 * DAY) { const f = valueAt(fundPts, t), i = valueAt(idxPts, t); if (f && i) { if (pf) { a.push(f.v / pf - 1); b.push(i.v / pi - 1); } pf = f.v; pi = i.v; } }
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let cov = 0, vb = 0; for (let k = 0; k < a.length; k++) { cov += (a[k] - ma) * (b[k] - mb); vb += (b[k] - mb) ** 2; }
  return vb ? +(cov / vb).toFixed(2) : null;
}
// quarter-end points over last 5y (21 points), rebased later by UI
function quarterly(pts, n = 21) {
  const end = new Date(pts[pts.length - 1].t); const out = [];
  for (let k = n - 1; k >= 0; k--) { const d = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3 * k + 1, 0); const p = valueAt(pts, Math.min(d, end.getTime())); out.push(p ? p.v : null); }
  return out;
}
function contribution(holdings, period) {
  return holdings.filter(h => h.returns && h.returns[period] != null).map(h => ({ name: h.name, weight: h.weight, sector: h.sector, ret: h.returns[period], contrib: +(h.weight * h.returns[period] / 100).toFixed(3) }));
}
module.exports = { periodReturns, risk, beta, quarterly, contribution, valueAt, DAY };
