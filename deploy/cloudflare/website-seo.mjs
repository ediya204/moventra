import { handle } from './gateway.mjs';

const canonical = 'https://moventra.me/';
const robots = `User-agent: *\nAllow: /\n\nSitemap: ${canonical}sitemap.xml\n`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${canonical}</loc></url></urlset>\n`;

export async function websiteFetch(request, env) {
  const url = new URL(request.url);
  const publicSite = env.SITE_KIND === 'client' && ['moventra.me', 'www.moventra.me'].includes(url.hostname);
  // The generated file is internal. Only the real homepage can be indexed.
  if (/^\/__seo-home(?:\.html|\/|$)/.test(url.pathname)) return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
  if (['/robots.txt', '/sitemap.xml'].includes(url.pathname)) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    const isRobots = url.pathname === '/robots.txt';
    const body = isRobots ? (publicSite ? robots : 'User-agent: *\nDisallow: /\n') : sitemap;
    return new Response(request.method === 'HEAD' ? null : body, { status: !isRobots && !publicSite ? 404 : 200, headers: {
      'Content-Type': isRobots ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff',
    } });
  }
  if (publicSite && url.pathname === '/index.html' && ['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 301, headers: { Location: canonical, 'Cache-Control': 'public, max-age=300' } });
  }
  if (publicSite && url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
    // Fetch only a fixed local asset, with no visitor cookies or authorization.
    const asset = new URL('/__seo-home', url.origin);
    const response = await env.ASSETS.fetch(new Request(asset, { method: request.method }));
    if (response.status !== 200 || !response.headers.get('Content-Type')?.includes('text/html')) {
      return new Response('Homepage temporarily unavailable', { status: 503, headers: { 'Retry-After': '300', 'X-Robots-Tag': 'noindex' } });
    }
    const headers = new Headers(response.headers);
    headers.set('Link', `<${canonical}>; rel="canonical"`);
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return new Response(response.body, { status: response.status, headers });
  }
  return handle(request, env);
}

export default { fetch: websiteFetch };
