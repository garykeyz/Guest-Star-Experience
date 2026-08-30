import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const requested = req.url === '/' ? 'index.html' : req.url.split('?')[0].replace(/^\/+/, '');
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}).listen(4310, '127.0.0.1', () => console.log('Guest Star Beta · modo Player: http://127.0.0.1:4310'));
