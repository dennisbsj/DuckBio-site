import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSqliteAuthStores } from '../shared-auth/sqlite-store.mjs';

test('private auth storage survives restart and consumes codes atomically across two connections', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'sessions.sqlite');
  let now = 1_800_000_000_000;
  const record = { clientId: 'duckman', state: 'transaction-state', challenge: 'S256-hash', redirectUri: 'https://duckman.celluloidconsulting.net/auth/callback', parentSessionId: 'original-native-session', expiresAt: now + 60_000 };
  let first = createSqliteAuthStores({ databasePath, clock: () => now });
  await first.brokerStore.putCode('hashed-one-time-code', record);
  await first.brokerStore.putCsrf('hashed-cookie', { tokenHash: 'hashed-csrf-token', expiresAt: now + 60_000 });
  await first.gatewayStore.putSession('hashed-session-cookie', { identity: { id: 'original-user' }, expiresAt: now + 60_000 });
  first.close();
  first = createSqliteAuthStores({ databasePath, clock: () => now });
  const second = createSqliteAuthStores({ databasePath, clock: () => now });
  t.after(() => { first.close(); second.close(); });
  assert.equal((await second.brokerStore.getCsrf('hashed-cookie')).tokenHash, 'hashed-csrf-token');
  assert.equal((await second.gatewayStore.getSession('hashed-session-cookie')).identity.id, 'original-user');
  assert.equal(statSync(databasePath).mode & 0o777, 0o600);
  const expected = { ...record, now };
  assert.equal(await first.brokerStore.consumeCode('hashed-one-time-code', { ...expected, clientId: 'other-client' }), null);
  const results = await Promise.all([
    first.brokerStore.consumeCode('hashed-one-time-code', expected),
    second.brokerStore.consumeCode('hashed-one-time-code', expected),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).parentSessionId, 'original-native-session');
  now += 61_000;
  assert.equal(await first.gatewayStore.getSession('hashed-session-cookie'), null);
  assert.equal(await first.brokerStore.getCsrf('hashed-cookie'), null);
});

test('two real worker processes cannot redeem the same stored code', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-auth-workers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'auth.sqlite');
  const now = Date.now();
  const stores = createSqliteAuthStores({ databasePath });
  const expected = { clientId: 'duckman', state: 'bound-state', challenge: 'bound-challenge', redirectUri: 'https://duckman.celluloidconsulting.net/auth/callback', now };
  await stores.brokerStore.putCode('same-code-hash', { ...expected, expiresAt: now + 60_000 });
  stores.close();
  const moduleURL = new URL('../shared-auth/sqlite-store.mjs', import.meta.url).href;
  const source = `import { createSqliteAuthStores } from ${JSON.stringify(moduleURL)};
    const stores = createSqliteAuthStores({databasePath:process.argv[1]});
    process.stdout.write('ready\\n');
    for await (const chunk of process.stdin) { if(chunk.toString().includes('go')) break; }
    const record = await stores.brokerStore.consumeCode('same-code-hash',JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify(Boolean(record))+'\\n'); stores.close();`;
  function worker() {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, databasePath, JSON.stringify(expected)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = ''; let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const result = new Promise((resolve, reject) => {
      child.stdout.on('data', data => { output += data; if (output.includes('ready\n')) readyResolve(); });
      child.stderr.on('data', data => { errors += data; });
      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) { readyResolve(); reject(new Error(`Auth worker exited ${code}: ${errors}`)); }
        else resolve(JSON.parse(output.trim().split('\n').at(-1)));
      });
    });
    return { child, ready, result };
  }
  const a = worker(); const b = worker();
  await Promise.all([a.ready, b.ready]);
  a.child.stdin.end('go\n'); b.child.stdin.end('go\n');
  assert.deepEqual((await Promise.all([a.result, b.result])).sort(), [false, true]);
});

test('gateway state can be taken exactly once and session deletion is durable', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const stores = createSqliteAuthStores({ databasePath: path.join(directory, 'auth.sqlite') });
  t.after(() => stores.close());
  const record = { state: 'app-origin-state', expiresAt: Date.now() + 60_000 };
  await stores.gatewayStore.putTransaction('hashed-state-cookie', record);
  assert.equal((await stores.gatewayStore.takeTransaction('hashed-state-cookie')).state, record.state);
  assert.equal(await stores.gatewayStore.takeTransaction('hashed-state-cookie'), null);
  await stores.gatewayStore.putSession('hashed-session', record);
  await stores.gatewayStore.deleteSession('hashed-session');
  assert.equal(await stores.gatewayStore.getSession('hashed-session'), null);
});

test('rate limit counters are atomic and shared across instances until expiry', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-auth-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = Date.now();
  const options = { databasePath: path.join(directory, 'auth.sqlite'), clock: () => now };
  const a = createSqliteAuthStores(options); const b = createSqliteAuthStores(options);
  t.after(() => { a.close(); b.close(); });
  assert.equal(await a.brokerStore.consumeLoginAttempt('hashed-client-and-account', { limit: 2, windowMs: 60_000, now }), true);
  assert.equal(await b.brokerStore.consumeLoginAttempt('hashed-client-and-account', { limit: 2, windowMs: 60_000, now }), true);
  assert.equal(await a.brokerStore.consumeLoginAttempt('hashed-client-and-account', { limit: 2, windowMs: 60_000, now }), false);
  now += 60_001;
  assert.equal(await b.brokerStore.consumeLoginAttempt('hashed-client-and-account', { limit: 2, windowMs: 60_000, now }), true);
});

test('a new auth database cannot be created through a private-looking symlink into a public root', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-auth-private-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const publicRoot = path.join(directory, 'public_html');
  mkdirSync(publicRoot);
  symlinkSync(publicRoot, path.join(directory, 'private-looking'));
  assert.throws(() => createSqliteAuthStores({ databasePath: path.join(directory, 'private-looking', 'auth.sqlite') }), /private auth database path/);
  assert.equal(existsSync(path.join(publicRoot, 'auth.sqlite')), false);
});
