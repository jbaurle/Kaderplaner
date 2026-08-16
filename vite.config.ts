import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/**
 * Commit des Builds. In Workers Builds liefert die Umgebung
 * `WORKERS_CI_COMMIT_SHA`, auf dem alten Cloudflare Pages war es
 * `CF_PAGES_COMMIT_SHA`; lokal fragen wir git. Ist nichts davon da (etwa in
 * einem Tarball ohne .git), bleibt es bei "dev".
 */
function buildCommit(): string {
  const fromCi = process.env['WORKERS_CI_COMMIT_SHA'] ?? process.env['CF_PAGES_COMMIT_SHA'];
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    open: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
