import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../../apps/client/dist');
const home = readFileSync(resolve(dist, '__seo-home.html'), 'utf8');
const shell = readFileSync(resolve(dist, 'index.html'), 'utf8');
test('built homepage is indexable with visible content even before JavaScript executes', () => {
  assert.match(home, /name="robots" content="index,follow,max-image-preview:large"/);
  assert.doesNotMatch(home, /noindex/);
  assert.match(home, /<title>Moventra \| 广告营销、AI 订阅与云服务<\/title>/);
  assert.equal((home.match(/rel="canonical"/g) || []).length, 1);
  assert.match(home, /rel="canonical" href="https:\/\/moventra.me\/"/);
  assert.equal((home.match(/<h1>/g) || []).length, 1);
  for (const content of ['广告营销', 'AI 订阅', '云服务', '常见问题', 'info@moventra.me']) assert.ok(home.includes(content));
  const schema = JSON.parse(home.match(/type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(schema['@graph'].map(item => item['@type']), ['Organization', 'WebSite']);
  assert.equal(schema['@graph'][0].url, 'https://moventra.me/');
});
test('private SPA fallback remains unindexable and has no homepage canonical or body', () => {
  assert.match(shell, /name="robots" content="noindex,nofollow"/);
  assert.doesNotMatch(shell, /rel="canonical"|application\/ld\+json|<h1>/);
  assert.match(shell, /<div id="root"><\/div>/);
});
test('generated homepage retains real application assets and all local links resolve', () => {
  for (const match of home.matchAll(/(?:src|href)="(\/(?:assets|brand)\/[^"?#]+)"/g)) assert.ok(existsSync(resolve(dist, '.' + match[1])), match[1]);
  const appScript = shell.match(/<script[^>]+src="([^"]+)"/)[1];
  assert.ok(home.includes(appScript));
  for (const id of ['services', 'faq', 'contact']) assert.match(home, new RegExp(`id="${id}"`));
});
