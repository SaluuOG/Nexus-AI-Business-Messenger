import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Nexus-AI-Business-Messenger/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'supabase-vendor',
              test: /node_modules[\\/]@supabase[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
