// GEMINI layer: (1) grounded retrieval of expectations -> kept only as cited snippets with real URLs;
// (2) reasoning over the verified fact pack -> JSON where every claim cites source IDs. Key stays server-side.
const { get } = require('./http');
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const KEY = () => process.env.GEMINI_API_KEY;

async function call(body, timeout = 120000) {
  if (!KEY()) throw new Error('GEMINI_API_KEY not set');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    for (let a = 0; a < 3; a++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() }, body: JSON.stringify(body), signal: ctl.signal });
      if (r.status === 429 || r.status === 503) { await new Promise(s => setTimeout(s, 4000 * (a + 1))); continue; }
      const j = await r.json(); if (!r.ok) throw new Error(`Gemini ${r.status}: ${(j.error && j.error.message || '').slice(0, 200)}`);
      return j;
    }
    throw new Error('Gemini rate-limited');
  } finally { clearTimeout(t); }
}

async function resolve(u) { // grounding URIs are redirect links; follow them to the publisher URL
  try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000); const r = await fetch(u, { method: 'GET', redirect: 'manual', signal: ctl.signal }); clearTimeout(t); return r.headers.get('location') || u; } catch { return u; }
}

// Grounded search for market expectations for a batch of companies. Returns snippets tied to real sources.
async function expectations(companies) {
  const list = companies.map(c => `- ${c.name}${c.nse ? ` (NSE: ${c.nse})` : ''}`).join('\n');
  const prompt = `For each Indian listed company below, search for the MOST RECENT quarterly results and what was expected before them: analyst consensus estimates (e.g. "vs estimate of", "Street expected", poll figures), company guidance, and whether results beat, met or missed. Also note any stated upcoming catalyst (next results date, guidance, regulatory event). Only state what the sources say, with numbers and dates. If you cannot find consensus for a company, say "No consensus found" for it.\n${list}`;
  const j = await call({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1 } });
  const cand = j.candidates && j.candidates[0]; const gm = cand && cand.groundingMetadata; if (!gm) return [];
  const chunks = (gm.groundingChunks || []).map(c => c.web || {});
  const urls = await Promise.all(chunks.map(c => c.uri ? resolve(c.uri) : null));
  return (gm.groundingSupports || []).filter(s => s.segment && s.segment.text && (s.groundingChunkIndices || []).length).map(s => ({
    text: s.segment.text.trim(),
    sources: s.groundingChunkIndices.map(i => ({ url: urls[i], publisher: chunks[i] && chunks[i].title })).filter(x => x.url)
  })).filter(s => s.text.length > 25 && s.sources.length);
}

const SCHEMA_HINT = `Return ONLY JSON with this shape:
{"holdings":[{"name":str,"what_changed":[{"text":str,"src":[ids]}],"expected":[{"text":str,"src":[ids]}],"seeing":[{"text":str,"src":[ids]}],"why_it_matters":str,"watch":[{"text":str,"src":[ids]}]}],
 "portfolio":{"statement":str,"interp":[str,str],"line":str,"drivers":[{"text":str,"src":[ids]}],"themes":[{"title":str,"text":str,"holdings":[names]}],"macro":[{"factor":str,"why":str,"holdings":[names]}],"priced_in":[{"text":str,"src":[ids]}],"could_change":[{"title":str,"text":str}],"risk_note":str}}`;

async function reason(pack) {
  const sys = `You are FundDNA's reasoning layer. You receive a JSON pack of VERIFIED facts about one Indian mutual fund: holdings with weights, computed returns and contributions, and source items (each with an id like S12). Rules:
1. Use ONLY facts in the pack. Never invent news, numbers, dates, sources, consensus or guidance.
2. Every sentence in what_changed / expected / seeing / watch / drivers / priced_in must cite one or more source ids from the pack in "src". If you have no source, leave that list empty.
3. "expected": only consensus or guidance that a source item explicitly states. If none, return an empty list (the UI will say no reliable consensus source was found).
4. "seeing": compare expected vs actual only when both are sourced.
5. "why_it_matters": reason from the holding's fund weight, its return/contribution (computed, may be marked estimated) and overlap with other holdings/sectors. No new facts.
6. Macro factors must come from the actual holdings (name the holdings). No generic market commentary.
7. Plain, precise English. Short sentences. No hype.
${SCHEMA_HINT}`;
  const j = await call({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(pack) }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, 180000);
  const txt = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []).map(p => p.text || '').join('');
  return JSON.parse(txt.replace(/^```json\s*|```$/g, ''));
}
module.exports = { expectations, reason, MODEL };
