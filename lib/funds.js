// DATA layer: fund universe (AMFI), holdings + fund facts (Groww public JSON), NAV history (mfapi.in, from AMFI).
const { get, getJSON } = require('./http');
const H12 = 12 * 3600e3;

// Parse AMFI NAVAll.txt into [{code, name, nav, date, amc, category}]
async function amfiIndex() {
  const txt = await get('https://portal.amfiindia.com/spages/NAVAll.txt', { ttl: H12, timeout: 25000 });
  const out = []; let cat = '', amc = '';
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    const p = l.split(';');
    if (p.length >= 8 && /^\d+$/.test(p[0])) {
      const name = [p[3], p[4], p[5]].map(x => (x || '').trim()).filter(x => x && x !== '-').join(' - ');
      out.push({ code: +p[0], isin: p[1] !== '-' ? p[1] : (p[2] !== '-' ? p[2] : null), name, scheme: p[3].trim(), planName: (p[4] || '').trim(), option: (p[5] || '').trim(), nav: parseFloat(p[6]) || null, date: (p[7] || '').trim(), amc, category: cat });
    } else if (/^Open Ended|^Close Ended|^Interval/i.test(l)) cat = l; else if (p.length === 1) amc = l;
  }
  return out;
}

function score(f, toks) {
  const n = f.name.toLowerCase(); let s = 0;
  for (const t of toks) { if (!n.includes(t)) return -1; s += 1; }
  if (/direct/.test(n)) s += 2; if (/growth/.test(n) && !/idcw|dividend|bonus/.test(n)) s += 2;
  if (/equity/i.test(f.category)) s += 1;
  return s - n.length / 400;
}
async function search(q, limit = 12) {
  const toks = String(q || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const idx = await amfiIndex();
  return idx.map(f => [score(f, toks), f]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).slice(0, limit)
    .map(([, f]) => ({ code: f.code, name: f.name, amc: f.amc, category: f.category.replace(/^Open Ended Schemes\s*\(?|\)$/g, ''), nav: f.nav, date: f.date }));
}
async function byCode(code) { return (await amfiIndex()).find(f => f.code === +code) || null; }

// Groww: scheme code -> search_id -> full scheme JSON with holdings.
async function growwScheme(code, name) {
  const base = name.split(' - ')[0].replace(/\(.*?\)/g, '').trim();
  const tryQ = async (q) => {
    const r = await getJSON(`https://groww.in/v1/api/search/v3/query/global/st_query?query=${encodeURIComponent(q)}&entity_type=scheme&page=0&size=10`, { ttl: H12 });
    return (r.data && r.data.content || []).filter(x => x.entity_type === 'Scheme');
  };
  let hits = await tryQ(base);
  let hit = hits.find(x => String(x.scheme_code) === String(code));
  if (!hit) { hits = await tryQ(name); hit = hits.find(x => String(x.scheme_code) === String(code)); }
  if (!hit) {
    const want = base.toLowerCase();
    hit = hits.find(x => (x.title || '').toLowerCase() === want) || null;
  }
  if (!hit) throw Object.assign(new Error('Holdings not found for this scheme'), { status: 404 });
  const d = await getJSON(`https://groww.in/v1/api/data/mf/web/v4/scheme/search/${hit.search_id}`, { ttl: 6 * 3600e3 });
  return { ...d, _groww_url: `https://groww.in/mutual-funds/${hit.search_id}` };
}

async function navHistory(code) {
  const r = await getJSON(`https://api.mfapi.in/mf/${code}`, { ttl: 6 * 3600e3, timeout: 20000 });
  const pts = (r.data || []).map(x => { const [d, m, y] = x.date.split('-'); return { t: Date.UTC(+y, +m - 1, +d), v: parseFloat(x.nav) }; }).filter(x => x.v > 0).sort((a, b) => a.t - b.t);
  return { meta: r.meta || {}, pts };
}

async function growwStock(searchId) {
  if (!searchId) return null;
  const d = await getJSON(`https://groww.in/v1/api/stocks_data/v1/company/search_id/${searchId}?page=0&size=10`, { ttl: H12 });
  const h = d.header || {}; const f = {};
  for (const x of d.fundamentals || []) f[x.name] = x.value;
  return { isin: h.isin, nse: h.nseScriptCode, bse: h.bseScriptCode, name: h.displayName || h.shortName, industry: h.industryName, fundamentals: f };
}
module.exports = { amfiIndex, search, byCode, growwScheme, navHistory, growwStock };
