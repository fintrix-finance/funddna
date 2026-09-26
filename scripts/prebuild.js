// Daily cheap signal scan; Gemini runs only for a missing analysis or a material change.
const fs = require('fs'), path = require('path');
const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis');
const { signals, compare } = require('../lib/triggers');
const FUNDS = (process.env.FUNDS || '118955,122639,120166,118989,120503,119598').split(',').map(s => s.trim()).filter(Boolean);
const GAP = +(process.env.PREBUILD_GAP_MS || 90000), MAX_RUN_MS = 43 * 60e3, started = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = path.join(__dirname, '..', 'data');
const file = code => path.join(out, 'analysis', `${code}.json`);
const signalFile = code => path.join(out, 'signals', `${code}.json`);
const read = f => { try { return JSON.parse(fs.readFileSync(f)); } catch { return null; } };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(x)); };
async function one(code) {
  const prior = read(file(code)), baseline = read(signalFile(code));
  const fund = await buildFund(code);
  const snap = path.join(out, 'snapshots', String(code), `${fund.portfolioDate}.json`);
  if (!fs.existsSync(snap)) write(snap, fund.holdings.map(h => ({ name: h.name, weight: h.weight, sector: h.sector, type: h.type })));
  const current = await signals(fund, prior);
  const reasons = process.env.FORCE ? ['manual FORCE'] : compare(current, baseline, prior);
  if (!reasons.length) {
    // Initialize legacy baselines without calling Gemini. Keep the last successful NAV
    // as the reference for 5% moves; a skipped day must not reset it.
    if (!baseline) write(signalFile(code), { ...current, nav: fund.nav, analysisGeneratedAt: prior.generatedAt });
    console.log(code, 'unchanged; kept analysis from', prior.generatedAt);
    return { ok: true, skipped: true };
  }
  console.log(code, 'material trigger:', reasons.join(' | '));
  const a = await buildAnalysis(fund);
  if (a.error || !a.holdings || !a.holdings.length || !a.portfolio) return { ok: false, error: String(a.error || 'incomplete analysis') };
  write(file(code), a);
  write(signalFile(code), { ...current, nav: fund.nav, analysisGeneratedAt: a.generatedAt });
  console.log(code, fund.name, 'updated', a.holdings.length, 'holdings,', a.sources.length, 'sources');
  return { ok: true, skipped: false };
}
(async () => {
  const retry = []; let calls = 0, updated = 0, skipped = 0, failed = new Map();
  const run = async (list, label) => {
    for (const code of list) {
      if (Date.now() - started + (calls ? GAP : 0) > MAX_RUN_MS) { failed.set(code, 'run time budget'); continue; }
      if (calls++) await sleep(GAP);
      let r; try { r = await one(code); } catch (e) { r = { ok: false, error: e.message }; }
      if (r.ok) { failed.delete(code); if (r.skipped) skipped++; else updated++; continue; }
      console.log(code, label, 'failed:', r.error.slice(0, 220)); failed.set(code, r.error);
      if (/503|429|timeout|abort/i.test(r.error)) retry.push(code);
    }
  };
  await run(FUNDS, 'first');
  for (let round = 1; round <= 2 && retry.length; round++) {
    const remaining = retry.splice(0), pause = round * 180000;
    if (Date.now() - started + pause + GAP > MAX_RUN_MS) break;
    console.log('retry round', round, 'for', remaining.join(',')); await sleep(pause); await run(remaining, `retry ${round}`);
  }
  const missing = FUNDS.filter(c => !read(file(c))?.holdings?.length);
  console.log(`Analysis files: ${FUNDS.length - missing.length}/${FUNDS.length}; updated ${updated}, unchanged ${skipped}; missing: ${missing.join(',') || 'none'}; failed triggers: ${[...failed.keys()].join(',') || 'none'}`);
  if (missing.length || failed.size) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
