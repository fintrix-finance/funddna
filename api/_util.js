const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://fintrix-finance.github.io,http://localhost:8080,http://localhost:8765').split(',');
function send(req, res, status, body, maxAge = 0) {
  const o = req.headers.origin; if (o && (ORIGINS.includes(o) || ORIGINS.includes('*'))) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (status === 200 && maxAge) res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`); else res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status; res.end(JSON.stringify(body));
}
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { send(req, res, e.status || 500, { error: String(e.message || e) }); } };
module.exports = { send, wrap };
