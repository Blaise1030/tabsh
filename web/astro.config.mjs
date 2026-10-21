import solid from '@astrojs/solid-js';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  integrations: [solid()],
  vite: {
    // /app/ is built from the daemon's own page in ../src.
    server: { fs: { allow: ['..'] } },
  },
});
