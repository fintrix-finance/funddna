// Checks each upstream source from this server and reports status (no secrets returned).
const { get, getJSON } = require('../lib/http'); const { send, wrap } = require('./_util');
module.exports = wrap(async (req, res) => {
  const t = async (name, fn) => { const s = Date.now(); try { const v = await fn(); return { name, ok: true, ms: Date.now() - s, detail: v }; } catch (e) { return { name, ok: false, ms: Date.now() - s, detail: String(e.message) }; } };
  const r = await Promise.all([
    t('amfi', async () => (await get('https://portal.amfiindia.com/spages/NAVAll.txt')).length + ' bytes'),
    t('mfapi', async () => (await getJSON('https://api.mfapi.in/mf/122639/latest')).data[0].date),
    t('groww_scheme', async () => (await getJSON('https://groww.in/v1/api/data/mf/web/v4/scheme/search/parag-parikh-long-term-value-fund-direct-growth')).holdings.length + ' holdings'),
    t('groww_stock', async () => (await getJSON('https://groww.in/v1/api/stocks_data/v1/company/search_id/hdfc-bank-ltd?page=0&size=10')).header.nseScriptCode),
    t('yahoo', async () => (await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/HDFCBANK.NS?range=1mo&interval=1d')).chart.result[0].timestamp.length + ' pts'),
    t('screener', async () => (await get('https://www.screener.in/company/HDFCBANK/consolidated/')).length + ' bytes'),
    t('gnews', async () => ((await get('https://news.google.com/rss/search?q=%22HDFC%20Bank%22&hl=en-IN&gl=IN&ceid=IN:en')).match(/<item>/g) || []).length + ' items'),
    t('gemini_key', async () => { if (!process.env.GEMINI_API_KEY) throw new Error('not set'); return 'set'; })
  ]);
  send(req, res, 200, { region: process.env.VERCEL_REGION || null, checks: r });
});
