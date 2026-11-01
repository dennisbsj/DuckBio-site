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

async function fixture(t, { allNative = false, beforeRoster } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'suite-service-'));
  const identityStore = createIdentityStore({ databasePath: path.join(directory, 'identity.sqlite') });
  const stores = createSqliteAuthStores({ databasePath: path.join(directory, 'auth.sqlite') });
  const organizationStore = createOrganizationStore({ databasePath: path.join(directory, 'private', 'org.sqlite') });
  const setupToken = randomBytes(32).toString('base64url');
  identityStore.configureBootstrapToken(setupToken);
  writeFileSync(path.join(directory, 'index.html'), '<html><head></head><body>local accounts</body></html>');
  const clients = ['goflo', 'eel', 'methpipe', 'mantrain', 'duckman', 'limsman'].map(id => ({ id, appId: id, secret: randomBytes(32).toString('base64url'), redirectUris: [`https://${id}.celluloidconsulting.net/auth/callback`], nativeOrigin: (allNative || ['eel', 'duckman', 'limsman'].includes(id)) ? `https://${id}.celluloidconsulting.net` : undefined }));
  let service;
  const server = http.createServer(async (req, res) => { if (!await service.handle(req, res)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const nativeCalls = [];
  service = createAccountService({ origin, issuer: 'https://login.celluloidconsulting.net', clients, identityStore, organizationStore, authStore: stores.brokerStore, assetRoot: directory, buildVersion: 'test-local-service', getClientAddress: req => req.socket.remoteAddress,
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
  t.after(async () => { await new Promise(resolve => server.close(resolve)); identityStore.close(); organizationStore.close(); stores.close(); rmSync(directory, { recursive: true, force: true }); });
  function browser() {
    const cookies = new Map(); let csrf;
    async function call(route, body, method = body === undefined ? 'GET' : 'POST', includeCsrf = true) {
      const response = await fetch(origin + route, { method, redirect: 'manual', headers: { ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin, ...(csrf && includeCsrf ? { 'X-CSRF-Token': csrf } : {}) } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      for (const value of response.headers.getSetCookie()) { const [key, content] = value.split(';')[0].split('='); if (content) cookies.set(key, content); else cookies.delete(key); }
      return response;
    }
    return { call, async preflight() { const response = await call('/api/suite/auth/session'); const data = await response.json(); csrf = data.csrfToken; return data; } };
  }
  return { identityStore, organizationStore, origin, setupToken, nativeCalls, browser };
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
