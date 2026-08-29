import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Cloudflare liefert die statischen Seiten unter der endungslosen Adresse
 * aus (/features statt /features.html) und leitet die .html-Fassung dorthin
 * um. Die internen Links zeigen deshalb auf die endungslose Form; im
 * Dev-Server fiele so eine Adresse sonst in den SPA-Fallback und zeigte die
 * App statt der Seite.
 */
function cleanUrls(): Plugin {
  const pages = new Set(['/features', '/score', '/privacy', '/terms', '/legal-notice']);
  return {
    name: 'clean-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        const path = url.split('?')[0] ?? '';
        if (pages.has(path)) req.url = `${path}.html${url.slice(path.length)}`;
        next();
      });
    },
  };
}

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
  plugins: [cleanUrls()],
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
