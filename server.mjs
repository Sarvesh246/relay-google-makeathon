// Local dev server: serves the app built straight from Relay.dc.html and runs
// the same /api/chat handler Vercel runs in production.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { renderIndex } from './scripts/build-site.mjs';
import { POST as chat } from './api/chat.mjs';
import { POST as post } from './api/post.mjs';
import { GET as config } from './api/config.mjs';

// Tiny .env.local loader so local dev matches Vercel without a dependency.
for (const name of ['.env.local', '.env']) {
  const file = new URL(name, import.meta.url);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const port = Number(process.env.PORT || 3000);
const nostore = { 'Cache-Control': 'no-store' };

async function readBody(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname === '/api/chat' || pathname === '/api/post') {
      if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();
      const body = await readBody(req);
      const response = await (pathname === '/api/post' ? post : chat)(new Request('http://localhost' + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
      res.writeHead(response.status, { 'Content-Type': 'application/json', ...nostore });
      return void res.end(await response.text());
    }
    if (pathname === '/api/config' && req.method === 'GET') {
      const response = config();
      res.writeHead(response.status, { 'Content-Type': 'application/json', ...nostore });
      return void res.end(await response.text());
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    if (pathname === '/' || pathname === '/index.html') {
      const html = renderIndex(await readFile(new URL('Relay.dc.html', import.meta.url), 'utf8'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...nostore });
      return void res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (pathname === '/support.js' || pathname === '/poster.js' || pathname === '/drive.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', ...nostore });
      return void res.end(await readFile(new URL(pathname.slice(1), import.meta.url)));
    }
    res.writeHead(404).end('Not found');
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Server error');
  }
});

server.on('error', (error) => {
  console.error(`Cannot start Relay: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Relay is ready at http://localhost:${port}`);
  if (!process.env.GEMINI_API_KEY) console.log('GEMINI_API_KEY is not set: the Playbook will use its built-in sample answers.');
});
