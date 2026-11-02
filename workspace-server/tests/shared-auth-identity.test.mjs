import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createIdentityStore, createLocalIdentityAdapter } from '../shared-auth/identity-store.mjs';

const PASSWORD = 'Exact password 🔒 with spaces '; // The trailing space is intentional.
function fixture(t, overrides = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-identity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { databasePath: path.join(directory, 'identity.sqlite'), ...overrides };
  const store = createIdentityStore(options);
  t.after(() => store.close());
  return { store, options, directory };
}

test('local credentials preserve exact password characters and durable UUIDs without storing plaintext', async t => {
  const { store, options } = fixture(t);
  const user = await store.createUser({ email: 'Dennis@Example.com', displayName: 'Dennis', password: PASSWORD });
  assert.match(user.id, /^[0-9a-f-]{36}$/);
  assert.equal(user.email, 'dennis@example.com');
  assert.equal(user.role, 'member');
  assert.equal('passwordHash' in user, false);
  assert.equal((await store.verifyCredentials({ email: 'DENNIS@example.com', password: PASSWORD })).id, user.id);
  assert.equal(await store.verifyCredentials({ email: user.email, password: PASSWORD.trim() }), null);
  assert.equal(await store.verifyCredentials({ email: user.email, password: PASSWORD + 'x' }), null);
  assert.equal(await store.verifyCredentials({ email: 'missing@example.com', password: PASSWORD }), null);
  assert.equal(readFileSync(options.databasePath).includes(Buffer.from(PASSWORD)), false);
  assert.equal(statSync(options.databasePath).mode & 0o777, 0o600);
  const reopened = createIdentityStore(options);
  t.after(() => reopened.close());
  assert.equal(reopened.getUser(user.id).id, user.id);
  assert.equal((await reopened.verifyCredentials({ email: user.email, password: PASSWORD })).id, user.id);
});

test('short passwords and normalized email collisions are rejected without creating another account', async t => {
  const { store } = fixture(t);
  await assert.rejects(store.createUser({ email: 'one@example.com', displayName: 'One', password: 'short' }), /invalid_password/);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  await assert.rejects(store.createUser({ email: 'ONE@example.com', displayName: 'Other', password: PASSWORD }), /account_exists/);
  await assert.rejects(store.createUser({ email: 'other@example.com', displayName: 'Other', password: PASSWORD, role: 'admin' }), /invalid_role/);
  assert.equal(store.listUsers().length, 1);
  assert.equal(store.findUserByEmail('ONE@example.com').id, user.id);
});

test('identity sessions are opaque, hashed, expiring and recheck current account state', async t => {
  let now = 1_800_000_000_000;
  const { store, options } = fixture(t, { clock: () => now });
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const { token, parent } = await store.authenticatePassword({ email: user.email, password: PASSWORD, ttlMs: 60_000 });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(parent.subject, user.id);
  assert.equal(store.getParentSession(parent.id).subject, user.id);
  assert.equal(store.getSessionByToken(token).id, parent.id);
  assert.equal(readFileSync(options.databasePath).includes(Buffer.from(token)), false);
  const second = store.createSession(user.id, { ttlMs: 60_000 });
  store.revokeSession(parent.id);
  assert.equal(store.getSessionByToken(token), null);
  assert.equal(store.getParentSession(parent.id), null);
  assert.equal(store.getSessionByToken(second.token).subject, user.id);
  now += 60_001;
  assert.equal(store.getSessionByToken(second.token), null);
  const third = store.createSession(user.id);
  store.setUserState(user.id, 'disabled');
  assert.equal(store.getSessionByToken(third.token), null);
  assert.equal(await store.verifyCredentials({ email: user.email, password: PASSWORD }), null);
  assert.throws(() => store.createSession(user.id), /invalid_credentials/);
  store.setUserState(user.id, 'active');
  assert.equal(store.getSessionByToken(third.token), null, 'disabled accounts do not regain old sessions when enabled');
});

test('changing a local password revokes every existing parent session', async t => {
  const { store } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const a = store.createSession(user.id); const b = store.createSession(user.id);
  await store.setPassword(user.id, 'Different password with spaces ');
  assert.equal(store.getSessionByToken(a.token), null);
  assert.equal(store.getParentSession(b.parent.id), null);
  assert.equal(await store.verifyCredentials({ email: user.email, password: PASSWORD }), null);
  assert.equal((await store.verifyCredentials({ email: user.email, password: 'Different password with spaces ' })).id, user.id);
});

test('revoking the authorizing parent during password hashing prevents a password change', async t => {
  const { store } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const { parent } = store.createSession(user.id);
  const pending = store.setPassword(user.id, 'New private password 123', { requireSessionId: parent.id });
  store.revokeSession(parent.id);
  await assert.rejects(pending, { code: 'invalid_credentials' });
  assert.equal((await store.verifyCredentials({ email: user.email, password: PASSWORD })).id, user.id);
  assert.equal(await store.verifyCredentials({ email: user.email, password: 'New private password 123' }), null);
});

test('concurrent changes authorized by one parent cannot both replace its credential', async t => {
  const { store } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const { parent } = store.createSession(user.id);
  const results = await Promise.allSettled([
    store.setPassword(user.id, 'First private password 123', { requireSessionId: parent.id }),
    store.setPassword(user.id, 'Second private password 123', { requireSessionId: parent.id }),
  ]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected' && value.reason.code === 'invalid_credentials').length, 1);
});

test('account metadata without password hashes cannot lock a new server out through restore', async t => {
  const source = fixture(t).store;
  await source.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const target = fixture(t).store;
  const metadataOnly = source.exportPortable();
  assert.equal(metadataOnly.users[0].credential, undefined);
  assert.throws(() => target.importPortable(metadataOnly), { code: 'invalid_import' });
  assert.equal(target.listUsers().length, 0);
  const actualBackup = source.exportPortable({ includePasswordHashes: true });
  assert.equal(target.importPortable(actualBackup).users, 1);
  assert.equal((await target.verifyCredentials({ email: 'one@example.com', password: PASSWORD })).id, actualBackup.users[0].id);
});

test('app access is explicit, preserves native user and organization IDs and can be withdrawn', async t => {
  const { store } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  assert.equal(store.getAccess(user.id, 'eel'), null);
  store.grantAppAccess({ userId: user.id, appId: 'eel', localUserId: 'native-eln-73', organizationId: 'org-41' });
  assert.deepEqual(store.getAccess(user.id, 'eel'), { localIdentity: { userId: 'native-eln-73', organizationId: 'org-41' } });
  assert.equal(store.getAccess(user.id, 'duckman'), null);
  assert.throws(() => store.grantAppAccess({ userId: user.id, appId: 'unknown', localUserId: user.id }), /invalid_grant/);
  assert.throws(() => store.grantAppAccess({ userId: 'missing', appId: 'eel', localUserId: user.id }), /user_not_found/);
  store.revokeAppAccess(user.id, 'eel');
  assert.equal(store.getAccess(user.id, 'eel'), null);
});

test('one native actor cannot be linked to two central users even across EEL organizations', async t => {
  const { store, directory } = fixture(t);
  const a = await store.createUser({ email: 'a@example.com', displayName: 'A', password: PASSWORD });
  const b = await store.createUser({ email: 'b@example.com', displayName: 'B', password: PASSWORD });
  store.grantAppAccess({ userId: a.id, appId: 'duckman', localUserId: 'one-native-duck' });
  assert.throws(() => store.grantAppAccess({ userId: b.id, appId: 'duckman', localUserId: 'one-native-duck' }), /mapping_already_linked/);
  store.grantAppAccess({ userId: a.id, appId: 'eel', localUserId: 'one-native-eel', organizationId: 'org-a' });
  assert.throws(() => store.grantAppAccess({ userId: b.id, appId: 'eel', localUserId: 'one-native-eel', organizationId: 'org-b' }), /mapping_already_linked/);
  assert.equal(store.getAccess(b.id, 'duckman'), null);
  assert.equal(store.getAccess(b.id, 'eel'), null);
  store.grantAppAccess({ userId: b.id, appId: 'eel', localUserId: 'other-native-eel', organizationId: 'org-b' });
  const portable = store.exportPortable({ includePasswordHashes: true });
  portable.grants.find(grant => grant.userId === b.id).localUserId = 'one-native-eel';
  const target = createIdentityStore({ databasePath: path.join(directory, 'bad-actor-clone.sqlite') });
  t.after(() => target.close());
  assert.throws(() => target.importPortable(portable), /invalid_import/);
  assert.equal(target.listUsers().length, 0);
});

test('private bootstrap creates the first admin once and never creates public owners or grants', async t => {
  const { store, options } = fixture(t);
  const token = 'a'.repeat(43);
  assert.equal(store.configureBootstrapToken(token), true);
  assert.equal(store.configureBootstrapToken('b'.repeat(43)), false, 'a restart cannot overwrite a configured setup code');
  await assert.rejects(store.bootstrap('wrong'.repeat(9), { email: 'admin@example.com', displayName: 'Admin', password: PASSWORD }), /invalid_setup_token/);
  const second = createIdentityStore(options);
  t.after(() => second.close());
  const results = await Promise.allSettled([
    store.bootstrap(token, { email: 'admin@example.com', displayName: 'Admin', password: PASSWORD }),
    second.bootstrap(token, { email: 'admin2@example.com', displayName: 'Admin 2', password: PASSWORD }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const admin = results.find(r => r.status === 'fulfilled').value;
  assert.equal(admin.role, 'admin');
  assert.equal(store.listUsers().length, 1);
  assert.equal(store.getAccess(admin.id, 'duckman'), null);
  assert.equal(store.configureBootstrapToken('c'.repeat(43)), false);
  assert.throws(() => store.setUserState(admin.id, 'disabled'), /last_active_admin/);
});

test('two operating-system processes cannot both create the first admin', async t => {
  const { store, options } = fixture(t);
  store.configureBootstrapToken('a'.repeat(43));
  store.close();
  const moduleURL = new URL('../shared-auth/identity-store.mjs', import.meta.url).href;
  const source = `import { createIdentityStore } from ${JSON.stringify(moduleURL)};
    const store = createIdentityStore({databasePath:process.argv[1]});
    process.stdout.write('ready\\n');
    for await (const chunk of process.stdin) { if(chunk.toString().includes('go')) break; }
    let created=false;
    try { await store.bootstrap('a'.repeat(43), {email:process.argv[2],displayName:'Admin',password:'Test password long enough'}); created=true; }
    catch(error) { if(error.code!=='invalid_setup_token') throw error; }
    process.stdout.write(JSON.stringify(created)+'\\n'); store.close();`;
  function worker(email) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, options.databasePath, email], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const result = new Promise((resolve, reject) => {
      child.stdout.on('data', data => { output += data; if (output.includes('ready\n')) readyResolve(); });
      child.stderr.on('data', data => { errors += data; });
      child.on('error', error => { readyResolve(); reject(error); });
      child.on('close', code => {
        readyResolve();
        if (code !== 0) reject(new Error(`Identity worker exited ${code}: ${errors}`));
        else resolve(JSON.parse(output.trim().split('\n').at(-1)));
      });
    });
    return { child, ready, result };
  }
  const a = worker('admin-a@example.com'); const b = worker('admin-b@example.com');
  await Promise.all([a.ready, b.ready]);
  a.child.stdin.end('go\n'); b.child.stdin.end('go\n');
  assert.deepEqual((await Promise.all([a.result, b.result])).sort(), [false, true]);
  const reopened = createIdentityStore(options);
  t.after(() => reopened.close());
  assert.equal(reopened.listUsers().length, 1);
  assert.equal(reopened.listUsers()[0].role, 'admin');
});

test('admin invitations are private, expire, consume once and apply only preapproved mappings', async t => {
  let now = Date.now();
  const { store } = fixture(t, { clock: () => now });
  store.configureBootstrapToken('a'.repeat(43));
  const admin = await store.bootstrap('a'.repeat(43), { email: 'admin@example.com', displayName: 'Admin', password: PASSWORD });
  const invite = store.issueInvitation({ inviterUserId: admin.id, email: 'member@example.com', displayName: 'Member', appGrants: [{ appId: 'goflo', localUserId: 'new-member-id' }], ttlMs: 60_000 });
  const user = await store.acceptInvitation(invite.token, { password: PASSWORD });
  assert.equal(user.role, 'member');
  assert.equal(store.getAccess(user.id, 'goflo').localIdentity.userId, 'new-member-id');
  assert.equal(store.getAccess(user.id, 'eel'), null);
  await assert.rejects(store.acceptInvitation(invite.token, { password: PASSWORD }), /invalid_invitation/);
  assert.throws(() => store.issueInvitation({ inviterUserId: user.id, email: 'other@example.com', displayName: 'Other' }), /access_denied/);
  const expired = store.issueInvitation({ inviterUserId: admin.id, email: 'expired@example.com', displayName: 'Expired', ttlMs: 60_000 });
  now += 60_001;
  await assert.rejects(store.acceptInvitation(expired.token, { password: PASSWORD }), /invalid_invitation/);
  assert.equal(store.findUserByEmail('expired@example.com'), null);
});

test('a server-selected invitation UUID and its preapproved static grants are stored together', async t => {
  const { store } = fixture(t);
  store.configureBootstrapToken('a'.repeat(43));
  const admin = await store.bootstrap('a'.repeat(43), { email: 'admin@example.com', displayName: 'Admin', password: PASSWORD });
  const userId = randomUUID();
  const invite = store.issueInvitation({ inviterUserId: admin.id, userId, email: 'new@example.com', displayName: 'New', appGrants: [{ appId: 'goflo', localUserId: userId }, { appId: 'mantrain', localUserId: userId }] });
  assert.equal(invite.userId, userId);
  assert.throws(() => store.issueInvitation({ inviterUserId: admin.id, userId, email: 'collision@example.com', displayName: 'Collision' }), /invitation_exists/);
  const user = await store.acceptInvitation(invite.token, { password: PASSWORD });
  assert.equal(user.id, userId);
  assert.equal(store.getAccess(userId, 'goflo').localIdentity.userId, userId);
  assert.equal(store.getAccess(userId, 'mantrain').localIdentity.userId, userId);
  assert.equal(store.getAccess(userId, 'eel'), null);
  assert.equal(store.getAccess(userId, 'duckman'), null);
});

test('portable account export preserves IDs, credentials and grants, while excluding active tokens', async t => {
  const { store, directory } = fixture(t);
  store.configureBootstrapToken('a'.repeat(43));
  const user = await store.bootstrap('a'.repeat(43), { email: 'admin@example.com', displayName: 'Admin', password: PASSWORD });
  store.grantAppAccess({ userId: user.id, appId: 'duckman', localUserId: 'native-duck-user' });
  const session = store.createSession(user.id);
  const publicExport = store.exportPortable();
  assert.equal('credential' in publicExport.users[0], false);
  const portable = store.exportPortable({ includePasswordHashes: true });
  assert.equal(JSON.stringify(portable).includes(session.token), false);
  assert.equal(JSON.stringify(portable).includes(session.parent.id), false);
  assert.equal(JSON.stringify(portable).includes(PASSWORD), false);
  const target = createIdentityStore({ databasePath: path.join(directory, 'moved.sqlite') });
  t.after(() => target.close());
  target.importPortable(portable);
  assert.equal(target.getUser(user.id).id, user.id);
  assert.equal((await target.verifyCredentials({ email: user.email, password: PASSWORD })).id, user.id);
  assert.deepEqual(target.getAccess(user.id, 'duckman'), store.getAccess(user.id, 'duckman'));
  assert.equal(target.getSessionByToken(session.token), null);
  assert.equal(target.getParentSession(session.parent.id), null);
  assert.throws(() => target.importPortable(portable), /import_requires_empty_store/);
});

test('import validates every record before writing and refuses malformed scrypt costs', async t => {
  const { store, directory } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const portable = store.exportPortable({ includePasswordHashes: true });
  portable.users[0].credential.N = 1_048_576;
  const target = createIdentityStore({ databasePath: path.join(directory, 'new.sqlite') });
  t.after(() => target.close());
  assert.throws(() => target.importPortable(portable), /invalid_import/);
  assert.equal(target.listUsers().length, 0);
  assert.equal(store.getUser(user.id).email, user.email);
});

test('local identity adapter establishes a host-only cookie and ignores duplicate or stolen-origin cookies', async t => {
  const { store } = fixture(t);
  const user = await store.createUser({ email: 'one@example.com', displayName: 'One', password: PASSWORD });
  const adapter = createLocalIdentityAdapter({ store, origin: 'https://login.example.com' });
  const headers = new Map();
  const res = { getHeader: name => headers.get(name), setHeader: (name, value) => headers.set(name, value) };
  const req = { headers: { host: 'login.example.com', origin: 'https://login.example.com' } };
  const parent = await adapter.authenticate(req, res, { email: user.email, password: PASSWORD });
  assert.equal(parent.subject, user.id);
  const cookie = headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-suite_identity=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(cookie.includes('Domain='), false);
  const value = cookie.split(';')[0];
  assert.equal((await adapter.getSession({ headers: { host: 'login.example.com', cookie: value } })).subject, user.id);
  assert.equal(await adapter.getSession({ headers: { host: 'evil.example.com', cookie: value } }), null);
  assert.equal(await adapter.getSession({ headers: { host: 'login.example.com', cookie: `${value}; ${value}` } }), null);
  assert.equal(await adapter.authenticate({ headers: { host: 'login.example.com', origin: 'https://evil.example.com' } }, res, { email: user.email, password: PASSWORD }), null);
  // Explicitly opting in must select the persistent cookie and corresponding
  // server-side session expiry, without weakening origin/cookie protections.
  const rememberHeaders = new Map();
  const rememberRes={getHeader:n=>rememberHeaders.get(n),
    setHeader:(n,v)=>rememberHeaders.set(n,v)};
  const remembered=await adapter.authenticate(req,rememberRes,{
    email:user.email,password:PASSWORD,rememberMe:true});
  assert(remembered.expiresAt-parent.expiresAt>12*24*60*60_000);
  assert.match(rememberHeaders.get('Set-Cookie'),
    /^__Host-suite_identity=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=1209600; Secure$/);
  await adapter.logout(parent.id);
  assert.equal(await adapter.getSession({ headers: { host: 'login.example.com', cookie: value } }), null);
});

test('Remember me duration is strictly capped at fourteen days even for injected configuration',t=>{
  const {store}=fixture(t);
  assert.throws(()=>createLocalIdentityAdapter({
   store,origin:'https://login.example.com',rememberedSessionTtlMs:30*24*60*60_000
  }),/invalid_expiry/);
  assert.doesNotThrow(()=>createLocalIdentityAdapter({
   store,origin:'https://login.example.com',rememberedSessionTtlMs:14*24*60*60_000
  }));
});

test('database paths stay private including a symlink into public_html', async t => {
  assert.throws(() => createIdentityStore({ databasePath: 'relative.sqlite' }), /private/);
  assert.throws(() => createIdentityStore({ databasePath: '/tmp/public_html/accounts.sqlite' }), /private/);
  const { directory } = fixture(t);
  const { mkdirSync, symlinkSync } = await import('node:fs');
  mkdirSync(path.join(directory, 'public_html'));
  symlinkSync(path.join(directory, 'public_html'), path.join(directory, 'alias'));
  assert.throws(() => createIdentityStore({ databasePath: path.join(directory, 'alias', 'accounts.sqlite') }), /private/);
});
