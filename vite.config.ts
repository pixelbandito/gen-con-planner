import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { genconProxy } from './server/gencon-proxy.mjs';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), genconProxy()],
  // Preferred port, clear of Vite's default 5173 cluster. strictPort is off,
  // so Vite falls back to the next free port if 5757/5758 is taken.
  server: {
    port: 5757,
  },
  preview: {
    port: 5758,
  },
});
