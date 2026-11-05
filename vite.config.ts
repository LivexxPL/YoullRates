/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base: the build runs from any sub-path (GitHub Pages, a file share, an Electron/Tauri shell).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    // The rate simulator chunk (three.js, ~140 kB gzipped) is lazy-loaded when the simulator opens.
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
