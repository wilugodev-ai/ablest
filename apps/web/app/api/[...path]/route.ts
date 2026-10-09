import { waitForApiReady } from '../../lib/api-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
const inquiryUnconfirmed = 'We could not confirm your inquiry was sent. Please retry without changing the form, or email ablestdigitalsolutions@gmail.com directly.';
async function proxy(request: Request, context: Context) {
  const { path } = await context.params;
  const route = path.join('/');
  if (!/^(contact|projects|images\/[a-f0-9-]{36}|auth\/(session|register|login|logout)|account|admin\/(session|setup|login|logout|clients|projects(?:\/[a-f0-9-]{36}(?:\/images)?)?|images\/[a-f0-9-]{36}))$/.test(route)) return Response.json({ message: 'Not found.' }, { status: 404 });
  if (route === 'contact' && request.method !== 'POST') return Response.json({ message: 'Method not allowed.' }, { status: 405, headers: { Allow: 'POST' } });
  const isWrite = !['GET', 'HEAD'].includes(request.method);
  const origin = request.headers.get('origin') || '';
  const allowed = process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : ['http://127.0.0.1:3200', 'http://localhost:3200'];
  if (isWrite && !allowed.includes(origin)) return Response.json({ message: 'Request origin is not allowed.' }, { status: 403 });
  const limit = route === 'contact' ? 24 * 1024 : route.endsWith('/images') ? 9 * 1024 * 1024 : 100 * 1024;
  const tooLarge = route === 'contact' ? 'Your inquiry is too long.' : 'Upload is too large.';
  if (isWrite && Number(request.headers.get('content-length') || 0) > limit) return Response.json({ message: tooLarge }, { status: 413 });
  const headers = new Headers();
  for (const name of ['cookie', 'content-type', 'origin']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  try {
    let body: Uint8Array | undefined;
    if (isWrite && request.body) {
      const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); return Response.json({ message: tooLarge }, { status: 413 }); } chunks.push(value); }
      body = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    }
    const apiUrl = process.env.API_URL || 'http://127.0.0.1:4200';
    if (route === 'contact') {
      if (!await waitForApiReady(apiUrl, request.signal)) return Response.json({ message: 'The contact form is taking longer to start. Your inquiry has not been sent. Please try again or email ablestdigitalsolutions@gmail.com directly.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
      request.signal.throwIfAborted();
    }
    const upstream = await fetch(`${apiUrl}/v1/${route}`, { method: request.method, headers, body: body as BodyInit | undefined, cache: 'no-store', signal: route === 'contact' ? AbortSignal.any([request.signal, AbortSignal.timeout(75000)]) : AbortSignal.timeout(75000) });
    const type=upstream.headers.get('content-type') || '';
    if(!type.includes('application/json') && !(route.startsWith('images/') && type.startsWith('image/'))) {
      await upstream.body?.cancel().catch(() => {});
      return Response.json({message:route === 'contact' ? inquiryUnconfirmed : 'The service is starting or temporarily unavailable. Please wait a moment and try again.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'set-cookie', 'retry-after']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name,value); }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return Response.json({ message: route === 'contact' ? inquiryUnconfirmed : 'The project service is unavailable. Make sure both applications are running, then try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
