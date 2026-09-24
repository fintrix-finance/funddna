// Assembles verified fund facts (DATA + CALCULATIONS). No model involved.
const F = require('./funds'), M = require('./market'), C = require('./calc');
const { pool } = require('./http');

const BENCH = [[/nifty\s*50\b(?!0)/i, 'NIFTY', 'Nifty 50'], [/nifty\s*100\b/i, 'NIFTY100', 'Nifty 100'], [/nifty\s*500/i, 'NIFTY500', 'Nifty 500'], [/midcap\s*150/i, 'NIFTYMIDCAP150', 'Nifty Midcap 150'], [/smallcap\s*250/i, 'NIFTYSMLCAP250', 'Nifty Smallcap 250']];
function benchFor(name) { for (const [re, s, n] of BENCH) if (re.test(name || '')) return { symbol: s, name: n + ' (price index)', exact: true }; return { symbol: 'NIFTY500', name: 'Nifty 500 (price index, reference)', exact: false }; }
const num = s => { if (s == null) return null; const m = String(s).replace(/[₹,\s]/g, '').match(/-?[\d.]+/); return m ? parseFloat(m[0]) : null; };
function capClass(cr) { if (cr == null) return null; return cr >= 100000 ? 'Large' : cr >= 33000 ? 'Mid' : 'Small'; } // approx. SEBI/AMFI rank cut-offs, labelled as approximate in UI
const plainSector = s => ({ 'Financial': 'Financials', 'Energy & Utilities': 'Energy & Utilities', 'Unspecified': 'Cash & others' }[s] || s || 'Other');

async function buildFund(code, { topN = 25 } = {}) {
  const meta = await F.byCode(code); if (!meta) throw Object.assign(new Error('Unknown scheme code'), { status: 404 });
  const [g, nav] = await Promise.all([F.growwScheme(code, meta.name), F.navHistory(code)]);
  const all = (g.holdings || []).map(h => ({
    name: h.company_name.replace(/\s+Forgn\. Eq.*$/, '').trim(), weight: +(+h.corpus_per || 0).toFixed(2), sector: plainSector(h.sector_name), type: h.nature_name, instrument: h.instrument_name,
    foreign: /Foreign/i.test(h.instrument_name || ''), ticker: ((h.company_name.match(/\(([A-Z.]+)\)/) || [])[1]) || null, search_id: h.stock_search_id, marketValueCr: h.market_value
  })).sort((a, b) => b.weight - a.weight);
  const portfolioDate = g.holdings && g.holdings[0] && g.holdings[0].portfolio_date ? new Date(new Date(g.holdings[0].portfolio_date).getTime() + 330 * 6e4).toISOString().slice(0, 10) : null;
  const eq = all.filter(h => h.type === 'EQUITY');
  const top = eq.slice(0, topN);
  await pool(top, 8, async h => {
    if (h.foreign) { if (h.ticker) { const c = await M.stock({ foreignTicker: h.ticker }); h.returns = C.periodReturns(c.pts); h.currency = c.currency; h.price_url = c.url; } return; }
    const s = await F.growwStock(h.search_id); if (!s) return;
    Object.assign(h, { nse: s.nse, bse: s.bse, isin: s.isin, industry: s.industry, marketCapCr: num(s.fundamentals['Market Cap']), pe: s.fundamentals['P/E Ratio(TTM)'] || null });
    h.cap = capClass(h.marketCapCr);
    const c = await M.stock({ nse: s.nse, bse: s.bse }); h.returns = C.periodReturns(c.pts); h.price_url = c.url;
  });
  // sectors over full book
  const sec = {}; for (const h of all) { const k = h.type === 'EQUITY' ? h.sector : h.type === 'DEBT' ? 'Debt' : 'Cash & others'; sec[k] = (sec[k] || 0) + h.weight; }
  const sectors = Object.entries(sec).map(([k, v]) => [k, +v.toFixed(1)]).sort((a, b) => b[1] - a[1]);
  const capped = top.filter(h => h.cap); const cw = capped.reduce((a, h) => a + h.weight, 0);
  const mcap = cw ? ['Large', 'Mid', 'Small'].map(k => +(capped.filter(h => h.cap === k).reduce((a, h) => a + h.weight, 0) / cw * 100).toFixed(0)) : null;
  // fund stats from NAV
  const fr = C.periodReturns(nav.pts, ['1M', '3M', '6M', '1Y', '3Y', '5Y']); const rk = C.risk(nav.pts, 3);
  const b = benchFor(g.benchmark_name || g.benchmark); let bench = null;
  try { let bc; try { bc = await M.index(b.symbol); } catch (e) { Object.assign(b, { symbol: 'NIFTY500', name: 'Nifty 500 (price index, reference)', exact: false }); bc = await M.index('NIFTY500'); } const br = C.periodReturns(bc.pts, ['1M', '3M', '6M', '1Y', '3Y', '5Y']); const bk = C.risk(bc.pts, 3); bench = { ...b, url: bc.url, series: C.quarterly(bc.pts), stats: { r1: br['1Y'], r3: br['3Y'], vol: bk.vol, dd: bk.dd, beta: 1 } }; bench.beta = C.beta(nav.pts, bc.pts); } catch (e) { bench = { ...b, error: String(e.message) }; }
  const RF = 6.5; const sharpe = fr['3Y'] != null && rk.vol ? +((fr['3Y'] - RF) / rk.vol).toFixed(2) : null;
  const top10 = +eq.slice(0, 10).reduce((a, h) => a + h.weight, 0).toFixed(1);
  const eqShare = +eq.reduce((a, h) => a + h.weight, 0).toFixed(1);
  const covered = +top.filter(h => h.returns && h.returns['1M'] != null).reduce((a, h) => a + h.weight, 0).toFixed(1);
  const mgrs = (g.fund_manager_details || []).map(m => ({ name: m.person_name, since: m.date_from ? m.date_from.slice(0, 10) : null, experience: m.experience || '' }));
  return {
    code: +code, name: meta.scheme, fullName: meta.name, plan: [meta.planName.replace(/\s*Plan$/i, ''), meta.option.replace(/\s*Option$/i, '')].filter(Boolean).join(' • ').toUpperCase(),
    amc: meta.amc, category: g.sub_category || meta.category, benchmarkName: g.benchmark_name || g.benchmark || null,
    nav: meta.nav, navDate: meta.date, aum: g.aum ? Math.round(g.aum) : null, er: g.expense_ratio != null ? +g.expense_ratio : null, turnover: g.portfolio_turnover != null ? +g.portfolio_turnover : null,
    managers: mgrs, portfolioDate, holdingsCount: all.length, equityShare: eqShare, top10, coverage: covered,
    holdings: all.slice(0, 60), sectors, mcap,
    stats: { r1m: fr['1M'], r3m: fr['3M'], r6m: fr['6M'], r1: fr['1Y'], r3: fr['3Y'], r5: fr['5Y'], vol: rk.vol, dd: rk.dd, sharpe, beta: bench && bench.beta, rf: RF },
    series: C.quarterly(nav.pts), seriesEnd: fr.asOf, bench,
    sources: {
      holdings: { publisher: 'Groww (from AMC monthly portfolio disclosure)', url: g._groww_url, date: portfolioDate },
      disclosure: { publisher: 'AMFI – AMC portfolio disclosures', url: 'https://www.amfiindia.com/online-center/portfolio-disclosure', date: portfolioDate },
      nav: { publisher: 'AMFI NAV (via mfapi.in)', url: 'https://portal.amfiindia.com/spages/NAVAll.txt', date: meta.date },
      prices: { publisher: 'NSE/BSE delayed prices via Groww (Yahoo Finance fallback)', url: 'https://www.nseindia.com/', date: fr.asOf }
    },
    generatedAt: new Date().toISOString()
  };
}
module.exports = { buildFund };
