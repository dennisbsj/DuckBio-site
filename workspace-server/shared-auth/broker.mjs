import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const opaque = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
};
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

function normalizePath(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) throw new BrokerError(400, 'invalid_input');
  const url = new URL(value, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid') throw new BrokerError(400, 'invalid_input');
  let decoded = url.pathname;
  for (let i = 0; i < 4; i += 1) {
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) throw new BrokerError(400, 'invalid_input');
    let next;
    try { next = decodeURIComponent(decoded); } catch { throw new BrokerError(400, 'invalid_input'); }
    if (next === decoded) return url.pathname + url.search + url.hash;
    decoded = next;
  }
  throw new BrokerError(400, 'invalid_input');
}

class BrokerError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function appendCookie(res, value) {
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [...(Array.isArray(existing) ? existing : [existing]), value] : value);
}

function cookie(req, name) {
  const matches = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return tokenPattern.test(value) ? value : null;
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw new BrokerError(415, 'invalid_input');
  if (req.body !== undefined) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || JSON.stringify(req.body).length > 8192) throw new BrokerError(400, 'invalid_input');
    return req.body;
  }
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw new BrokerError(413, 'invalid_input');
    parts.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new BrokerError(400, 'invalid_input'); }
}

// Tests/local development only. Production must supply durable, atomic storage.
export function createMemoryBrokerStore() {
  const csrf = new Map(); const codes = new Map(); const proofs = new Map(); const attempts = new Map();
  return {
    async putCsrf(key, value) { csrf.set(key, structuredClone(value)); },
    async getCsrf(key) { return structuredClone(csrf.get(key) ?? null); },
    async putCode(key, value) { codes.set(key, structuredClone(value)); },
    async consumeCode(key, expected) {
      const value = codes.get(key);
      if (!value || value.expiresAt <= expected.now || value.clientId !== expected.clientId || value.state !== expected.state || value.challenge !== expected.challenge || value.redirectUri !== expected.redirectUri) return null;
      codes.delete(key);
      return structuredClone(value);
    },
    async putProof(key, value) { proofs.set(key, structuredClone(value)); },
    async getProof(key) { return structuredClone(proofs.get(key) ?? null); },
    async deleteProof(key) { proofs.delete(key); },
    async consumeLoginAttempt(key, { limit, windowMs, now }) {
      for (const [id, value] of attempts) if (value.expiresAt <= now) attempts.delete(id);
      const value = attempts.get(key) ?? { count: 0, expiresAt: now + windowMs };
      value.count += 1; attempts.set(key, value);
      return value.count <= limit;
    },
    async clearLoginAttempts(key) { attempts.delete(key); },
  };
}

/** Identity adapter reads live native sessions, verifies real credentials, checks
 * explicit per-app grants/local mappings, and revokes the native parent session.
 * No account provisioning, email linking, or role promotion happens here. */
export function createAuthBroker({ origin, issuer = origin, clients, identity, store, clock = Date.now, prefix = '/api/suite/auth', maxLoginAttempts = 10, getClientAddress }) {
  const brokerURL = new URL(origin);
  if (brokerURL.origin !== origin || brokerURL.username || brokerURL.password || brokerURL.search || brokerURL.hash || (brokerURL.protocol !== 'https:' && !(brokerURL.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(brokerURL.hostname)))) throw new Error('A secure canonical broker origin is required');
  if (new URL(issuer).protocol !== 'https:') throw new Error('A secure identity issuer is required');
  if (brokerURL.protocol === 'https:' && typeof getClientAddress !== 'function') throw new Error('A deployment-aware trusted client address adapter is required');
  const clientAddress = getClientAddress ?? (req => req.socket?.remoteAddress);
  if (!Number.isInteger(maxLoginAttempts) || maxLoginAttempts < 1 || maxLoginAttempts > 100) throw new Error('Invalid login attempt limit');
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix)) throw new Error('Invalid auth route prefix');
  for (const method of ['getSession', 'authenticate', 'getParentSession', 'getAccess', 'logout']) if (typeof identity?.[method] !== 'function') throw new Error(`Identity adapter requires ${method}`);
  for (const method of ['putCsrf', 'getCsrf', 'putCode', 'consumeCode', 'putProof', 'getProof', 'deleteProof', 'consumeLoginAttempt', 'clearLoginAttempts']) if (typeof store?.[method] !== 'function') throw new Error(`Durable broker store requires ${method}`);
  const registered = new Map();
  const redirects = new Map();
  for (const client of clients ?? []) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(client.id) || !/^[a-z][a-z0-9_-]{0,63}$/.test(client.appId) || registered.has(client.id) || typeof client.secret !== 'string' || client.secret.length < 32 || !Array.isArray(client.redirectUris) || !client.redirectUris.length) throw new Error('Invalid registered client');
    for (const value of client.redirectUris) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/(?:[a-z][a-z0-9_-]{0,63}\/)?auth\/callback$/.test(url.pathname) || url.href !== value || redirects.has(value)) throw new Error('Invalid or duplicate registered redirect URI');
      redirects.set(value, client.id);
    }
    registered.set(client.id, Object.freeze({ ...client, redirectUris: Object.freeze([...client.redirectUris]) }));
  }
  if (!registered.size) throw new Error('At least one explicit app client is required');
  const csrfCookie = 'suite_login_csrf';
  const secureCookie = brokerURL.protocol === 'https:' ? '; Secure' : '';
  let credentialJobs = 0;

  function json(res, status, data) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(status === 204 ? undefined : JSON.stringify(data));
  }
  function parentValid(value) {
    return value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 && typeof value.subject === 'string' && value.subject.length > 0 && value.subject.length <= 128 && typeof value.displayName === 'string' && value.displayName.trim() && value.displayName.length <= 200 && Number.isFinite(value.expiresAt) && value.expiresAt > clock();
  }
  async function checkAccess(parent, appId) {
    if (!parentValid(parent)) throw new BrokerError(401, 'invalid_credentials');
    if (parent.passwordChangeRequired) throw new BrokerError(409, 'password_change_required');
    const access = await identity.getAccess(parent, appId);
    if (!access || !access.localIdentity || typeof access.localIdentity.userId !== 'string' || !access.localIdentity.userId || access.localIdentity.userId.length > 128) throw new BrokerError(403, 'access_denied');
    const localIdentity = { userId: access.localIdentity.userId };
    if (access.localIdentity.organizationId !== undefined) {
      if (typeof access.localIdentity.organizationId !== 'string' || !access.localIdentity.organizationId || access.localIdentity.organizationId.length > 128) throw new BrokerError(403, 'access_denied');
      localIdentity.organizationId = access.localIdentity.organizationId;
    }
    // Only a trusted backend adapter may supply this revision. It must identify
    // the exact authorization generation (including the selected tenant), not
    // merely the app user's stable ID. Legacy grants omit the field entirely.
    let bindingRevision = null;
    if (Object.hasOwn(access, 'bindingRevision')) {
      if (typeof access.bindingRevision !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(access.bindingRevision))
        throw new BrokerError(403, 'access_denied');
      bindingRevision = access.bindingRevision;
    }
    return { localIdentity, bindingRevision };
  }
  function browserTarget(body) {
    const client = registered.get(redirects.get(body.redirectUri));
    if (!client || client.appId !== body.appId || !tokenPattern.test(body.state ?? '') || typeof body.state !== 'string' || typeof body.codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge) || body.codeChallengeMethod !== 'S256') throw new BrokerError(400, 'invalid_input');
    return { client, returnPath: normalizePath(body.returnPath ?? '/'), state: body.state, challenge: body.codeChallenge, redirectUri: body.redirectUri };
  }
  async function verifyCsrf(req) {
    if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin' && req.headers['sec-fetch-site'] !== 'none')) throw new BrokerError(403, 'csrf_expired');
    const token = cookie(req, csrfCookie);
    const value = token ? await store.getCsrf(digest(token)) : null;
    const supplied = req.headers['x-csrf-token'];
    if (!value || value.expiresAt <= clock() || typeof supplied !== 'string' || !tokenPattern.test(supplied) || !safeEqual(value.tokenHash, digest(supplied))) throw new BrokerError(403, 'csrf_expired');
  }
  function authenticateClient(req, body) {
    if (req.headers.origin) throw new BrokerError(401, 'invalid_client');
    const value = String(req.headers.authorization ?? '');
    if (!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 1024) throw new BrokerError(401, 'invalid_client');
    const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const client = registered.get(decoded.slice(0, separator));
    if (separator < 1 || !client || !safeEqual(client.secret, decoded.slice(separator + 1)) || (body.clientId !== undefined && body.clientId !== client.id)) throw new BrokerError(401, 'invalid_client');
    return client;
  }
  async function issueCode(parent, target) {
    const initialAccess = await checkAccess(parent, target.client.appId);
    const code = opaque();
    await store.putCode(digest(code), { clientId: target.client.id, appId: target.client.appId, parentSessionId: parent.id, subject: parent.subject, state: target.state, challenge: target.challenge, redirectUri: target.redirectUri, returnPath: target.returnPath, bindingRevision: initialAccess.bindingRevision, expiresAt: Math.min(clock() + 60_000, parent.expiresAt) });
    const redirect = new URL(target.redirectUri);
    redirect.searchParams.set('code', code); redirect.searchParams.set('state', target.state);
    return { redirectUrl: redirect.href };
  }
  async function liveProof(client, sessionToken) {
    if (typeof sessionToken !== 'string' || !tokenPattern.test(sessionToken)) return null;
    const proof = await store.getProof(digest(sessionToken));
    if (!proof || proof.clientId !== client.id || proof.expiresAt <= clock()) return null;
    const parent = await identity.getParentSession(proof.parentSessionId);
    if (!parentValid(parent) || parent.subject !== proof.subject || parent.passwordChangeRequired) return null;
    let granted;
    try { granted = await checkAccess(parent, client.appId); } catch (error) { if (error instanceof BrokerError) return null; throw error; }
    // Missing binding in a historical proof is the legacy unbound mode.
    // A switch to a revision-aware adapter invalidates those old proofs.
    const proofBinding = Object.hasOwn(proof, 'bindingRevision') ? proof.bindingRevision : null;
    if (granted.bindingRevision !== proofBinding ||
        JSON.stringify(granted.localIdentity) !== JSON.stringify(proof.localIdentity)) return null;
    return { proof, parent, assertion: { active: true, issuer, audience: client.id, subject: parent.subject, displayName: parent.displayName, localIdentity: granted.localIdentity, expiresAt: Math.min(proof.expiresAt, parent.expiresAt) } };
  }
  async function checkRate(req, email) {
    const address = clientAddress(req);
    if (typeof address !== 'string' || !address || address.length > 128) throw new BrokerError(503, 'unavailable');
    // Separate account+address buckets avoid a proxy-wide ten-login lockout.
    // The deployment adapter, never untrusted forwarded headers, selects IP.
    const key = digest(`${address}\u0000${email.toLowerCase()}`);
    if (!await store.consumeLoginAttempt(key, { limit: maxLoginAttempts, windowMs: 15 * 60_000, now: clock() })) throw new BrokerError(429, 'rate_limited');
    return key;
  }

  async function credentialWork(req, identifier, operation) {
    await verifyCsrf(req);
    if (credentialJobs >= 4) throw new BrokerError(429, 'rate_limited');
    const key = await checkRate(req, identifier);
    // Check again after the durable limiter await: concurrent callers must not
    // all reserve the last free hashing slot before SQLite returns.
    if (credentialJobs >= 4) throw new BrokerError(429, 'rate_limited');
    credentialJobs += 1;
    try {
      const result = await operation();
      if (result) await store.clearLoginAttempts(key);
      return result;
    } finally { credentialJobs -= 1; }
  }
  async function authenticateCredentials(req, res, body) {
    if (typeof body.email !== 'string' || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+$/.test(body.email.trim()) || typeof body.password !== 'string' || !body.password || body.password.length > 1024 || (body.rememberMe!==undefined && typeof body.rememberMe!=='boolean')) throw new BrokerError(400, 'invalid_input');
    return credentialWork(req, body.email.trim(), () => identity.authenticate(req, res, { email: body.email.trim(), password: body.password, rememberMe:body.rememberMe===true }));
  }

  return Object.freeze({
    // For trusted native backends only. The secret and broker proof must remain
    // server-side; neither browser cookies nor user-supplied IDs are accepted.
    async authenticateNativeSession(req,body){
      if(req.headers.cookie||req.headers['sec-fetch-site'])
        throw new BrokerError(401,'invalid_client');
      const client=authenticateClient(req,body);
      const result=await liveProof(client,body?.sessionToken);
      return result?{...result.assertion,appId:client.appId}:null;
    },
    verifyCsrf,
    credentialWork,
    authenticateCredentials,
    async handle(req, res) {
      const path = String(req.url || '/').split('?')[0];
      const route = path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null;
      if (!['session', 'login', 'authorize', 'exchange', 'introspect', 'revoke'].includes(route)) return false;
      try {
        if (String(req.headers.host ?? '').toLowerCase() !== brokerURL.host.toLowerCase()) throw new BrokerError(400, 'invalid_input');
        if (route === 'session') {
          if (req.method !== 'GET') throw new BrokerError(405, 'method_not_allowed');
          if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw new BrokerError(403, 'csrf_expired');
          let key = cookie(req, csrfCookie);
          let binding = key ? await store.getCsrf(digest(key)) : null;
          if (!binding || binding.expiresAt <= clock() || typeof binding.csrfToken !== 'string' || !tokenPattern.test(binding.csrfToken) || !safeEqual(binding.tokenHash, digest(binding.csrfToken))) {
            key = opaque();
            const csrfToken = opaque();
            binding = { csrfToken, tokenHash: digest(csrfToken), expiresAt: clock() + 2 * 60 * 60_000 };
            await store.putCsrf(digest(key), binding);
            appendCookie(res, `${csrfCookie}=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${secureCookie}`);
          }
          const parent = await identity.getSession(req);
          const authenticated = Boolean(parentValid(parent));
          json(res, 200, { authenticated, csrfToken: binding.csrfToken, user: authenticated ? { id: parent.subject, displayName: parent.displayName } : null, passwordChangeRequired: authenticated && Boolean(parent.passwordChangeRequired) });
        } else {
          if (req.method !== 'POST') throw new BrokerError(405, 'method_not_allowed');
          if (route === 'login' || route === 'authorize') await verifyCsrf(req);
          const body = await readJson(req);
          if (route === 'login' || route === 'authorize') {
            const target = browserTarget(body);
            let parent;
            if (route === 'login') {
              parent = await authenticateCredentials(req, res, body);
            } else parent = await identity.getSession(req);
            json(res, 200, await issueCode(parent, target));
          } else {
            const client = authenticateClient(req, body);
            if (route === 'exchange') {
              if (typeof body.code !== 'string' || !tokenPattern.test(body.code) || typeof body.state !== 'string' || !tokenPattern.test(body.state) || typeof body.codeVerifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier) || !client.redirectUris.includes(body.redirectUri)) throw new BrokerError(401, 'invalid_grant');
              const challenge = createHash('sha256').update(body.codeVerifier).digest('base64url');
              const record = await store.consumeCode(digest(body.code), { clientId: client.id, state: body.state, challenge, redirectUri: body.redirectUri, now: clock() });
              if (!record) throw new BrokerError(401, 'invalid_grant');
              const parent = await identity.getParentSession(record.parentSessionId);
              if (!parentValid(parent) || parent.subject !== record.subject || parent.passwordChangeRequired) throw new BrokerError(401, 'invalid_grant');
              let granted;
              try { granted = await checkAccess(parent, client.appId); } catch (error) { if (error instanceof BrokerError) throw new BrokerError(401, 'invalid_grant'); throw error; }
              const codeBinding = Object.hasOwn(record, 'bindingRevision') ? record.bindingRevision : null;
              if (granted.bindingRevision !== codeBinding) throw new BrokerError(401, 'invalid_grant');
              const localIdentity = granted.localIdentity;
              const sessionToken = opaque(); const expiresAt = Math.min(parent.expiresAt, clock() + 8 * 60 * 60_000);
              await store.putProof(digest(sessionToken), { clientId: client.id, parentSessionId: parent.id, subject: parent.subject, localIdentity, bindingRevision: granted.bindingRevision, expiresAt });
              json(res, 200, { issuer, audience: client.id, subject: parent.subject, displayName: parent.displayName, localIdentity, expiresAt, sessionToken, returnPath: record.returnPath });
            } else if (route === 'introspect') {
              const proof = await liveProof(client, body.sessionToken);
              json(res, 200, proof?.assertion ?? { active: false });
            } else {
              if (body.childOnly !== undefined && typeof body.childOnly !== 'boolean') throw new BrokerError(400, 'invalid_input');
              const token = body.sessionToken;
              const proof = typeof token === 'string' && tokenPattern.test(token) ? await store.getProof(digest(token)) : null;
              if (proof && proof.clientId === client.id) {
                // A withdrawn app grant must still be able to log out the
                // parent session it originally authenticated with.
                if (!body.childOnly) await identity.logout(proof.parentSessionId);
                await store.deleteProof(digest(body.sessionToken));
              }
              json(res, 204);
            }
          }
        }
      } catch (error) {
        json(res, error instanceof BrokerError ? error.status : 503, { error: error instanceof BrokerError ? error.code : 'unavailable' });
      }
      return true;
    },
  });
}
