// Cheap daily signal check. This does not call Gemini.
// An analysis remains valid until a material filing/news item, a new quarter,
// a meaningful portfolio weight change, or a large move in the fund's NAV.
const crypto = require('crypto');
const R = require('./research');
const { pickImportant } = require('./analysis');
const MATERIAL = /results?|earnings|profit|revenue|guidance|order(?:s| book)?|contract|acquisition|merger|demerger|buyback|dividend|pledge|fraud|regulator|rbi|sebi|fda|investigation|stake|insolvency|bankruptcy|approval|launch|tariff|capacity|plant|fundrais|capital rais|rating (?:upgrade|downgrade)|downgrade/i;
const IGNORE = /trading window|newspaper publication|duplicate share|esop|loss of share|certificate under reg|analyst meet|press release of analyst/i;
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const date = x => String(x || '').slice(0, 10);
const holdings = f => (f.holdings.some(h => h.type === 'EQUITY') ? f.holdings.filter(h => h.type === 'EQUITY') : f.holdings).slice(0, 10).map(h => ({ name: h.name, weight: h.weight }));
const relevant = (x, generated) => date(x.date) >= date(generated) && MATERIAL.test(x.title || '') && !IGNORE.test(x.title || '');
async function signals(fund, previous, research = R) {
  const top = pickImportant(fund), found = await Promise.all(top.map(async h => {
    const [sc, news] = await Promise.all([
      research.screener(h.nse, h.bse).catch(() => null),
      research.news(h.name.replace(/\s+(Ltd|Limited)\.?$/i, ''), 8).catch(() => [])
    ]);
    return { name: h.name,
      quarter: sc && sc.quarters && sc.quarters.periods.at(-1) || null,
      filings: (sc && sc.announcements || []).filter(x => relevant(x, previous && previous.generatedAt)).map(x => ({ date: date(x.date), title: x.title, url: x.url })),
      news: news.filter(x => relevant(x, previous && previous.generatedAt)).map(x => ({ date: date(x.date), title: x.title, url: x.url })) };
  }));
  return { portfolioDate: fund.portfolioDate, nav: fund.nav, navDate: fund.navDate,
    holdings: holdings(fund), companies: found };
}
function compare(current, baseline, analysis) {
  if (!analysis || !analysis.holdings || !analysis.holdings.length) return ['missing analysis'];
  const reasons = [];
  const dated = analysis.generatedAt;
  const oldDate = baseline && baseline.portfolioDate || (analysis.sources || []).find(s => s.kind === 'holdings')?.date;
  if (current.portfolioDate && oldDate && current.portfolioDate > oldDate) {
    const old = baseline && baseline.holdings || analysis.holdings.map(h => ({ name: h.name, weight: h.weight }));
    const prev = new Map(old.map(h => [h.name.toLowerCase(), h.weight]));
    if (current.holdings.some(h => !prev.has(h.name.toLowerCase()) || Math.abs(h.weight - prev.get(h.name.toLowerCase())) >= 2) || old.some(h => !current.holdings.some(n => n.name.toLowerCase() === h.name.toLowerCase()))) reasons.push('top holding changed by 2 percentage points or entered/left');
  }
  const prior = new Map((baseline && baseline.companies || []).map(c => [c.name.toLowerCase(), c]));
  const cited = new Set((analysis.sources || []).map(s => s.url).filter(Boolean));
  for (const c of current.companies) {
    const p = prior.get(c.name.toLowerCase());
    if (p && p.quarter && c.quarter && p.quarter !== c.quarter) reasons.push(c.name + ': new quarterly results');
    const oldUrls = new Set([...(p && p.filings || []), ...(p && p.news || [])].map(x => x.url));
    for (const x of [...c.filings, ...c.news]) if (x.date >= date(dated) && !oldUrls.has(x.url) && !cited.has(x.url)) reasons.push(c.name + ': ' + x.title);
  }
  return [...new Set(reasons)];
}
module.exports = { signals, compare, relevant, MATERIAL, hash };
