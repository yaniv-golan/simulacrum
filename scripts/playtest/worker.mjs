import { LIMITS, digest } from './protocol.mjs';
export { CaptureStore } from './cloud-store.mjs';
const headers = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};
const bytes = (value) => new TextEncoder().encode(value);
async function equal(a, b) {
  return (await digest(bytes(a))) === (await digest(bytes(b)));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(value))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function invited(request, env) {
  if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 32) return false;
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('playtest='))
    ?.slice(9);
  const match = /^(\d+)\.([A-Za-z0-9_-]{1,80})\.([a-f0-9-]{36}|human)\.([a-f0-9]{64})$/.exec(
    cookie || '',
  );
  if (!match || Number(match[1]) <= Date.now() || match[2] !== env.INVITATION_GENERATION)
    return false;
  return (await equal(
    match[4],
    await sign(`${match[1]}.${match[2]}.${match[3]}`, env.COOKIE_SECRET),
  ))
    ? { run: match[3] === 'human' ? null : match[3] }
    : false;
}
function response(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { ...headers, ...extra } });
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!env.ALLOWED_ORIGIN || url.origin !== env.ALLOWED_ORIGIN)
        return response({ error: 'Unknown origin' }, 403);
      if (url.pathname === '/join' && request.method === 'GET') {
        if (
          !env.INVITATION_TOKEN ||
          env.INVITATION_TOKEN.length < 32 ||
          !env.COOKIE_SECRET ||
          env.COOKIE_SECRET.length < 32 ||
          !/^[A-Za-z0-9_-]{1,80}$/.test(env.INVITATION_GENERATION || '')
        )
          return response({ error: 'Capture unavailable' }, 503);
        const token = url.searchParams.get('token') || '';
        let run = 'human',
          expires = Date.now() + 7 * 86400000;
        if (!(await equal(token, env.INVITATION_TOKEN))) {
          const synthetic = /^synthetic\.([a-f0-9-]{36})\.(\d+)\.([a-f0-9]{64})$/.exec(token);
          if (
            !synthetic ||
            Number(synthetic[2]) <= Date.now() ||
            !(await equal(
              synthetic[3],
              await sign(`synthetic.${synthetic[1]}.${synthetic[2]}`, env.COOKIE_SECRET),
            ))
          )
            return response({ error: 'Invalid invitation' }, 401);
          run = synthetic[1];
          expires = Number(synthetic[2]);
        }
        const value = `${expires}.${env.INVITATION_GENERATION}.${run}`;
        return new Response(null, {
          status: 303,
          headers: {
            ...headers,
            location: '/',
            'set-cookie': `playtest=${value}.${await sign(value, env.COOKIE_SECRET)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`,
          },
        });
      }
      const admin = url.pathname.startsWith('/admin/playtest/');
      if (admin) {
        if (
          !env.ADMIN_TOKEN ||
          env.ADMIN_TOKEN.length < 32 ||
          !(await equal(request.headers.get('authorization') || '', `Bearer ${env.ADMIN_TOKEN}`))
        )
          return response({ error: 'Admin required' }, 403);
      }
      const auth = admin || (await invited(request, env));
      const syntheticInvitation =
        /^\/admin\/playtest\/synthetic\/([a-f0-9-]{36})\/invitation$/.exec(url.pathname);
      if (admin && syntheticInvitation && request.method === 'POST') {
        const value = `synthetic.${syntheticInvitation[1]}.${Date.now() + 2 * 3600000}`;
        return response({ token: `${value}.${await sign(value, env.COOKIE_SECRET)}` });
      }
      if (url.pathname === '/api/playtest/config' && request.method === 'GET')
        return response(
          auth
            ? {
                enabled: true,
                protocolVersion: 2,
                supportedProtocols: [2],
                optionalVideo: env.CAPTURE_OPTIONAL_VIDEO === 'true',
                accountingVersion: 'cloud-v2',
                limits: LIMITS,
              }
            : { enabled: false },
        );
      if (url.pathname.startsWith('/api/') || admin) {
        if (!auth) return response({ error: 'Invitation required' }, 401);
        if (
          !admin &&
          (request.headers.get('origin') !== env.ALLOWED_ORIGIN ||
            request.headers.get('sec-fetch-site') === 'cross-site')
        )
          return response({ error: 'Cross-origin request denied' }, 403);
        // Never trust caller-injected internal routing or synthetic-run headers.
        const forwarded = new Headers(request.headers);
        forwarded.delete('x-synthetic-run');
        if (auth?.run) forwarded.set('x-synthetic-run', auth.run);
        forwarded.set('x-invitation-generation', env.INVITATION_GENERATION);
        const store = env.CAPTURE.get(env.CAPTURE.idFromName('capture-v2'));
        const result = await store.fetch(new Request(request, { headers: forwarded }));
        const safe = new Response(result.body, result);
        for (const [key, value] of Object.entries(headers)) safe.headers.set(key, value);
        return safe;
      }
      if (env.PRIVATE_SITE === 'true' && !auth)
        return response({ error: 'Invitation required' }, 401);
      if (!['GET', 'HEAD'].includes(request.method)) return response({ error: 'Not found' }, 404);
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return response({ error: 'Invalid path' }, 400);
      }
      if (
        path.includes('\\') ||
        path.split('/').some((x) => x.startsWith('.')) ||
        path.endsWith('.map')
      )
        return response({ error: 'Not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch {
      return response({ error: 'Capture unavailable' }, 503);
    }
  },
  async scheduled(_event, env) {
    await env.CAPTURE.get(env.CAPTURE.idFromName('capture-v2')).fetch(
      new Request('https://store.invalid/admin/playtest/reconcile', { method: 'POST' }),
    );
  },
};
