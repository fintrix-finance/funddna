// DATA layer: prices. Primary: Groww public NSE/BSE daily candles (works from servers; NSE/BSE's own APIs block them).
// Fallback / foreign listings: Yahoo Finance chart endpoint.
const { getJSON } = require('./http');
const DAY = 864e5;
async function groww(exchange, symbol, days = 400) {
  const e = Date.now(), s = e - days * DAY;
  const d = await getJSON(`https://groww.in/v1/api/charting_service/v2/chart/delayed/exchange/${exchange}/segment/CASH/${encodeURIComponent(symbol)}?endTimeInMillis=${e}&intervalInMinutes=1440&startTimeInMillis=${s}`, { ttl: 3 * 3600e3 });
  const pts = (d.candles || []).map(c => ({ t: c[0] * 1000, v: c[4] })).filter(p => p.v != null);
  if (pts.length < 5) throw new Error(`no candles ${exchange}:${symbol}`);
  return { symbol: `${exchange}:${symbol}`, currency: 'INR', pts, url: exchange === 'NSE' ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : `https://www.bseindia.com/stock-share-price/x/x/${symbol}/` };
}
async function yahoo(symbol, range = '2y') {
  let last;
  for (const h of ['query1', 'query2']) {
    try {
      const d = await getJSON(`https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { ttl: 3 * 3600e3, retries: 1 });
      const r = d.chart && d.chart.result && d.chart.result[0]; if (!r || !r.timestamp) throw new Error('no data ' + symbol);
      const c = r.indicators.adjclose ? r.indicators.adjclose[0].adjclose : r.indicators.quote[0].close;
      return { symbol, currency: r.meta.currency, pts: r.timestamp.map((t, i) => ({ t: t * 1000, v: c[i] })).filter(p => p.v != null), url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` };
    } catch (e) { last = e; }
  }
  throw last;
}
async function stock({ nse, bse, foreignTicker }) {
  if (foreignTicker) return yahoo(foreignTicker);
  if (nse) { try { return await groww('NSE', nse); } catch (e) { try { return await yahoo(nse + '.NS'); } catch { } } }
  if (bse) { try { return await groww('BSE', bse); } catch (e) { return yahoo(bse + '.BO'); } }
  throw new Error('no listing');
}
async function index(sym, days = 1900) { return groww('NSE', sym, days); }
module.exports = { stock, index, groww, yahoo };
