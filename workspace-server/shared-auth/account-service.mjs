import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthBroker } from './broker.mjs';
import { createLocalIdentityAdapter, IdentityStoreError } from './identity-store.mjs';
import { OrganizationError } from '../organization-store.mjs';
import {OWNER_SUPPORT,SECURITY_SENDER} from '../communications-store.mjs';
import {authorizedContentDestination} from '../private-content-launch.mjs';
import {mentionHandleForUser} from '../message-references.mjs';

const APP_NAMES = Object.freeze({ goflo: 'CytoDuck', eel: 'DuckNote', methpipe: 'DuckPipe', mantrain: 'DuckTrain', duckman: 'DuckMan', limsman: 'LabDuck' });
const STATIC_APPS = new Set(['goflo', 'methpipe', 'mantrain']);
// Each native app must have an explicit private client origin; retired domains are not fallbacks.
const FILES = new Set(['index.html', 'login.css', 'app.js', 'app-registry.mjs', 'auth-client.mjs', 'config.mjs', 'admin.html', 'admin.js', 'admin.css', 'workspace.html', 'workspace.css', 'workspace.js', 'owner.html', 'owner.js', 'communications.html', 'communications.js', 'communications.css', 'communications-launchers.js', ...Object.keys(APP_NAMES).map(id => `assets/${id}.svg`), 'assets/favicon.svg']);
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
export function createAccountService({ origin, issuer = origin, clients, identityStore, authStore, assetRoot, organizationStore = null, communicationsStore = null, resolveContentResource = null, invitationMailer = null, stripeTestCheckout = null, stripeTestReconciler = null, ownerAccountId = null, ownerAlertsConfigured = false, clock = Date.now, buildVersion = 'local', getClientAddress, fetchImpl = globalThis.fetch }) {
  if(ownerAccountId!==null&&!safeId(ownerAccountId))throw new Error('Invalid private owner account ID');
  const isOwner=user=>Boolean(ownerAccountId&&user?.id===ownerAccountId&&user.role==='admin'&&user.state==='active');
  const communicationsEnabled=Boolean(organizationStore&&communicationsStore);
  const membershipActive=id=>Boolean(organizationStore?.organizationsFor(id).length);
  const canCommunicate=user=>Boolean(communicationsEnabled&&(isOwner(user)||membershipActive(user.id)));
  function checkRecipient(id){
    const target=identityStore.getUser(id);
    if(!target||target.state!=='active'||(!isOwner(target)&&!membershipActive(target.id)))
      throw new ServiceError(400,'recipient_unavailable');
    return target;
  }
  // Return a conservative UI capability; the POST route retains its own
  // independent recipient and owner checks on every send.
  function canSendDirectChat(user,peerId){
    if(peerId===user.id||peerId===SECURITY_SENDER||
       (peerId===ownerAccountId&&!isOwner(user)))return false;
    const peer=identityStore.getUser(peerId);
    return Boolean(peer&&peer.state==='active'&&
      (isOwner(peer)||membershipActive(peer.id)));
  }
  function groupAction(work){
    try{return work();}
    catch(error){
      if(['group_access_denied','owner_chat_forbidden'].includes(error.message))
        throw new ServiceError(403,'access_denied');
      if(error.message==='message_conflict')throw new ServiceError(409,'message_conflict');
      if(error.message==='message_rate_limited')throw new ServiceError(429,'rate_limited');
      throw new ServiceError(400,'invalid_group');
    }
  }
  function displayContact(id){
    if(id===SECURITY_SENDER)return {accountId:id,displayName:'DuckBio Security',system:true};
    const row=identityStore.getUser(id);
    return row?{accountId:id,displayName:row.displayName}: {accountId:id,displayName:'Former user'};
  }
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
    return { user: userView(user), apps: Object.entries(APP_NAMES).map(([id, name]) => ({ id, name, nativeIdentity: nativeApps.has(id), enabled: Boolean(identityStore.getAccess(user.id, id)) })), admin: user.role === 'admin',ownerPanel:isOwner(user),communicationsEnabled };
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
    else if (['/owner','/owner/','/owner/index.html'].includes(pathname)) file = 'owner.html';
    else if (['/messages','/messages/','/messages/index.html'].includes(pathname)) file = 'communications.html';
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
      status = ['access_denied','invalid_invitation'].includes(code) ? 403
        : ['app_seats_exhausted','last_organization_admin','duplicate_organization_email','organization_locked','app_access_required','invitation_exists','member_exists','checkout_started','checkout_price_changed','checkout_conflict','reconciliation_superseded','stripe_test_subscription_conflict','stripe_test_invoice_conflict'].includes(code) ? 409
        : 400;
      if (!['access_denied','app_seats_exhausted','last_organization_admin','duplicate_organization_email','organization_locked','app_access_required','invitation_exists','member_exists','member_not_found','invalid_invitation','invalid_subscription','subscription_not_found','invalid_permission','invalid_roles','invalid_member','checkout_started','checkout_price_changed','checkout_conflict','invalid_checkout','checkout_not_found','reconciliation_superseded','invalid_reconciliation','reconciliation_limit','stripe_test_subscription_conflict','stripe_test_invoice_conflict'].includes(code)) code = 'invalid_input';
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
        if(route.startsWith('/content/')){
          if(req.method!=='GET'&&req.method!=='HEAD')throw new ServiceError(405,'method_not_allowed');
          if(parsed.search||parsed.hash)throw new ServiceError(400,'invalid_input');
          const contentId=route.slice('/content/'.length);
          if(!/^(?:ld|dm|dn|cd|md|dt)[0-9]{6,}$/.test(contentId))
            throw new ServiceError(404,'not_found');
          const parent=await identity.getSession(req);
          const user=parent?identityStore.getUser(parent.subject):null;
          if(!parent||user?.state!=='active'){
            // Authentication is required before revealing native resource location.
            res.writeHead(303,{'Location':'/workspace?content='+contentId,'Cache-Control':'private, no-store',
              'Referrer-Policy':'no-referrer'});res.end();return true;
          }
          const destination=await authorizedContentDestination({
            contentId,viewerId:user.id,resolveResource:resolveContentResource,
            clients,organizationStore});
          if(!destination)throw new ServiceError(404,'not_found');
          res.writeHead(303,{'Location':destination,'Cache-Control':'private, no-store',
            'Referrer-Policy':'no-referrer'});res.end();return true;
        }
        if (!route.startsWith('/api/suite/')) return staticFile(req, res, route);
        const methods = { '/api/suite/account': 'GET', '/api/suite/account/login': 'POST', '/api/suite/setup': 'POST', '/api/suite/invitations/accept': 'POST', '/api/suite/account/password': 'POST', '/api/suite/account/logout': 'POST', '/api/suite/admin/users': ['GET', 'PATCH'], '/api/suite/admin/invitations': 'POST', '/api/suite/admin/native-users': 'GET', '/api/suite/admin/grants': ['PUT', 'DELETE'], '/api/suite/admin/backup': 'POST', '/api/suite/owner/overview': 'GET', '/api/suite/communications/self': 'GET', '/api/suite/communications/contacts': 'GET', '/api/suite/communications/search': 'POST', '/api/suite/communications/threads': 'GET', '/api/suite/communications/chat/history': 'POST', '/api/suite/communications/chat/send': 'POST', '/api/suite/communications/chat/read': 'POST', '/api/suite/communications/notifications': 'GET', '/api/suite/communications/notification/read': 'POST', '/api/suite/communications/unread': 'GET', '/api/suite/communications/mentions': 'GET', '/api/suite/communications/mention/read': 'POST', '/api/suite/communications/groups': 'GET', '/api/suite/communications/group/create': 'POST', '/api/suite/communications/group/members': 'POST', '/api/suite/communications/group/history': 'POST', '/api/suite/communications/group/send': 'POST', '/api/suite/communications/group/read': 'POST', '/api/suite/communications/mail/inbox': 'GET', '/api/suite/communications/mail/sent': 'GET', '/api/suite/communications/mail/send': 'POST', '/api/suite/communications/mail/read': 'POST', '/api/suite/organizations': 'GET', '/api/suite/organization/select': 'POST', '/api/suite/organization/overview': 'POST', '/api/suite/organization/audit': 'POST', '/api/suite/organization/matrix': 'POST', '/api/suite/organization/permission/set': 'POST', '/api/suite/organization/user/save': 'POST', '/api/suite/organization/user/remove': 'POST', '/api/suite/organization/user/active': 'POST', '/api/suite/organization/invite': 'POST', '/api/suite/organization/invite/list': 'POST', '/api/suite/organization/invite/revoke': 'POST', '/api/suite/organization/invite/preview': 'GET', '/api/suite/organization/invite/accept': 'POST', '/api/suite/organization/subscriptions': 'POST', '/api/suite/organization/subscription/draft': 'POST', '/api/suite/organization/subscription/cancel': 'POST', '/api/suite/organization/subscription/test-checkout': 'POST', '/api/suite/organization/subscription/test-reconcile': 'POST', '/api/suite/organization/subscription/test-history': 'POST' };
        if (!methods[route]) return false;
        if (![methods[route]].flat().includes(req.method)) throw new ServiceError(405, 'method_not_allowed');
        if (!['/api/suite/admin/native-users','/api/suite/organization/invite/preview'].includes(route) && parsed.search) throw new ServiceError(400, 'invalid_input');
        if (req.method !== 'GET') await broker.verifyCsrf(req);
        const body = req.method === 'GET' ? null : await jsonBody(req);
        if (route === '/api/suite/organization/invite/preview') {
          if(!organizationStore || parsed.searchParams.getAll('token').length!==1 || [...parsed.searchParams.keys()].some(x=>x!=='token'))throw new ServiceError(400,'invalid_input');
          const invite=organizationStore.previewInvitation(parsed.searchParams.get('token'));
          if(!invite)throw new ServiceError(403,'invalid_invitation');
          send(res,200,{invitation:invite});
        } else if (route === '/api/suite/organization/invite/accept') {
          if(!organizationStore)throw new ServiceError(503,'unavailable');
          const invite=organizationStore.previewInvitation(body.token);
          if(!invite)throw new ServiceError(403,'invalid_invitation');
          const existingSession=await identity.getSession(req);
          const existing=existingSession?identityStore.getUser(existingSession.subject):null;
          if(existing && (existing.state!=='active'||existing.email!==invite.email))throw new ServiceError(403,'access_denied');
          if(existing && organizationStore.currentSessionOrganization({sessionId:existingSession.id,accountId:existing.id}))throw new ServiceError(409,'organization_locked');
          if(!existing && identityStore.findUserByEmail(invite.email))throw new ServiceError(409,'login_required');
          // A new central account has no app grants. An existing central account keeps its identity.
          // A failed organization binding leaves an account without access, never an app privilege.
          const account=existing||await broker.credentialWork(req,invite.email,
            ()=>identityStore.createUser({email:invite.email,displayName:invite.name,password:body.password}));
          const assigned=organizationStore.acceptInvitation({token:body.token,accountId:account.id,email:account.email});
          await identity.establishSession(req,res,account.id);
          send(res,201,{account:userView(account),organization:assigned});
        } else if (route === '/api/suite/setup') {
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
          const { parent, user } = await authenticated(req, route.startsWith('/api/suite/admin/') || route.startsWith('/api/suite/owner/'));
          if(route.startsWith('/api/suite/owner/')&&(!organizationStore||!isOwner(user)))throw new ServiceError(403,'access_denied');
          if (organizationStore && route.startsWith('/api/suite/admin/')) throw new ServiceError(403,'access_denied');
          const selected = () => organizationStore?.currentSessionOrganization({sessionId:parent.id,accountId:user.id});
          const requireSelection = organizationId => {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            const active = selected();
            if (!active || active.id !== organizationId || !active.admin) throw new ServiceError(403,'access_denied');
          };
          if (route.startsWith('/api/suite/communications/')&&!canCommunicate(user))
            throw new ServiceError(403,'access_denied');
          if (route === '/api/suite/account') send(res, 200, account(user));
          else if (route === '/api/suite/communications/self') {
            send(res,200,{address:communicationsStore.addressFor(user.id),
              owner:isOwner(user),supportAddress:OWNER_SUPPORT,
              billingAddress:isOwner(user)?communicationsStore.ownerAddresses()?.billing:null,
              realtime:'polling',mailTransport:'internal_only'});
          }
          else if (route === '/api/suite/communications/contacts') {
            const rows=organizationStore.activeContactBook(user.id).filter(x=>x.accountId!==ownerAccountId);
            send(res,200,{contacts:rows.filter(x=>identityStore.getUser(x.accountId)?.state==='active')
              .map(x=>({...x,address:communicationsStore.addressFor(x.accountId),
                mention:'@'+mentionHandleForUser(x.accountId)})),
              ownerHidden:true});
          }
          else if (route === '/api/suite/communications/search') {
            if(typeof body.query!=='string'||body.query.trim().length<2||
               body.query.length>80)throw new ServiceError(400,'invalid_input');
            const q=body.query.trim().toLowerCase();
            const results=[];
            for(const person of identityStore.listUsers()){
              if(results.length===20)break;
              if(person.id===user.id||person.id===ownerAccountId||
                 person.state!=='active'||!membershipActive(person.id))continue;
              if(person.displayName.toLowerCase().includes(q)||communicationsStore.addressFor(person.id).includes(q))
                results.push({...displayContact(person.id),
                  address:communicationsStore.addressFor(person.id),
                  mention:'@'+mentionHandleForUser(person.id)});
            }
            send(res,200,{results,ownerExcluded:true});
          }
          else if (route === '/api/suite/communications/threads') {
            const threads=communicationsStore.chatThreads(user.id).map(x=>({
              ...x,peer:displayContact(x.peerId),canSend:canSendDirectChat(user,x.peerId)}));
            send(res,200,{threads});
          }
          else if (route === '/api/suite/communications/chat/history') {
            if(!safeId(body.peerId)||(body.peerId===SECURITY_SENDER&&!isOwner(user)))
              throw new ServiceError(403,'access_denied');
            // Historic conversations can be read after a recipient is disabled.
            send(res,200,{messages:communicationsStore.chatHistory(user.id,body.peerId),
              peer:displayContact(body.peerId),canSend:canSendDirectChat(user,body.peerId)});
          }
          else if (route === '/api/suite/communications/chat/send') {
            checkRecipient(body.recipientId);
            if(body.recipientId===ownerAccountId&&!isOwner(user))
              throw new ServiceError(403,'owner_chat_forbidden');
            const message=communicationsStore.sendChat({
              senderId:user.id,recipientId:body.recipientId,
              body:body.body,clientId:body.clientId});
            send(res,201,{message});
          }
          else if (route === '/api/suite/communications/chat/read') {
            if(!safeId(body.peerId))throw new ServiceError(400,'invalid_input');
            if(body.peerId===SECURITY_SENDER&&!isOwner(user))
              throw new ServiceError(403,'access_denied');
            send(res,200,{marked:communicationsStore.markChatRead(user.id,body.peerId)});
          }
          else if (route === '/api/suite/communications/unread') {
            send(res,200,{counts:communicationsStore.unreadCounts(user.id)});
          }
          else if (route === '/api/suite/communications/notifications') {
            const items=communicationsStore.notifications(user.id);
            send(res,200,{notifications:items.map(x=>({...x,
              sender:displayContact(x.senderId)}))});
          }
          else if (route === '/api/suite/communications/notification/read') {
            if(!safeId(body.notificationId))throw new ServiceError(400,'invalid_input');
            send(res,200,communicationsStore.markNotificationRead(user.id,body.notificationId));
          }
          else if (route === '/api/suite/communications/mentions') {
            const mentions=communicationsStore.mentionInbox(user.id);
            send(res,200,{mentions:mentions.map(x=>({...x,
              sender:displayContact(x.senderId)}))});
          }
          else if (route === '/api/suite/communications/mention/read') {
            if(!safeId(body.notificationId))throw new ServiceError(400,'invalid_input');
            send(res,200,communicationsStore.markMentionRead(user.id,body.notificationId));
          }
          else if (route === '/api/suite/communications/groups') {
            send(res,200,{groups:communicationsStore.groupsFor(user.id)});
          }
          else if (route === '/api/suite/communications/group/create') {
            if(!Array.isArray(body.memberIds)||body.memberIds.length<2||
               body.memberIds.length>29||new Set(body.memberIds).size!==body.memberIds.length||
               body.memberIds.includes(user.id))throw new ServiceError(400,'invalid_group');
            for(const id of body.memberIds)checkRecipient(id);
            if(body.kind==='chat'&&body.memberIds.includes(ownerAccountId)&&!isOwner(user))
              throw new ServiceError(403,'access_denied');
            const group=groupAction(()=>communicationsStore.createGroup({
              creatorId:user.id,memberIds:body.memberIds,kind:body.kind,
              title:body.title,clientId:body.clientId}));
            send(res,201,{group});
          }
          else if (route === '/api/suite/communications/group/members') {
            const members=groupAction(()=>communicationsStore.groupMembers({
              groupId:body.groupId,actorId:user.id}));
            const group=groupAction(()=>communicationsStore.groupHistory({
              groupId:body.groupId,actorId:user.id})).group;
            send(res,200,{members:members.map(id=>({
              ...displayContact(id),mention:'@'+mentionHandleForUser(id)})),
              canSend:group.kind!=='chat'||isOwner(user)||!members.includes(ownerAccountId)});
          }
          else if (route === '/api/suite/communications/group/history') {
            const history=groupAction(()=>communicationsStore.groupHistory({
              groupId:body.groupId,actorId:user.id}));
            send(res,200,history);
          }
          else if (route === '/api/suite/communications/group/send') {
            const result=groupAction(()=>communicationsStore.sendGroup({
              groupId:body.groupId,senderId:user.id,
              body:body.body,subject:body.subject??null,clientId:body.clientId}));
            send(res,201,{message:result});
          }
          else if (route === '/api/suite/communications/group/read') {
            const result=groupAction(()=>communicationsStore.markGroupRead({
              groupId:body.groupId,actorId:user.id,messageId:body.messageId}));
            send(res,200,result);
          }
          else if (route === '/api/suite/communications/mail/inbox')
            send(res,200,{messages:communicationsStore.listMail(user.id,'inbox')});
          else if (route === '/api/suite/communications/mail/sent')
            send(res,200,{messages:communicationsStore.listMail(user.id,'sent')});
          else if (route === '/api/suite/communications/mail/send') {
            const destination=communicationsStore.resolveAddress(body.to);
            if(!destination||destination.alias==='billing@duckbio.internal')
              throw new ServiceError(400,'recipient_unavailable');
            checkRecipient(destination.accountId);
            if(destination.accountId===ownerAccountId&&destination.alias!==OWNER_SUPPORT)
              throw new ServiceError(403,'access_denied');
            const message=communicationsStore.sendMail({
              senderId:user.id,recipientId:destination.accountId,
              toAddress:body.to,subject:body.subject,body:body.body,
              clientId:body.clientId});
            send(res,201,{message});
          }
          else if (route === '/api/suite/communications/mail/read') {
            if(!safeId(body.id))throw new ServiceError(400,'invalid_input');
            send(res,200,{marked:communicationsStore.markMailRead(user.id,body.id)});
          }
          else if (route === '/api/suite/owner/overview') {
            send(res,200,{ownerOnly:true,ownerAlertsConfigured:Boolean(ownerAlertsConfigured),summary:organizationStore.ownerSnapshot(),
              identities:identityStore.listUsers().map(row=>({id:row.id,email:row.email,
                displayName:row.displayName,state:row.state,centralAdmin:row.role==='admin'}))});
          }
          else if (route === '/api/suite/organizations') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            send(res,200,{organizations:organizationStore.organizationsFor(user.id),selectedOrganization:selected()});
          }
          else if (route === '/api/suite/organization/select') {
            if(!organizationStore)throw new ServiceError(503,'unavailable');
            const binding=organizationStore.selectSessionOrganization({sessionId:parent.id,accountId:user.id,organizationId:body.organizationId});
            send(res,200,{selectedOrganization:selected(),alreadySelected:binding.alreadySelected});
          }
          else if (route === '/api/suite/organization/overview') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            requireSelection(body.organizationId);
            send(res,200,organizationStore.overview(body.organizationId,user.id));
          }
          else if (route === '/api/suite/organization/audit') {
            requireSelection(body.organizationId);
            send(res,200,{events:organizationStore.auditLog(body.organizationId,user.id)});
          }
          else if (route === '/api/suite/organization/subscriptions') {
            requireSelection(body.organizationId);
            send(res,200,{drafts:organizationStore.listSubscriptionDrafts(body.organizationId,user.id),testCheckoutEnabled:Boolean(stripeTestCheckout),testReconciliationEnabled:Boolean(stripeTestReconciler),testSeatCapacity:stripeTestReconciler?organizationStore.testSeatCapacity(body.organizationId,user.id):null,testSeatImpact:stripeTestReconciler?organizationStore.testSeatImpact(body.organizationId,user.id):null,testEntitlementPlan:stripeTestReconciler?organizationStore.testSubscriptionEntitlementPlan(body.organizationId,user.id):null,testEntitlementReadiness:stripeTestReconciler?organizationStore.testEntitlementReadiness(body.organizationId,user.id):null});
          }
          else if (route === '/api/suite/organization/subscription/draft') {
            requireSelection(body.organizationId);
            const draft=organizationStore.createSubscriptionDraft({...body,actorId:user.id});
            send(res,201,{draft});
          }
          else if (route === '/api/suite/organization/subscription/test-checkout') {
            requireSelection(body.organizationId);
            if(!stripeTestCheckout)throw new ServiceError(503,'checkout_unavailable');
            const draft=organizationStore.listSubscriptionDrafts(body.organizationId,user.id).find(x=>x.id===body.draftId&&x.status==='draft');
            if(!draft)throw new ServiceError(400,'invalid_checkout');
            const price=stripeTestCheckout.priceFor(draft);
            if(!price)throw new ServiceError(503,'checkout_price_unconfigured');
            const intent=organizationStore.prepareTestCheckout({organizationId:body.organizationId,actorId:user.id,draftId:draft.id,price});
            if(intent.checkout)send(res,200,{checkoutUrl:intent.checkout.url,mode:'test',licensesGranted:false});
            else{
              let session;
              try{session=await stripeTestCheckout.createSession(intent);}
              catch{throw new ServiceError(503,'checkout_unavailable');}
              requireSelection(body.organizationId);
              const saved=organizationStore.completeTestCheckout({organizationId:body.organizationId,actorId:user.id,draftId:draft.id,session});
              send(res,200,{checkoutUrl:saved.url,mode:'test',licensesGranted:false});
            }
          }
          else if (route === '/api/suite/organization/subscription/test-reconcile') {
            requireSelection(body.organizationId);
            if(!stripeTestReconciler)throw new ServiceError(503,'reconciliation_unavailable');
            const started=organizationStore.beginTestReconciliation({
              organizationId:body.organizationId,actorId:user.id,draftId:body.draftId});
            let result,failed=false;
            try{result=await stripeTestReconciler.inspect(started.snapshot);}
            catch{failed=true;result={state:'unavailable',licensesGranted:false};}
            // Never commit the result of an asynchronous read unless the original
            // session and the selected organization still belong to the same admin.
            const current=await authenticated(req);
            if(current.user.id!==user.id||current.parent.id!==parent.id)
              throw new ServiceError(403,'access_denied');
            requireSelection(body.organizationId);
            const observed=organizationStore.finishTestReconciliation({
              organizationId:body.organizationId,actorId:user.id,draftId:body.draftId,
              attempt:started.attempt,result});
            if(failed)throw new ServiceError(503,'reconciliation_unavailable');
            send(res,200,{reconciliation:result,observation:observed,mode:'test',licensesGranted:false});
          }
          else if (route === '/api/suite/organization/subscription/test-history') {
            requireSelection(body.organizationId);
            if(!stripeTestReconciler)throw new ServiceError(503,'reconciliation_unavailable');
            send(res,200,{history:organizationStore.testReconciliationHistory({
              organizationId:body.organizationId,actorId:user.id,draftId:body.draftId}),
              mode:'test',licensesGranted:false});
          }
          else if (route === '/api/suite/organization/subscription/cancel') {
            requireSelection(body.organizationId);
            const result=organizationStore.cancelSubscriptionDraft({...body,actorId:user.id});
            send(res,200,result);
          }
          else if (route === '/api/suite/organization/invite/list') {
            requireSelection(body.organizationId);
            send(res,200,{invitations:organizationStore.listPendingInvitations(body.organizationId,user.id)});
          }
          else if (route === '/api/suite/organization/invite/revoke') {
            requireSelection(body.organizationId);
            send(res,200,organizationStore.revokeInvitation({organizationId:body.organizationId,actorId:user.id,email:body.email}));
          }
          else if (route === '/api/suite/organization/invite') {
            requireSelection(body.organizationId);
            const issued=organizationStore.issueInvitation({organizationId:body.organizationId,actorId:user.id,email:body.email,name:body.name,nickname:body.nickname,admin:body.admin===true,roles:body.roles??{}});
            const inviteUrl=new URL('/workspace',origin);inviteUrl.searchParams.set('invite',issued.token);
            if(invitationMailer){
              try{
                const invite=organizationStore.previewInvitation(issued.token);
                await invitationMailer.sendInvitation({email:invite.email,name:invite.name,organizationName:invite.organizationName,invitationUrl:inviteUrl.href,expiresAt:issued.expiresAt});
              }catch{
                // If provider confirmation fails, revoke the pending secret and release seats.
                // On an ambiguous timeout a delivered email may have an unusable link;
                // a fresh invitation must then be issued by the administrator.
                organizationStore.revokeInvitation({organizationId:body.organizationId,actorId:user.id,email:body.email});
                throw new ServiceError(503,'email_unavailable');
              }
              send(res,201,{delivery:'email',expiresAt:issued.expiresAt});
            }else send(res,201,{delivery:'manual',invitationUrl:inviteUrl.href,expiresAt:issued.expiresAt});
          }
          else if (route === '/api/suite/organization/user/active') {
            requireSelection(body.organizationId);
            const updated=organizationStore.setMemberActive({...body,actorId:user.id});
            send(res,200,{user:updated});
          }
          else if (route === '/api/suite/organization/user/remove') {
            requireSelection(body.organizationId);
            const removed=organizationStore.removeMember({organizationId:body.organizationId,actorId:user.id,accountId:body.accountId});
            send(res,200,removed);
          }
          else if (route === '/api/suite/organization/matrix') {
            requireSelection(body.organizationId);
            send(res,200,organizationStore.matrix(body.organizationId,user.id));
          }
          else if (route === '/api/suite/organization/permission/set') {
            requireSelection(body.organizationId);
            const result=organizationStore.setPermission({...body,actorId:user.id});
            await authenticated(req);
            send(res,200,{permission:result});
          }
          else if (route === '/api/suite/organization/user/save') {
            if (!organizationStore) throw new ServiceError(503,'unavailable');
            requireSelection(body.organizationId);
            const target = identityStore.getUser(body.member?.accountId);
            if (!target || target.state !== 'active' || target.email !== String(body.member.email||'').trim().toLowerCase())
              throw new ServiceError(400,'invalid_input');
            // Do not create a central identity or match native accounts based only on e-mail.
            // Only already verified, active account subjects can receive Workspace roles.
            const saved = organizationStore.saveMember({organizationId:body.organizationId,actorId:user.id,member:body.member});
            await authenticated(req);
            send(res,200,{user:saved});
          }
          else if (route === '/api/suite/account/logout') { await identity.logout(parent.id); organizationStore?.clearSessionOrganization(parent.id); identity.clearCookie(res); send(res, 200, { authenticated: false, loggedOut: true }); }
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
