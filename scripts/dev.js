// Local dev server: serves index.html + data/, and routes /api/* to the Vercel handlers.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) { const f = path.join(root, 'api', u.pathname.slice(5) + '.js'); if (fs.existsSync(f)) return require(f)(req, res); }
  const p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('{}'); }
  res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : 'application/json'); fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 8080, () => console.log('http://localhost:' + (process.env.PORT || 8080)));
