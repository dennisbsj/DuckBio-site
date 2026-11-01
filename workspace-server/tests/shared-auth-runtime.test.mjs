import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSuiteRuntime } from '../shared-auth/runtime.mjs';

const SECRET = 'private-native-static-client-secret-32-characters';
const ISSUER = 'https://login.example.test';
const NATIVE_ID = 'existing-native-owner-17';
const CENTRAL_ID = '251677df-3a70-47bd-a075-3da3a288a2e8';
const nativeOwner = { id: NATIVE_ID, displayName: 'Existing native owner', email: 'native-owner@example.test', role: 'admin' };
const cookieFrom = (response, suffix) => response.headers.getSetCookie().find(value => value.split('=')[0].endsWith(suffix))?.split(';')[0];

async function fixture(t, { appId = 'goflo', basePath = '', native = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'suite-runtime-'));
  const frontend = join(directory, 'frontend');
  mkdirSync(frontend);
  writeFileSync(join(frontend, 'index.html'), '<html><head></head><body>Private existing application</body></html>');
  writeFileSync(join(frontend, 'science-auth.js'), 'window.existingApplication = true;');
  const databasePath = join(directory, 'native.sqlite');
  if (native) {
    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL)');
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(NATIVE_ID, nativeOwner.email, nativeOwner.displayName, 'private-password-verifier', 'admin', '2026-10-17T00:00:00Z');
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run('existing-native-member-18', 'member@example.test', 'Existing member', 'other-private-verifier', 'member', '2026-10-17T00:00:00Z');
    db.close();
  }
  let active = true;
  let mapping = native ? NATIVE_ID : CENTRAL_ID;
  let organizationId;
  let transaction;
  let revokeCalls = 0;
  const origin = `https://${appId}.example.test`;
  const env = {
    SUITE_MODE: 'static', SUITE_APP_ID: appId, SUITE_APP_ORIGINS: JSON.stringify([origin]), SUITE_BASE_PATH: basePath,
    SUITE_BROKER_ORIGIN: ISSUER, SUITE_ISSUER: ISSUER, SUITE_CLIENT_ID: appId, SUITE_CLIENT_SECRET: SECRET,
    SUITE_FRONTEND_ROOT: frontend, SUITE_AUTH_DB_PATH: join(directory, 'auth.sqlite'), SUITE_BUILD_SHA: 'runtime-native-test',
    ...(native ? { SUITE_NATIVE_DB_PATH: databasePath } : {}),
  };
  const runtime = createSuiteRuntime({ env, fetchImpl: async (url, options) => {
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${appId}:${SECRET}`).toString('base64')}`);
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    const proof = { issuer: ISSUER, audience: appId, subject: CENTRAL_ID, displayName: 'Central account name', localIdentity: { userId: mapping, ...(organizationId === undefined ? {} : { organizationId }) }, expiresAt: Date.now() + 3_600_000 };
    if (url === `${ISSUER}/api/suite/auth/exchange`) {
      assert.equal(body.code, 'c'.repeat(43));
      assert.equal(body.state, transaction.state);
      assert.equal(body.redirectUri, `${origin}${basePath}/auth/callback`);
      assert.equal(createHash('sha256').update(body.codeVerifier).digest('base64url'), transaction.challenge);
      return Response.json({ ...proof, sessionToken: 's'.repeat(43), returnPath: `${basePath}/` });
    }
    if (url === `${ISSUER}/api/suite/auth/introspect`) {
      assert.equal(body.sessionToken, 's'.repeat(43));
      return Response.json(active ? { ...proof, active: true } : { active: false });
    }
    assert.equal(url, `${ISSUER}/api/suite/auth/revoke`);
    revokeCalls += 1;
    if (!body.childOnly) active = false;
    return new Response(null, { status: 204 });
  } });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => runtime.server.close(resolve)); runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const address = `http://127.0.0.1:${runtime.server.address().port}`;
  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${address}${basePath}${path}`, { method: options.method || 'GET', headers: { Host: new URL(origin).host, ...options.headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const headers = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
        });
      });
      req.on('error', reject);
      req.end(options.body);
    });
  }
  async function signIn() {
    const start = await request('/auth/login');
    assert.equal(start.status, 302);
    const target = new URL(start.headers.get('location'));
    transaction = { state: target.searchParams.get('state'), challenge: target.searchParams.get('code_challenge') };
    const response = await request(`/auth/callback?code=${'c'.repeat(43)}&state=${transaction.state}`, { headers: { Cookie: cookieFrom(start, '_transaction') } });
    return { response, cookie: cookieFrom(response, '_session') };
  }
  function updateNative(sql, ...args) { const db = new DatabaseSync(databasePath); try { db.prepare(sql).run(...args); } finally { db.close(); } }
  return { request, signIn, env, directory, databasePath, updateNative, revoke: () => { active = false; }, setMapping: value => { mapping = value; }, setOrganization: value => { organizationId = value; }, get revokeCalls() { return revokeCalls; } };
}

for (const appId of ['goflo', 'methpipe', 'mantrain']) {
  test(`${appId} native static callback preserves existing ID, email, role and account database`, async t => {
    const f = await fixture(t, { appId });
    const before = readFileSync(f.databasePath);
    const beforeFiles = ['-wal', '-shm'].map(suffix => existsSync(f.databasePath + suffix));
    assert.equal((await f.request('/')).status, 302);
    assert.equal((await f.request('/science-auth.js')).status, 302);
    const signedIn = await f.signIn();
    assert.equal(signedIn.response.status, 302);
    const session = await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json();
    assert.equal(session.authenticated, true);
    assert.deepEqual(session.user, nativeOwner);
    assert.notEqual(session.user.id, CENTRAL_ID);
    const page = await f.request('/', { headers: { Cookie: signedIn.cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<meta name="suite-auth-base" content="">/);
    assert.deepEqual(readFileSync(f.databasePath), before, 'roster, callback and session lookup never write the native account database');
    assert.deepEqual(['-wal', '-shm'].map(suffix => existsSync(f.databasePath + suffix)), beforeFiles);
    f.updateNative('UPDATE accounts SET role=? WHERE id=?', 'member', NATIVE_ID);
    const changed = await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json();
    assert.equal(changed.user.role, 'member', 'existing app rights are resolved on each request');
    f.revoke();
    const revoked = await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json();
    assert.equal(revoked.authenticated, false);
    assert.equal((await f.request('/science-auth.js', { headers: { Cookie: signedIn.cookie } })).status, 302);
  });
}

test('native static roster requires private Basic credentials, registered host and no browser Origin', async t => {
  const f = await fixture(t);
  const authorization = `Basic ${Buffer.from(`goflo:${SECRET}`).toString('base64')}`;
  const options = { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await f.request('/api/suite/native-users', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await f.request('/api/suite/native-users', { ...options, headers: { ...options.headers, Authorization: `Basic ${Buffer.from('goflo:incorrect').toString('base64')}` } })).status, 401);
  assert.equal((await f.request('/api/suite/native-users', { ...options, headers: { ...options.headers, Origin: 'https://goflo.example.test' } })).status, 401);
  assert.equal((await f.request('/api/suite/native-users', { ...options, headers: { ...options.headers, Origin: '' } })).status, 401);
  assert.equal((await f.request('/api/suite/native-users', { ...options, headers: { ...options.headers, Host: 'attacker.example.test' } })).status, 400);
  assert.equal((await f.request('/api/suite/native-users', { headers: { Authorization: authorization } })).status, 405);
  const response = await f.request('/api/suite/native-users', options);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('password_hash'), false);
  assert.equal(text.includes('private-password-verifier'), false);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(JSON.parse(text).users.find(user => user.id === NATIVE_ID), nativeOwner);
});

test('native static mappings reject central UUID fallback, unknown accounts, organizations and invalid roles', async t => {
  const f = await fixture(t);
  for (const id of [CENTRAL_ID, 'nonexistent-account']) {
    f.setMapping(id);
    assert.equal((await f.signIn()).response.status, 403);
  }
  f.setMapping(NATIVE_ID); f.setOrganization('unapproved-organization');
  assert.equal((await f.signIn()).response.status, 403);
  f.setOrganization(undefined);
  f.updateNative('UPDATE accounts SET role=? WHERE id=?', 'owner', NATIVE_ID);
  assert.equal((await f.signIn()).response.status, 403);
  f.updateNative('UPDATE accounts SET role=? WHERE id=?', 'admin', NATIVE_ID);
  const signedIn = await f.signIn();
  assert.equal(signedIn.response.status, 302);
  f.updateNative('DELETE FROM accounts WHERE id=?', NATIVE_ID);
  assert.equal((await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json()).authenticated, false);
  assert.equal(f.revokeCalls, 4, 'rejected callback mappings revoke only their child proofs');
});

test('native roster and callback preserve the same account on a legacy same-origin base path', async t => {
  const f = await fixture(t, { appId: 'methpipe', basePath: '/methpipe' });
  const signedIn = await f.signIn();
  assert.equal(signedIn.response.status, 302);
  assert.equal(signedIn.response.headers.get('location'), '/methpipe/');
  const response = await f.request('/api/suite/native-users', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`methpipe:${SECRET}`).toString('base64')}` }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).users.find(user => user.id === NATIVE_ID).id, NATIVE_ID);
  const session = await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json();
  assert.deepEqual(session.user, nativeOwner);
});

test('native account database configuration refuses missing, public, symlinked-public and invalid-schema stores', async t => {
  const f = await fixture(t);
  const publicRoot = join(f.directory, 'public_html'); mkdirSync(publicRoot);
  const publicDb = join(publicRoot, 'accounts.sqlite'); writeFileSync(publicDb, readFileSync(f.databasePath));
  const alias = join(f.directory, 'private-looking.sqlite'); symlinkSync(publicDb, alias);
  const invalid = join(f.directory, 'wrong-schema.sqlite'); const db = new DatabaseSync(invalid); db.exec('CREATE TABLE unrelated(id TEXT)'); db.close();
  for (const databasePath of [join(f.directory, 'missing.sqlite'), publicDb, alias, invalid]) {
    assert.throws(() => createSuiteRuntime({ env: { ...f.env, SUITE_AUTH_DB_PATH: join(f.directory, 'failed-auth.sqlite'), SUITE_NATIVE_DB_PATH: databasePath } }));
  }
  assert.equal(existsSync(join(f.directory, 'missing.sqlite')), false, 'a native database is never provisioned by the gateway');
});

test('unconfigured native database retains the explicit legacy synthetic-member mode', async t => {
  const f = await fixture(t, { native: false });
  const signedIn = await f.signIn();
  assert.equal(signedIn.response.status, 302);
  const session = await (await f.request('/api/suite/session', { headers: { Cookie: signedIn.cookie } })).json();
  assert.deepEqual(session.user, { id: CENTRAL_ID, displayName: 'Central account name', role: 'member' });
  assert.equal((await f.request('/api/suite/native-users', { method: 'POST', body: '{}' })).status, 405);
});
