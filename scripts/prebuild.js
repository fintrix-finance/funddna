// Daily (GitHub Actions): pre-build analysis JSON for popular funds so they load instantly on Pages,
// and save a monthly holdings snapshot per fund (enables month-on-month position changes later).
// Calls are spaced out to stay inside Gemini free-tier limits; a fund that hits a temporary error
// (503 / per-minute 429) is retried once at the end. If the daily quota is used up, the run stops.
const fs = require('fs'), path = require('path');
const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis');
const FUNDS = (process.env.FUNDS || '118955,122639,120166,118989,120503,119598').split(',').map(s => s.trim()).filter(Boolean);
const GAP = +(process.env.PREBUILD_GAP_MS || 90000), SKIP_IF_NEWER = 20 * 3600e3;
const MAX_RUN_MS = 43 * 60e3, started = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = path.join(__dirname, '..', 'data');
const file = code => path.join(out, 'analysis', `${code}.json`);
const fresh = code => { try { const a = JSON.parse(fs.readFileSync(file(code), 'utf8')); return Date.now() - new Date(a.generatedAt) < SKIP_IF_NEWER; } catch { return false; } };

async function one(code) {
  const fund = await buildFund(code);
  const snapDir = path.join(out, 'snapshots', String(code)); fs.mkdirSync(snapDir, { recursive: true });
  const snap = path.join(snapDir, `${fund.portfolioDate}.json`);
  if (!fs.existsSync(snap)) fs.writeFileSync(snap, JSON.stringify(fund.holdings.map(h => ({ name: h.name, weight: h.weight, sector: h.sector, type: h.type }))));
  const a = await buildAnalysis(fund);
  if (a.error || !a.holdings || !a.holdings.length) return { ok: false, error: String(a.error || 'no holdings analysed') };
  fs.writeFileSync(file(code), JSON.stringify(a));
  console.log(code, fund.name, 'ok', a.holdings.length, 'holdings,', a.sources.length, 'sources');
  return { ok: true };
}

(async () => {
  fs.mkdirSync(path.join(out, 'analysis'), { recursive: true });
  const todo = FUNDS.filter(c => process.env.FORCE ? true : !fresh(c));
  console.log('funds to build:', todo.join(',') || 'none (all fresh)');
  const retry = []; let calls = 0, stoppedForQuota = false;
  const run = async (list, label) => {
    for (const code of list) {
      const wait = calls ? GAP : 0;
      if (Date.now() - started + wait > MAX_RUN_MS) { console.log('Run time budget reached; stopping before timeout.'); return false; }
      if (calls++) await sleep(wait);
      let r; try { r = await one(code); } catch (e) { r = { ok: false, error: e.message }; }
      if (r.ok) continue;
      console.log(code, label, 'failed:', r.error.slice(0, 200));
      if (/429/.test(r.error) && /quota/i.test(r.error) && /day|daily|PerDay/i.test(r.error)) { console.log('Daily Gemini quota used up; stopping.'); stoppedForQuota = true; return false; }
      if (/503|429|timeout|abort/i.test(r.error)) retry.push(code);
    }
    return true;
  };
  await run(todo, 'first');
  for (let round = 1; round <= 2 && retry.length && !stoppedForQuota; round++) {
    const remaining = retry.splice(0);
    const pause = round * 180000;
    if (Date.now() - started + pause + GAP > MAX_RUN_MS) { console.log('No time for next retry round.'); break; }
    console.log('retry round', round, 'for', remaining.join(','), 'after', pause / 60000, 'min');
    await sleep(pause);
    await run(remaining, `retry ${round}`);
  }
  const missing = FUNDS.filter(c => !fresh(c));
  console.log(`done: ${FUNDS.length - missing.length}/${FUNDS.length} funds have fresh analysis; missing: ${missing.join(',') || 'none'}`);
  if (missing.length) process.exitCode = 1;
})();
