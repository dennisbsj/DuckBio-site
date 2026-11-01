import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthBroker } from './broker.mjs';
import { createLocalIdentityAdapter, IdentityStoreError } from './identity-store.mjs';
import { OrganizationError } from '../organization-store.mjs';

const APP_NAMES = Object.freeze({ goflo: 'GoFlo', eel: 'EEL', methpipe: 'MethPipe', mantrain: 'ManTrain', duckman: 'DuckMan', limsman: 'LIMSMan' });
const STATIC_APPS = new Set(['goflo', 'methpipe', 'mantrain']);
// Each native app must have an explicit private client origin; retired domains are not fallbacks.
const FILES = new Set(['index.html', 'login.css', 'app.js', 'app-registry.mjs', 'auth-client.mjs', 'config.mjs', 'admin.html', 'admin.js', 'admin.css', 'workspace.html', 'workspace.css', 'workspace.js', ...Object.keys(APP_NAMES).map(id => `assets/${id}.svg`), 'assets/favicon.svg']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
class ServiceError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u0020\u007f]/.test(value);

async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw new ServiceError(415, 'invalid_input');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new ServiceError(413, 'invalid_input'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ServiceError(400, 'invalid_input'); }
}
function userView(user) { return { id: user.id, email: user.email, displayName: user.displayName, state: user.state, isAdmin: user.role === 'admin' }; }

/** Account service is independent of all business-data apps. It never migrates
 * their passwords/users, links by email, or promotes a central role to an app role. */
export function createAccountService({ origin, issuer = origin, clients, identityStore, authStore, assetRoot, organizationStore = null, clock = Date.now, buildVersion = 'local', getClientAddress, fetchImpl = globalThis.fetch }) {
  const url = new URL(origin);
  const identity = createLocalIdentityAdapter({ store: identityStore, origin });
  const broker = createAuthBroker({ origin, issuer, clients, identity, store: authStore, clock, getClientAddress });
  const registrations = new Map(clients.map(client => [client.appId, client]));
  const nativeApps = new Set(clients.filter(client => client.nativeOrigin || !STATIC_APPS.has(client.appId)).map(client => client.appId));
  const staticApps = new Set([...STATIC_APPS].filter(id => !nativeApps.has(id)));
  const assets = resolve(assetRoot);
  function send(res, status, body, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...extra });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }
  async function authenticated(req, admin = false) {
    const parent = await identity.getSession(req);
    const user = parent ? identityStore.getUser(parent.subject) : null;
    if (!parent || !user || user.state !== 'active') throw new ServiceError(401, 'invalid_credentials');
    if (admin && user.role !== 'admin') throw new ServiceError(403, 'access_denied');
    return { parent, user };
  }
  function account(user) {
    return { user: userView(user), apps: Object.entries(APP_NAMES).map(([id, name]) => ({ id, name, nativeIdentity: nativeApps.has(id), enabled: Boolean(identityStore.getAccess(user.id, id)) })), admin: user.role === 'admin' };
  }
  async function roster(appId) {
    const client = registrations.get(appId);
    if (!nativeApps.has(appId) || !client) throw new ServiceError(400, 'invalid_input');
    const expected = client.nativeOrigin;
    if(typeof expected !== 'string') throw new ServiceError(400,'invalid_input');
    const native = new URL(expected);
    if (native.origin !== expected || native.protocol !== 'https:' || native.username || native.password || native.search || native.hash || !client.redirectUris.some(value => new URL(value).origin === expected)) throw new ServiceError(400, 'invalid_input');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(`${expected}/api/suite/native-users`, { method: 'POST', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Authorization: `Basic ${Buffer.from(`${client.id}:${client.secret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new ServiceError(503, 'unavailable');
      const text = await response.text(); if (text.length > 1_000_000) throw new ServiceError(503, 'unavailable');
      const data = JSON.parse(text);
      if (!Array.isArray(data?.users) || data.users.length > 10_000) throw new ServiceError(503, 'unavailable');
      return data.users.map(row => {
        const organizationId = row.organizationId ?? row.organization?.id;
        const organizationName = row.organizationName ?? row.organization?.name;
        const displayName = row.displayName ?? row.name;
        if (!safeId(row.id) || typeof displayName !== 'string' || !displayName.trim() || displayName.length > 200 || typeof row.email !== 'string' || row.email.length > 254 || typeof row.role !== 'string' || row.role.length > 64 || (organizationId !== undefined && !safeId(organizationId)) || (organizationName !== undefined && (typeof organizationName !== 'string' || organizationName.length > 200))) throw new ServiceError(503, 'unavailable');
        return { id: row.id, displayName, email: row.email, role: row.role, isAdmin: row.isAdmin === true, ...(organizationId !== undefined ? { organizationId } : {}), ...(organizationName !== undefined ? { organizationName } : {}) };
      });
    } catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError(503, 'unavailable'); }
    finally { clearTimeout(timeout); }
  }
  async function staticFile(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    let file = pathname.replace(/^\//, '');
    if (['/', '/login/', '/login', '/setup', '/setup/', '/invite', '/invite/'].includes(pathname)) file = 'index.html';
    else if (['/account', '/account/', '/account/index.html'].includes(pathname)) file = 'admin.html';
    else if (['/workspace','/workspace/','/workspace/index.html'].includes(pathname)) file = 'workspace.html';
    else if (file.startsWith('login/')) file = file.slice(6);
    if (!FILES.has(file)) return false;
    try {
      const bytes = await readFile(resolve(assets, file));
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': TYPES[ext], 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { send(res, 404, { error: 'not_found' }); }
    return true;
  }
  function errorResponse(res, error) {
    let status = error.status ?? 503; let code = error.code ?? 'unavailable';
    if (error instanceof OrganizationError) {
      status = code === 'access_denied' ? 403
        : ['app_seats_exhausted','last_organization_admin','duplicate_organization_email'].includes(code) ? 409
        : 400;
      if (!['access_denied','app_seats_exhausted','last_organization_admin','duplicate_organization_email','invalid_roles','invalid_member'].includes(code)) code = 'invalid_input';
    }
    if (error instanceof IdentityStoreError) {
      if (code === 'invalid_setup_token') status = 403;
      else if (['account_exists', 'invitation_exists', 'last_active_admin', 'mapping_already_linked'].includes(code)) status = 409;
      else if (code === 'access_denied') status = 403;
      else if (code === 'invalid_credentials') status = 401;
      else status = 400;
      if (!['invalid_setup_token', 'invalid_invitation', 'account_exists', 'invitation_exists', 'last_active_admin', 'mapping_already_linked', 'access_denied', 'invalid_credentials'].includes(code)) code = 'invalid_input';
    }
    if (!res.headersSent) send(res, status, { error: code });
    else if (!res.writableEnded) res.end();
  }
  return Object.freeze({
    async handle(req, res) {
      try {
        if (String(req.headers.host || '').toLowerCase() !== url.host.toLowerCase()) throw new ServiceError(400, 'invalid_input');
        if (await broker.handle(req, res)) return true;
        const parsed = new URL(req.url, origin); const route = parsed.pathname;
        if (route === '/api/suite/health' || route === '/api/suite/status') {
          if (req.method !== 'GET') throw new ServiceError(405, 'method_not_allowed');
          send(res, 200, { status: 'ok', mode: 'local', buildVersion, configured: identityStore.listUsers().length > 0 }); return true;
        }
        if (!route.startsWith('/api/suite/')) return staticFile(req, res, route);
        const methods = { '/api/suite/account': 'GET', '/api/suite/account/login': 'POST', '/api/suite/setup': 'POST', '/api/suite/invitations/accept': 'POST', '/api/suite/account/password': 'POST', '/api/suite/account/logout': 'POST', '/api/suite/admin/users': ['GET', 'PATCH'], '/api/suite/admin/invitations': 'POST', '/api/suite/admin/native-users': 'GET', '/api/suite/admin/grants': ['PUT', 'DELETE'], '/api/suite/admin/backup': 'POST', '/api/suite/organizations': 'GET', '/api/suite/organization/overview': 'POST', '/api/suite/organization/user/save': 'POST' };
        if (!methods[route]) return false;
        if (![methods[route]].flat().includes(req.method)) throw new ServiceError(405, 'method_not_allowed');
        if (route !== '/api/suite/admin/native-users' && parsed.search) throw new ServiceError(400, 'invalid_input');
        if (req.method !== 'GET') await broker.verifyCsrf(req);
        const body = req.method === 'GET' ? null : await jsonBody(req);
        if (route === '/api/suite/setup') {
          const user = await broker.credentialWork(req, String(body.email ?? ''), () => identityStore.bootstrap(body.setupToken, body));
          for (const appId of (organizationStore ? [] : staticApps)) identityStore.grantAppAccess({ userId: user.id, appId, localUserId: user.id });
          await identity.establishSession(req, res, user.id); send(res, 201, { authenticated: true, user: userView(user) });
        } else if (route === '/api/suite/invitations/accept') {
          const user = await broker.credentialWork(req, 'accept-invitation', () => identityStore.acceptInvitation(body.token, body));
          await identity.establishSession(req, res, user.id); send(res, 201, { authenticated: true, user: userView(user) });
        } else if (route === '/api/suite/account/login') {
          const parent = await broker.authenticateCredentials(req, res, body);
          if (!parent) throw new ServiceError(401, 'invalid_credentials');
          send(res, 200, { authenticated: true, user: userView(identityStore.getUser(parent.subject)) });
        } else {
          const { parent, user } = await authenticated(req, route.startsWith('/api/suite/admin/'));
          if (route === '/api/suite/account') send(res, 200, account(user));
          else if (route === '/api/suite/organizations') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            send(res,200,{organizations:organizationStore.organizationsFor(user.id)});
          }
          else if (route === '/api/suite/organization/overview') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            send(res,200,organizationStore.overview(body.organizationId,user.id));
          }
          else if (route === '/api/suite/organization/user/save') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            const target = identityStore.getUser(body.member?.accountId);
            if (!target || target.state !== 'active' || target.email !== String(body.member.email||'').trim().toLowerCase())
              throw new ServiceError(400,'invalid_input');
            // Do not create a central identity or match native accounts based only on e-mail.
            // Only already verified, active account subjects can receive Workspace roles.
            const saved = organizationStore.saveMember({organizationId:body.organizationId,actorId:user.id,member:body.member});
            await authenticated(req);
            send(res,200,{user:saved});
          }
          else if (route === '/api/suite/account/logout') { await identity.logout(parent.id); identity.clearCookie(res); send(res, 200, { authenticated: false, loggedOut: true }); }
          else if (route === '/api/suite/account/password') {
            await broker.credentialWork(req, user.email, async () => {
              const verified = await identityStore.verifyCredentials({ email: user.email, password: body.currentPassword });
              if (!verified || verified.id !== user.id || !identityStore.getParentSession(parent.id)) throw new ServiceError(401, 'invalid_credentials');
              await identityStore.setPassword(user.id, body.newPassword, { requireSessionId: parent.id }); return true;
            });
            await identity.establishSession(req, res, user.id); send(res, 200, { changed: true });
          } else if (route === '/api/suite/admin/users' && req.method === 'GET') send(res, 200, { users: identityStore.listUsers().map(value => ({ ...userView(value), grants: identityStore.listAppGrants(value.id) })) });
          else if (route === '/api/suite/admin/users') { const changed = identityStore.setUserState(body.userId, body.state); send(res, 200, { user: userView(changed) }); }
          else if (route === '/api/suite/admin/native-users') {
            if (parsed.searchParams.getAll('app').length !== 1 || [...parsed.searchParams.keys()].some(key => key !== 'app')) throw new ServiceError(400, 'invalid_input');
            const users = await roster(parsed.searchParams.get('app'));
            await authenticated(req, true);
            send(res, 200, { users });
          } else if (route === '/api/suite/admin/invitations') {
            const appIds = body.appIds ?? [];
            if(organizationStore && appIds.length) throw new ServiceError(403,'access_denied');
            if (!Array.isArray(appIds) || new Set(appIds).size !== appIds.length || appIds.some(appId => !staticApps.has(appId))) throw new ServiceError(400, 'invalid_input');
            // Reserve UUID first so static account grants refer to the invite's
            // eventual stable subject, never an email or a native app account.
            const inviteUserId = randomUUID();
            const invite = identityStore.issueInvitation({ userId: inviteUserId, inviterUserId: user.id, email: body.email, displayName: body.displayName, appGrants: appIds.map(appId => ({ appId, localUserId: inviteUserId })) });
            const invitation = new URL('/invite', origin); invitation.searchParams.set('token', invite.token);
            send(res, 201, { invitationUrl: invitation.href, expiresAt: invite.expiresAt });
          } else if (route === '/api/suite/admin/grants') {
            // Workspace assignments reserve seats but cannot be taken as a native-account mapping.
            // Until native mapping is verified, forbid all manual app grants in org mode.
            if (organizationStore) throw new ServiceError(403,'access_denied');
            const target = identityStore.getUser(body.userId);
            if (!target || !APP_NAMES[body.appId]) throw new ServiceError(400, 'invalid_input');
            if (req.method === 'DELETE') identityStore.revokeAppAccess(target.id, body.appId);
            else {
              if (staticApps.has(body.appId)) {
                if (body.localUserId !== target.id || body.organizationId !== undefined) throw new ServiceError(400, 'invalid_input');
              } else {
                const candidates = await roster(body.appId);
                await authenticated(req, true);
                if (!candidates.some(row => row.id === body.localUserId && row.organizationId === body.organizationId)) throw new ServiceError(400, 'invalid_input');
              }
              identityStore.grantAppAccess({ userId: target.id, appId: body.appId, localUserId: body.localUserId, ...(body.organizationId !== undefined ? { organizationId: body.organizationId } : {}) });
            }
            send(res, 200, { grants: identityStore.listAppGrants(target.id) });
          } else if (route === '/api/suite/admin/backup') send(res, 200, identityStore.exportPortable({ includePasswordHashes: true }), { 'Content-Disposition': 'attachment; filename="celluloid-local-accounts.json"' });
        }
        return true;
      } catch (error) { errorResponse(res, error); return true; }
    },
  });
}
