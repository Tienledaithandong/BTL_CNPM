import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist/web' },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4173', '/ws': { target: 'ws://127.0.0.1:4173', ws: true } } },
});
