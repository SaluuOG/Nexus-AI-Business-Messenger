import { readFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const asset = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
if (!asset) throw new Error('Built entry asset missing');
console.log('script=' + asset);
