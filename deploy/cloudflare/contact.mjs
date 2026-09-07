const origins = new Set(['https://moventra.me', 'https://www.moventra.me', 'https://moventra.apexisnetworking.work']);
const services = ['Advertising', 'AI subscriptions', 'Subscription cards', 'Cloud services', 'Combined solution'];
const response = (status, code) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export async function contact(request, env) {
  if (env.SITE_KIND !== 'client') return response(404, 'not_found');
  if (request.method !== 'POST') return response(405, 'method_not_allowed');
  const origin = request.headers.get('Origin');
  if (!origins.has(origin) || new URL(request.url).origin !== origin) return response(403, 'invalid_origin');
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return response(415, 'invalid_content_type');
  if (!env.CONTACT_EMAIL || !env.CONTACT_RATE_LIMITER) return response(503, 'unavailable');
  try {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return response(403, 'invalid_client');
    if (!(await env.CONTACT_RATE_LIMITER.limit({ key: ip })).success) return response(429, 'rate_limited');
    const reader = request.body?.getReader();
    if (!reader) return response(400, 'invalid_input');
    let size = 0; const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) { await reader.cancel(); return response(413, 'too_large'); }
      chunks.push(value);
    }
    let data;
    try { data = JSON.parse(await new Blob(chunks).text()); } catch { return response(400, 'invalid_input'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return response(400, 'invalid_input');
    const { name, email, description, service, website } = data;
    if (typeof website !== 'string' || website !== '' || typeof name !== 'string' || !name.trim() || name.length > 80 || /[\r\n\x00-\x1f]/.test(name) || typeof email !== 'string' || email.length > 180 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\x00-\x1f\x7f]/.test(email) || typeof description !== 'string' || !description.trim() || description.length > 3000 || !Number.isInteger(service) || !services[service]) return response(400, 'invalid_input');
    const text = `New Moventra website inquiry\n\nName: ${name.trim()}\nEmail: ${email}\nService: ${services[service]}\n\n${description.trim()}\n\nSubmitted: ${new Date().toISOString()}`;
    await env.CONTACT_EMAIL.send({
      from: { email: 'website@mail.moventra.me', name: 'Moventra Website' },
      to: 'info@moventra.me', replyTo: email,
      subject: `Website inquiry: ${services[service]}`,
      text, html: `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(text)}</pre>`,
    });
    return response(202, 'accepted');
  } catch { return response(503, 'unavailable'); }
}
