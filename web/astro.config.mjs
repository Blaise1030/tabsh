import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    // /app/ is built from the daemon's own page in ../src.
    server: { fs: { allow: ['..'] } },
  },
});
