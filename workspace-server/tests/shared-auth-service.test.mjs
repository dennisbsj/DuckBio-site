import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createIdentityStore } from '../shared-auth/identity-store.mjs';
import { createSqliteAuthStores } from '../shared-auth/sqlite-store.mjs';
import { createAccountService } from '../shared-auth/account-service.mjs';

async function fixture(t, { allNative = false, beforeRoster } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-service-'));
  const identityStore = createIdentityStore({ databasePath: path.join(directory, 'identity.sqlite') });
  const stores = createSqliteAuthStores({ databasePath: path.join(directory, 'auth.sqlite') });
  const setupToken = randomBytes(32).toString('base64url');
  identityStore.configureBootstrapToken(setupToken);
  writeFileSync(path.join(directory, 'index.html'), '<html><head></head><body>local accounts</body></html>');
  const clients = ['goflo', 'eel', 'methpipe', 'mantrain', 'duckman', 'limsman'].map(id => ({ id, appId: id, secret: randomBytes(32).toString('base64url'), redirectUris: [`https://${id}.celluloidconsulting.net/auth/callback`], nativeOrigin: (allNative || ['eel', 'duckman', 'limsman'].includes(id)) ? `https://${id}.celluloidconsulting.net` : undefined }));
  let service;
  const server = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const nativeCalls = [];
  service = createAccountService({ origin, issuer: 'https://login.celluloidconsulting.net', clients, identityStore, authStore: stores.brokerStore, assetRoot: directory, buildVersion: 'test-local-service', getClientAddress: req => req.socket.remoteAddress,
    fetchImpl: async (url, options) => {
      nativeCalls.push({ url, options });
      const appId = clients.find(client => client.nativeOrigin && url === `${client.nativeOrigin}/api/suite/native-users`)?.appId;
      assert.ok(appId);
      await beforeRoster?.(identityStore);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Origin, undefined);
      return new Response(JSON.stringify({ users: [{ id: appId === 'eel' ? 'native-eel-user' : `existing-${appId}-uuid`, displayName: 'Existing scientist', email: 'native@example.test', role: 'scientist', ...(appId === 'eel' ? { organizationId: 'approved-org', organizationName: 'Existing laboratory' } : {}) }] }), { headers: { 'Content-Type': 'application/json' } });
    },
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); identityStore.close(); stores.close(); rmSync(directory, { recursive: true, force: true }); });
  function browser() {
    const cookies = new Map(); let csrf;
    async function call(route, body, method = body === undefined ? 'GET' : 'POST', includeCsrf = true) {
      const response = await fetch(origin + route, { method, redirect: 'manual', headers: { ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin, ...(csrf && includeCsrf ? { 'X-CSRF-Token': csrf } : {}) } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      for (const value of response.headers.getSetCookie()) { const [key, content] = value.split(';')[0].split('='); if (content) cookies.set(key, content); else cookies.delete(key); }
      return response;
    }
    return { call, async preflight() { const response = await call('/api/suite/auth/session'); const data = await response.json(); csrf = data.csrfToken; return data; } };
  }
  return { identityStore, origin, setupToken, nativeCalls, browser };
}

test('private first-admin setup establishes local account, preserves scope and denies public provisioning', async t => {
  const f = await fixture(t); const admin = f.browser();
  assert.equal((await admin.preflight()).authenticated, false);
  const details = { setupToken: f.setupToken, email: 'owner@example.test', displayName: 'Local owner', password: ' a long owner password ' };
  assert.equal((await admin.call('/api/suite/setup', details, 'POST', false)).status, 403);
  const setup = await admin.call('/api/suite/setup', details);
  assert.equal(setup.status, 201);
  const owner = (await setup.json()).user;
  assert.equal(owner.isAdmin, true);
  const account = await (await admin.call('/api/suite/account')).json();
  assert.equal(account.user.id, owner.id);
  assert.deepEqual(account.apps.filter(app => app.enabled).map(app => app.id).sort(), ['goflo', 'mantrain', 'methpipe']);
  assert.equal((await admin.call('/api/suite/setup', details)).status, 403);
  assert.equal((await admin.call('/api/suite/admin/users', { userId: owner.id, state: 'disabled' }, 'PATCH')).status, 409);
  const roster = await admin.call('/api/suite/admin/native-users?app=eel');
  assert.equal(roster.status, 200); assert.equal(f.nativeCalls.length, 1);
  assert.equal((await admin.call('/api/suite/admin/grants', { userId: owner.id, appId: 'eel', localUserId: 'native-eel-user', organizationId: 'wrong-org' }, 'PUT')).status, 400);
  const granted = await admin.call('/api/suite/admin/grants', { userId: owner.id, appId: 'eel', localUserId: 'native-eel-user', organizationId: 'approved-org' }, 'PUT');
  assert.equal(granted.status, 200);
  assert.deepEqual(f.identityStore.getAccess(owner.id, 'eel'), { localIdentity: { userId: 'native-eel-user', organizationId: 'approved-org' } });
  assert.equal((await admin.call('/api/suite/admin/grants', { userId: owner.id, appId: 'goflo', localUserId: 'unrelated-account' }, 'PUT')).status, 400);
  const backup = await admin.call('/api/suite/admin/backup', {});
  assert.equal(backup.status, 200); assert.match(backup.headers.get('cache-control'), /no-store/);
  const data = await backup.json();
  assert.ok(data.users[0].credential.hash);
  assert.equal('sessions' in data, false);
  assert.equal('setupToken' in data, false);
});

test('invited local member cannot administer; password changes and disable revoke all prior sessions', async t => {
  const f = await fixture(t); const admin = f.browser(); const member = f.browser();
  await admin.preflight(); await member.preflight();
  await admin.call('/api/suite/setup', { setupToken: f.setupToken, email: 'owner@example.test', displayName: 'Owner', password: 'Owner password 12345' });
  const invitation = await admin.call('/api/suite/admin/invitations', { email: 'member@example.test', displayName: 'Local member', appIds: ['goflo'] });
  assert.equal(invitation.status, 201);
  const token = new URL((await invitation.json()).invitationUrl).searchParams.get('token');
  const accept = await member.call('/api/suite/invitations/accept', { token, password: ' exact member password ' });
  assert.equal(accept.status, 201);
  const user = (await accept.json()).user;
  assert.equal(user.isAdmin, false);
  assert.equal((await member.call('/api/suite/admin/users')).status, 403);
  assert.equal((await member.call('/api/suite/admin/backup', {})).status, 403);
  assert.equal((await member.call('/api/suite/invitations/accept', { token, password: ' exact member password ' })).status, 400);
  const other = f.browser(); await other.preflight();
  assert.equal((await other.call('/api/suite/account/login', { email: 'member@example.test', password: 'exact member password' })).status, 401);
  assert.equal((await other.call('/api/suite/account/login', { email: 'member@example.test', password: ' exact member password ' })).status, 200);
  assert.equal((await member.call('/api/suite/account/password', { currentPassword: 'wrong password', newPassword: 'new local password 456' })).status, 401);
  assert.equal((await member.call('/api/suite/account/password', { currentPassword: ' exact member password ', newPassword: 'new local password 456' })).status, 200);
  assert.equal((await other.preflight()).authenticated, false);
  assert.equal((await member.preflight()).authenticated, true);
  assert.equal((await admin.call('/api/suite/admin/users', { userId: user.id, state: 'disabled' }, 'PATCH')).status, 200);
  assert.equal((await member.preflight()).authenticated, false);
  const guest = f.browser(); await guest.preflight();
  assert.equal((await guest.call('/api/suite/admin/users')).status, 401);
  assert.equal((await guest.call('/identity.sqlite')).status, 404);
  assert.equal((await guest.call('/../.github/shared-auth/identity-store.mjs')).status, 404);
});

test('six native account apps require explicit existing user mappings and never receive synthetic setup grants', async t => {
  const f = await fixture(t, { allNative: true }); const admin = f.browser();
  await admin.preflight();
  const response = await admin.call('/api/suite/setup', { setupToken: f.setupToken, email: 'owner@example.test', displayName: 'Owner', password: 'Owner password 12345' });
  assert.equal(response.status, 201);
  const owner = (await response.json()).user;
  const account = await (await admin.call('/api/suite/account')).json();
  assert.equal(account.apps.filter(app => app.enabled).length, 0);
  assert.ok(account.apps.every(app => app.nativeIdentity === true));
  assert.equal((await admin.call('/api/suite/admin/invitations', { email: 'member@example.test', displayName: 'Member', appIds: ['goflo'] })).status, 400);
  assert.equal((await admin.call('/api/suite/admin/invitations', { email: 'member@example.test', displayName: 'Member', appIds: [] })).status, 201);
  for (const appId of ['goflo', 'methpipe', 'mantrain']) {
    const roster = await admin.call('/api/suite/admin/native-users?app=' + appId);
    assert.equal(roster.status, 200);
    assert.equal((await roster.json()).users[0].id, `existing-${appId}-uuid`);
    assert.equal((await admin.call('/api/suite/admin/grants', { userId: owner.id, appId, localUserId: owner.id }, 'PUT')).status, 400);
    assert.equal((await admin.call('/api/suite/admin/grants', { userId: owner.id, appId, localUserId: `existing-${appId}-uuid` }, 'PUT')).status, 200);
    assert.equal(f.identityStore.getAccess(owner.id, appId).localIdentity.userId, `existing-${appId}-uuid`);
  }
});

for (const operation of ['grant', 'roster']) test(`revoking an admin during native roster lookup prevents the delayed ${operation}`, async t => {
  let revoke = false;
  const f = await fixture(t, { beforeRoster(store) { if (revoke) store.revokeUserSessions(store.listUsers()[0].id); } });
  const admin = f.browser(); await admin.preflight();
  const response = await admin.call('/api/suite/setup', { setupToken: f.setupToken, email: 'owner@example.test', displayName: 'Owner', password: 'Owner password 12345' });
  const owner = (await response.json()).user;
  revoke = true;
  const result = operation === 'grant'
    ? await admin.call('/api/suite/admin/grants', { userId: owner.id, appId: 'eel', localUserId: 'native-eel-user', organizationId: 'approved-org' }, 'PUT')
    : await admin.call('/api/suite/admin/native-users?app=eel');
  assert.equal(result.status, 401);
  assert.equal(f.identityStore.getAccess(owner.id, 'eel'), null);
});
