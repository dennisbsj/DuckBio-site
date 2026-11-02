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
import { createOrganizationStore } from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';

async function fixture(t, { allNative = false, beforeRoster, invitationMailer = null, stripeTestCheckout = null, stripeTestReconciler = null, prebootstrapOwner = false, communications = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-service-'));
  const identityStore = createIdentityStore({ databasePath: path.join(directory, 'identity.sqlite') });
  const stores = createSqliteAuthStores({ databasePath: path.join(directory, 'auth.sqlite') });
  const organizationStore = createOrganizationStore({ databasePath: path.join(directory, 'private', 'org.sqlite') });
  let communicationsStore=null;
  const setupToken = randomBytes(32).toString('base64url');
  identityStore.configureBootstrapToken(setupToken);
  const ownerAccount=prebootstrapOwner?await identityStore.bootstrap(setupToken,{
    email:'owner@example.test',displayName:'DuckBio Owner',password:'Owner password 12345'}):null;
  if(communications)communicationsStore=createCommunicationsStore({databasePath:path.join(directory,'private','communications.sqlite'),ownerAccountId:ownerAccount?.id??null});
  writeFileSync(path.join(directory, 'index.html'), '<html><head></head><body>local accounts</body></html>');
  const clients = ['goflo', 'eel', 'methpipe', 'mantrain', 'duckman', 'limsman'].map(id => ({ id, appId: id, secret: randomBytes(32).toString('base64url'), redirectUris: [`https://${id}.celluloidconsulting.net/auth/callback`], nativeOrigin: (allNative || ['eel', 'duckman', 'limsman'].includes(id)) ? `https://${id}.celluloidconsulting.net` : undefined }));
  let service;
  const server = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const nativeCalls = [];
  service = createAccountService({ invitationMailer, stripeTestCheckout, stripeTestReconciler,communicationsStore,ownerAccountId:ownerAccount?.id??null, origin, issuer: 'https://login.celluloidconsulting.net', clients, identityStore, organizationStore, authStore: stores.brokerStore, assetRoot: directory, buildVersion: 'test-local-service', getClientAddress: req => req.socket.remoteAddress,
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
  t.after(async () => { await new Promise(resolve => server.close(resolve)); identityStore.close(); organizationStore.close(); communicationsStore?.close(); stores.close(); rmSync(directory, { recursive: true, force: true }); });
  function browser() {
    const cookies = new Map(); let csrf;
    async function call(route, body, method = body === undefined ? 'GET' : 'POST', includeCsrf = true) {
      const response = await fetch(origin + route, { method, redirect: 'manual', headers: { ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin, ...(csrf && includeCsrf ? { 'X-CSRF-Token': csrf } : {}) } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      for (const value of response.headers.getSetCookie()) { const [key, content] = value.split(';')[0].split('='); if (content) cookies.set(key, content); else cookies.delete(key); }
      return response;
    }
    return { call, async preflight() { const response = await call('/api/suite/auth/session'); const data = await response.json(); csrf = data.csrfToken; return data; } };
  }
  return { identityStore, organizationStore, communicationsStore, origin, setupToken, ownerAccount, nativeCalls, browser };
}


test('Workspace organization APIs require a live account, CSRF and organization administrator status',async t=>{
 const f=await fixture(t),admin=f.browser(),member=f.browser();
 await admin.preflight();await member.preflight();
 const unauth=await member.call('/api/suite/organizations');
 assert.equal(unauth.status,401);
 const setup=await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'});
 assert.equal(setup.status,201);
 const owner=(await setup.json()).user;
 assert.equal((await (await admin.call('/api/suite/account')).json()).apps.some(a=>a.enabled),false,'new org mode must not create bypass grants');
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Lab A',owner:{accountId:owner.id,name:'Owner',nickname:'O',email:'owner@example.test'}});
 assert.equal((await admin.call('/api/suite/organization/select',{organizationId:'org-a'})).status,200);
 const verified=f.organizationStore.applyVerifiedSeatPurchase({reference:'verified-event-1',organizationId:'org-a',plan:'Mixed',apps:['eel','limsman'],seats:1});
 assert.equal(verified.applied,true);
 const target=await f.identityStore.createUser({email:'worker@example.test',displayName:'Worker',password:'Worker password 12345'});
 const body={organizationId:'org-a',member:{accountId:target.id,name:'Worker',nickname:'W',email:'worker@example.test',admin:false,roles:{eel:'scientist',limsman:'QC'}}};
 assert.equal((await admin.call('/api/suite/organization/user/save',body,'POST',false)).status,403,'CSRF is required');
 const saved=await admin.call('/api/suite/organization/user/save',body);
 assert.equal(saved.status,200,await saved.text().catch(()=>'')); // response text is only for assertion diagnostics
 const groups=await (await admin.call('/api/suite/organizations')).json();
 assert.deepEqual(groups.organizations.map(x=>x.id),['org-a']);
 const overview=await (await admin.call('/api/suite/organization/overview',{organizationId:'org-a'})).json();
 assert.equal(overview.users.find(x=>x.accountId===target.id).roles.eel,'scientist');
 assert.equal(overview.apps.find(x=>x.id==='eel').assigned,1);
 assert.equal(overview.apps.find(x=>x.id==='eel').purchased,1);
 assert.equal((await admin.call('/api/suite/admin/grants',{userId:target.id,appId:'eel',localUserId:'native-eel-user'},'PUT')).status,403,'unverified native mapping cannot bypass org licensing');
 assert.equal((await admin.call('/api/suite/admin/invitations',{email:'external@example.test',displayName:'External',appIds:['goflo']})).status,403,'legacy invite cannot bypass app seats');
 const login=await member.call('/api/suite/account/login',{email:'worker@example.test',password:'Worker password 12345'});
 assert.equal(login.status,200);
 assert.equal((await member.call('/api/suite/organization/overview',{organizationId:'org-a'})).status,403,'ordinary members cannot view roster');
 assert.equal((await member.call('/api/suite/organization/user/save',{...body,member:{...body.member,roles:{eel:'owner'}}})).status,403);
 assert.deepEqual((await (await member.call('/api/suite/organizations')).json()).organizations.map(x=>x.id),['org-a']);
});

test('workspace API must reject absent paid seats, unknown identity, bad role and cross-tenant admin',async t=>{
 const f=await fixture(t),admin=f.browser();
 await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'A',owner:{accountId:owner.id,name:'Owner',nickname:'O',email:'owner@example.test'}});
 f.organizationStore.setupOrganization({organizationId:'org-b',name:'B',owner:{accountId:'other-account',name:'Else',nickname:'E',email:'else@example.test'}});
 assert.equal((await admin.call('/api/suite/organization/select',{organizationId:'org-a'})).status,200);
 const target=await f.identityStore.createUser({email:'worker@example.test',displayName:'Worker',password:'Worker password 12345'});
 const request={organizationId:'org-a',member:{accountId:target.id,name:'Worker',nickname:'W',email:'worker@example.test',admin:false,roles:{eel:'scientist'}}};
 assert.equal((await admin.call('/api/suite/organization/user/save',request)).status,409,'no purchased seats');
 assert.equal((await admin.call('/api/suite/organization/user/save',{...request,organizationId:'org-b'})).status,403,'no cross-tenant writes');
 assert.equal((await admin.call('/api/suite/organization/user/save',{...request,member:{...request.member,email:'other@example.test'}})).status,400,'email must match authenticated central account');
 assert.equal((await admin.call('/api/suite/organization/user/save',{...request,member:{...request.member,accountId:'missing'}})).status,400,'unknown central subject cannot gain roles');
 assert.equal((await f.organizationStore.overview('org-a',owner.id)).users.length,1);
});

test('multi-organization login choice is bound to one session until logout and supports independent next login',async t=>{
 const f=await fixture(t),client=f.browser();
 await client.preflight();
 const setup=await client.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'});
 const owner=(await setup.json()).user;
 for(const [id,name] of [['alpha','Alpha'],['beta','Beta']])f.organizationStore.setupOrganization({organizationId:id,name,owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 const initial=await (await client.call('/api/suite/organizations')).json();
 assert.equal(initial.organizations.length,2);
 assert.equal(initial.selectedOrganization,null);
 assert.equal((await client.call('/api/suite/organization/overview',{organizationId:'alpha'})).status,403);
 assert.equal((await client.call('/api/suite/organization/select',{organizationId:'alpha'},'POST',false)).status,403,'CSRF binding required');
 assert.equal((await client.call('/api/suite/organization/select',{organizationId:'alpha'})).status,200);
 assert.equal((await client.call('/api/suite/organization/select',{organizationId:'alpha'})).status,200,'idempotent reselect');
 assert.equal((await client.call('/api/suite/organization/overview',{organizationId:'alpha'})).status,200);
 assert.equal((await client.call('/api/suite/organization/overview',{organizationId:'beta'})).status,403);
 assert.equal((await client.call('/api/suite/organization/select',{organizationId:'beta'})).status,409,'cannot switch before logout');
 assert.equal((await (await client.call('/api/suite/organizations')).json()).selectedOrganization.id,'alpha');
 assert.equal((await client.call('/api/suite/account/logout',{})).status,200);
 const login=await client.call('/api/suite/account/login',{email:'owner@example.test',password:'Owner password 12345'});
 assert.equal(login.status,200);
 assert.equal((await (await client.call('/api/suite/organizations')).json()).selectedOrganization,null);
 assert.equal((await client.call('/api/suite/organization/select',{organizationId:'beta'})).status,200);
 assert.equal((await client.call('/api/suite/organization/overview',{organizationId:'beta'})).status,200);
 assert.equal((await client.call('/api/suite/organization/overview',{organizationId:'alpha'})).status,403);
 assert.equal((await client.call('/api/suite/admin/users')).status,403,'global admin roster cannot bypass organization scope');
});

test('permission matrix API requires the selected organization and rejects unrelated users',async t=>{
 const f=await fixture(t),admin=f.browser();
 await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Lab A',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 f.organizationStore.applyVerifiedSeatPurchase({reference:'verified1',organizationId:'org-a',plan:'Single',apps:['eel'],seats:1});
 const scientist=await f.identityStore.createUser({email:'worker@example.test',displayName:'Worker',password:'Worker password 12345'});
 f.organizationStore.saveMember({organizationId:'org-a',actorId:owner.id,member:{accountId:scientist.id,name:'Worker',nickname:'Worker',email:scientist.email,admin:false,roles:{eel:'scientist'}}});
 assert.equal((await admin.call('/api/suite/organization/matrix',{organizationId:'org-a'})).status,403,'an organization must first be chosen');
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const matrix=await (await admin.call('/api/suite/organization/matrix',{organizationId:'org-a'})).json();
 assert(matrix.apps.find(x=>x.id==='eel').permissions.includes('document.review'));
 const data={organizationId:'org-a',accountId:scientist.id,appId:'eel',permission:'document.review',enabled:true};
 assert.equal((await admin.call('/api/suite/organization/permission/set',data,'POST',false)).status,403);
 assert.equal((await admin.call('/api/suite/organization/permission/set',{...data,permission:'invalid.permission'})).status,400);
 assert.equal((await admin.call('/api/suite/organization/permission/set',data)).status,200);
 assert(f.organizationStore.effectivePermissions({organizationId:'org-a',accountId:scientist.id,appId:'eel'}).includes('document.review'));
 assert.equal((await admin.call('/api/suite/organization/matrix',{organizationId:'org-b'})).status,403);
});

test('org admin can invite new central account, activated only once, without app grants',async t=>{
 const f=await fixture(t),admin=f.browser(),guest=f.browser();
 await admin.preflight();await guest.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 assert.equal((await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'New scientist',nickname:'New',email:'new@example.test'})).status,403,'select org before inviting');
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 assert.equal((await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test'},'POST',false)).status,403,'CSRF');
 const invitationResponse=await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test'});
 assert.equal(invitationResponse.status,201);
 const invite=await invitationResponse.json(),token=new URL(invite.invitationUrl).searchParams.get('invite');
 const preview=await (await guest.call('/api/suite/organization/invite/preview?token='+token)).json();
 assert.equal(preview.invitation.email,'new@example.test');
 assert.equal((await guest.call('/api/suite/organization/invite/accept',{token,password:'Long example password 12345'},'POST',false)).status,403);
 const accepted=await guest.call('/api/suite/organization/invite/accept',{token,password:'Long example password 12345'});
 assert.equal(accepted.status,201,await accepted.text().catch(()=>'')); 
 const newAccount=f.identityStore.findUserByEmail('new@example.test');
 assert.equal(newAccount.role,'member');
 assert.equal(f.organizationStore.organizationsFor(newAccount.id)[0].id,'org-a');
 assert.deepEqual(f.organizationStore.overview('org-a',owner.id).users.find(u=>u.accountId===newAccount.id).roles,{});
 assert.equal((await guest.call('/api/suite/organization/invite/accept',{token})).status,403,'one-use token');
 assert.equal((await admin.call('/api/suite/organization/user/remove',{organizationId:'org-a',accountId:newAccount.id})).status,200);
 assert.equal(f.organizationStore.organizationsFor(newAccount.id).length,0);
 assert.notEqual(f.identityStore.getUser(newAccount.id),null,'central identity persists after leaving org');
 assert.equal((await admin.call('/api/suite/organization/user/remove',{organizationId:'org-a',accountId:owner.id})).status,409,'last admin cannot be removed');
});

test('pending invitation list and revocation require selected organization and CSRF',async t=>{
 const f=await fixture(t),admin=f.browser(),guest=f.browser();
 await admin.preflight();await guest.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 f.organizationStore.setupOrganization({organizationId:'org-b',name:'Beta lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 assert.equal((await admin.call('/api/suite/organization/invite/list',{organizationId:'org-a'})).status,403);
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const invitationResponse=await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test'});
 const token=new URL((await invitationResponse.json()).invitationUrl).searchParams.get('invite');
 assert.equal((await admin.call('/api/suite/organization/invite/list',{organizationId:'org-a'},'POST',false)).status,403);
 assert.equal((await guest.call('/api/suite/organization/invite/list',{organizationId:'org-a'})).status,401);
 assert.equal((await admin.call('/api/suite/organization/invite/list',{organizationId:'org-b'})).status,403);
 const pending=(await (await admin.call('/api/suite/organization/invite/list',{organizationId:'org-a'})).json()).invitations;
 assert.deepEqual(pending.map(x=>x.email),['new@example.test']);
 assert.equal(JSON.stringify(pending).includes(token),false);
 assert.equal((await admin.call('/api/suite/organization/invite/revoke',{organizationId:'org-b',email:'new@example.test'})).status,403);
 assert.equal((await admin.call('/api/suite/organization/invite/revoke',{organizationId:'org-a',email:'new@example.test'},'POST',false)).status,403);
 assert.equal((await admin.call('/api/suite/organization/invite/revoke',{organizationId:'org-a',email:'new@example.test'})).status,200);
 assert.equal((await (await admin.call('/api/suite/organization/invite/list',{organizationId:'org-a'})).json()).invitations.length,0);
 assert.equal((await guest.call('/api/suite/organization/invite/preview?token='+token)).status,403);
 assert.equal((await guest.call('/api/suite/organization/invite/accept',{token,password:'Long new password 12345'})).status,403);
 assert.equal(f.identityStore.findUserByEmail('new@example.test'),null);
});
test('app-role invitations reserve seats before acceptance and cannot exceed licensed capacity over HTTP',async t=>{
 const f=await fixture(t),admin=f.browser(),guest=f.browser();
 await admin.preflight();await guest.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const data={organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test',roles:{eel:'scientist'}};
 assert.equal((await admin.call('/api/suite/organization/invite',data)).status,409,'no purchased DuckNote seat');
 f.organizationStore.applyVerifiedSeatPurchase({reference:'trusted-seat',organizationId:'org-a',plan:'Single',apps:['eel'],seats:1});
 assert.equal((await admin.call('/api/suite/organization/invite',{...data,roles:{eel:'not-a-real-role'}})).status,400);
 const created=await admin.call('/api/suite/organization/invite',data);
 assert.equal(created.status,201);
 const token=new URL((await created.json()).invitationUrl).searchParams.get('invite');
 const listed=(await (await admin.call('/api/suite/organization/invite/list',{organizationId:'org-a'})).json()).invitations;
 assert.equal(listed[0].roles.eel,'scientist');
 assert.equal((await admin.call('/api/suite/organization/invite',{...data,email:'other@example.test'})).status,409);
 assert.equal((await (await admin.call('/api/suite/organization/overview',{organizationId:'org-a'})).json()).apps.find(x=>x.id==='eel').reserved,1);
 const accepted=await guest.call('/api/suite/organization/invite/accept',{token,password:'Long new password 12345'});
 assert.equal(accepted.status,201);
 const account=f.identityStore.findUserByEmail('new@example.test');
 assert.equal(f.organizationStore.accessFor({organizationId:'org-a',accountId:account.id,appId:'eel'}).role,'scientist');
 assert.equal(f.organizationStore.overview('org-a',owner.id).apps.find(x=>x.id==='eel').reserved,0);
});
test('organization audit read API is CSRF protected and cannot expose a different tenant',async t=>{
 const f=await fixture(t),admin=f.browser(),outsider=f.browser();
 await admin.preflight();await outsider.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 f.organizationStore.setupOrganization({organizationId:'org-b',name:'Beta lab',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 assert.equal((await admin.call('/api/suite/organization/audit',{organizationId:'org-a'})).status,403);
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 assert.equal((await admin.call('/api/suite/organization/audit',{organizationId:'org-a'},'POST',false)).status,403);
 assert.equal((await outsider.call('/api/suite/organization/audit',{organizationId:'org-a'})).status,401);
 assert.equal((await admin.call('/api/suite/organization/audit',{organizationId:'org-b'})).status,403);
 const invite=await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'scientist@example.test'});
 const token=new URL((await invite.json()).invitationUrl).searchParams.get('invite');
 const events=(await (await admin.call('/api/suite/organization/audit',{organizationId:'org-a'})).json()).events;
 assert(events.some(event=>event.action==='invitation.issued'&&event.subject==='scientist@example.test'));
 assert(!JSON.stringify(events).includes(token));
 assert(!events.some(event=>event.subject==='org-b'));
});
test('organization member status API revokes only the selected tenant and requires live admin and CSRF',async t=>{
 const f=await fixture(t),admin=f.browser(),workerBrowser=f.browser();
 await admin.preflight();await workerBrowser.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 const worker=await f.identityStore.createUser({email:'worker@example.test',displayName:'Worker',password:'Worker password 12345'});
 for(const [id,name] of [['org-a','A'],['org-b','B']]){
  f.organizationStore.setupOrganization({organizationId:id,name,owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:owner.email}});
  f.organizationStore.applyVerifiedSeatPurchase({reference:'trusted-'+id,organizationId:id,plan:'Single',apps:['eel'],seats:1});
  f.organizationStore.saveMember({organizationId:id,actorId:owner.id,member:{accountId:worker.id,name:'Worker',nickname:'Worker',email:worker.email,admin:false,roles:{eel:'scientist'}}});
 }
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:worker.id,active:false})).status,403);
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:worker.id,active:false},'POST',false)).status,403);
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-b',accountId:worker.id,active:false})).status,403);
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:owner.id,active:false})).status,409);
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:worker.id,active:false})).status,200);
 assert.equal(f.organizationStore.accessFor({organizationId:'org-a',accountId:worker.id,appId:'eel'}),null);
 assert.equal(f.organizationStore.accessFor({organizationId:'org-b',accountId:worker.id,appId:'eel'}).role,'scientist');
 await workerBrowser.call('/api/suite/account/login',{email:'worker@example.test',password:'Worker password 12345'});
 const list=(await (await workerBrowser.call('/api/suite/organizations')).json()).organizations;
 assert.deepEqual(list.map(x=>x.id),['org-b']);
 assert.equal((await workerBrowser.call('/api/suite/organization/select',{organizationId:'org-a'})).status,403);
 assert.equal((await workerBrowser.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:worker.id,active:true})).status,403);
 assert.equal((await admin.call('/api/suite/organization/user/active',{organizationId:'org-a',accountId:worker.id,active:true})).status,200);
 const after=(await (await workerBrowser.call('/api/suite/organizations')).json()).organizations;
 assert.deepEqual(after.map(x=>x.id),['org-a','org-b']);
});
test('private email invitation submission does not expose tokens in the HTTP response',async t=>{
 const messages=[];
 const f=await fixture(t,{invitationMailer:{async sendInvitation(value){messages.push(value);return {accepted:true}}}});
 const admin=f.browser();await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:owner.email}});
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const response=await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test'});
 assert.equal(response.status,201);
 const data=await response.json();
 assert.equal(data.delivery,'email');
 assert.equal(data.invitationUrl,undefined);
 assert.equal(messages.length,1);
 assert.equal(messages[0].email,'new@example.test');
 assert.match(messages[0].invitationUrl,/invite=/);
});
test('provider failure revokes pending invitations and releases licensed reservations',async t=>{
 const f=await fixture(t,{invitationMailer:{async sendInvitation(){throw new Error('remote provider details')}}});
 const admin=f.browser();await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Alpha',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:owner.email}});
 f.organizationStore.applyVerifiedSeatPurchase({reference:'trusted',organizationId:'org-a',plan:'Single',apps:['eel'],seats:1});
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const response=await admin.call('/api/suite/organization/invite',{organizationId:'org-a',name:'Scientist',nickname:'Sci',email:'new@example.test',roles:{eel:'scientist'}});
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'email_unavailable'});
 assert.equal(f.organizationStore.listPendingInvitations('org-a',owner.id).length,0);
 assert.equal(f.organizationStore.overview('org-a',owner.id).apps.find(x=>x.id==='eel').reserved,0);
});
test('organization test Checkout HTTP API requires selected admin and reuses a saved session',async t=>{
 const calls=[],fake={priceFor:()=> 'price_test123456',async createSession(value){calls.push(value);return {id:'cs_test_mock123',url:'https://checkout.stripe.com/c/pay/example'};}};
 const f=await fixture(t,{stripeTestCheckout:fake}),admin=f.browser(),outsider=f.browser();
 await admin.preflight();await outsider.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 for(const id of ['org-a','org-b'])f.organizationStore.setupOrganization({organizationId:id,name:id,owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:owner.email}});
 const draft=f.organizationStore.createSubscriptionDraft({organizationId:'org-a',actorId:owner.id,plan:'Single',apps:['eel'],seats:3});
 const input={organizationId:'org-a',draftId:draft.id};
 assert.equal((await admin.call('/api/suite/organization/subscription/test-checkout',input)).status,403);
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 assert.equal((await admin.call('/api/suite/organization/subscription/test-checkout',input,'POST',false)).status,403);
 assert.equal((await outsider.call('/api/suite/organization/subscription/test-checkout',input)).status,401);
 assert.equal((await admin.call('/api/suite/organization/subscription/test-checkout',{...input,organizationId:'org-b'})).status,403);
 const first=await admin.call('/api/suite/organization/subscription/test-checkout',input);
 assert.equal(first.status,200);
 assert.deepEqual(await first.json(),{checkoutUrl:'https://checkout.stripe.com/c/pay/example',mode:'test',licensesGranted:false});
 assert.equal((await admin.call('/api/suite/organization/subscription/test-checkout',input)).status,200);
 assert.equal(calls.length,1);
 assert.equal(f.organizationStore.overview('org-a',owner.id).apps.find(x=>x.id==='eel').purchased,0);
 assert.equal((await admin.call('/api/suite/organization/subscription/cancel',input)).status,409);
});
test('subscription draft HTTP API is CSRF protected, org locked and cannot mint seats',async t=>{
 const f=await fixture(t),admin=f.browser();await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'Lab A',owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 const request={organizationId:'org-a',plan:'Mixed',apps:['eel','goflo'],seats:10};
 assert.equal((await admin.call('/api/suite/organization/subscription/draft',request)).status,403);
 assert.equal((await admin.call('/api/suite/organization/select',{organizationId:'org-a'})).status,200);
 assert.equal((await admin.call('/api/suite/organization/subscription/draft',request,'POST',false)).status,403);
 const saved=await admin.call('/api/suite/organization/subscription/draft',request);
 assert.equal(saved.status,201);const draft=(await saved.json()).draft;
 assert.equal((await (await admin.call('/api/suite/organization/subscriptions',{organizationId:'org-a'})).json()).drafts.length,1);
 assert.equal((await admin.call('/api/suite/organization/subscription/cancel',{organizationId:'org-b',draftId:draft.id})).status,403);
 assert.equal((await admin.call('/api/suite/organization/subscription/cancel',{organizationId:'org-a',draftId:draft.id})).status,200);
 assert.deepEqual(f.organizationStore.overview('org-a',owner.id).apps.map(x=>x.purchased),[0,0,0,0,0,0]);
});

test('reconciliation API checks only the selected admin\'s own ready test Checkout',async t=>{
 const observations=[];
 const checker={async inspect(snapshot){
  observations.push(snapshot);
  return {state:'paid_test_verified',invoiceId:'in_test_mock1234',subscriptionId:'sub_test_mock1234',
   sessionId:snapshot.checkout.sessionId,organizationId:snapshot.draft.organizationId,
   draftId:snapshot.draft.id,price:snapshot.checkout.price,seats:snapshot.draft.seats,
   licensesGranted:false};
 }};
 const f=await fixture(t,{stripeTestReconciler:checker});
 const admin=f.browser(),outsider=f.browser();await admin.preflight();await outsider.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,
  email:'owner@example.test',displayName:'Owner',password:'Owner password 12345'})).json()).user;
 for(const id of ['org-a','org-b'])f.organizationStore.setupOrganization({
  organizationId:id,name:id,owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:owner.email}});
 const d=f.organizationStore.createSubscriptionDraft({organizationId:'org-a',actorId:owner.id,
  plan:'Single',apps:['eel'],seats:3});
 const input={organizationId:'org-a',draftId:d.id},route='/api/suite/organization/subscription/test-reconcile';
 assert.equal((await admin.call(route,input)).status,403,'must first select organization');
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 assert.equal((await admin.call(route,input,'POST',false)).status,403,'CSRF is mandatory');
 assert.equal((await outsider.call(route,input)).status,401,'no unauthenticated billing read');
 assert.equal((await admin.call(route,{...input,organizationId:'org-b'})).status,403,'no cross-org access');
 assert.equal((await admin.call(route,input)).status,400,'unprepared test Checkout cannot be checked');
 f.organizationStore.prepareTestCheckout({...input,actorId:owner.id,price:'price_test12345'});
 assert.equal((await admin.call(route,input)).status,400,'pending Checkout is not a ready session');
 f.organizationStore.completeTestCheckout({...input,actorId:owner.id,
  session:{id:'cs_test_mock1234',url:'https://checkout.stripe.com/c/pay/mock'}});
 const result=await admin.call(route,input);
 assert.equal(result.status,200);
 const completed=await result.json();
 assert.deepEqual(completed.reconciliation,{
  state:'paid_test_verified',invoiceId:'in_test_mock1234',subscriptionId:'sub_test_mock1234',
  sessionId:'cs_test_mock1234',organizationId:'org-a',draftId:d.id,price:'price_test12345',
  seats:3,licensesGranted:false
 });
 assert.equal(completed.mode,'test');
 assert.equal(completed.licensesGranted,false);
 assert.equal(completed.observation.state,'paid_test_verified');
 assert.equal(completed.observation.attempt,1);
 assert.equal(completed.observation.licensesGranted,false);
 assert(Number.isSafeInteger(completed.observation.checkedAt));
 assert.equal(f.organizationStore.listSubscriptionDrafts('org-a',owner.id)[0].testReconciliation.state,'paid_test_verified');
 const listing=await admin.call('/api/suite/organization/subscriptions',{organizationId:'org-a'});
 assert.equal(listing.status,200);
 const subscriptionResponse=await listing.json();
 const capacity=subscriptionResponse.testSeatImpact;
 const shadow=subscriptionResponse.testEntitlementPlan;
 assert.equal(shadow.testOnly,true);
 assert.equal(shadow.realSeatChanges,false);
 assert.equal(shadow.licensesGranted,false);
 assert.equal(shadow.apps.find(x=>x.appId==='eel').status,'manual_review');
 assert.equal(shadow.apps.find(x=>x.appId==='eel').candidateTestSeats,0);
 assert.equal(capacity.testOnly,true);
 assert.equal(capacity.licensesGranted,false);
 assert.equal(capacity.realSeatChanges,false);
 assert.equal(capacity.apps.find(x=>x.appId==='eel').status,'manual_review',
  'a legacy paid observation without lifecycle information may not promise usable seats');
 assert.equal(capacity.apps.find(x=>x.appId==='eel').candidateTestSeats,0);

 const historyRoute='/api/suite/organization/subscription/test-history';
 assert.equal((await outsider.call(historyRoute,input)).status,401);
 assert.equal((await admin.call(historyRoute,input,'POST',false)).status,403);
 assert.equal((await admin.call(historyRoute,{...input,organizationId:'org-b'})).status,403);
 const prior=await admin.call(historyRoute,input);
 assert.equal(prior.status,200);
 const historical=await prior.json();
 assert.equal(historical.mode,'test');
 assert.equal(historical.licensesGranted,false);
 assert.equal(historical.history.length,1);
 assert.equal(historical.history[0].state,'paid_test_verified');
 assert.equal(historical.history[0].licensesGranted,false);
 assert.equal(historical.history[0].lifecycle,null);
 assert.equal('subscriptionId' in historical.history[0],false);

 assert.equal(observations.length,1);
 assert.deepEqual(observations[0],{
  draft:{id:d.id,organizationId:'org-a',plan:'Single',apps:['eel'],seats:3},
  checkout:{sessionId:'cs_test_mock1234',price:'price_test12345'}
 });
 assert(f.organizationStore.overview('org-a',owner.id).apps.every(x=>x.purchased===0));
 assert(f.organizationStore.overview('org-b',owner.id).apps.every(x=>x.purchased===0));
});
test('reconciliation API fails closed on Stripe errors and on disabled integration',async t=>{
 const f=await fixture(t,{stripeTestReconciler:{async inspect(){throw Error('Stripe unavailable');}}});
 const admin=f.browser();await admin.preflight();
 const owner=(await (await admin.call('/api/suite/setup',{setupToken:f.setupToken,email:'owner@example.test',
  displayName:'Owner',password:'Owner password 12345'})).json()).user;
 f.organizationStore.setupOrganization({organizationId:'org-a',name:'A',owner:{
  accountId:owner.id,name:'Owner',nickname:'O',email:owner.email}});
 await admin.call('/api/suite/organization/select',{organizationId:'org-a'});
 const draft=f.organizationStore.createSubscriptionDraft({organizationId:'org-a',actorId:owner.id,
  plan:'Single',apps:['eel'],seats:1});
 const body={organizationId:'org-a',draftId:draft.id};
 f.organizationStore.prepareTestCheckout({...body,actorId:owner.id,price:'price_test12345'});
 f.organizationStore.completeTestCheckout({...body,actorId:owner.id,
  session:{id:'cs_test_mock1234',url:'https://checkout.stripe.com/c/pay/mock'}});
 const result=await admin.call('/api/suite/organization/subscription/test-reconcile',body);
 assert.equal(result.status,503);
 assert.deepEqual(await result.json(),{error:'reconciliation_unavailable'});
 const saved=f.organizationStore.listSubscriptionDrafts('org-a',owner.id)[0].testReconciliation;
 assert.equal(saved.state,'unavailable');
 assert.equal(saved.attempt,1);
 assert(f.organizationStore.overview('org-a',owner.id).apps.every(x=>x.purchased===0));
});

test('owner API is disabled without explicitly pinned central owner account',async t=>{
 const f=await fixture(t),client=f.browser();
 await client.preflight();
 const bootstrap=await client.call('/api/suite/setup',{
  setupToken:f.setupToken,email:'primary@example.test',
  displayName:'Primary',password:'Owner password 12345'});
 assert.equal(bootstrap.status,201);
 assert.equal((await client.call('/api/suite/owner/overview')).status,403);
 const account=(await (await client.call('/api/suite/account')).json());
 assert.equal(account.ownerPanel,false);
});
test('private owner dashboard aggregates all organization changes but excludes other users',async t=>{
 const f=await fixture(t,{prebootstrapOwner:true}),owner=f.browser(),member=f.browser();
 assert.equal((await member.call('/api/suite/owner/overview')).status,401);
 await owner.preflight();
 assert.equal((await owner.call('/api/suite/account/login',{
  email:'owner@example.test',password:'Owner password 12345'})).status,200);
 assert.equal((await (await owner.call('/api/suite/account')).json()).ownerPanel,true);
 const worker=await f.identityStore.createUser({
  email:'worker@example.test',displayName:'Worker',password:'Worker password 12345'});
 f.organizationStore.setupOrganization({organizationId:'one',name:'Lab One',owner:{
  accountId:f.ownerAccount.id,name:'DuckBio Owner',nickname:'Owner',email:'owner@example.test'}});
 f.organizationStore.setupOrganization({organizationId:'two',name:'Lab Two',owner:{
  accountId:worker.id,name:'Worker',nickname:'W',email:'worker@example.test'}});
 f.organizationStore.applyVerifiedSeatPurchase({reference:'synthetic-legacy-owner-report',
  organizationId:'one',plan:'Single',apps:['eel'],seats:3});
 f.organizationStore.saveMember({organizationId:'one',actorId:f.ownerAccount.id,member:{
  accountId:worker.id,name:'Worker',nickname:'W',email:'worker@example.test',
  admin:false,roles:{eel:'scientist'}}});
 const draft=f.organizationStore.createSubscriptionDraft({organizationId:'one',
  actorId:f.ownerAccount.id,plan:'Single',apps:['eel'],seats:2});
 assert(draft.id);
 f.organizationStore.recordVerifiedStripeLiveEvent({
  id:'evt_live_ownerapi1234',type:'customer.subscription.updated',
  objectId:'sub_live_ownerapi1234',created:1800000000,
  digest:'b'.repeat(64),mode:'live',licensesGranted:false,
  authorizesSeatChanges:false
 });
 const response=await owner.call('/api/suite/owner/overview');
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 const result=await response.json();
 assert.equal(result.ownerOnly,true);
 assert.equal(result.summary.totals.organizations,2);
 assert.equal(result.summary.totals.memberAccounts,2);
 assert.equal(result.summary.totals.activeMemberships,3);
 assert.equal(result.summary.totals.unpaidDrafts,1);
 assert.equal(result.summary.totals.liveWebhookEvents,1);
 assert.equal(result.summary.liveWebhookEvents[0].linkage,'unassigned');
 assert.equal(result.summary.liveWebhookEvents[0].type,'customer.subscription.updated');
 assert(!JSON.stringify(result.summary.liveWebhookEvents).includes('sub_live_ownerapi1234'));
 assert.equal(result.summary.totals.activeVerifiedSubscriptions,0);
 assert.equal(result.summary.financials.available,false);
 assert.equal(result.summary.organizations.find(x=>x.id==='one').memberships,2);
 assert.equal(result.summary.capacity.find(x=>x.appId==='eel').purchased,3);
 assert.equal(result.summary.capacity.find(x=>x.appId==='eel').assigned,1);
 assert.equal(result.summary.memberships.filter(x=>x.accountId===worker.id).length,2);
 assert(result.identities.find(x=>x.id===worker.id));
 assert(result.summary.activity.some(x=>x.action==='member.added'));
 assert(result.summary.activity.every(x=>!Object.hasOwn(x,'details')));
 assert(!JSON.stringify(result).includes('synthetic-legacy-owner-report'));
 assert.equal(result.summary.testDrafts[0].source,'unpaid_test_draft');
 await member.preflight();
 assert.equal((await member.call('/api/suite/account/login',{
  email:'worker@example.test',password:'Worker password 12345'})).status,200);
 assert.equal((await member.call('/api/suite/owner/overview')).status,403);
 assert.equal((await (await member.call('/api/suite/account')).json()).ownerPanel,false);
 assert.equal((await member.call('/api/suite/owner/overview',{anything:'x'})).status,405);
});

test('DuckBio-only messaging uses private virtual mail and hides owner from all user chat discovery',async t=>{
 const f=await fixture(t,{prebootstrapOwner:true,communications:true});
 const owner=f.browser(),alice=f.browser(),bob=f.browser(),carla=f.browser();
 for(const c of [owner,alice,bob,carla])await c.preflight();
 const [a,b,c]=await Promise.all([
  f.identityStore.createUser({email:'alice@example.test',displayName:'Alice Scientist',password:'Alice password 12345'}),
  f.identityStore.createUser({email:'bob@example.test',displayName:'Bob Technician',password:'Bob password 12345'}),
  f.identityStore.createUser({email:'carla@example.test',displayName:'Carla Researcher',password:'Carla password 12345'})
 ]);
 f.organizationStore.setupOrganization({organizationId:'org-1',name:'First Lab',
  owner:{accountId:f.ownerAccount.id,name:'DuckBio Owner',nickname:'O',email:'owner@example.test'}});
 f.organizationStore.setupOrganization({organizationId:'org-2',name:'Second Lab',
  owner:{accountId:c.id,name:'Carla',nickname:'C',email:'carla@example.test'}});
 for(const member of [{user:a,name:'Alice'},{user:b,name:'Bob'}])
  f.organizationStore.saveMember({organizationId:'org-1',actorId:f.ownerAccount.id,
   member:{accountId:member.user.id,name:member.name,nickname:member.name,
    email:member.user.email,admin:false,roles:{}}});
 const logins=[
  [owner,'owner@example.test'],[alice,'alice@example.test'],
  [bob,'bob@example.test'],[carla,'carla@example.test']
 ];
 for(const [client,email] of logins)assert.equal(
  (await client.call('/api/suite/account/login',{email,password:
   email==='owner@example.test'?'Owner password 12345':
   email==='alice@example.test'?'Alice password 12345':
   email==='bob@example.test'?'Bob password 12345':'Carla password 12345'})).status,200);
 const selfAlice=await (await alice.call('/api/suite/communications/self')).json();
 const selfBob=await (await bob.call('/api/suite/communications/self')).json();
 const ownerSelf=await (await owner.call('/api/suite/communications/self')).json();
 assert.match(selfAlice.address,/^duck-[a-f0-9]{24}@duckbio\.internal$/);
 assert.notEqual(selfAlice.address,selfBob.address);
 assert.equal(ownerSelf.owner,true);
 assert.equal(ownerSelf.billingAddress,'billing@duckbio.internal');
 assert.equal(selfAlice.mailTransport,'internal_only');
 const contactList=await (await alice.call('/api/suite/communications/contacts')).json();
 assert(contactList.contacts.some(x=>x.accountId===b.id&&x.organizationName==='First Lab'));
 assert(!contactList.contacts.some(x=>x.accountId===f.ownerAccount.id));
 assert(!JSON.stringify(contactList).includes('owner@example.test'));
 const cross=await (await alice.call('/api/suite/communications/search',{query:'Carla'})).json();
 assert.equal(cross.results.length,1);
 assert.equal(cross.results[0].accountId,c.id);
 assert(!JSON.stringify(cross).includes('carla@example.test'));
 assert.deepEqual((await (await alice.call('/api/suite/communications/search',{query:'Owner'})).json()).results,[]);
 const ownerSearch=await (await owner.call('/api/suite/communications/search',{query:'Alice'})).json();
 assert.equal(ownerSearch.results[0].accountId,a.id);
 const badChat=await alice.call('/api/suite/communications/chat/send',{
  recipientId:f.ownerAccount.id,body:'Not allowed',clientId:'owner-guess-123'});
 assert.equal(badChat.status,403);
 assert.equal((await alice.call('/api/suite/communications/chat/history',{peerId:'duckbio-security'})).status,403);
 const sent=await alice.call('/api/suite/communications/chat/send',{
  recipientId:c.id,body:'Hello across labs',clientId:'cross-lab-123'});
 assert.equal(sent.status,201);
 assert.equal((await (await carla.call('/api/suite/communications/threads')).json()).threads[0].peerId,a.id);
 const ownChat=await owner.call('/api/suite/communications/chat/send',{
  recipientId:a.id,body:'Owner reaching out',clientId:'owner-to-alice-123'});
 assert.equal(ownChat.status,201);
 assert.equal((await (await alice.call('/api/suite/communications/chat/history',{peerId:f.ownerAccount.id})).json()).messages.length,1);
 assert.equal((await alice.call('/api/suite/communications/chat/send',{
  recipientId:f.ownerAccount.id,body:'Reply not allowed',clientId:'forbidden-reply-123'})).status,403);
 const email=await alice.call('/api/suite/communications/mail/send',{
  to:'support@duckbio.internal',subject:'Question',body:'Please help',clientId:'support-mail-123'});
 assert.equal(email.status,201);
 assert.equal((await (await owner.call('/api/suite/communications/mail/inbox')).json()).messages[0].subject,'Question');
 assert.equal((await alice.call('/api/suite/communications/mail/send',{
  to:'billing@duckbio.internal',subject:'Spoof notice',body:'Not permitted',clientId:'spoof-mail-123'})).status,400);
 assert.equal((await alice.call('/api/suite/communications/mail/send',{
  to:ownerSelf.address,subject:'Guess',body:'Use support instead',clientId:'private-mail-123'})).status,403);
 assert.equal((await alice.call('/api/suite/communications/mail/send',{
  to:selfBob.address,subject:'Work',body:'Internal only',clientId:'alice-to-bob-123'})).status,201);
 assert.equal((await (await bob.call('/api/suite/communications/mail/inbox')).json()).messages[0].body,'Internal only');
 f.communicationsStore.postSubscriptionNotice({reference:'billing123',organizationName:'First Lab',
  description:'2 extra DuckNote seats'});
 f.communicationsStore.postSecurityAlert({reference:'security123',description:'Suspicious login attempts'});
 const inbox=(await (await owner.call('/api/suite/communications/mail/inbox')).json()).messages;
 assert(inbox.some(x=>x.to==='billing@duckbio.internal'&&x.kind==='billing'));
 const ownerThreads=(await (await owner.call('/api/suite/communications/threads')).json()).threads;
 assert(ownerThreads.some(x=>x.peerId==='duckbio-security'&&x.unread===1));
 assert.equal((await (await owner.call('/api/suite/communications/chat/history',{peerId:'duckbio-security'})).json()).messages[0].body,'Suspicious login attempts');
 assert.equal((await (await owner.call('/api/suite/communications/chat/read',{peerId:'duckbio-security'})).json()).marked,1);
 assert.equal((await (await alice.call('/api/suite/communications/threads')).json()).threads.some(x=>x.peerId==='duckbio-security'),false);
 assert.equal((await alice.call('/api/suite/communications/chat/send',{
  recipientId:c.id,body:'Hello across labs',clientId:'cross-lab-123'})).status,201);
});
