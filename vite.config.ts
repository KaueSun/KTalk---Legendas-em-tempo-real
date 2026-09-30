import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'ktalk-development-csp',
    apply: 'serve',
    // React's development refresh preamble is inline. Production remains strict.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  }],
  base: './',
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/.runtime/**', '**/.venv/**', '**/.cache/**', '**/.tools/**', '**/artifacts/**', '**/__pycache__/**'] },
  },
  build: { sourcemap: false },
});
