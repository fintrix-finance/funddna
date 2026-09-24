const { buildFund } = require('../lib/fund'); const { buildAnalysis } = require('../lib/analysis'); const { send, wrap } = require('./_util');
module.exports = wrap(async (req, res) => {
  const code = new URL(req.url, 'http://x').searchParams.get('code'); if (!/^\d+$/.test(code || '')) return send(req, res, 400, { error: 'code required' });
  const fund = await buildFund(code); const a = await buildAnalysis(fund);
  send(req, res, 200, a, a.error ? 0 : 24 * 3600);
});
