// Nightly (GitHub Actions): pre-build analysis JSON for popular funds so they load instantly on Pages,
// and save a monthly holdings snapshot per fund (enables month-on-month position changes later).
const fs = require('fs'), path = require('path');
const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis');
const FUNDS = (process.env.FUNDS || '118955,122639,120166,118989,120503,119598').split(',').map(s => s.trim()).filter(Boolean);
(async () => {
  const out = path.join(__dirname, '..', 'data'); fs.mkdirSync(path.join(out, 'analysis'), { recursive: true });
  for (const code of FUNDS) {
    try {
      const fund = await buildFund(code);
      const snapDir = path.join(out, 'snapshots', String(code)); fs.mkdirSync(snapDir, { recursive: true });
      const snap = path.join(snapDir, `${fund.portfolioDate}.json`);
      if (!fs.existsSync(snap)) fs.writeFileSync(snap, JSON.stringify(fund.holdings.map(h => ({ name: h.name, weight: h.weight, sector: h.sector, type: h.type }))));
      const a = await buildAnalysis(fund);
      if (a.error || !a.holdings.length) { console.log(code, 'analysis failed:', a.error); continue; }
      fs.writeFileSync(path.join(out, 'analysis', `${code}.json`), JSON.stringify(a));
      console.log(code, fund.name, 'ok', a.holdings.length, 'holdings,', a.sources.length, 'sources');
      await new Promise(r => setTimeout(r, 20000)); // stay inside Gemini free-tier rate limits
    } catch (e) { console.log(code, 'error', e.message); }
  }
})();
