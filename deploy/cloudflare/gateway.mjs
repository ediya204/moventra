// Only the implemented Go contract is routable. Legacy and local Demo APIs
// must not be silently redirected to the new service.
const id = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const lists = new RegExp(`^/(client|admin)-api/v1/customers/${id}/(accounts|transactions)$`);
const upgrade = new RegExp(`^/client-api/v1/customers/${id}/business-upgrade$`);
const error = (status, code) => Response.json({ error: { code } }, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export async function handle(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  const api = /^\/(api|admin-api|client-api|local-slash-demo)(\/|$)/.test(url.pathname);
  if (!api) return env.ASSETS.fetch(request);
  const readable = url.pathname === '/api/v1/me' || lists.test(url.pathname) || upgrade.test(url.pathname);
  if (!readable) return error(404, 'api_not_available');
  if (request.method !== 'GET' && !(request.method === 'POST' && upgrade.test(url.pathname))) return error(405, 'method_not_allowed');

  let origin;
  try { origin = new URL(env.API_ORIGIN); } catch { return error(503, 'api_not_configured'); }
  // Configuration-controlled origin, never a request query/header destination.
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return error(503, 'invalid_api_configuration');
  if (!/^Bearer \S+$/i.test(request.headers.get('Authorization') || '')) return error(401, 'unauthenticated');

  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['Authorization', 'Content-Type', 'Idempotency-Key']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const target = new URL(url.pathname + url.search, origin.origin);
  try {
    const response = await upstreamFetch(target, {
      method: request.method, headers,
      body: request.method === 'POST' ? request.body : undefined,
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    // Never forward a token to a redirect target or return HTML upstream errors.
    if (response.status >= 300 && response.status < 400 || !response.headers.get('Content-Type')?.includes('application/json')) return error(502, 'invalid_api_response');
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return error(502, 'api_unavailable'); }
}

export default { fetch: (request, env) => handle(request, env) };
