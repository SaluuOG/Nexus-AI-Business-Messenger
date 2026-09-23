import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const supabaseFixture = fileURLToPath(new URL('./supabase.mjs', import.meta.url));

export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 4192, strictPort: true, hmr: false },
  plugins: [{
    name: 'nexus-browser-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/lib/supabase') || source.endsWith('/lib/env')) return supabaseFixture;
    },
  }],
});
