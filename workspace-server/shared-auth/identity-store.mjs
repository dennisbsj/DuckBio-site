import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const derive = promisify(scrypt);
const PASSWORD_COST = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 64 });
const APP_IDS = new Set(['goflo', 'eel', 'methpipe', 'mantrain', 'duckman', 'limsman', 'dataduck']);
const opaque = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;
const textId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);

export class IdentityStoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new IdentityStoreError(code); }
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid_email');
  return value.trim().toLowerCase();
}
function displayName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid_display_name');
  return value.trim();
}
function validPassword(value) {
  if (typeof value !== 'string' || [...value].length < 12 || value.length > 1024) fail('invalid_password');
  return value;
}
function credentialValid(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.algorithm === 'scrypt'
    && value.N === PASSWORD_COST.N && value.r === PASSWORD_COST.r && value.p === PASSWORD_COST.p
    && value.keyLength === PASSWORD_COST.keyLength && /^[0-9a-f]{64}$/.test(value.salt ?? '') && /^[0-9a-f]{128}$/.test(value.hash ?? '')
    && Object.keys(value).every(key => ['algorithm', 'N', 'r', 'p', 'keyLength', 'salt', 'hash'].includes(key));
}
async function makeCredential(password) {
  validPassword(password);
  const salt = randomBytes(32).toString('hex');
  const hash = await derive(password, Buffer.from(salt, 'hex'), PASSWORD_COST.keyLength, { ...PASSWORD_COST, maxmem: 64 * 1024 * 1024 });
  return { algorithm: 'scrypt', ...PASSWORD_COST, salt, hash: hash.toString('hex') };
}
async function checkCredential(password, credential) {
  const hash = await derive(password, Buffer.from(credential.salt, 'hex'), PASSWORD_COST.keyLength, { ...PASSWORD_COST, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(hash, Buffer.from(credential.hash, 'hex'));
}
function grantValue({ appId, localUserId, organizationId }) {
  if (!APP_IDS.has(appId) || !textId(localUserId) || (organizationId !== undefined && !textId(organizationId))) fail('invalid_grant');
  return { appId, localUserId, ...(organizationId !== undefined ? { organizationId } : {}) };
}
function ttl(value, fallback, maximum) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1000 || result > maximum) fail('invalid_expiry');
  return result;
}

/** A dedicated portable account database. Never use a business-data database.
 * All account provisioning methods are private server/CLI seams, not public registration APIs. */
export function createIdentityStore({ databasePath, clock = Date.now }) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) || databasePath.split(path.sep).includes('public_html')) throw new Error('An absolute private identity database path is required');
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const actualParent = realpathSync(path.dirname(databasePath));
  if (actualParent.split(path.sep).includes('public_html') || (existsSync(databasePath) && realpathSync(databasePath).split(path.sep).includes('public_html'))) throw new Error('An absolute private identity database path is required');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS suite_identity_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('active','disabled')),
      role TEXT NOT NULL CHECK(role IN ('admin','member')),
      credential TEXT CHECK(credential IS NULL OR json_valid(credential)),
      auth_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suite_identity_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES suite_identity_users(id),
      auth_version INTEGER NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS suite_identity_sessions_user ON suite_identity_sessions(user_id);
    CREATE INDEX IF NOT EXISTS suite_identity_sessions_expiry ON suite_identity_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS suite_identity_grants (
      user_id TEXT NOT NULL REFERENCES suite_identity_users(id),
      app_id TEXT NOT NULL,
      local_user_id TEXT NOT NULL,
      organization_id TEXT,
      PRIMARY KEY(user_id,app_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS suite_identity_native_actor ON suite_identity_grants(app_id,local_user_id);
    CREATE TABLE IF NOT EXISTS suite_identity_bootstrap (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS suite_identity_invitations (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      inviter_user_id TEXT NOT NULL REFERENCES suite_identity_users(id),
      grants TEXT NOT NULL CHECK(json_valid(grants)),
      expires_at INTEGER NOT NULL
    );
  `);
  function privateFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      try { chmodSync(databasePath + suffix, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  privateFiles();
  const dummyCredential = { algorithm: 'scrypt', ...PASSWORD_COST, salt: randomBytes(32).toString('hex'), hash: randomBytes(PASSWORD_COST.keyLength).toString('hex') };
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try { const value = work(); db.exec('COMMIT'); committed = true; privateFiles(); return value; }
    catch (error) { if (!committed) db.exec('ROLLBACK'); throw error; }
  }
  function userRow(id) { return db.prepare('SELECT * FROM suite_identity_users WHERE id=?').get(id); }
  function publicUser(row) {
    return row ? { id: row.id, email: row.email, displayName: row.display_name, state: row.state, role: row.role, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  function requireUser(id) { const row = userRow(id); if (!row) fail('user_not_found'); return row; }
  function requireAdmin(id) { const row = requireUser(id); if (row.role !== 'admin' || row.state !== 'active') fail('access_denied'); return row; }
  function insertUser({ id = randomUUID(), email, displayName: name, credential, role = 'member', state = 'active', createdAt = clock(), updatedAt = createdAt }) {
    if (!uuidPattern.test(id)) fail('invalid_user_id');
    if (db.prepare('SELECT id FROM suite_identity_users WHERE email=? OR id=?').get(email, id)) fail('account_exists');
    db.prepare('INSERT INTO suite_identity_users(id,email,display_name,state,role,credential,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, email, name, state, role, credential ? JSON.stringify(credential) : null, createdAt, updatedAt);
    return publicUser(userRow(id));
  }
  function grantAccess(userId, input) {
    requireUser(userId);
    const grant = grantValue(input);
    if (db.prepare('SELECT user_id FROM suite_identity_grants WHERE app_id=? AND local_user_id=? AND user_id<>?').get(grant.appId, grant.localUserId, userId)) fail('mapping_already_linked');
    db.prepare('INSERT INTO suite_identity_grants(user_id,app_id,local_user_id,organization_id) VALUES(?,?,?,?) ON CONFLICT(user_id,app_id) DO UPDATE SET local_user_id=excluded.local_user_id,organization_id=excluded.organization_id').run(userId, grant.appId, grant.localUserId, grant.organizationId ?? null);
  }
  function parentSession(row) {
    return row ? { id: row.id, subject: row.user_id, displayName: row.display_name, expiresAt: row.expires_at, passwordChangeRequired: false } : null;
  }
  function sessionRow(where, value) {
    return db.prepare(`SELECT s.*,u.display_name FROM suite_identity_sessions s JOIN suite_identity_users u ON u.id=s.user_id WHERE ${where}=? AND s.expires_at>? AND u.state='active' AND u.auth_version=s.auth_version`).get(value, clock());
  }
  function newSession(userId, { ttlMs, expectedAuthVersion } = {}) {
    const duration = ttl(ttlMs, 8 * 60 * 60_000, 30 * 24 * 60 * 60_000);
    return transaction(() => {
      const row = requireUser(userId);
      if (row.state !== 'active' || (expectedAuthVersion !== undefined && row.auth_version !== expectedAuthVersion)) fail('invalid_credentials');
      const token = opaque(); const id = randomUUID(); const now = clock();
      db.prepare('DELETE FROM suite_identity_sessions WHERE expires_at<=?').run(now);
      db.prepare('INSERT INTO suite_identity_sessions(id,token_hash,user_id,auth_version,issued_at,expires_at) VALUES(?,?,?,?,?,?)').run(id, digest(token), userId, row.auth_version, now, now + duration);
      return { token, parent: parentSession(sessionRow('s.id', id)) };
    });
  }
  async function verifiedCredentials({ email, password }) {
    let address;
    try { address = emailAddress(email); } catch { address = null; }
    if (typeof password !== 'string' || !password || password.length > 1024) return null;
    const row = address ? db.prepare('SELECT * FROM suite_identity_users WHERE email=?').get(address) : null;
    const credential = row?.credential ? JSON.parse(row.credential) : dummyCredential;
    const valid = await checkCredential(password, credential);
    const current = row ? userRow(row.id) : null;
    if (!valid || !current || current.state !== 'active' || !row.credential || current.auth_version !== row.auth_version || current.credential !== row.credential) return null;
    return { user: publicUser(current), authVersion: current.auth_version };
  }
  let closed = false;
  return Object.freeze({
    async createUser({ id, email, displayName: name, password, role = 'member' }) {
      if (role !== 'member') fail('invalid_role');
      const address = emailAddress(email); const label = displayName(name); const credential = await makeCredential(password);
      return transaction(() => insertUser({ id, email: address, displayName: label, credential }));
    },
    getUser(id) { return publicUser(userRow(id)); },
    findUserByEmail(email) { return publicUser(db.prepare('SELECT * FROM suite_identity_users WHERE email=?').get(emailAddress(email))); },
    listUsers() { return db.prepare('SELECT * FROM suite_identity_users ORDER BY created_at,id').all().map(publicUser); },
    setUserState(id, state) {
      if (!['active', 'disabled'].includes(state)) fail('invalid_state');
      return transaction(() => {
        const row = requireUser(id);
        if (state === 'disabled' && row.state === 'active' && row.role === 'admin' && db.prepare("SELECT COUNT(*) AS count FROM suite_identity_users WHERE role='admin' AND state='active'").get().count === 1) fail('last_active_admin');
        if (row.state !== state) {
          db.prepare('UPDATE suite_identity_users SET state=?,auth_version=auth_version+1,updated_at=? WHERE id=?').run(state, clock(), id);
          db.prepare('DELETE FROM suite_identity_sessions WHERE user_id=?').run(id);
        }
        return publicUser(userRow(id));
      });
    },
    async setPassword(id, password, { requireSessionId } = {}) {
      const before = requireUser(id);
      if (requireSessionId !== undefined && (!uuidPattern.test(requireSessionId) || sessionRow('s.id', requireSessionId)?.user_id !== id)) fail('invalid_credentials');
      const credential = await makeCredential(password);
      return transaction(() => {
        const current = requireUser(id);
        if (requireSessionId !== undefined && (current.auth_version !== before.auth_version || sessionRow('s.id', requireSessionId)?.user_id !== id)) fail('invalid_credentials');
        db.prepare('UPDATE suite_identity_users SET credential=?,auth_version=auth_version+1,updated_at=? WHERE id=?').run(JSON.stringify(credential), clock(), id);
        db.prepare('DELETE FROM suite_identity_sessions WHERE user_id=?').run(id);
        return publicUser(userRow(id));
      });
    },
    async verifyCredentials(input) { return (await verifiedCredentials(input))?.user ?? null; },
    async authenticatePassword(input) {
      const verified = await verifiedCredentials(input);
      if (!verified) return null;
      try { return newSession(verified.user.id, { ttlMs: input.ttlMs, expectedAuthVersion: verified.authVersion }); }
      catch (error) { if (error.code === 'invalid_credentials') return null; throw error; }
    },
    createSession(userId, options) { return newSession(userId, options); },
    getSessionByToken(token) { return typeof token === 'string' && tokenPattern.test(token) ? parentSession(sessionRow('s.token_hash', digest(token))) : null; },
    getParentSession(id) { return typeof id === 'string' && uuidPattern.test(id) ? parentSession(sessionRow('s.id', id)) : null; },
    revokeSession(id) { db.prepare('DELETE FROM suite_identity_sessions WHERE id=?').run(id); },
    revokeUserSessions(id) { requireUser(id); db.prepare('DELETE FROM suite_identity_sessions WHERE user_id=?').run(id); },
    grantAppAccess({ userId, ...grant }) { return transaction(() => grantAccess(userId, grant)); },
    getAccess(userId, appId) {
      const row = db.prepare("SELECT g.* FROM suite_identity_grants g JOIN suite_identity_users u ON u.id=g.user_id WHERE g.user_id=? AND g.app_id=? AND u.state='active'").get(userId, appId);
      return row ? { localIdentity: { userId: row.local_user_id, ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}) } } : null;
    },
    listAppGrants(userId) {
      requireUser(userId);
      return db.prepare('SELECT * FROM suite_identity_grants WHERE user_id=? ORDER BY app_id').all(userId).map(row => ({ appId: row.app_id, localUserId: row.local_user_id, ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}) }));
    },
    revokeAppAccess(userId, appId) { db.prepare('DELETE FROM suite_identity_grants WHERE user_id=? AND app_id=?').run(userId, appId); },
    configureBootstrapToken(token, { expiresAt = clock() + 24 * 60 * 60_000 } = {}) {
      if (typeof token !== 'string' || !tokenPattern.test(token) || !Number.isSafeInteger(expiresAt) || expiresAt <= clock() || expiresAt > clock() + 7 * 24 * 60 * 60_000) fail('invalid_setup_token');
      return transaction(() => {
        if (db.prepare('SELECT COUNT(*) AS count FROM suite_identity_users').get().count > 0 || db.prepare('SELECT singleton FROM suite_identity_bootstrap').get()) return false;
        db.prepare('INSERT INTO suite_identity_bootstrap(singleton,token_hash,expires_at) VALUES(1,?,?)').run(digest(token), expiresAt);
        return true;
      });
    },
    async bootstrap(token, { email, displayName: name, password }) {
      if (typeof token !== 'string' || !tokenPattern.test(token)) fail('invalid_setup_token');
      const address = emailAddress(email); const label = displayName(name); const credential = await makeCredential(password);
      return transaction(() => {
        if (db.prepare('SELECT COUNT(*) AS count FROM suite_identity_users').get().count > 0) fail('invalid_setup_token');
        const taken = db.prepare('UPDATE suite_identity_bootstrap SET consumed_at=? WHERE singleton=1 AND token_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING singleton').get(clock(), digest(token), clock());
        if (!taken) fail('invalid_setup_token');
        return insertUser({ email: address, displayName: label, credential, role: 'admin' });
      });
    },
    issueInvitation({ inviterUserId, userId = randomUUID(), email, displayName: name, appGrants = [], ttlMs }) {
      const address = emailAddress(email); const label = displayName(name); const duration = ttl(ttlMs, 7 * 24 * 60 * 60_000, 7 * 24 * 60 * 60_000);
      if (typeof userId !== 'string' || !uuidPattern.test(userId)) fail('invalid_user_id');
      if (!Array.isArray(appGrants) || appGrants.length > APP_IDS.size) fail('invalid_grant');
      const grants = appGrants.map(grantValue);
      if (new Set(grants.map(g => g.appId)).size !== grants.length) fail('invalid_grant');
      return transaction(() => {
        requireAdmin(inviterUserId);
        if (db.prepare('SELECT id FROM suite_identity_users WHERE email=? OR id=?').get(address, userId)) fail('account_exists');
        const now = clock();
        db.prepare('DELETE FROM suite_identity_invitations WHERE expires_at<=?').run(now);
        if (db.prepare('SELECT token_hash FROM suite_identity_invitations WHERE email=? OR user_id=?').get(address, userId)) fail('invitation_exists');
        const token = opaque(); const id = userId;
        db.prepare('INSERT INTO suite_identity_invitations(token_hash,user_id,email,display_name,inviter_user_id,grants,expires_at) VALUES(?,?,?,?,?,?,?)').run(digest(token), id, address, label, inviterUserId, JSON.stringify(grants), now + duration);
        return { token, email: address, userId: id, expiresAt: now + duration };
      });
    },
    async acceptInvitation(token, { password }) {
      if (typeof token !== 'string' || !tokenPattern.test(token)) fail('invalid_invitation');
      const credential = await makeCredential(password);
      return transaction(() => {
        const invite = db.prepare('DELETE FROM suite_identity_invitations WHERE token_hash=? AND expires_at>? RETURNING *').get(digest(token), clock());
        if (!invite) fail('invalid_invitation');
        requireAdmin(invite.inviter_user_id);
        const user = insertUser({ id: invite.user_id, email: invite.email, displayName: invite.display_name, credential });
        for (const grant of JSON.parse(invite.grants)) grantAccess(user.id, grant);
        return user;
      });
    },
    exportPortable({ includePasswordHashes = false } = {}) {
      if (typeof includePasswordHashes !== 'boolean') fail('invalid_export');
      return transaction(() => ({
        format: 'celluloid-local-identity', version: 1, exportedAt: clock(),
        users: db.prepare('SELECT * FROM suite_identity_users ORDER BY id').all().map(row => ({ ...publicUser(row), ...(includePasswordHashes && row.credential ? { credential: JSON.parse(row.credential) } : {}) })),
        grants: db.prepare('SELECT * FROM suite_identity_grants ORDER BY user_id,app_id').all().map(row => ({ userId: row.user_id, appId: row.app_id, localUserId: row.local_user_id, ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}) })),
      }));
    },
    importPortable(bundle) {
      let users; let grants;
      try {
        if (!bundle || bundle.format !== 'celluloid-local-identity' || bundle.version !== 1 || !Array.isArray(bundle.users) || bundle.users.length > 10_000 || !Array.isArray(bundle.grants) || bundle.grants.length > 60_000 || JSON.stringify(bundle).length > 32 * 1024 * 1024) fail('invalid_import');
        users = bundle.users.map(value => {
          if (!value || !uuidPattern.test(value.id) || !['active', 'disabled'].includes(value.state) || !['admin', 'member'].includes(value.role) || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.updatedAt) || !credentialValid(value.credential)) fail('invalid_import');
          return { ...value, email: emailAddress(value.email), displayName: displayName(value.displayName), credential: value.credential };
        });
        const ids = new Set(users.map(user => user.id));
        if (ids.size !== users.length || new Set(users.map(user => user.email)).size !== users.length) fail('invalid_import');
        grants = bundle.grants.map(value => { if (!value || !ids.has(value.userId)) fail('invalid_import'); return { userId: value.userId, ...grantValue(value) }; });
        if (new Set(grants.map(grant => `${grant.userId}\0${grant.appId}`)).size !== grants.length) fail('invalid_import');
        if (new Set(grants.map(grant => `${grant.appId}\0${grant.localUserId}`)).size !== grants.length) fail('invalid_import');
      } catch { fail('invalid_import'); }
      return transaction(() => {
        if (db.prepare('SELECT COUNT(*) AS count FROM suite_identity_users').get().count > 0) fail('import_requires_empty_store');
        db.exec('DELETE FROM suite_identity_sessions; DELETE FROM suite_identity_invitations; DELETE FROM suite_identity_bootstrap;');
        for (const user of users) insertUser(user);
        for (const grant of grants) grantAccess(grant.userId, grant);
        return { users: users.length, grants: grants.length };
      });
    },
    close() { if (!closed) { db.close(); closed = true; } },
  });
}

function appendCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : value);
}

/** Browser-session adapter for the portable local accounts. Origin checking here
 * supplements the broker's CSRF checks; it never replaces them. */
export function createLocalIdentityAdapter({ store, origin, sessionTtlMs = 8 * 60 * 60_000, rememberedSessionTtlMs = 14 * 24 * 60 * 60_000 }) {
  const url = new URL(origin);
  const development = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin !== origin || (!development && url.protocol !== 'https:') || url.username || url.password) throw new Error('A secure local identity origin is required');
  const duration = ttl(sessionTtlMs, 8 * 60 * 60_000, 30 * 24 * 60 * 60_000);
  const rememberedDuration=ttl(rememberedSessionTtlMs,14 * 24 * 60 * 60_000,14 * 24 * 60 * 60_000);
  const name = development ? 'suite_identity_dev' : '__Host-suite_identity';
  function validHost(req) { return String(req.headers.host ?? '').toLowerCase() === url.host.toLowerCase(); }
  function browserWrite(req) { return validHost(req) && req.headers.origin === origin && (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site'])); }
  function session(req) {
    if (!validHost(req)) return null;
    const matches = String(req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    return matches.length === 1 ? store.getSessionByToken(matches[0].slice(name.length + 1)) : null;
  }
  function writeCookie(res, token, rememberMe=false) {
    // Without Remember me this is a browser-session cookie, not persistent
    // across normal browser restarts. Both modes have finite server expiry.
    appendCookie(res, `${name}=${token}; Path=/; HttpOnly; SameSite=Lax${rememberMe ? '; Max-Age='+Math.floor(rememberedDuration / 1000) : ''}${development ? '' : '; Secure'}`);
  }
  return Object.freeze({
    async getSession(req) { return session(req); },
    async authenticate(req, res, credentials) {
      if (!browserWrite(req)) return null;
      const rememberMe=credentials.rememberMe===true;
      const result = await store.authenticatePassword({email:credentials.email,
        password:credentials.password,ttlMs: rememberMe?rememberedDuration:duration});
      if (!result) return null;
      writeCookie(res,result.token,rememberMe);
      return result.parent;
    },
    async establishSession(req, res, userId) {
      if (!browserWrite(req)) fail('csrf_expired');
      const result = store.createSession(userId, { ttlMs: duration });
      writeCookie(res,result.token,false);
      return result.parent;
    },
    async getParentSession(id) { return store.getParentSession(id); },
    async getAccess(parent, appId) {
      const current = store.getParentSession(parent.id);
      return current && current.subject === parent.subject ? store.getAccess(current.subject, appId) : null;
    },
    async logout(parentSessionId) { store.revokeSession(parentSessionId); },
    clearCookie(res) { appendCookie(res, `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${development ? '' : '; Secure'}`); },
  });
}
