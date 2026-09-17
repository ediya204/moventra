import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteFetch } from './website-seo.mjs';

const env = { SITE_KIND: 'client', ASSETS: { fetch: async () => new Response('<meta name="robots" content="noindex,nofollow">', { headers: { 'Content-Type': 'text/html' } }) } };
const request = (path, init) => new Request(`https://moventra.me${path}`, init);

test('homepage uses only the generated local asset and does not forward identity', async () => {
  for (const host of ['moventra.me', 'www.moventra.me']) {
    const response = await websiteFetch(new Request(`https://${host}/?utm_source=test`, { headers: { Authorization: 'Bearer fixture', Cookie: 'fixture=private' } }), {
      ...env, ASSETS: { fetch: async req => {
        assert.equal(new URL(req.url).pathname, '/__seo-home');
        assert.equal(new URL(req.url).search, '');
        assert.equal(req.headers.get('Authorization'), null); assert.equal(req.headers.get('Cookie'), null);
        return new Response('public homepage', { headers: { 'Content-Type': 'text/html' } });
      } },
    });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'public homepage');
    assert.equal(response.headers.get('Link'), '<https://moventra.me/>; rel="canonical"');
  }
});
test('robots and sitemap use correct formats and include only the public canonical homepage', async () => {
  const robots = await websiteFetch(request('/robots.txt'), env);
  assert.match(robots.headers.get('Content-Type'), /^text\/plain/);
  assert.equal(await robots.text(), 'User-agent: *\nAllow: /\n\nSitemap: https://moventra.me/sitemap.xml\n');
  const sitemap = await websiteFetch(request('/sitemap.xml'), env);
  assert.match(sitemap.headers.get('Content-Type'), /^application\/xml/);
  const xml = await sitemap.text();
  assert.match(xml, /<loc>https:\/\/moventra.me\/<\/loc>/);
  assert.equal((xml.match(/<loc>/g) || []).length, 1);
  assert.doesNotMatch(xml, /portal|login|admin|session/);
});
test('private pages and nonexistent paths keep the noindex app shell', async () => {
  for (const path of ['/portal', '/portal/login', '/register', '/session', '/forgot-password', '/privacy-policy', '/does-not-exist']) {
    const response = await websiteFetch(request(path), env);
    assert.match(await response.text(), /noindex,nofollow/);
    assert.equal(response.headers.get('Link'), null);
  }
});
test('staging, old host and admin cannot receive the indexable homepage or sitemap', async () => {
  for (const host of ['preview.workers.dev', 'moventra.apexisnetworking.work', 'admin.moventra.me', 'localhost']) {
    const root = await websiteFetch(new Request(`https://${host}/`), env);
    assert.match(await root.text(), /noindex/);
    const robots = await websiteFetch(new Request(`https://${host}/robots.txt`), env);
    assert.match(await robots.text(), /Disallow: \//);
    assert.equal((await websiteFetch(new Request(`https://${host}/sitemap.xml`), env)).status, 404);
  }
  assert.match(await (await websiteFetch(request('/'), { ...env, SITE_KIND: 'admin' })).text(), /noindex/);
});
test('internal generated HTML is not a second public page', async () => {
  for (const path of ['/__seo-home', '/__seo-home.html', '/__seo-home/']) {
    const response = await websiteFetch(request(path), env);
    assert.equal(response.status, 404); assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
  }
});
test('HEAD discovery requests have no body and unsupported methods fail', async () => {
  for (const path of ['/robots.txt', '/sitemap.xml']) {
    const response = await websiteFetch(request(path, { method: 'HEAD' }), env);
    assert.equal(response.status, 200); assert.equal(await response.text(), '');
    assert.equal((await websiteFetch(request(path, { method: 'POST' }), env)).status, 405);
  }
});
test('legacy index URL redirects to canonical homepage', async () => {
  const response = await websiteFetch(request('/index.html'), env);
  assert.equal(response.status, 301); assert.equal(response.headers.get('Location'), 'https://moventra.me/');
});
test('asset errors do not return indexable empty success pages', async () => {
  for (const response of [new Response('failure', { status: 404 }), new Response('not html')]) {
    const result = await websiteFetch(request('/'), { ...env, ASSETS: { fetch: () => response } });
    assert.equal(result.status, 503); assert.equal(result.headers.get('X-Robots-Tag'), 'noindex');
  }
});
test('the SEO entry preserves authentication and surface boundaries', async () => {
  assert.equal((await websiteFetch(request('/admin'), env)).status, 404);
  assert.equal((await websiteFetch(request('/admin-api/v1/me'), env)).status, 404);
  const login = await websiteFetch(request('/login'), env);
  assert.equal(login.status, 302); assert.equal(login.headers.get('Location'), '/portal/login');
  assert.equal((await websiteFetch(request('/client-api/v1/me'), { ...env, API_ORIGIN: 'https://example.invalid' })).status, 401);
});
