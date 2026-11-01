import http from 'node:http';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccountService } from './account-service.mjs';
import { createIdentityStore } from './identity-store.mjs';
import { createSqliteAuthStores } from './sqlite-store.mjs';
import { createOrganizationStore } from '../organization-store.mjs';
import { createResendInvitationMailer } from '../invitation-mailer.mjs';
import { createSharedAuthGateway, createProtectedStaticHandler } from './gateway.mjs';

function privatePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.split('/').includes('public_html') || (existsSync(value) && realpathSync(value).split('/').includes('public_html'))) throw new Error(`Private ${label} path required`);
  let ancestor = value;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  if (realpathSync(ancestor).split('/').includes('public_html')) throw new Error(`Private ${label} path required`);
  return value;
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function origins(value) {
  const result = typeof value === 'string' && value.trim().startsWith('[') ? JSON.parse(value) : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!Array.isArray(result) || !result.length) throw new Error('Explicit app origins required');
  return result;
}
function nativeUser(row) {
  const validText = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
  if (!row || !validText(row.id, 128) || !validText(row.email, 254) || !validText(row.display_name, 200) || !['admin', 'member'].includes(row.role)) return null;
  return { id: row.id, displayName: row.display_name, email: row.email, role: row.role };
}
function nativeClient(req, clientId, secret) {
  if (req.headers.origin !== undefined) return false;
  const supplied = req.headers.authorization;
  if (typeof supplied !== 'string' || supplied.length > 1024 || !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(supplied)) return false;
  const expected = Buffer.from(`${clientId}:${secret}`);
  const received = Buffer.from(supplied.slice(6), 'base64');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Standalone account service or private static app gateway. The same code and
 * account backup run on another Node server after DNS/origin configuration. */
export function createSuiteRuntime({ env = process.env, fetchImpl = globalThis.fetch, clock = Date.now } = {}) {
  let actual = env;
  if (env.SUITE_ENV_FILE) {
    const config = JSON.parse(readFileSync(privatePath(env.SUITE_ENV_FILE, 'configuration'), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.entries(config).some(([key, value]) => !/^SUITE_[A-Z0-9_]+$/.test(key) || typeof value !== 'string')) throw new Error('Invalid private suite configuration');
    actual = { ...env, ...config };
  }
  if (actual.SUITE_MODE === 'broker' && actual.NODE_ENV === 'production' && !actual.SUITE_ORGANIZATION_DB_PATH) throw new Error('A private organization database is required for production Workspace login');
  const buildVersion = String(actual.SUITE_BUILD_SHA || 'development');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(buildVersion)) throw new Error('Invalid reviewed build identity');
  const auth = createSqliteAuthStores({ databasePath: privatePath(actual.SUITE_AUTH_DB_PATH, 'session database'), clock });
  let identityStore; let nativeStore; let organizationStore; let requestHandler;
  try {
    if (actual.SUITE_MODE === 'broker') {
      identityStore = createIdentityStore({ databasePath: privatePath(actual.SUITE_IDENTITY_DB_PATH, 'identity database'), clock });
      if(actual.SUITE_ORGANIZATION_DB_PATH) organizationStore = createOrganizationStore({databasePath:privatePath(actual.SUITE_ORGANIZATION_DB_PATH,'organization database'),clock});
      if (actual.SUITE_SETUP_TOKEN) identityStore.configureBootstrapToken(actual.SUITE_SETUP_TOKEN, { expiresAt: clock() + 7 * 24 * 60 * 60_000 });
      const invitationMailer=(actual.SUITE_RESEND_API_KEY||actual.SUITE_INVITATION_FROM)
        ?createResendInvitationMailer({apiKey:actual.SUITE_RESEND_API_KEY,from:actual.SUITE_INVITATION_FROM,fetchImpl}):null;
      const service = createAccountService({ invitationMailer, origin: actual.SUITE_ORIGIN, issuer: actual.SUITE_ISSUER || actual.SUITE_ORIGIN, clients: JSON.parse(actual.SUITE_CLIENTS || 'null'), identityStore, organizationStore, authStore: auth.brokerStore, assetRoot: privatePath(actual.SUITE_ASSET_ROOT, 'login frontend'), buildVersion, clock, fetchImpl,
        // Passenger supplies the request socket; arbitrary forwarded headers do
        // not select limiter buckets. Account+address buckets isolate users.
        getClientAddress: req => req.socket.remoteAddress,
      });
      requestHandler = async (req, res) => { if (!await service.handle(req, res)) json(res, 404, { error: 'not_found' }); };
    } else if (actual.SUITE_MODE === 'static') {
      if (!['goflo', 'methpipe', 'mantrain'].includes(actual.SUITE_APP_ID)) throw new Error('Only reviewed static apps may use this runtime');
      const brokerOrigin = new URL(actual.SUITE_BROKER_ORIGIN);
      const issuer = actual.SUITE_ISSUER || brokerOrigin.origin;
      const basePath = actual.SUITE_BASE_PATH || '';
      const appOrigins = origins(actual.SUITE_APP_ORIGINS);
      const clientId = actual.SUITE_CLIENT_ID || actual.SUITE_APP_ID;
      if (actual.SUITE_NATIVE_DB_PATH !== undefined) {
        const databasePath = privatePath(actual.SUITE_NATIVE_DB_PATH, 'native account database');
        if (!existsSync(databasePath) || !statSync(databasePath).isFile()) throw new Error('An existing native account database is required');
        nativeStore = new DatabaseSync(databasePath, { readOnly: true });
        // Validate the existing schema without provisioning or changing it.
        nativeStore.prepare('SELECT id,email,display_name,role FROM accounts LIMIT 0').all();
      }
      const gateway = createSharedAuthGateway({ appId: actual.SUITE_APP_ID, issuer, appOrigins, sharedLoginUrl: new URL('/login/', brokerOrigin).href, basePath, store: auth.gatewayStore, fetchImpl, clock,
        broker: { clientId, clientSecret: actual.SUITE_CLIENT_SECRET, exchangeUrl: new URL('/api/suite/auth/exchange', brokerOrigin).href, introspectUrl: new URL('/api/suite/auth/introspect', brokerOrigin).href, revokeUrl: new URL('/api/suite/auth/revoke', brokerOrigin).href },
        resolveIdentity: async proof => {
          if (proof.localIdentity?.organizationId !== undefined) return null;
          if (nativeStore) return nativeUser(nativeStore.prepare('SELECT id,email,display_name,role FROM accounts WHERE id=?').get(proof.localIdentity.userId));
          return proof.localIdentity?.userId === proof.subject ? { id: proof.subject, displayName: proof.displayName, role: 'member' } : null;
        },
      });
      const staticHandler = createProtectedStaticHandler({ gateway, basePath, root: privatePath(actual.SUITE_FRONTEND_ROOT, 'app frontend'), htmlTransform: html => html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<meta name="suite-auth-base" content="${basePath}">`) });
      requestHandler = async (req, res) => {
        const pathname = String(req.url).split('?')[0];
        if (nativeStore && pathname === `${basePath}/api/suite/native-users`) {
          if (!appOrigins.some(origin => new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase())) { json(res, 400, { error: 'invalid_host' }); return; }
          if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'method_not_allowed' }); return; }
          if (!nativeClient(req, clientId, actual.SUITE_CLIENT_SECRET)) { json(res, 401, { error: 'invalid_client' }); return; }
          if (String(req.url).includes('?')) { json(res, 400, { error: 'invalid_input' }); return; }
          const rows = nativeStore.prepare('SELECT id,email,display_name,role FROM accounts ORDER BY id LIMIT 10001').all();
          const users = rows.map(nativeUser);
          if (users.length > 10000 || users.some(user => user === null)) { json(res, 503, { error: 'unavailable' }); return; }
          json(res, 200, { users }); return;
        }
        if (pathname === `${basePath}/api/suite/health` && req.method === 'GET') {
          if (!appOrigins.some(origin => new URL(origin).host === req.headers.host)) { json(res, 400, { error: 'invalid_host' }); return; }
          json(res, 200, { appId: actual.SUITE_APP_ID, status: 'ok', buildVersion }); return;
        }
        await staticHandler(req, res);
      };
    } else throw new Error('Explicit suite runtime mode required');
  } catch (error) { identityStore?.close(); organizationStore?.close(); nativeStore?.close(); auth.close(); throw error; }
  const server = http.createServer(async (req, res) => {
    try { await requestHandler(req, res); }
    catch { if (!res.headersSent) json(res, 503, { error: 'unavailable' }); else if (!res.writableEnded) res.end(); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 64;
  return Object.freeze({ server, close() { identityStore?.close(); organizationStore?.close(); nativeStore?.close(); auth.close(); } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createSuiteRuntime();
  runtime.server.listen(Number(process.env.PORT || 3000), '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => runtime.server.close(() => { runtime.close(); process.exit(0); }));
}
