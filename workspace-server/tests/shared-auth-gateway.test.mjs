import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSharedAuthGateway,
  createMemoryGatewayStore,
  createProtectedStaticHandler,
} from '../shared-auth/gateway.mjs';

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = (server) => new Promise((resolve) => server.close(resolve));
const requestWithHost = (url, host) => new Promise((resolve, reject) => {
  const request = httpRequest(url, { headers: { Host: host } }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const headers = new Headers();
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
      }
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
    });
  });
  request.on('error', reject);
  request.end();
});
const sha256 = (value) => createHash('sha256').update(value).digest('base64url');
const cookieFrom = (response, prefix) => response.headers.getSetCookie()
  .find((value) => value.startsWith(prefix))?.split(';')[0];

async function fixture(t, options = {}) {
  let now = Date.now();
  let active = true;
  let mode = 'ok';
  let exchangeCalls = 0;
  let revokeCalls = 0;
  let seenExchange;
  let internalSessionKey;
  const basePath = options.basePath || '';
  let proofOrganization = options.organizationId;
  const codes = new Map();
  const issuer = 'https://accounts.example.test';
  const clientId = 'duckman-client';
  const secret = 'private-client-secret-for-test';
  const store = createMemoryGatewayStore();
  const broker = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    assert.equal(req.headers.authorization, `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`);
    res.setHeader('Content-Type', 'application/json');
    const assertion = {
      issuer, audience: clientId, subject: 'central-user-7',
      expiresAt: now + 60 * 60 * 1000, sessionToken: 'g'.repeat(43),
      displayName: 'Real account', localIdentity: { userId: 'local-user-11' },
    };
    if (proofOrganization !== undefined) assertion.localIdentity.organizationId = proofOrganization;
    if (req.url === '/exchange') {
      exchangeCalls += 1;
      seenExchange = body;
      const code = codes.get(body.code);
      codes.delete(body.code);
      if (!code || code.state !== body.state || code.redirectUri !== body.redirectUri ||
          code.challenge !== sha256(body.codeVerifier)) {
        res.writeHead(401).end(JSON.stringify({ error: 'invalid_code' }));
        return;
      }
      if (mode === 'wrong-issuer') assertion.issuer = 'https://attacker.example.test';
      if (mode === 'wrong-app') assertion.audience = 'different-client';
      if (mode === 'expired-proof') assertion.expiresAt = now - 1;
      res.end(JSON.stringify(assertion));
    } else if (req.url === '/introspect') {
      assert.equal(body.sessionToken, assertion.sessionToken);
      if (mode === 'unavailable') res.writeHead(503).end('{}');
      else res.end(JSON.stringify(active ? { ...assertion, active: true } : { active: false }));
    } else if (req.url === '/revoke') {
      revokeCalls += 1;
      if (mode === 'revoke-unavailable') { res.writeHead(503).end('{}'); return; }
      if (!body.childOnly) active = false;
      res.end(JSON.stringify({ revoked: true }));
    } else res.writeHead(404).end('{}');
  });
  const brokerOrigin = await listen(broker);
  let gateway;
  const server = createServer(async (req, res) => {
    try {
      if (options.staticRoot) {
        await createProtectedStaticHandler({ gateway, root: options.staticRoot })(req, res);
      } else if (!(await gateway.handle(req, res, { sessionKey: internalSessionKey }))) {
        const session = await gateway.requireSession(req, res, { sessionKey: internalSessionKey });
        if (session) res.end(JSON.stringify({ identity: session.identity }));
      }
    } catch (error) {
      res.writeHead(500).end('test-server-error');
    }
  });
  const origin = await listen(server);
  gateway = createSharedAuthGateway({
    appId: 'duckman', issuer, appOrigins: [origin, ...(options.aliases || [])],
    sharedLoginUrl: 'https://accounts.example.test/login/',
    broker: { clientId, clientSecret: secret,
      exchangeUrl: `${brokerOrigin}/exchange`, introspectUrl: `${brokerOrigin}/introspect`,
      revokeUrl: `${brokerOrigin}/revoke` },
    store, clock: () => now, allowInsecureLocalhost: true, basePath,
    resolveIdentity: options.resolveIdentity || (async (proof) => {
      assert.equal(proof.localIdentity.userId, 'local-user-11');
      return { id: 'local-user-11', displayName: proof.displayName, role: 'read_only',
        ...(proof.localIdentity.organizationId === undefined ? {} : { organizationId: proof.localIdentity.organizationId }) };
    }), nativeSessionAdapter: options.nativeSessionAdapter,
  });
  t.after(async () => { gateway.close(); await Promise.all([close(server), close(broker)]); });
  const request = (path, opts = {}) => fetch(`${origin}${path}`, { redirect: 'manual', ...opts });
  const begin = async (returnPath = `${basePath}/documents?tab=owned#entry`) => {
    const response = await request(`${basePath}/auth/login?returnPath=${encodeURIComponent(returnPath)}`);
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get('location'));
    const cookie = cookieFrom(response, 'suite_duckman_transaction=');
    const code = `code${String(codes.size + exchangeCalls).padStart(39, '0')}`;
    codes.set(code, {
      state: target.searchParams.get('state'),
      challenge: target.searchParams.get('code_challenge'),
      redirectUri: target.searchParams.get('redirect_uri'),
    });
    return { target, cookie, code };
  };
  const callback = ({ target, cookie, code }, overrides = {}) => request(
    `${basePath}/auth/callback?code=${encodeURIComponent(overrides.code || code)}&state=${encodeURIComponent(overrides.state || target.searchParams.get('state'))}`,
    { headers: { Cookie: overrides.cookie ?? cookie } },
  );
  const signIn = async () => {
    const transaction = await begin();
    const response = await callback(transaction);
    assert.equal(response.status, 302);
    return { response, transaction, cookie: cookieFrom(response, 'suite_duckman_session=') };
  };
  return { gateway, store, origin, request, begin, callback, signIn,
    setInternalSessionKey: value => { internalSessionKey = value; },
    advance: (ms) => { now += ms; }, setMode: (value) => { mode = value; },
    setOrganization: (value) => { proofOrganization = value; },
    revoke: () => { active = false; },
    get exchangeCalls() { return exchangeCalls; }, get revokeCalls() { return revokeCalls; },
    get parentActive() { return active; },
    get seenExchange() { return seenExchange; } };
}

test('app initiates an opaque state transaction and S256 PKCE before shared login', async (t) => {
  const f = await fixture(t);
  const { target, cookie } = await f.begin();
  assert.equal(target.origin, 'https://accounts.example.test');
  assert.equal(target.searchParams.get('app'), 'duckman');
  assert.match(target.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(target.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(target.searchParams.get('redirect_uri'), `${f.origin}/auth/callback`);
  assert.equal(target.searchParams.get('returnPath'), '/documents?tab=owned#entry');
  assert.match(cookie, /^suite_duckman_transaction=[A-Za-z0-9_-]{43}$/);
  const response = await f.request('/auth/login');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/i);
});

test('native DB session marker enforces shared proof after the browser removes its suite cookie', async t => {
  let marker;
  const f = await fixture(t, { nativeSessionAdapter: {
    create: async (_req, _res, _identity, metadata) => { marker = metadata.sessionKey; },
    read: async () => ({ id: 'independent-native-user', displayName: 'Legacy user' }),
  } });
  await f.signIn();
  f.setInternalSessionKey(marker);
  assert.equal((await f.request('/private')).status, 200);
  const session = await (await f.request('/api/suite/session')).json();
  assert.equal(session.shared, true);
  assert.equal(session.user.id, 'local-user-11');
  f.revoke();
  assert.equal((await f.request('/private')).status, 401);
  f.setInternalSessionKey('f'.repeat(64));
  assert.equal((await f.request('/private')).status, 401, 'unknown internal marker never falls back to an independent native identity');
});

test('legacy subpath keeps its origin, exact callback and local return path', async t => {
  const f = await fixture(t, { basePath: '/methpipe' });
  const transaction = await f.begin('/methpipe/documents?tab=all');
  assert.equal(transaction.target.searchParams.get('redirect_uri'), `${f.origin}/methpipe/auth/callback`);
  const response = await f.callback(transaction);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/methpipe/documents?tab=all');
  assert.equal((await f.request('/methpipe/auth/login?returnPath=%2Fother-app')).status, 400);
});

test('valid callback exchanges server-side and creates a real local identity session', async (t) => {
  const f = await fixture(t);
  const { response, cookie, transaction } = await f.signIn();
  assert.equal(response.headers.get('location'), '/documents?tab=owned#entry');
  assert.equal(f.seenExchange.state, transaction.target.searchParams.get('state'));
  assert.equal(sha256(f.seenExchange.codeVerifier), transaction.target.searchParams.get('code_challenge'));
  assert.equal(f.seenExchange.clientId, 'duckman-client');
  assert.equal(f.seenExchange.redirectUri, `${f.origin}/auth/callback`);
  assert.doesNotMatch(cookie, /central-user|local-user|gggg/);
  const session = await f.request('/api/suite/session', { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);
  assert.deepEqual((await session.json()).user, { id: 'local-user-11', displayName: 'Real account', role: 'read_only' });
  assert.equal(session.headers.get('cache-control'), 'no-store');
});

test('wrong state, missing cookie, expired transactions and callback replay fail closed', async (t) => {
  const f = await fixture(t);
  const first = await f.begin();
  assert.equal((await f.callback(first, { state: 'w'.repeat(43) })).status, 400);
  assert.equal(f.exchangeCalls, 0);
  assert.equal((await f.callback(first)).status, 400);
  const second = await f.begin();
  assert.equal((await f.callback(second, { cookie: '' })).status, 400);
  f.advance(10 * 60 * 1000 + 1);
  assert.equal((await f.callback(second)).status, 400);
  const third = await f.begin();
  assert.equal((await f.callback(third)).status, 302);
  assert.equal((await f.callback(third)).status, 400);
  assert.equal(f.exchangeCalls, 1);
});

test('concurrent duplicate callbacks consume an app transaction exactly once', async (t) => {
  const f = await fixture(t);
  const transaction = await f.begin();
  const responses = await Promise.all([f.callback(transaction), f.callback(transaction)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [302, 400]);
  assert.equal(f.exchangeCalls, 1);
});

test('allowed GoFlo aliases retain their exact callback origin and Secure host-only cookies', async (t) => {
  const aliases = ['https://flow.example.test', 'https://goflo.example.test', 'https://flobro.example.test'];
  const f = await fixture(t, { aliases });
  for (const alias of aliases) {
    const response = await requestWithHost(`${f.origin}/auth/login`, new URL(alias).host);
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get('location'));
    assert.equal(target.searchParams.get('redirect_uri'), `${alias}/auth/callback`);
    assert.match(response.headers.get('set-cookie'), /^__Host-suite_duckman_transaction=/);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
    assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/i);
  }
  assert.equal((await requestWithHost(`${f.origin}/auth/login`, 'flow.example.test.attacker.test')).status, 400);
});

for (const mode of ['wrong-issuer', 'wrong-app', 'expired-proof']) {
  test(`broker ${mode} assertion cannot create an app session`, async (t) => {
    const f = await fixture(t);
    f.setMode(mode);
    const response = await f.callback(await f.begin());
    assert.equal(response.status, 502);
    assert.equal(cookieFrom(response, 'suite_duckman_session='), undefined);
  });
}

test('forged cookie is unauthenticated and broker revocation invalidates existing sessions', async (t) => {
  const f = await fixture(t);
  const forged = await f.request('/api/suite/session', { headers: { Cookie: `suite_duckman_session=${'f'.repeat(43)}` } });
  assert.equal((await forged.json()).authenticated, false);
  const { cookie } = await f.signIn();
  f.revoke();
  const revoked = await f.request('/api/suite/session', { headers: { Cookie: cookie } });
  assert.equal((await revoked.json()).authenticated, false);
  const protectedPage = await f.request('/private', { headers: { Cookie: cookie } });
  assert.equal(protectedPage.status, 401);
});

test('broker outage cannot authorize cached identities', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.signIn();
  f.setMode('unavailable');
  assert.equal((await f.request('/private', { headers: { Cookie: cookie } })).status, 503);
});

test('app session expiry is enforced even if the broker still asserts an active account', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.signIn();
  f.advance(60 * 60 * 1000 + 1);
  const response = await f.request('/private', { headers: { Cookie: cookie } });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('logout requires exact origin and session CSRF and revokes the parent proof', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.signIn();
  const view = await f.request('/api/suite/session', { headers: { Cookie: cookie } });
  const { csrfToken } = await view.json();
  const logout = (headers) => f.request('/api/suite/logout', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: '{}',
  });
  assert.equal((await logout({ Origin: 'https://attacker.example.test', 'X-CSRF-Token': csrfToken })).status, 403);
  assert.equal((await logout({ Origin: f.origin, 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal(f.revokeCalls, 0);
  const response = await logout({ Origin: f.origin, 'X-CSRF-Token': csrfToken });
  assert.equal(response.status, 200);
  assert.equal(f.revokeCalls, 1);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await (await f.request('/api/suite/session', { headers: { Cookie: cookie } })).json()).authenticated, false);
});

test('failed shared logout retains the local proof for a retry without claiming revocation', async (t) => {
  const f = await fixture(t);
  const { cookie } = await f.signIn();
  const { csrfToken } = await (await f.request('/api/suite/session', { headers: { Cookie: cookie } })).json();
  f.setMode('revoke-unavailable');
  const response = await f.request('/api/suite/logout', { method: 'POST',
    headers: { Cookie: cookie, Origin: f.origin, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await f.request('/private', { headers: { Cookie: cookie } })).status, 200);
});

test('local permissions are read again after sign-in and a removed mapping invalidates the session', async (t) => {
  let identity = { id: 'local-user-11', displayName: 'Local reviewer', role: 'reviewer' };
  const f = await fixture(t, { resolveIdentity: async () => identity });
  const { cookie } = await f.signIn();
  identity = { ...identity, role: 'read_only' };
  const session = await f.request('/api/suite/session', { headers: { Cookie: cookie } });
  assert.equal((await session.json()).user.role, 'read_only');
  identity = null;
  assert.equal((await f.request('/private', { headers: { Cookie: cookie } })).status, 401);
});

test('failed native session creation clears the derived local proof without globally logging out', async (t) => {
  const f = await fixture(t, { nativeSessionAdapter: {
    create: async () => { throw new Error('local database failure'); },
  } });
  const response = await f.callback(await f.begin());
  assert.equal(response.status, 503);
  assert.equal(cookieFrom(response, 'suite_duckman_session='), undefined);
  assert.equal(f.revokeCalls, 1);
  assert.equal(f.parentActive, true);
});

test('approved organization reaches native session creation without inferring another membership', async (t) => {
  let nativeIdentity;
  let nativeMetadata;
  const f = await fixture(t, { organizationId: 'org-approved-A', nativeSessionAdapter: {
    create: async (_req, _res, identity, metadata) => { nativeIdentity = identity; nativeMetadata = metadata; },
  } });
  const { cookie } = await f.signIn();
  assert.equal(nativeIdentity.organizationId, 'org-approved-A');
  assert.deepEqual(nativeMetadata.localIdentity, { userId: 'local-user-11', organizationId: 'org-approved-A' });
  const session = await f.request('/api/suite/session', { headers: { Cookie: cookie } });
  assert.equal((await session.json()).user.organizationId, 'org-approved-A');
});

test('org A grant cannot create native org B or a session with an unspecified organization', async (t) => {
  for (const organizationId of ['org-other-B', undefined]) {
    let created = false;
    const f = await fixture(t, { organizationId: 'org-approved-A',
      resolveIdentity: async () => ({ id: 'local-user-11', displayName: 'Member', organizationId }),
      nativeSessionAdapter: { create: async () => { created = true; } },
    });
    const response = await f.callback(await f.begin());
    assert.equal(response.status, 403);
    assert.equal(created, false);
    assert.equal(cookieFrom(response, 'suite_duckman_session='), undefined);
  }
});

test('introspection cannot move an existing app session to a different organization', async (t) => {
  const f = await fixture(t, { organizationId: 'org-approved-A' });
  const { cookie } = await f.signIn();
  f.setOrganization('org-other-B');
  assert.equal((await f.request('/private', { headers: { Cookie: cookie } })).status, 502);
});

test('refreshed local identity must retain the approved organization', async (t) => {
  let organizationId = 'org-approved-A';
  const f = await fixture(t, { organizationId,
    resolveIdentity: async () => ({ id: 'local-user-11', displayName: 'Member', organizationId }),
  });
  const { cookie } = await f.signIn();
  organizationId = 'org-other-B';
  assert.equal((await f.request('/private', { headers: { Cookie: cookie } })).status, 401);
});

test('native legacy session remains visible without claiming a shared account grant', async (t) => {
  const f = await fixture(t, { nativeSessionAdapter: {
    read: async () => ({ id: 'legacy-user', displayName: 'Existing login', role: 'reviewer' }),
  } });
  const response = await f.request('/api/suite/session');
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.source, 'native');
  assert.equal(body.shared, false);
  assert.equal(body.csrfToken, null);
  assert.equal(body.user.id, 'legacy-user');
  const forged = await f.request('/api/suite/session', {
    headers: { Cookie: `suite_duckman_session=${'f'.repeat(43)}` },
  });
  assert.equal((await forged.json()).authenticated, false);
});

test('explicit local mapping is required and local roles are never derived from central names', async (t) => {
  const f = await fixture(t, { resolveIdentity: async () => null });
  const response = await f.callback(await f.begin());
  assert.equal(response.status, 403);
  assert.equal(cookieFrom(response, 'suite_duckman_session='), undefined);
});

test('return paths reject open redirects, nested encoded traversal and malformed query input', async (t) => {
  const f = await fixture(t);
  for (const path of ['//attacker.test', '/\\attacker.test', '/%252f%252fattacker.test', '/%00bad', 'https://attacker.test']) {
    assert.equal((await f.request(`/auth/login?returnPath=${encodeURIComponent(path)}`)).status, 400, path);
  }
  assert.equal((await f.request('/auth/login?returnPath=/a&returnPath=/b')).status, 400);
  assert.equal((await f.request('/auth/callback?code=a&code=b&state=c')).status, 400);
});

test('protected static entry is gated and traversal and symlink escapes are never served', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'suite-static-'));
  const root = join(temporary, 'frontend');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(root));
  await writeFile(join(root, 'index.html'), '<h1>private app</h1>');
  await writeFile(join(temporary, 'secret.txt'), 'private runtime secret');
  await symlink(join(temporary, 'secret.txt'), join(root, 'escape.txt'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const f = await fixture(t, { staticRoot: root });
  const denied = await f.request('/');
  assert.equal(denied.status, 302);
  assert.equal(new URL(denied.headers.get('location'), f.origin).pathname, '/auth/login');
  const { cookie } = await f.signIn();
  const page = await f.request('/', { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /private app/);
  for (const path of ['/escape.txt', '/%252e%252e/secret.txt', '/.env', '/%5csecret.txt']) {
    const response = await f.request(path, { headers: { Cookie: cookie } });
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /private runtime secret/);
  }
});
