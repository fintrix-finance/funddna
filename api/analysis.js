// Analysis endpoint. Order: nightly prebuilt file on the site -> stored result -> start a background job.
// Gemini only runs for funds with no fresh result, one job per fund at a time, and never while the
// free-tier quota is known to be used up. The browser polls (short requests) instead of waiting ~60s.
const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis');
const store = require('../lib/store'); const { send, wrap } = require('./_util');
let waitUntil = p => p; try { ({ waitUntil } = require('@vercel/functions')); } catch {}
const SITE = process.env.SITE_URL || 'https://funddna.github.io';
const H = 3600 * 1000, FRESH = 30 * H, JOB_TTL = 6 * 60 * 1000;
const age = a => a && a.generatedAt ? Date.now() - new Date(a.generatedAt).getTime() : Infinity;

function nextPacificMidnight() { // Gemini daily quotas reset at midnight Pacific time
  const now = new Date();
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const ms = (24 * 60 - (pt.getHours() * 60 + pt.getMinutes())) * 60000 - pt.getSeconds() * 1000;
  return new Date(now.getTime() + ms + 5 * 60000).toISOString();
}

async function prebuilt(code) {
  try { const r = await fetch(`${SITE}/data/analysis/${code}.json`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function job(code) {
  try {
    const fund = await buildFund(code); const a = await buildAnalysis(fund);
    if (!a.error && a.holdings && a.holdings.length) {
      await store.write(`analysis/${code}.json`, a);
      await store.write(`status/${code}.json`, { state: 'done', at: Date.now() });
      return;
    }
    const e = String(a.error || 'No analysis returned');
    if (/429/.test(e) && /quota/i.test(e)) await store.write('status/_quota.json', { until: nextPacificMidnight(), error: e.slice(0, 200) });
    const retryAt = /503|429/.test(e) ? Date.now() + 3 * 60000 : Date.now() + 30 * 60000;
    await store.write(`status/${code}.json`, { state: 'failed', at: Date.now(), retryAt, error: e.slice(0, 200) });
  } catch (err) {
    await store.write(`status/${code}.json`, { state: 'failed', at: Date.now(), retryAt: Date.now() + 10 * 60000, error: String(err.message || err).slice(0, 200) }).catch(() => {});
  }
}

module.exports = wrap(async (req, res) => {
  const code = new URL(req.url, 'http://x').searchParams.get('code'); if (!/^\d+$/.test(code || '')) return send(req, res, 400, { error: 'code required' });
  const pre = await prebuilt(code); if (pre && age(pre) < FRESH) return send(req, res, 200, pre, 1800);
  const saved = await store.read(`analysis/${code}.json`); if (saved && age(saved) < FRESH) return send(req, res, 200, saved, 1800);
  const stale = [pre, saved].filter(Boolean).sort((x, y) => age(x) - age(y))[0] || null;
  const quota = await store.read('status/_quota.json');
  if (quota && new Date(quota.until) > new Date()) return send(req, res, 200, { ...(stale || {}), code: +code, unavailable: true, reason: 'quota', retryAt: quota.until });
  const st = await store.read(`status/${code}.json`);
  if (st && st.state === 'running' && Date.now() - st.at < JOB_TTL) return send(req, res, 200, { ...(stale || {}), code: +code, pending: true, retryAfter: 20 });
  if (st && st.state === 'failed' && Date.now() < st.retryAt) return send(req, res, 200, { ...(stale || {}), code: +code, unavailable: true, reason: 'failed', retryAt: new Date(st.retryAt).toISOString() });
  await store.write(`status/${code}.json`, { state: 'running', at: Date.now() });
  waitUntil(job(code));
  send(req, res, 200, { ...(stale || {}), code: +code, pending: true, retryAfter: 25 });
});
