/**
 * The real Workspace PKCE broker + durable SQLite code/proof store.
 * All six app clients are synthetic; there is no native service or billing
 * adapter and no grant is installed in the live Workspace runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthBroker } from '../shared-auth/broker.mjs';
import { createSqliteAuthStores } from '../shared-auth/sqlite-store.mjs';

const APP_IDS = Object.freeze(['limsman', 'eel', 'methpipe', 'mantrain', 'duckman', 'goflo']);
const opaque = () => randomBytes(32).toString('base64url');
const NOW = 1_800_000_000_000;

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'duckbio-pkce-pin-'));
  const databasePath = join(root, 'private', 'auth.sqlite');
  const stores = createSqliteAuthStores({ databasePath, clock: () => NOW });
  let proofWrites = 0;
  const authStore = {
    ...stores.brokerStore,
    async putProof(key, value) {
      proofWrites += 1;
      return stores.brokerStore.putProof(key, value);
    },
  };
  const clients = APP_IDS.map(id => ({
    id, appId: id,
    secret: opaque(),
    redirectUris: ['https://' + id + '.example.test/auth/callback'],
  }));
  const parent = {
    id: 'existing-parent-session', subject: 'workspace-account',
    displayName: 'Offline Workspace User', expiresAt: NOW + 3_600_000,
  };
  const grants = new Map(APP_IDS.map(id => [id, {
    localIdentity: { userId: 'native-' + id + '-user', organizationId: 'native-org-a' },
  }]));
  const identity = {
    async getSession() { return parent; },
    async authenticate() { return parent; },
    async getParentSession(id) { return id === parent.id ? parent : null; },
    async getAccess(_parent, appId) { return grants.get(appId) ?? null; },
    async logout() {},
  };
  let broker;
  const server = http.createServer(async (req, res) => {
    if (!await broker.handle(req, res)) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  broker = createAuthBroker({
    origin, issuer: 'https://identity.example.test',
    clients, identity, store: authStore, clock: () => NOW,
  });
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    stores.close();
    rmSync(root, { recursive: true, force: true });
  });
  const start = await fetch(origin + '/api/suite/auth/session');
  assert.equal(start.status, 200);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await start.json();
  const browserHeaders = {
    'Content-Type': 'application/json', Origin: origin,
    Cookie: cookie, 'X-CSRF-Token': csrfToken,
  };
  const clientFor = id => {
    const client = clients.find(c => c.id === id);
    assert(client);
    return client;
  };
  async function post(route, body, appId = null) {
    const headers = appId
      ? {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(
          appId + ':' + clientFor(appId).secret,
        ).toString('base64'),
      }
      : browserHeaders;
    const response = await fetch(origin + '/api/suite/auth/' + route, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: response.status === 204 ? null : await response.json(),
    };
  }
  async function authorize(appId) {
    const client = clientFor(appId);
    const state = opaque(), verifier = opaque();
    const codeChallenge = createHash('sha256')
      .update(verifier).digest('base64url');
    const result = await post('authorize', {
      appId, returnPath: '/analysis', state,
      codeChallenge, codeChallengeMethod: 'S256',
      redirectUri: client.redirectUris[0],
    });
    assert.equal(result.status, 200);
    return {
      code: new URL(result.data.redirectUrl).searchParams.get('code'),
      state, verifier, redirectUri: client.redirectUris[0],
    };
  }
  const exchange = (appId, ticket) => post('exchange', {
    clientId: appId, code: ticket.code, state: ticket.state,
    codeVerifier: ticket.verifier, redirectUri: ticket.redirectUri,
  }, appId);
  const introspect = (appId, sessionToken) => post('introspect',
    { clientId: appId, sessionToken }, appId);
  return {
    authorize, exchange, introspect, authStore,
    codeWrites: () => proofWrites, parent, clients,
    setGrant: (appId, localIdentity, revision = undefined) => grants.set(appId,
      localIdentity === null ? null : {
        localIdentity,
        ...(revision === undefined ? {} : { bindingRevision: revision }),
      }),
    getGrant: appId => grants.get(appId),
  };
}

test('all six registered apps deny changed native user at code exchange even with legacy unbound revisions', async t => {
  const f = await fixture(t);
  for (const appId of APP_IDS) {
    const original = f.getGrant(appId).localIdentity;
    const ticket = await f.authorize(appId);
    f.setGrant(appId, {
      userId: original.userId + '-rebound',
      organizationId: original.organizationId,
    });
    const denied = await f.exchange(appId, ticket);
    assert.deepEqual(denied, { status: 401, data: { error: 'invalid_grant' } }, appId);
    assert.equal((await f.exchange(appId, ticket)).status, 401, 'code must be consumed');
    assert.equal(f.codeWrites(), APP_IDS.indexOf(appId), 'denial cannot mint proof');
    // A new code issued for the new identity remains valid.
    const fresh = await f.authorize(appId);
    const valid = await f.exchange(appId, fresh);
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.data.localIdentity, {
      userId: original.userId + '-rebound',
      organizationId: original.organizationId,
    });
    assert.equal((await f.introspect(appId, valid.data.sessionToken)).data.active, true);
  }
});

test('all six registered apps deny changed native tenant even with same user ID and unchanged revision', async t => {
  const f = await fixture(t);
  for (const appId of APP_IDS) {
    const original = f.getGrant(appId).localIdentity;
    f.setGrant(appId, original, 'tenant:1');
    const ticket = await f.authorize(appId);
    f.setGrant(appId, {
      userId: original.userId,
      organizationId: 'native-org-b',
    }, 'tenant:1');
    const denied = await f.exchange(appId, ticket);
    assert.deepEqual(denied, { status: 401, data: { error: 'invalid_grant' } }, appId);
  }
  assert.equal(f.codeWrites(), 0);
});

test('six-app broker accepts unchanged native identities and strict revision at issuance/exchange', async t => {
  const f = await fixture(t);
  for (const appId of APP_IDS) {
    const original = f.getGrant(appId).localIdentity;
    f.setGrant(appId, original, 'strict:123');
    const ticket = await f.authorize(appId);
    const issued = await f.exchange(appId, ticket);
    assert.equal(issued.status, 200);
    assert.equal(issued.data.audience, appId);
    assert.deepEqual(issued.data.localIdentity, original);
    assert.equal(Object.hasOwn(issued.data, 'bindingRevision'), false);
    assert.equal((await f.introspect(appId, issued.data.sessionToken)).data.active, true);
  }
  assert.equal(f.codeWrites(), APP_IDS.length);
});

test('legacy SQLite PKCE code without identity snapshot expires closed and creates no proof', async t => {
  const f = await fixture(t);
  const appId = 'goflo';
  const verifier = opaque(), state = opaque(), code = opaque();
  const redirectUri = f.clients.find(c => c.id === appId).redirectUris[0];
  await f.authStore.putCode(createHash('sha256').update(code).digest('hex'), {
    appId, clientId: appId, parentSessionId: f.parent.id,
    subject: f.parent.subject, state,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    redirectUri, returnPath: '/analysis', expiresAt: NOW + 60_000,
  });
  const result = await f.exchange(appId, { code, state, verifier, redirectUri });
  assert.deepEqual(result, { status: 401, data: { error: 'invalid_grant' } });
  assert.equal(f.codeWrites(), 0);
});

test('suspension between code issuance and exchange denies even when identity remains unchanged', async t => {
  const f = await fixture(t);
  const ticket = await f.authorize('goflo');
  f.setGrant('goflo', null);
  const result = await f.exchange('goflo', ticket);
  assert.deepEqual(result, { status: 401, data: { error: 'invalid_grant' } });
  assert.equal(f.codeWrites(), 0);
});

test('legacy single-tenant local identity stays compatible until its native tenant changes', async t => {
  const f = await fixture(t);
  for (const appId of APP_IDS) {
    const userId = 'legacy-' + appId + '-user';
    f.setGrant(appId, { userId });
    const ticket = await f.authorize(appId);
    const successful = await f.exchange(appId, ticket);
    assert.equal(successful.status, 200, appId);
    assert.deepEqual(successful.data.localIdentity, { userId });
    assert.equal((await f.introspect(appId, successful.data.sessionToken)).data.active, true);
    const beforeTenantBinding = await f.authorize(appId);
    f.setGrant(appId, { userId, organizationId: 'new-native-tenant' });
    assert.deepEqual(await f.exchange(appId, beforeTenantBinding), {
      status: 401, data: { error: 'invalid_grant' },
    }, appId + ' newly introduced native tenant invalidates outstanding code');
    assert.deepEqual((await f.introspect(appId, successful.data.sessionToken)).data, {
      active: false,
    }, appId + ' outstanding proof cannot survive a changed local identity');
  }
});
