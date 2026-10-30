/**
 * Cloudflare Worker für kaderplaner.de: reicht `/api/*` an die Kickbase-API
 * weiter. Alles andere liefert Cloudflare direkt aus `dist`, der Worker sieht
 * es nicht (`run_worker_first` in `wrangler.jsonc`).
 *
 * Warum es ihn gibt: Seit Ende Oktober 2026 setzt api.kickbase.com CORS-Header
 * nur noch für die eigenen Domains. Der Browser blockt damit jeden direkten
 * Aufruf von kaderplaner.de aus. Serverseitig gilt CORS nicht.
 *
 * Der Worker speichert nichts. Weitergereicht werden nur Methode, Pfad, Query,
 * Body und die Header, die der Client wirklich setzt. Origin und Cookies
 * bleiben weg, Set-Cookie von Kickbase ebenso.
 */

const UPSTREAM = 'https://api.kickbase.com/v4/';
const PREFIX = '/api/';
const FORWARDED_HEADERS = ['accept', 'authorization', 'content-type'];

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await fetch(UPSTREAM + url.pathname.slice(PREFIX.length) + url.search, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
    });

    const response = new Response(upstream.body, upstream);
    response.headers.delete('set-cookie');
    return response;
  },
};
