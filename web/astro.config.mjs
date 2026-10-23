import solid from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss()],
    // /app/ is built from the daemon's own page in ../src.
    server: { fs: { allow: ['..'] } },
    // remark-* packages re-export default via `export {default} from`, which
    // browsers reject as native ESM. Prebundle so Vite flattens the export.
    optimizeDeps: {
      include: ['solid-markdown', 'remark-gfm', 'remark-parse', 'remark-rehype', 'unified', 'vfile'],
    },
  },
});
