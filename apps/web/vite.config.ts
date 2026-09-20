import path from 'node:path';
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // Keeps the SPA same-origin with the API in development, so the
      // httpOnly refresh cookie behaves exactly as it will in production.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  optimizeDeps: {
    // Linked workspace package ships CommonJS; pre-bundle it.
    include: ['@ifp/shared'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    commonjsOptions: { include: [/shared/, /node_modules/] },
  },
});
