// Daily (GitHub Actions): pre-build analysis JSON for popular funds so they load instantly on Pages,
// and save a monthly holdings snapshot per fund (enables month-on-month position changes later).
// Calls are spaced out to stay inside Gemini free-tier limits; a fund that hits a temporary error
// (503 / per-minute 429) is retried once at the end. If the daily quota is used up, the run stops.
const fs = require('fs'), path = require('path');
const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis');
const FUNDS = (process.env.FUNDS || '118955,122639,120166,118989,120503,119598').split(',').map(s => s.trim()).filter(Boolean);
const GAP = +(process.env.PREBUILD_GAP_MS || 90000), SKIP_IF_NEWER = 20 * 3600e3;
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
  const retry = []; let calls = 0, failed = 0;
  const run = async (list, label) => {
    for (const code of list) {
      if (calls++) await sleep(GAP);
      let r; try { r = await one(code); } catch (e) { r = { ok: false, error: e.message }; }
      if (r.ok) continue;
      console.log(code, label, 'failed:', r.error.slice(0, 200));
      if (/429/.test(r.error) && /quota/i.test(r.error) && /day|daily|PerDay/i.test(r.error)) { console.log('Daily Gemini quota used up; stopping.'); failed += list.length; return false; }
      if (label === 'first' && /503|429|timeout|abort/i.test(r.error)) retry.push(code); else failed++;
    }
    return true;
  };
  if (await run(todo, 'first') && retry.length) { console.log('retrying', retry.join(','), 'in 3 min'); await sleep(180000); await run(retry, 'retry'); }
  const have = FUNDS.filter(fresh).length;
  console.log(`done: ${have}/${FUNDS.length} funds have fresh analysis`);
})();
