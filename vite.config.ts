import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { genconProxy } from './server/gencon-proxy.mjs';

// https://vite.dev/config/
export default defineConfig({
  // Served from https://pixelbandito.github.io/gen-con-planner/ — the project
  // lives under a repo-name subpath on GitHub Pages. Asset URLs and the
  // offline-bundle fetch (import.meta.env.BASE_URL) resolve under this prefix.
  // Local dev/preview therefore also serve under /gen-con-planner/.
  base: '/gen-con-planner/',
  plugins: [react(), genconProxy()],
  // Preferred port, clear of Vite's default 5173 cluster. strictPort is off,
  // so Vite falls back to the next free port if 5757/5758 is taken.
  server: {
    port: 5757,
  },
  preview: {
    port: 5758,
  },
  test: {
    // Don't scan into git worktrees under .worktrees/, or their copies of the
    // test files double-count when a worktree exists.
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
});
