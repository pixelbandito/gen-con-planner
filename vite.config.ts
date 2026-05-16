import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Preferred port, clear of Vite's default 5173 cluster. strictPort is off,
  // so Vite falls back to the next free port if 5757/5758 is taken.
  server: {
    port: 5757,
  },
  preview: {
    port: 5758,
  },
});
