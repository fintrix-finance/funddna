// RESEARCH layer: fresh external information with real URLs, collected by code (not by the model).
// Sources: Screener.in company page (links to BSE/NSE filings, investor presentations, concall transcripts,
// quarterly results table) and Google News RSS filtered to reputable financial publishers.
const { get } = require('./http');
const dec = s => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = s => dec(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function screener(nse, bse) {
  const ids = [nse, bse].filter(Boolean);
  for (const id of ids) for (const v of ['consolidated/', '']) {
    const url = `https://www.screener.in/company/${id}/${v}`;
    try {
      const html = await get(url, { ttl: 6 * 3600e3, retries: 0 });
      const q = parseQuarters(html);
      if (v && (!q || !q.rows.length)) continue; // no consolidated numbers -> try standalone
      return { url, quarters: q, announcements: parseAnn(html), concalls: parseConcalls(html), ratios: parseRatios(html) };
    } catch (e) { if (e.status !== 404) break; }
  }
  return null;
}
function parseQuarters(html) {
  const i = html.indexOf('id="quarters"'); if (i < 0) return null;
  const t = html.slice(i, html.indexOf('</table>', i));
  const rows = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => strip(c[1]).replace(/\s*\+$/, '')));
  if (!rows.length) return null;
  const head = rows[0].slice(-5); const keep = /^(Sales|Revenue|Operating Profit|OPM %|Financing Profit|Net Profit|EPS in Rs|Profit before tax|Gross NPA %|Net NPA %)/;
  return { periods: head, rows: rows.slice(1).filter(r => keep.test(r[0]) && r.slice(-5).some(Boolean)).map(r => ({ item: r[0], values: r.slice(-5) })) };
}
function parseAnn(html) {
  const i = html.indexOf('id="company-announcements-tab"'); if (i < 0) return [];
  const seg = html.slice(i, html.indexOf('</ul>', i));
  return [...seg.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => {
    const tm = m[2].match(/datetime="([^"]+)"/); const sum = m[2].match(/<\/time>\s*-\s*([\s\S]*?)<\/div>/);
    return { url: dec(m[1]), title: strip(m[2].split('<div')[0]), date: tm ? tm[1].slice(0, 10) : null, summary: sum ? strip(sum[1]) : '' , publisher: /nseindia/.test(m[1]) ? 'NSE' : 'BSE' };
  }).filter(a => a.date).slice(0, 8);
}
function parseConcalls(html) {
  const i = html.indexOf('Concalls</h3>'); if (i < 0) return [];
  const seg = html.slice(i, html.indexOf('</ul>', i));
  return seg.split('<li').slice(1, 3).map(li => {
    const per = (li.match(/nowrap[^>]*>([^<]+)</) || [])[1];
    const links = [...li.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)</g)].map(m => ({ url: dec(m[1]), kind: m[2].trim() })).filter(l => /Transcript|PPT/.test(l.kind));
    return { period: per && per.trim(), links };
  }).filter(c => c.links.length);
}
function parseRatios(html) {
  const i = html.indexOf('id="top-ratios"'); if (i < 0) return {};
  const seg = html.slice(i, html.indexOf('</ul>', i)); const o = {};
  for (const m of seg.matchAll(/<span class="name">([\s\S]*?)<\/span>[\s\S]*?<span class="nowrap value">([\s\S]*?)<\/span>\s*<\/li>/g)) o[strip(m[1])] = strip(m[2]);
  return o;
}

const GOOD = /reuters|economic times|economictimes|livemint|mint|business standard|business-standard|businessline|thehindubusinessline|moneycontrol|cnbc|ndtv profit|ndtvprofit|financial express|financialexpress|bloomberg|the hindu|hindustan times|times of india|forbes india|outlook business|zee business|business today|et now|etnow/i;
async function news(company, limit = 6) {
  const q = `"${company}" when:30d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const xml = await get(url, { ttl: 3 * 3600e3 });
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const x = m[1]; const g = tag => { const r = x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return r ? dec(r[1]).trim() : ''; };
    const src = x.match(/<source url="([^"]+)">([\s\S]*?)<\/source>/);
    const publisher = src ? dec(src[2]).trim() : ''; let title = g('title'); if (publisher && title.endsWith(' - ' + publisher)) title = title.slice(0, -(publisher.length + 3));
    return { title, url: g('link'), date: g('pubDate') ? new Date(g('pubDate')).toISOString().slice(0, 10) : null, publisher, publisher_site: src ? src[1] : '' };
  });
  const key = company.toLowerCase().split(' ')[0];
  return items.filter(i => GOOD.test(i.publisher + ' ' + i.publisher_site) && i.title.toLowerCase().includes(key)).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, limit);
}
module.exports = { screener, news };
