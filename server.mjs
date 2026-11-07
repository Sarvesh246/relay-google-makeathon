import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT || 3000);
const files = new Map([
  ['/', ['Relay-standalone.html', 'text/html; charset=utf-8']],
  ['/Relay-standalone.html', ['Relay-standalone.html', 'text/html; charset=utf-8']],
  ['/Relay.dc.html', ['Relay.dc.html', 'text/html; charset=utf-8']],
  ['/support.js', ['support.js', 'text/javascript; charset=utf-8']],
]);

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = files.get(pathname);
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Unable to load the project file');
  }
});

server.on('error', (error) => {
  console.error(`Cannot start Relay: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Relay is ready at http://localhost:${port}`);
});
