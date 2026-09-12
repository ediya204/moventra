import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { handle } from './gateway.mjs';
const input = { name: 'Visitor <test>', email: 'visitor@example.com', description: 'Hello <script>alert(1)</script>', service: 2, website: '' };
function request(data = input, headers = {}, method = 'POST') {
  return new Request('https://moventra.me/api/contact', { method, headers: { Origin: 'https://moventra.me', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, ...(method === 'POST' ? { body: typeof data === 'string' ? data : JSON.stringify(data) } : {}) });
}
function setup() {
  const sent = [];
  return { sent, env: { SITE_KIND: 'client', CONTACT_RATE_LIMITER: { limit: async () => ({ success: true }) }, CONTACT_EMAIL: { send: async mail => { sent.push(mail); } } } };
}
test('public contact delivers only to fixed mailbox with visitor Reply-To and escaped HTML', async () => {
  const { env, sent } = setup();
  const result = await handle(request(), env, () => { throw Error('must not use Go API'); });
  assert.equal(result.status, 202); assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'info@moventra.me'); assert.equal(sent[0].replyTo, input.email);
  assert.equal(sent[0].from.email, 'website@mail.moventra.me');
  assert.ok(!sent[0].html.includes('<script>')); assert.ok(sent[0].text.includes('<script>'));
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});
test('rejects invalid payloads without sending', async () => {
  for (const data of ['{', 'null', { ...input, name: '\r\nBcc: attacker@example.com' }, { ...input, email: 'a@b.com\r\nBcc:x@y.com' }, { ...input, service: 9 }, { ...input, service: '2' }, { ...input, description: ' ' }, { ...input, description: 'a'.repeat(3001) }, { ...input, website: 'bot' }]) {
    const { env, sent } = setup(); assert.equal((await handle(request(data), env)).status, 400); assert.equal(sent.length, 0);
  }
});
test('restricts origin, content type, method, payload size and admin site', async () => {
  const { env, sent } = setup();
  assert.equal((await handle(request(input, { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await handle(request(input, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await handle(request(input, {}, 'GET'), env)).status, 405);
  assert.equal((await handle(request('a'.repeat(16001)), env)).status, 413);
  assert.equal((await handle(request(), { ...env, SITE_KIND: 'admin' })).status, 404);
  assert.equal(sent.length, 0);
});
test('fails closed on rate limit or missing bindings and never reports send failure as success', async () => {
  const { env, sent } = setup();
  assert.equal((await handle(request(), { ...env, CONTACT_RATE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await handle(request(), { ...env, CONTACT_EMAIL: undefined })).status, 503);
  assert.equal((await handle(request(), { ...env, CONTACT_EMAIL: { send: async () => { throw Error('provider unavailable'); } } })).status, 503);
  assert.equal(sent.length, 0);
});

test('visible service options retain the contact API identifiers after removing subscription cards', async () => {
  const source = readFileSync(new URL('../../apps/client/src/website/Website.tsx', import.meta.url), 'utf8');
  const mapping = source.match(/service: (\[[\d, ]+\])\[interest\]/);
  assert.ok(mapping, 'frontend must map option positions to stable API identifiers');
  const ids = JSON.parse(mapping[1]);
  const names = ['Advertising', 'AI subscriptions', 'Cloud services', 'Combined solution'];
  assert.equal(ids.length, names.length);
  for (const [index, service] of ids.entries()) {
    const { env, sent } = setup();
    assert.equal((await handle(request({ ...input, service }), env)).status, 202);
    assert.equal(sent[0].subject, `Website inquiry: ${names[index]}`);
  }
});
