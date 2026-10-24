import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev only: forward API calls to the local backend.
    proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
  build: { sourcemap: false },
});
