/**
 * Opt-in broker authorization-generation binding contract.
 *
 * Synthetic trusted identity adapters ONLY. No native services or live billing
 * are contacted; this does not switch production to organization-based SSO.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createAuthBroker, createMemoryBrokerStore } from '../shared-auth/broker.mjs';

const opaque = () => randomBytes(32).toString('base64url');
const secret = opaque();
const state = opaque();
const verifier = opaque();
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'https://goflo.example.test/auth/callback';
const NO_BINDING = Symbol('legacy unbound grant');

async function fixture(t, initialBinding = NO_BINDING) {
  const now = 1_800_000_000_000;
  let parent = null;
  let binding = initialBinding;
  let proofWrites = 0;
  const localIdentity = { userId: 'same-native-id', organizationId: 'same-native-tenant' };
  const identity = {
    async getSession() { return parent; },
    async authenticate(_req, _res, { email, password }) {
      if (email !== 'user@example.test' || password !== 'synthetic-only-password') return null;
      parent = {
        id: 'private-parent-session', subject: 'central-account',
        displayName: 'Synthetic user', expiresAt: now + 3_600_000,
        passwordChangeRequired: false,
      };
      return parent;
    },
    async getParentSession(id) { return parent?.id === id ? parent : null; },
    async getAccess(_parent, appId) {
      if (appId !== 'goflo') return null;
      return {
        localIdentity,
        ...(binding === NO_BINDING ? {} : { bindingRevision: binding }),
      };
    },
    async logout() { parent = null; },
  };
  const store = createMemoryBrokerStore();
  const originalPutProof = store.putProof.bind(store);
  store.putProof = async (...args) => {
    proofWrites += 1;
    return originalPutProof(...args);
  };
  let broker;
  const server = http.createServer(async (req, res) => {
    if (!await broker.handle(req, res)) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  broker = createAuthBroker({
    origin, issuer: 'https://identity.example.test', clock: () => now,
    clients: [{ id: 'goflo', appId: 'goflo', secret, redirectUris: [redirectUri] }],
    identity, store,
  });
  const session = await fetch(origin + '/api/suite/auth/session');
  const csrf = await session.json();
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const target = {
    appId: 'goflo', returnPath: '/analysis', state,
    codeChallenge: challenge, codeChallengeMethod: 'S256',
    redirectUri,
  };
  async function post(route, body, serverAuth = false) {
    const response = await fetch(origin + '/api/suite/auth/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(serverAuth
          ? { Authorization: 'Basic ' + Buffer.from('goflo:' + secret).toString('base64') }
          : { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf.csrfToken }),
      },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
    };
  }
  async function login() {
    const response = await post('login', {
      ...target, email: 'user@example.test', password: 'synthetic-only-password',
    });
    return {
      ...response,
      code: response.status === 200
        ? new URL(response.data.redirectUrl).searchParams.get('code') : null,
    };
  }
  const exchange = code => post('exchange', {
    clientId: 'goflo', code, state, codeVerifier: verifier, redirectUri,
  }, true);
  const introspect = sessionToken => post('introspect', { sessionToken }, true);
  const nativeSession = sessionToken => broker.authenticateNativeSession({
    headers: { authorization: 'Basic ' + Buffer.from('goflo:' + secret).toString('base64') },
  }, { sessionToken });
  return {
    login, exchange, introspect, nativeSession, post,
    setBinding: value => { binding = value; },
    proofWrites: () => proofWrites,
  };
}

test('unbound legacy grant remains compatible, without exposing revisions in public assertions', async t => {
  const f = await fixture(t);
  const login = await f.login();
  assert.equal(login.status, 200);
  const exchanged = await f.exchange(login.code);
  assert.equal(exchanged.status, 200);
  assert.deepEqual(exchanged.data.localIdentity, {
    userId: 'same-native-id', organizationId: 'same-native-tenant',
  });
  assert.equal(Object.hasOwn(exchanged.data, 'bindingRevision'), false);
  const live = await f.introspect(exchanged.data.sessionToken);
  assert.equal(live.data.active, true);
  assert.equal(Object.hasOwn(live.data, 'bindingRevision'), false);
  assert.equal((await f.nativeSession(exchanged.data.sessionToken)).active, true);
  assert.equal(f.proofWrites(), 1);
});

test('authorization code cannot be exchanged after grant revision changes, even if identity is unchanged', async t => {
  const f = await fixture(t, 'alpha:1');
  const login = await f.login();
  assert.equal(login.status, 200);
  f.setBinding('alpha:2');
  const exchanged = await f.exchange(login.code);
  assert.deepEqual(exchanged, { status: 401, data: { error: 'invalid_grant' } });
  assert.equal(f.proofWrites(), 0);
  assert.equal((await f.exchange(login.code)).status, 401);
});

test('revoking/rebinding the same native ID invalidates issued proof and native backend session', async t => {
  const f = await fixture(t, 'alpha:100');
  const login = await f.login();
  const issued = await f.exchange(login.code);
  assert.equal(issued.status, 200);
  assert.equal((await f.introspect(issued.data.sessionToken)).data.active, true);
  f.setBinding('alpha:101'); // revoke/rebind identical local user and tenant
  assert.deepEqual((await f.introspect(issued.data.sessionToken)).data, { active: false });
  assert.equal(await f.nativeSession(issued.data.sessionToken), null);
  f.setBinding('alpha:102');
  assert.deepEqual((await f.introspect(issued.data.sessionToken)).data, { active: false });
});

test('selected Workspace organization change invalidates proof with unchanged native identity tuple', async t => {
  const f = await fixture(t, 'workspace-alpha:101');
  const login = await f.login();
  const issued = await f.exchange(login.code);
  assert.equal(issued.status, 200);
  f.setBinding('workspace-beta:101');
  assert.deepEqual((await f.introspect(issued.data.sessionToken)).data, { active: false });
});

test('switching between legacy and revision-aware adapters invalidates outstanding codes and proofs', async t => {
  const f = await fixture(t, 'alpha:1');
  const strictCode = await f.login();
  f.setBinding(NO_BINDING);
  assert.equal((await f.exchange(strictCode.code)).status, 401);
  const legacyCode = await f.login();
  const oldProof = await f.exchange(legacyCode.code);
  assert.equal(oldProof.status, 200);
  f.setBinding('alpha:2');
  assert.deepEqual((await f.introspect(oldProof.data.sessionToken)).data, { active: false });
  const strictAfterChange = await f.login();
  assert.equal(strictAfterChange.status, 200);
  f.setBinding(NO_BINDING);
  assert.deepEqual(await f.exchange(strictAfterChange.code), {
    status: 401, data: { error: 'invalid_grant' },
  });
});

test('malformed, missing-value and ambiguous binding revisions deny access before code issuance', async t => {
  const f = await fixture(t, 'alpha:1');
  for (const invalid of ['', null, undefined, 5, {}, 'alpha beta', ':alpha', 'x'.repeat(129)]) {
    f.setBinding(invalid);
    const login = await f.login();
    assert.equal(login.status, 403, 'Invalid revision: ' + String(invalid));
    assert.deepEqual(login.data, { error: 'access_denied' });
  }
  assert.equal(f.proofWrites(), 0);
  f.setBinding('alpha:4');
  assert.equal((await f.login()).status, 200);
});

test('withdrawn revision-bound proof can still globally revoke parent login', async t => {
  const f = await fixture(t, 'alpha:1');
  const login = await f.login();
  const issued = await f.exchange(login.code);
  assert.equal(issued.status, 200);
  f.setBinding('alpha:2');
  const revoke = await f.post('revoke', { sessionToken: issued.data.sessionToken }, true);
  assert.equal(revoke.status, 204);
  // The old parent session is gone; re-authentication would be required.
  assert.equal((await f.post('authorize', {
    appId: 'goflo', returnPath: '/analysis', state,
    codeChallenge: challenge, codeChallengeMethod: 'S256', redirectUri,
  })).status, 401);
});
