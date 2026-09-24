# fundDNA

Decodes what is happening **inside** a mutual fund: its largest holdings, what changed at those companies, what the market expected, and why it matters to this portfolio. Every factual claim links to a source.

## Layers
| Layer | Where | What |
|---|---|---|
| DATA | `lib/funds.js`, `lib/market.js` | Fund list + NAV (AMFI), holdings (AMC monthly disclosures via Groww's public JSON), NAV history (mfapi.in), NSE/BSE daily prices (Groww, Yahoo fallback) |
| RESEARCH | `lib/research.js` | BSE/NSE filings, results tables, investor presentations and concall transcripts (via Screener.in), reputable press (Google News RSS) |
| CALCULATIONS | `lib/calc.js`, `lib/fund.js` | 1M/3M/6M/1Y returns, estimated contribution (weight × return), volatility, drawdown, beta, concentration |
| GEMINI | `lib/gemini.js`, `lib/analysis.js` | Grounded search for expectations (kept only as cited snippets) + reasoning over the verified fact pack. Claims without a valid source id are dropped. |
| UI | `index.html` | The fundDNA dashboard (GitHub Pages) |

## Hosting
- Dashboard: GitHub Pages (this repo).
- API: Vercel (`api/`): `/api/search?q=`, `/api/fund?code=`, `/api/analysis?code=`, `/api/health`.
- Nightly: GitHub Actions pre-builds popular funds into `data/analysis/` and saves monthly holdings snapshots.
- `GEMINI_API_KEY` lives only in Vercel env settings and GitHub Actions secrets.

## Honest limits
- Holdings are as of the last monthly disclosure (SEBI rule), shown on the page.
- No free analyst-consensus feed exists for Indian stocks: the "expected" line shows only guidance/consensus stated in a cited source, otherwise "No reliable consensus source found".
- Contribution is estimated (weight × return) and labelled so.
- Market-cap split is approximate (market cap thresholds), from the largest holdings.

Local: `PORT=8080 node scripts/dev.js`
