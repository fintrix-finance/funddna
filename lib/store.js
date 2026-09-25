// Small JSON store for analysis results and job status.
// On Vercel it uses a private Vercel Blob store (free on Hobby); locally it falls back to memory.
let blob = null;
try { blob = require('@vercel/blob'); } catch { blob = null; }
const mem = new Map();
const enabled = () => !!(blob && (process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID)));

async function read(key) {
  if (!enabled()) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  try {
    const r = await blob.get(key, { access: 'private', useCache: false });
    if (!r || !r.stream) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch { return null; }
}
async function write(key, obj) {
  const s = JSON.stringify(obj);
  if (!enabled()) { mem.set(key, s); return; }
  await blob.put(key, s, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
}
module.exports = { read, write, enabled };
