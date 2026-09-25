// RESEARCH + GEMINI orchestration for the "What's happening inside the fund?" section.
const R = require('./research'), G = require('./gemini'), C = require('./calc');
const { pool } = require('./http');

function pickImportant(fund, max = 10) { // top holdings up to ~60% of fund, max N (equity only)
  const eq = fund.holdings.filter(h => h.type === 'EQUITY'); const out = []; let w = 0;
  for (const h of eq) { if (out.length >= max || (w >= 60 && out.length >= 5)) break; out.push(h); w += h.weight; }
  return out;
}
const pubOf = u => /bseindia/.test(u) ? 'BSE filing' : /nseindia/.test(u) ? 'NSE filing' : (u.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [, 'Company'])[1] + ' (company site)';
const NOISE = /ESOP|ESPS|Trading Window|Loss of Share|Duplicate Share|Certificate under Reg|Newspaper Publication/i;
const shortName = n => n.replace(/\b(Ltd|Limited|Corporation of India|Corp|Inc|Co)\b\.?/gi, '').replace(/\s+/g, ' ').trim();

async function buildAnalysis(fund, { max = 10, grounded = true } = {}) {
  const imp = pickImportant(fund, max);
  const S = []; const add = (o) => { const id = 'S' + (S.length + 1); S.push({ id, ...o }); return id; };
  add({ kind: 'holdings', title: `Portfolio holdings as of ${fund.portfolioDate}`, ...fund.sources.holdings });
  const research = await pool(imp, 5, async h => {
    const out = { name: h.name, weight: h.weight, sector: h.sector, returns: h.returns || null, marketCapCr: h.marketCapCr || null, pe: h.pe || null, facts: [] };
    if (!h.foreign) {
      const sc = await R.screener(h.nse, h.bse).catch(() => null);
      if (sc) {
        if (sc.quarters && sc.quarters.rows.length) out.facts.push({ type: 'quarterly_results', periods: sc.quarters.periods, rows: sc.quarters.rows, src: add({ kind: 'results', title: `${shortName(h.name)} quarterly results (Rs cr)`, publisher: 'Screener.in (company filings)', url: sc.url, date: null }) });
        for (const a of sc.announcements.filter(a => !NOISE.test(a.title)).slice(0, 5)) out.facts.push({ type: 'filing', title: a.title, summary: a.summary, date: a.date, src: add({ kind: 'filing', title: a.title, publisher: a.publisher + ' filing', url: a.url, date: a.date }) });
        for (const c of sc.concalls.slice(0, 1)) for (const l of c.links) out.facts.push({ type: l.kind === 'PPT' ? 'investor_presentation' : 'concall_transcript', period: c.period, src: add({ kind: l.kind === 'PPT' ? 'presentation' : 'transcript', title: `${shortName(h.name)} ${l.kind === 'PPT' ? 'investor presentation' : 'earnings call transcript'} (${c.period})`, publisher: pubOf(l.url), url: l.url, date: null }) });
      }
    }
    const nw = await R.news(shortName(h.name)).catch(() => []);
    for (const n of nw) out.facts.push({ type: 'news', headline: n.title, date: n.date, publisher: n.publisher, src: add({ kind: 'news', title: n.title, publisher: n.publisher, url: n.url, date: n.date }) });
    return out;
  });
  // Grounded expectations (retrieval only; kept as cited snippets)
  let groundedOk = false, gErr = null;
  // Google Search grounding is a paid-tier feature on Gemini 3.x; enable with GEMINI_GROUNDING=1.
  if (grounded && process.env.GEMINI_API_KEY && process.env.GEMINI_GROUNDING === '1') {
    const batches = [imp.slice(0, 5), imp.slice(5)].filter(b => b.length);
    for (const b of batches) {
      try {
        const snips = await G.expectations(b.map(h => ({ name: shortName(h.name), nse: h.nse })));
        groundedOk = true;
        for (const s of snips) {
          const ids = s.sources.map(x => add({ kind: 'web', title: s.text.slice(0, 120), publisher: x.publisher, url: x.url, date: null }));
          const who = research.find(r => r && r.name && s.text.toLowerCase().includes(shortName(r.name).toLowerCase().split(' ')[0])) ;
          (who || research[0]).facts.push({ type: 'search_snippet', text: s.text, src: ids.join(',') });
        }
      } catch (e) { gErr = String(e.message || e); }
    }
  }
  const per = ['1M', '3M', '6M', '1Y'];
  const contrib = Object.fromEntries(per.map(p => [p, C.contribution(fund.holdings.filter(h => h.returns), p).sort((a, b) => b.contrib - a.contrib)]));
  const pack = {
    fund: { name: fund.name, category: fund.category, benchmark: fund.benchmarkName, portfolio_date: fund.portfolioDate, aum_cr: fund.aum, top10_weight: fund.top10, equity_share: fund.equityShare, sectors: fund.sectors, stats: fund.stats, contribution_note: 'Contribution = fund weight x stock return over the period. ESTIMATED; weights are month-end.' },
    contributions_3M: { top: contrib['3M'].slice(0, 5), bottom: contrib['3M'].slice(-5).reverse() },
    holdings: research.filter(r => r && r.name),
    sources: S.map(s => ({ id: s.id, kind: s.kind, title: s.title, publisher: s.publisher, date: s.date }))
  };
  let out = null, err = null;
  try { out = await G.reason(pack); } catch (e) { err = String(e.message || e); }
  // Enforce citations: drop claims citing unknown ids
  const known = new Set(S.map(s => s.id));
  const clean = arr => (arr || []).map(c => ({ text: String(c.text || ''), src: (c.src || []).map(String).flatMap(x => x.split(',')).map(x => x.trim()).filter(x => known.has(x)) })).filter(c => c.text && c.src.length);
  if (out) {
    for (const h of out.holdings || []) { h.what_changed = clean(h.what_changed); h.expected = clean(h.expected); h.seeing = clean(h.seeing); h.watch = clean(h.watch); const m = imp.find(x => shortName(x.name).toLowerCase() === shortName(h.name || '').toLowerCase()) || imp.find(x => (h.name || '').toLowerCase().includes(shortName(x.name).toLowerCase().split(' ')[0])); if (m) { h.name = m.name; h.weight = m.weight; h.sector = m.sector; h.returns = m.returns || null; } }
    if (out.portfolio) { out.portfolio.drivers = clean(out.portfolio.drivers); out.portfolio.priced_in = clean(out.portfolio.priced_in); }
  }
  return { code: fund.code, model: G.MODEL(), grounded: groundedOk, groundedError: gErr, error: err, holdings: out ? out.holdings : [], portfolio: out ? out.portfolio : null, sources: S, generatedAt: new Date().toISOString() };
}
module.exports = { buildAnalysis, pickImportant };
