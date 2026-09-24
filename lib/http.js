// Small fetch helpers: browser-like UA, timeout, retry, tiny in-memory cache.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const cache = new Map();

async function get(url, { type = 'text', timeout = 15000, retries = 1, headers = {}, ttl = 0 } = {}) {
  const key = type + ' ' + url;
  if (ttl) { const c = cache.get(key); if (c && c.exp > Date.now()) return c.v; }
  let err;
  for (let a = 0; a <= retries; a++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-IN,en;q=0.9', ...headers }, signal: ctl.signal, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status} ${url}`);
      if (!r.ok) { const e = new Error(`HTTP ${r.status} ${url}`); e.status = r.status; throw e; }
      const v = type === 'json' ? await r.json() : await r.text();
      if (ttl) cache.set(key, { v, exp: Date.now() + ttl });
      return v;
    } catch (e) { err = e; if (e.status && e.status < 500 && e.status !== 429) break; await new Promise(s => setTimeout(s, 600 * (a + 1))); }
    finally { clearTimeout(t); }
  }
  throw err;
}
const getJSON = (u, o = {}) => get(u, { ...o, type: 'json' });

// Run async fn over items with limited concurrency.
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e.message || e) }; } }
  }));
  return out;
}
module.exports = { get, getJSON, pool, UA };
