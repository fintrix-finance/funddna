const { search } = require('../lib/funds'); const { send, wrap } = require('./_util');
module.exports = wrap(async (req, res) => { const q = new URL(req.url, 'http://x').searchParams.get('q') || ''; send(req, res, 200, { results: await search(q) }, 3600); });
