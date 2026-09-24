const { buildFund } = require('../lib/fund'); const { send, wrap } = require('./_util');
module.exports = wrap(async (req, res) => { const code = new URL(req.url, 'http://x').searchParams.get('code'); if (!/^\d+$/.test(code || '')) return send(req, res, 400, { error: 'code required' }); send(req, res, 200, await buildFund(code), 6 * 3600); });
