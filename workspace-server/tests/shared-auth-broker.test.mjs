import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createAuthBroker, createMemoryBrokerStore } from '../shared-auth/broker.mjs';

const secret = randomBytes(32).toString('base64url');
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const client = { id: 'duckman', appId: 'duckman', secret, redirectUris: ['https://duckman.celluloidconsulting.net/auth/callback'] };

async function fixture() {
  let time = 1_800_000_000_000;
  let access = true;
  let parent = null;
  let calls = 0;
  const identity = {
    async getSession() { return parent; },
    async authenticate(_req, _res, credentials) {
      calls += 1;
      if (credentials.email !== 'existing@example.test' || credentials.password !== '  exact password  ') return null;
      parent = { id: 'native-session', subject: 'native-user', displayName: 'Existing user', expiresAt: time + 3_600_000, passwordChangeRequired: false };
      return parent;
    },
    async getParentSession(id) { return parent?.id === id ? parent : null; },
    async getAccess(session, appId) { return access && session && appId === 'duckman' ? { localIdentity: { userId: 'existing-duck-user' } } : null; },
    async logout() { parent = null; },
  };
  let broker;
  const server = http.createServer(async (req, res) => {
    if (!await broker.handle(req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  broker = createAuthBroker({ origin, issuer: 'https://identity.example.test', clients: [client], identity, store: createMemoryBrokerStore(), clock: () => time });
  const session = await fetch(`${origin}/api/suite/auth/session`);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const preflight = await session.json();
  async function post(route, body, { csrf = true, serverAuth = false, requestOrigin = origin } = {}) {
    return fetch(`${origin}/api/suite/auth/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(serverAuth ? { Authorization: `Basic ${Buffer.from(`duckman:${secret}`).toString('base64')}` } : { Cookie: cookie, Origin: requestOrigin, ...(csrf ? { 'X-CSRF-Token': preflight.csrfToken } : {}) }) },
      body: JSON.stringify(body),
    });
  }
  const target = { appId: 'duckman', returnPath: '/library?tab=all', state, codeChallenge: challenge, codeChallengeMethod: 'S256', redirectUri: client.redirectUris[0] };
  async function login(extra = {}) {
    const response = await post('login', { ...target, email: 'existing@example.test', password: '  exact password  ', ...extra });
    return { response, body: await response.json() };
  }
  async function exchange(code, extra = {}) {
    const response = await post('exchange', { clientId: 'duckman', code, state, codeVerifier: verifier, redirectUri: client.redirectUris[0], ...extra }, { serverAuth: true });
    return { response, body: await response.json() };
  }
  return { origin, post, login, exchange, target, preflight, cookie, calls: () => calls, setAccess: value => { access = value; }, expire: () => { time += 61_000; }, changePassword: () => { parent.passwordChangeRequired = true; }, revokeParent: () => { parent = null; }, close: () => new Promise(resolve => server.close(resolve)) };
}

test('real broker handoff uses existing identity and approved local mapping; code is consumed once', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal(f.preflight.authenticated, false);
  assert.match(f.preflight.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const { response, body } = await f.login();
  assert.equal(response.status, 200);
  const redirect = new URL(body.redirectUrl);
  assert.equal(redirect.origin, 'https://duckman.celluloidconsulting.net');
  assert.equal(redirect.searchParams.get('state'), state);
  assert.deepEqual([...redirect.searchParams.keys()].sort(), ['code', 'state']);
  const exchanged = await f.exchange(redirect.searchParams.get('code'));
  assert.equal(exchanged.response.status, 200);
  assert.equal(exchanged.body.subject, 'native-user');
  assert.deepEqual(exchanged.body.localIdentity, { userId: 'existing-duck-user' });
  assert.equal(exchanged.body.audience, 'duckman');
  const replay = await f.exchange(redirect.searchParams.get('code'));
  assert.equal(replay.response.status, 401);
  const introspect = await f.post('introspect', { sessionToken: exchanged.body.sessionToken }, { serverAuth: true });
  assert.equal((await introspect.json()).active, true);
  f.revokeParent();
  assert.deepEqual(await (await f.post('introspect', { sessionToken: exchanged.body.sessionToken }, { serverAuth: true })).json(), { active: false });
});

test('login rejects missing CSRF and cross-origin credentials before authenticating', async t => {
  const f = await fixture(); t.after(f.close);
  for (const opts of [{ csrf: false }, { requestOrigin: 'https://untrusted.example' }]) {
    const res = await f.post('login', { ...f.target, email: 'existing@example.test', password: '  exact password  ' }, opts);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'csrf_expired' });
  }
  assert.equal(f.calls(), 0);
});

test('valid credentials alone do not grant app access or inherit roles', async t => {
  const f = await fixture(); t.after(f.close);
  f.setAccess(false);
  const denied = await f.login();
  assert.equal(denied.response.status, 403);
  assert.deepEqual(denied.body, { error: 'access_denied' });
  const wrong = await f.login({ password: 'exact password' });
  assert.equal(wrong.response.status, 401);
});

test('redirect, state and PKCE are required; unsafe paths never reach account authentication', async t => {
  const f = await fixture(); t.after(f.close);
  for (const extra of [
    { redirectUri: 'https://evil.example/auth/callback' }, { returnPath: '//evil.example' },
    { returnPath: '/%252f%252fevil.example' }, { codeChallengeMethod: 'plain' }, { state: 'short' },
  ]) assert.equal((await f.login(extra)).response.status, 400);
  assert.equal(f.calls(), 0);
  const valid = await f.login();
  const code = new URL(valid.body.redirectUrl).searchParams.get('code');
  assert.equal((await f.exchange(code, { state: randomBytes(32).toString('base64url') })).response.status, 401);
  assert.equal((await f.exchange(code, { codeVerifier: randomBytes(32).toString('base64url') })).response.status, 401);
  assert.equal((await f.exchange(code)).response.status, 200);
});

test('codes expire and live parent/grants are rechecked during exchange and introspection', async t => {
  const f = await fixture(); t.after(f.close);
  let valid = await f.login();
  f.expire();
  assert.equal((await f.exchange(new URL(valid.body.redirectUrl).searchParams.get('code'))).response.status, 401);
  valid = await f.login();
  f.setAccess(false);
  assert.equal((await f.exchange(new URL(valid.body.redirectUrl).searchParams.get('code'))).response.status, 401);
});

test('password-change requirement cannot be bypassed through authorize', async t => {
  const f = await fixture(); t.after(f.close);
  await f.login();
  f.changePassword();
  const response = await f.post('authorize', f.target);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'password_change_required' });
});

test('global logout revokes parent, while childOnly cleanup leaves native session intact', async t => {
  const f = await fixture(); t.after(f.close);
  let valid = await f.login();
  let proof = await f.exchange(new URL(valid.body.redirectUrl).searchParams.get('code'));
  assert.equal((await f.post('revoke', { sessionToken: proof.body.sessionToken, childOnly: true }, { serverAuth: true })).status, 204);
  assert.equal((await f.post('authorize', f.target)).status, 200);
  valid = await f.login();
  proof = await f.exchange(new URL(valid.body.redirectUrl).searchParams.get('code'));
  assert.equal((await f.post('revoke', { sessionToken: proof.body.sessionToken }, { serverAuth: true })).status, 204);
  assert.equal((await f.post('authorize', f.target)).status, 401);
});

test('successful logins from one proxy do not lock out existing users', async t => {
  const f = await fixture(); t.after(f.close);
  for (let i = 0; i < 15; i += 1) assert.equal((await f.login()).response.status, 200);
  for (let i = 0; i < 10; i += 1) assert.equal((await f.login({ password: 'wrong-password' })).response.status, 401);
  assert.equal((await f.login({ password: 'wrong-password' })).response.status, 429);
  assert.equal((await f.login({ email: 'another-account@example.test', password: 'wrong-password' })).response.status, 401);
});

test('withdrawn app grant cannot prevent the issued proof from globally logging out', async t => {
  const f = await fixture(); t.after(f.close);
  const valid = await f.login();
  const exchanged = await f.exchange(new URL(valid.body.redirectUrl).searchParams.get('code'));
  f.setAccess(false);
  assert.deepEqual(await (await f.post('introspect', { sessionToken: exchanged.body.sessionToken }, { serverAuth: true })).json(), { active: false });
  assert.equal((await f.post('revoke', { sessionToken: exchanged.body.sessionToken }, { serverAuth: true })).status, 204);
  f.setAccess(true);
  assert.equal((await f.post('authorize', f.target)).status, 401);
});

test('concurrent exchange requests cannot both redeem the same app handoff', async t => {
  const f = await fixture(); t.after(f.close);
  const valid = await f.login();
  const code = new URL(valid.body.redirectUrl).searchParams.get('code');
  const results = await Promise.all([f.exchange(code), f.exchange(code)]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 401]);
});

test('opening a second login tab reuses CSRF binding without invalidating the first', async t => {
  const f = await fixture(); t.after(f.close);
  const second = await fetch(`${f.origin}/api/suite/auth/session`, { headers: { Cookie: f.cookie } });
  const session = await second.json();
  assert.equal(session.csrfToken, f.preflight.csrfToken);
  assert.equal(second.headers.get('set-cookie'), null);
  assert.equal((await f.login()).response.status, 200);
});
