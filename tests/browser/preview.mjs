// Local UI review with synthetic data only; never included in the production build.
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('../../', import.meta.url));
const stub = fileURLToPath(new URL('./supabase.mjs', import.meta.url));
const server = await createServer({
  root, configFile: false, base: '/', server: { host: '127.0.0.1', port: 4175, strictPort: true, hmr: false },
  plugins: [{ name: 'browser-fixture', enforce: 'pre', resolveId(source) {
    if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return stub;
  } }],
});
await server.listen();
console.log('Synthetic Nexus preview: http://localhost:4175/#/app/chats');
