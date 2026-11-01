import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';

const TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const COOKIE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_TRANSACTION_MS = 10 * 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

class GatewayError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function trustedURL(value, allowLocal, originOnly = false) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash ||
      (originOnly && url.pathname !== '/')) throw new TypeError('Invalid gateway URL');
  return url;
}

/** A single local path, never a protocol-relative URL, even after repeated decoding. */
export function normalizeGatewayReturnPath(value = '/') {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) {
    throw new GatewayError(400, 'invalid_return_path');
  }
  let decoded = value.split(/[?#]/)[0];
  for (let index = 0; index < 4; index += 1) {
    if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) {
      throw new GatewayError(400, 'invalid_return_path');
    }
    let next;
    try { next = decodeURIComponent(decoded); }
    catch { throw new GatewayError(400, 'invalid_return_path'); }
    if (next === decoded) break;
    decoded = next;
    if (index === 3 && /%[a-f0-9]{2}/i.test(decoded)) throw new GatewayError(400, 'invalid_return_path');
  }
  if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) {
    throw new GatewayError(400, 'invalid_return_path');
  }
  const parsed = new URL(value, 'https://local.invalid');
  if (parsed.origin !== 'https://local.invalid') throw new GatewayError(400, 'invalid_return_path');
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function cookieValue(req, name) {
  const parts = String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (parts.length !== 1) return null;
  const value = parts[0].slice(name.length + 1);
  return COOKIE_TOKEN.test(value) ? value : null;
}

function appendCookie(res, value) {
  const previous = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), value]);
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}

function redirect(res, target) {
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  res.end();
}

function identityValue(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' ||
      !value.id || value.id.length > 128 || typeof value.displayName !== 'string' ||
      !value.displayName || value.displayName.length > 200) return null;
  const identity = { id: value.id, displayName: value.displayName };
  if (typeof value.role === 'string' && value.role.length <= 64) identity.role = value.role;
  if (value.email !== undefined) {
    if (typeof value.email !== 'string' || value.email.length > 254 || /[\u0000-\u001f\u007f]/.test(value.email)) return null;
    identity.email = value.email;
  }
  if (value.organizationId !== undefined) {
    if (typeof value.organizationId !== 'string' || !value.organizationId ||
        value.organizationId.length > 128 || /[\u0000-\u0020\u007f]/.test(value.organizationId)) return null;
    identity.organizationId = value.organizationId;
  }
  return identity;
}

function localIdentityValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.userId !== 'string' || !value.userId || value.userId.length > 128) return null;
  const identity = { userId: value.userId };
  if (value.organizationId !== undefined) {
    if (typeof value.organizationId !== 'string' || !value.organizationId ||
        value.organizationId.length > 128 || /[\u0000-\u0020\u007f]/.test(value.organizationId)) return null;
    identity.organizationId = value.organizationId;
  }
  return identity;
}

const identityMatchesContext = (identity, context) => Boolean(identity && context &&
  identity.id === context.userId && identity.organizationId === context.organizationId);

async function readLogoutBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new GatewayError(415, 'invalid_content_type');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new GatewayError(413, 'request_too_large');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new GatewayError(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
    throw new GatewayError(400, 'invalid_logout_request');
  }
}

/**
 * In-memory adapter for isolated tests. Production must provide persistent storage.
 * takeTransaction MUST atomically read and delete a transaction; never implement it
 * as separate database read/delete operations. Store only already-hashed keys.
 */
export function createMemoryGatewayStore() {
  const transactions = new Map();
  const sessions = new Map();
  return {
    async putTransaction(key, value) { transactions.set(key, structuredClone(value)); },
    async takeTransaction(key) {
      const value = transactions.get(key);
      transactions.delete(key);
      return value ? structuredClone(value) : null;
    },
    async putSession(key, value) { sessions.set(key, structuredClone(value)); },
    async getSession(key) { const value = sessions.get(key); return value ? structuredClone(value) : null; },
    async deleteSession(key) { sessions.delete(key); },
  };
}

/**
 * Same-origin app boundary, independent of the chosen central account provider.
 *
 * Required storage: putTransaction, atomic takeTransaction, putSession,
 * getSession, deleteSession. Records carry expiresAt in epoch milliseconds;
 * expired records should also be periodically removed by the persistent adapter.
 *
 * resolveIdentity(proof) MUST resolve an explicit issuer/subject-to-local mapping
 * and current local rights. There is no email linking or central-role fallback.
 * Optional nativeSessionAdapter preserves existing native logins:
 *   read(req) -> local identity | null
 *   create(req,res,identity,{issuer,subject,localIdentity,sessionKey,expiresAt})
 *   destroy(req,res,{sessionKey})
 * Existing native middleware must enforce this gateway for sessions created with
 * sharedMetadata; native sessions alone do not prove a central grant. identity and
 * localIdentity preserve the exact approved organizationId when one is granted;
 * adapters MUST use it rather than inferring a user's first membership.
 */
export function createSharedAuthGateway(options) {
  const { appId, issuer, appOrigins, sharedLoginUrl, broker, store, resolveIdentity,
    nativeSessionAdapter = {}, fetchImpl = globalThis.fetch, clock = Date.now,
    allowInsecureLocalhost = false, basePath = '' } = options || {};
  if (typeof basePath !== 'string' || (basePath && !/^\/[a-z][a-z0-9_-]{0,63}$/.test(basePath))) throw new TypeError('Invalid gateway base path');
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(appId || '') || !Array.isArray(appOrigins) ||
      !appOrigins.length || typeof resolveIdentity !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid gateway configuration');
  }
  for (const operation of ['putTransaction', 'takeTransaction', 'putSession', 'getSession', 'deleteSession']) {
    if (typeof store?.[operation] !== 'function') throw new TypeError(`Persistent store missing ${operation}`);
  }
  trustedURL(issuer, allowInsecureLocalhost);
  const login = trustedURL(sharedLoginUrl, allowInsecureLocalhost);
  const origins = new Map(appOrigins.map((value) => {
    const url = trustedURL(value, allowInsecureLocalhost, true);
    return [url.host.toLowerCase(), url.origin];
  }));
  if (origins.size !== appOrigins.length) throw new TypeError('Duplicate app origin');
  if (typeof broker?.clientId !== 'string' || !broker.clientId || broker.clientId.length > 128 ||
      /[:\r\n]/.test(broker.clientId) || typeof broker.clientSecret !== 'string' ||
      broker.clientSecret.length < 16 || /[\r\n]/.test(broker.clientSecret)) {
    throw new TypeError('Invalid broker client credentials');
  }
  const exchangeURL = trustedURL(broker.exchangeUrl, allowInsecureLocalhost).href;
  const introspectURL = trustedURL(broker.introspectUrl, allowInsecureLocalhost).href;
  const revokeURL = trustedURL(broker.revokeUrl, allowInsecureLocalhost).href;
  const timeoutMs = Math.min(30000, Math.max(50, options.timeoutMs || 10000));
  const transactionMs = Math.min(MAX_TRANSACTION_MS, Math.max(1000, options.transactionMs || MAX_TRANSACTION_MS));
  const sessionMs = Math.min(MAX_SESSION_MS, Math.max(1000, options.sessionMs || MAX_SESSION_MS));
  const authHeader = `Basic ${Buffer.from(`${broker.clientId}:${broker.clientSecret}`, 'utf8').toString('base64')}`;

  function originFor(req) {
    const origin = origins.get(String(req.headers.host || '').toLowerCase());
    if (!origin) throw new GatewayError(400, 'invalid_host');
    return origin;
  }
  function names(origin) {
    const secure = origin.startsWith('https:');
    const prefix = `${secure ? '__Host-' : ''}suite_${appId}`;
    return { transaction: `${prefix}_transaction`, session: `${prefix}_session`, secure };
  }
  function setCookie(res, name, value, maxAge, secure) {
    appendCookie(res, `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? '; Secure' : ''}`);
  }
  function returnPathFor(value = `${basePath}/`) {
    const result = normalizeGatewayReturnPath(value);
    const pathname = result.split(/[?#]/)[0];
    if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) throw new GatewayError(400, 'invalid_return_path');
    return result;
  }
  function loginURL(origin, returnPath = `${basePath}/`) {
    const url = new URL(`${basePath}/auth/login`, origin);
    if (returnPath !== `${basePath}/`) url.searchParams.set('returnPath', returnPathFor(returnPath));
    return url.href;
  }
  function assertProof(value, { withToken = false, subject, localIdentity } = {}) {
    const approvedIdentity = localIdentityValue(value?.localIdentity);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.issuer !== issuer ||
        value.audience !== broker.clientId || typeof value.subject !== 'string' ||
        !value.subject || value.subject.length > 128 || (subject && value.subject !== subject) ||
        !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= clock() ||
        (withToken && !TOKEN.test(value.sessionToken || '')) ||
        !approvedIdentity || (localIdentity && (approvedIdentity.userId !== localIdentity.userId ||
          approvedIdentity.organizationId !== localIdentity.organizationId))) {
      throw new GatewayError(502, 'invalid_broker_response');
    }
    return { ...value, localIdentity: approvedIdentity };
  }
  async function callBroker(url, body, expectJSON = true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { Authorization: authHeader,
          'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
        redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new GatewayError(503, 'broker_unavailable');
      if (!expectJSON) return null;
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
        throw new GatewayError(502, 'invalid_broker_response');
      }
      const text = await response.text();
      if (text.length > 32768) throw new GatewayError(502, 'invalid_broker_response');
      try { return JSON.parse(text); }
      catch { throw new GatewayError(502, 'invalid_broker_response'); }
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(503, 'broker_unavailable');
    } finally { clearTimeout(timeout); }
  }
  async function destroySession(req, res, sessionKey, origin) {
    await store.deleteSession(sessionKey);
    const cookie = names(origin);
    setCookie(res, cookie.session, '', 0, cookie.secure);
    if (typeof nativeSessionAdapter.destroy === 'function') {
      await nativeSessionAdapter.destroy(req, res, { sessionKey });
    }
  }
  async function storedSession(req, origin, sessionKey) {
    if (sessionKey !== undefined && (typeof sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(sessionKey))) throw new GatewayError(400, 'invalid_session_key');
    const value = sessionKey === undefined ? cookieValue(req, names(origin).session) : null;
    if (sessionKey === undefined && !value) return null;
    const key = sessionKey ?? hash(value);
    const session = await store.getSession(key);
    return session ? { ...session, sessionKey: key } : null;
  }
  async function readSession(req, res, origin, sessionKey) {
    const session = await storedSession(req, origin, sessionKey);
    if (!session) {
      // A supplied but unknown shared cookie cannot fall back to a native session.
      // Native fallback applies only to an ordinary, independently logged-in user.
      if (sessionKey !== undefined || cookieValue(req, names(origin).session)) return null;
      const native = typeof nativeSessionAdapter.read === 'function'
        ? identityValue(await nativeSessionAdapter.read(req)) : null;
      return native ? { identity: native, source: 'native', shared: false, csrfToken: null } : null;
    }
    if (session.origin !== origin || session.expiresAt <= clock()) {
      await destroySession(req, res, session.sessionKey, origin);
      return null;
    }
    const proof = await callBroker(introspectURL, { sessionToken: session.sessionToken });
    if (proof?.active === false) {
      await destroySession(req, res, session.sessionKey, origin);
      return null;
    }
    if (proof?.active !== true) throw new GatewayError(502, 'invalid_broker_response');
    const validatedProof = assertProof(proof, { subject: session.subject, localIdentity: session.localIdentity });
    const identity = identityValue(await resolveIdentity(validatedProof));
    if (!identityMatchesContext(identity, session.localIdentity)) {
      await destroySession(req, res, session.sessionKey, origin);
      return null;
    }
    return { ...session, identity, source: 'shared', shared: true };
  }
  async function start(req, res, origin, url) {
    if ([...url.searchParams.keys()].some((key) => key !== 'returnPath') ||
        url.searchParams.getAll('returnPath').length > 1) throw new GatewayError(400, 'invalid_request');
    const returnPath = returnPathFor(url.searchParams.get('returnPath') || `${basePath}/`);
    const state = opaque();
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const transactionCookie = opaque();
    const redirectUri = `${origin}${basePath}/auth/callback`;
    await store.putTransaction(hash(transactionCookie), {
      origin, state, verifier, redirectUri, returnPath, expiresAt: clock() + transactionMs,
    });
    const cookie = names(origin);
    setCookie(res, cookie.transaction, transactionCookie, transactionMs / 1000, cookie.secure);
    const target = new URL(login);
    target.searchParams.set('app', appId);
    target.searchParams.set('state', state);
    target.searchParams.set('code_challenge', challenge);
    target.searchParams.set('code_challenge_method', 'S256');
    target.searchParams.set('redirect_uri', redirectUri);
    target.searchParams.set('returnPath', returnPath);
    redirect(res, target.href);
  }
  async function callback(req, res, origin, url) {
    if (url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1 ||
        [...url.searchParams.keys()].some((key) => !['code', 'state'].includes(key)) ||
        !TOKEN.test(url.searchParams.get('code') || '') || !COOKIE_TOKEN.test(url.searchParams.get('state') || '')) {
      throw new GatewayError(400, 'invalid_callback');
    }
    const cookie = names(origin);
    const value = cookieValue(req, cookie.transaction);
    if (!value) throw new GatewayError(400, 'invalid_callback');
    const transaction = await store.takeTransaction(hash(value));
    setCookie(res, cookie.transaction, '', 0, cookie.secure);
    if (!transaction || transaction.expiresAt <= clock() || transaction.origin !== origin ||
        transaction.redirectUri !== `${origin}${basePath}/auth/callback` ||
        !safeEqual(transaction.state, url.searchParams.get('state'))) {
      throw new GatewayError(400, 'invalid_callback');
    }
    const proof = assertProof(await callBroker(exchangeURL, {
      clientId: broker.clientId, code: url.searchParams.get('code'), state: transaction.state,
      codeVerifier: transaction.verifier, redirectUri: transaction.redirectUri,
    }), { withToken: true });
    const identity = identityValue(await resolveIdentity(proof));
    if (!identityMatchesContext(identity, proof.localIdentity)) {
      await callBroker(revokeURL, { sessionToken: proof.sessionToken, childOnly: true }, false).catch(() => {});
      throw new GatewayError(403, 'account_mapping_required');
    }
    const token = opaque();
    const sessionKey = hash(token);
    const expiresAt = Math.min(proof.expiresAt, clock() + sessionMs);
    const session = { identity, issuer, subject: proof.subject, localIdentity: proof.localIdentity, sessionToken: proof.sessionToken,
      expiresAt, origin, csrfToken: opaque() };
    try {
      await store.putSession(sessionKey, session);
      if (typeof nativeSessionAdapter.create === 'function') {
        await nativeSessionAdapter.create(req, res, identity, {
          issuer, subject: proof.subject, localIdentity: proof.localIdentity, sessionKey, expiresAt,
        });
      }
    } catch {
      await store.deleteSession(sessionKey);
      await callBroker(revokeURL, { sessionToken: proof.sessionToken, childOnly: true }, false).catch(() => {});
      throw new GatewayError(503, 'local_session_unavailable');
    }
    setCookie(res, cookie.session, token, (expiresAt - clock()) / 1000, cookie.secure);
    redirect(res, returnPathFor(transaction.returnPath));
  }
  async function logout(req, res, origin, sessionKey) {
    if (req.headers.origin !== origin) throw new GatewayError(403, 'invalid_origin');
    const session = await storedSession(req, origin, sessionKey);
    if (!session || session.origin !== origin) throw new GatewayError(401, 'unauthenticated');
    if (!safeEqual(session.csrfToken, req.headers['x-csrf-token'])) throw new GatewayError(403, 'invalid_csrf');
    await readLogoutBody(req);
    // Keep a usable local session if the broker cannot confirm global revocation.
    await callBroker(revokeURL, { sessionToken: session.sessionToken }, false);
    await destroySession(req, res, session.sessionKey, origin);
    sendJSON(res, 200, { authenticated: false, loggedOut: true, loginUrl: loginURL(origin) });
  }
  function errorResponse(res, error) {
    if (!res.headersSent) sendJSON(res, error instanceof GatewayError ? error.status : 503,
      { error: error instanceof GatewayError ? error.code : 'session_unavailable' });
    else if (!res.writableEnded) res.end();
  }
  async function handle(req, res, { sessionKey } = {}) {
    let url;
    try { url = new URL(req.url, 'https://app.invalid'); }
    catch { sendJSON(res, 400, { error: 'invalid_request' }); return true; }
    const route = basePath && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : basePath ? null : url.pathname;
    if (!['/auth/login', '/auth/callback', '/api/suite/session', '/api/suite/logout', '/api/suite/health'].includes(route)) return false;
    try {
      const origin = originFor(req);
      const expected = route === '/api/suite/logout' ? 'POST' : 'GET';
      if (req.method !== expected) {
        res.setHeader('Allow', expected);
        throw new GatewayError(405, 'method_not_allowed');
      }
      if (route === '/auth/login') await start(req, res, origin, url);
      else if (route === '/auth/callback') await callback(req, res, origin, url);
      else if (route === '/api/suite/logout') {
        if (url.search) throw new GatewayError(400, 'invalid_request');
        await logout(req, res, origin, sessionKey);
      } else if (route === '/api/suite/health') sendJSON(res, 200, { appId, status: 'ok' });
      else {
        if (url.search) throw new GatewayError(400, 'invalid_request');
        const session = await readSession(req, res, origin, sessionKey);
        sendJSON(res, 200, { authenticated: Boolean(session), source: session?.source || null,
          shared: session?.shared || false, user: session?.identity || null,
          csrfToken: session?.csrfToken || null, loginUrl: loginURL(origin) });
      }
    } catch (error) { errorResponse(res, error); }
    return true;
  }
  async function requireSession(req, res, { redirectToLogin = false, sessionKey } = {}) {
    try {
      const origin = originFor(req);
      const session = await readSession(req, res, origin, sessionKey);
      if (session) return session;
      if (redirectToLogin) redirect(res, loginURL(origin, returnPathFor(req.url || `${basePath}/`)));
      else sendJSON(res, 401, { error: 'unauthenticated', loginUrl: loginURL(origin) });
    } catch (error) { errorResponse(res, error); }
    return null;
  }
  // sessionKey is an internal native-session DB marker, never a request field.
  // This allows native APIs to enforce shared revocation if the browser removes
  // its separate suite cookie. Absence of a stored key never falls back to native.
  return Object.freeze({ handle, requireSession,
    async readSession(req, res, { sessionKey } = {}) { return readSession(req, res, originFor(req), sessionKey); },
    close() {} });
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

/** Serve only a private frontend directory, after the real session boundary. */
export function createProtectedStaticHandler({ gateway, root, indexFile = 'index.html', basePath = '', htmlTransform }) {
  if (!gateway || typeof gateway.handle !== 'function' || typeof gateway.requireSession !== 'function' ||
      typeof root !== 'string' || !root || !/^[a-z0-9_-]+\.html$/i.test(indexFile)) {
    throw new TypeError('Invalid protected frontend configuration');
  }
  const resolvedRoot = resolve(root);
  return async (req, res) => {
    if (await gateway.handle(req, res)) return;
    if (!['GET', 'HEAD'].includes(req.method)) { sendJSON(res, 405, { error: 'method_not_allowed' }); return; }
    try {
      let pathname = String(req.url || '/').split(/[?#]/)[0];
      for (let round = 0; round < 4; round += 1) {
        const decoded = decodeURIComponent(pathname);
        if (decoded === pathname) break;
        pathname = decoded;
      }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(pathname) ||
          pathname.split('/').some((part) => part.startsWith('.'))) {
        throw new GatewayError(400, 'invalid_path');
      }
      if (!(await gateway.requireSession(req, res, { redirectToLogin: true }))) return;
      if (basePath) {
        if (pathname === basePath) pathname = '/';
        else if (pathname.startsWith(`${basePath}/`)) pathname = pathname.slice(basePath.length);
        else throw new GatewayError(404, 'not_found');
      }
      if (pathname.endsWith('/')) pathname += indexFile;
      const file = resolve(resolvedRoot, `.${pathname}`);
      const [physicalRoot, physicalFile] = await Promise.all([realpath(resolvedRoot), realpath(file)]);
      const within = relative(physicalRoot, physicalFile);
      if (within === '..' || within.startsWith(`..${sep}`) || within.startsWith(sep) || !(await stat(physicalFile)).isFile()) {
        throw new GatewayError(404, 'not_found');
      }
      let contents = await readFile(physicalFile);
      if (extname(physicalFile).toLowerCase() === '.html' && typeof htmlTransform === 'function') contents = Buffer.from(htmlTransform(contents.toString('utf8')));
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(physicalFile).toLowerCase()] || 'application/octet-stream',
        'Content-Length': contents.length, 'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      const status = error instanceof GatewayError ? error.status : error?.code === 'ENOENT' ? 404 : 503;
      if (!res.headersSent) sendJSON(res, status, { error: status === 404 ? 'not_found' : status === 400 ? 'invalid_path' : 'frontend_unavailable' });
      else if (!res.writableEnded) res.end();
    }
  };
}
