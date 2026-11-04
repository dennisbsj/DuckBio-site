// End-to-end synthetic HTTP contract across the SIX registered native apps.
// Test-only loopback transport and disposable stores: no production accounts,
// external callbacks, purchase endpoints, network fetches or deployed services.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';
import {createAccountService} from '../shared-auth/account-service.mjs';
import {nativeConnectRequest} from '../native-connect.mjs';

const apps=Object.freeze([
 {id:'goflo',role:'Analyst',name:'CytoDuck'},
 {id:'eel',role:'scientist',name:'DuckNote'},
 {id:'methpipe',role:'Analyst',name:'DuckPipe'},
 {id:'mantrain',role:'Learner',name:'DuckTrain'},
 {id:'duckman',role:'editor',name:'DuckMan'},
 {id:'limsman',role:'Analyst',name:'LabDuck'}
]);
const secret=()=>randomBytes(32).toString('base64url');
const pkce=()=>{const verifier=secret(),state=secret();
 return {verifier,state,codeChallenge:createHash('sha256').update(verifier).digest('base64url')}};
async function fixture(t,{organizationMode=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-six-native-contract-'));
 const identity=createIdentityStore({databasePath:join(dir,'identity.sqlite')});
 const auth=createSqliteAuthStores({databasePath:join(dir,'auth.sqlite')});
 const org=createOrganizationStore({databasePath:join(dir,'organizations.sqlite')});
 const setup=secret();
 identity.configureBootstrapToken(setup);
 const owner=await identity.bootstrap(setup,{email:'owner@example.test',displayName:'Fixture owner',
  password:'Synthetic only owner passphrase 123456'});
 const worker=await identity.createUser({email:'worker@example.test',displayName:'Fixture worker',
  password:'Synthetic only worker passphrase 123456'});
 org.setupOrganization({organizationId:'lab-a',name:'Fixture Lab A',
  owner:{accountId:owner.id,name:'Fixture owner',nickname:'Owner',email:'owner@example.test'}});
 org.setupOrganization({organizationId:'lab-b',name:'Fixture Lab B',
  owner:{accountId:owner.id,name:'Fixture owner',nickname:'Owner',email:'owner@example.test'}});
 // A test-only private VERIFIED-billing adapter is the sole seat allocator.
 // No checkout URLs, payment provider, production organisation or paid user.
 org.applyVerifiedSeatPurchase({reference:'synthetic-six-app-bundle',organizationId:'lab-a',
  plan:'Bundle',apps:apps.map(app=>app.id),seats:2});
 const roles=Object.fromEntries(apps.map(app=>[app.id,app.role]));
 const member=roles=>({accountId:worker.id,name:'Fixture worker',nickname:'Worker',
  email:'worker@example.test',admin:false,roles});
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:member(roles)});
 for(const app of apps){
  identity.grantAppAccess({userId:worker.id,appId:app.id,
   localUserId:'native-'+app.id+'-worker',organizationId:'lab-a'});
 }
 const messages=createCommunicationsStore({databasePath:join(dir,'messages.sqlite'),
  ownerAccountId:owner.id});
 messages.sendChat({senderId:owner.id,recipientId:worker.id,body:'Review fixture',
  clientId:'fixture-chat'});
 messages.sendMail({senderId:owner.id,recipientId:worker.id,
  toAddress:messages.addressFor(worker.id),subject:'Fixture mail',body:'Review fixture',
  clientId:'fixture-mail'});
 const clients=apps.map(app=>({
  id:app.id,appId:app.id,secret:secret(),
  redirectUris:['https://'+app.id+'.example.test/auth/callback'],
  nativeOrigin:'https://'+app.id+'.example.test'
 }));
 let service;
 const server=http.createServer(async(req,res)=>{
  if(!await service.handle(req,res)){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  messages.close();org.close();identity.close();auth.close();
  rmSync(dir,{recursive:true,force:true});
 });
 service=createAccountService({
  origin,issuer:'https://identity.example.test',clients,
  identityStore:identity,authStore:auth.brokerStore,
  // Standalone native login still receives the generation-pinned grants;
  // organization-mode authority explicitly refuses global legacy grants.
  organizationStore:organizationMode?org:null,
  communicationsStore:messages,ownerAccountId:owner.id,assetRoot:dir,
  getClientAddress:req=>req.socket.remoteAddress
 });
 const start=await fetch(origin+'/api/suite/auth/session');
 assert.equal(start.status,200);
 const csrfCookie=start.headers.get('set-cookie').split(';')[0];
 const {csrfToken}=await start.json();
 const headers={'Content-Type':'application/json','Origin':origin,
  Cookie:csrfCookie,'X-CSRF-Token':csrfToken};
 const login=await fetch(origin+'/api/suite/account/login',{method:'POST',headers,
  body:JSON.stringify({email:'worker@example.test',
   password:'Synthetic only worker passphrase 123456'})});
 assert.equal(login.status,200);
 const identityCookie=login.headers.getSetCookie()
  .find(item=>item.includes('suite_identity'))?.split(';')[0];
 assert(identityCookie,'private central session was created');
 const browserHeaders={...headers,Cookie:csrfCookie+'; '+identityCookie};
 const native=async(app,path,body,asApp=app)=>{
  const credential='Basic '+Buffer.from(asApp.id+':'+asApp.secret).toString('base64');
  return fetch(origin+path,{method:'POST',headers:{
   Authorization:credential,'Content-Type':'application/json'
  },body:JSON.stringify(body)});
 };
 async function handoff(app){
  const data=pkce();
  const url=new URL('/connect',origin);
  for(const [key,value] of Object.entries({
   appId:app.appId,redirectUri:app.redirectUris[0],
   state:data.state,codeChallenge:data.codeChallenge
  }))url.searchParams.set(key,value);
  const allowed=nativeConnectRequest(url.searchParams,clients);
  assert(allowed,'exact registered browser handoff');
  const authorize=await fetch(origin+'/api/suite/auth/authorize',{
   method:'POST',headers:browserHeaders,body:JSON.stringify(allowed)});
  assert.equal(authorize.status,200,
   app.id+' central authorization should require the exact native grant');
  const response=await authorize.json();
  const callback=new URL(response.redirectUrl);
  assert.equal(callback.origin,new URL(app.redirectUris[0]).origin);
  assert.equal(callback.pathname,'/auth/callback');
  assert.deepEqual([...callback.searchParams.keys()].sort(),['code','state']);
  assert.equal(callback.searchParams.get('state'),data.state);
  const code=callback.searchParams.get('code');
  const exchangePayload={clientId:app.id,code,state:data.state,
   codeVerifier:data.verifier,redirectUri:app.redirectUris[0]};
  return {data,code,exchangePayload,callback,
   exchange:()=>native(app,'/api/suite/auth/exchange',exchangePayload)};
 }
 return {identity,org,owner,worker,clients,origin,browserHeaders,native,member,
  async handoff(appId){return handoff(clients.find(app=>app.id===appId))}};
}

test('all six standalone native clients bind codes/proofs to app, parent and monotonic global grant generation',{timeout:60000},async t=>{
 const f=await fixture(t);
 const proofs=new Map(),links=new Map();
 for(const app of apps){
  const client=f.clients.find(x=>x.id===app.id);
  const link=await f.handoff(app.id);
  const other=f.clients.find(x=>x.id!==app.id);
  assert.equal((await f.native(client,'/api/suite/auth/exchange',
    link.exchangePayload,other)).status,401,
   'a different native app cannot redeem '+app.id+' code');
  const response=await link.exchange();
  assert.equal(response.status,200,app.id);
  const details=await response.json();
  assert.equal(details.subject,f.worker.id);
  assert.equal(details.audience,app.id);
  assert.equal(details.issuer,'https://identity.example.test');
  assert.deepEqual(details.localIdentity,{
   userId:'native-'+app.id+'-worker',organizationId:'lab-a'
  });
  assert.match(details.sessionToken,/^[A-Za-z0-9_-]{32,128}$/);
  assert(!JSON.stringify(details).includes(client.secret));
  proofs.set(app.id,details.sessionToken);
  links.set(app.id,link);
  assert.equal((await link.exchange()).status,401,'code is one-time');
  const own=await f.native(client,'/api/suite/auth/introspect',{
   clientId:app.id,sessionToken:details.sessionToken
  });
  assert.equal(own.status,200);
  assert.equal((await own.json()).active,true);
  const foreign=await f.native(other,'/api/suite/auth/introspect',{
   clientId:other.id,sessionToken:details.sessionToken
  });
  assert.equal(foreign.status,200);
  assert.deepEqual(await foreign.json(),{active:false},
   'foreign app must not see token or actor details');
 }
 assert.equal(proofs.size,6);

 const goflo=f.clients.find(x=>x.id==='goflo');
 const mantrain=f.clients.find(x=>x.id==='mantrain');
 const methpipe=f.clients.find(x=>x.id==='methpipe');
 const duckman=f.clients.find(x=>x.id==='duckman');

 // Central org-side role edits are not standalone app permission authority:
 // changing a separate organization policy never creates a new native proof.
 f.org.saveMember({organizationId:'lab-a',actorId:f.owner.id,
  member:f.member({})});
 assert.equal((await f.native(goflo,'/api/suite/auth/introspect',{
  clientId:'goflo',sessionToken:proofs.get('goflo')
 })).status,200);

 // Revoking & rebinding the IDENTICAL native tuple may not resurrect old
 // proof; the parent login is still valid and a fresh grant can reauthorize.
 f.identity.revokeAppAccess(f.worker.id,'goflo');
 f.identity.grantAppAccess({userId:f.worker.id,appId:'goflo',
  localUserId:'native-goflo-worker',organizationId:'lab-a'});
 assert.deepEqual(await (await f.native(goflo,'/api/suite/auth/introspect',{
  clientId:'goflo',sessionToken:proofs.get('goflo')
 })).json(),{active:false},'ABA must not resurrect child proof');
 const fresh=await f.handoff('goflo');
 const freshReply=await fresh.exchange();
 assert.equal(freshReply.status,200);
 assert.equal((await (await f.native(goflo,'/api/suite/auth/introspect',{
  clientId:'goflo',sessionToken:(await freshReply.json()).sessionToken
 })).json()).active,true);

 // A different organization's native identity replaces old native user/tenant
 // but cannot revive an existing app proof.
 f.identity.grantAppAccess({userId:f.worker.id,appId:'duckman',
  localUserId:'native-duckman-worker',organizationId:'lab-b'});
 assert.deepEqual(await (await f.native(duckman,'/api/suite/auth/introspect',{
  clientId:'duckman',sessionToken:proofs.get('duckman')
 })).json(),{active:false});
 const methpipeToken=proofs.get('methpipe');
 const foreignRevoke=await f.native(mantrain,'/api/suite/auth/revoke',{
  clientId:'mantrain',sessionToken:methpipeToken,childOnly:true
 });
 assert.equal(foreignRevoke.status,204);
 assert.equal((await (await f.native(methpipe,'/api/suite/auth/introspect',{
  clientId:'methpipe',sessionToken:methpipeToken
 })).json()).active,true,'wrong-app childOnly revoke cannot affect sibling');
 assert.equal((await f.native(methpipe,'/api/suite/auth/revoke',{
  clientId:'methpipe',sessionToken:methpipeToken,childOnly:true
 })).status,204);
 assert.deepEqual(await (await f.native(methpipe,'/api/suite/auth/introspect',{
  clientId:'methpipe',sessionToken:methpipeToken
 })).json(),{active:false});
 assert.equal((await (await f.native(mantrain,'/api/suite/auth/introspect',{
  clientId:'mantrain',sessionToken:proofs.get('mantrain')
 })).json()).active,true,
  'childOnly disconnect must preserve independent parent and other child');

 // Parent logout invalidates every child proof regardless of active grants.
 const logout=await fetch(f.origin+'/api/suite/account/logout',{
  method:'POST',headers:f.browserHeaders,body:'{}'
 });
 assert.equal(logout.status,200);
 assert.equal((await logout.json()).loggedOut,true);
 for(const app of apps){
  const client=f.clients.find(x=>x.id===app.id);
  const r=await f.native(client,'/api/suite/auth/introspect',{
   clientId:app.id,sessionToken:proofs.get(app.id)
  });
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{active:false},app.id+' stale proof');
 }
 const parent=await fetch(f.origin+'/api/suite/auth/session',{
  headers:f.browserHeaders
 });
 assert.equal((await parent.json()).authenticated,false);
});

test('all six organization-mode clients DENY legacy grants despite membership, manual seats and valid local IDs',{timeout:60000},async t=>{
 const f=await fixture(t,{organizationMode:true});
 const account=await fetch(f.origin+'/api/suite/account',{headers:f.browserHeaders});
 assert.equal(account.status,200);
 const details=await account.json();
 assert.equal(details.apps.length,6);
 assert(details.apps.every(app=>app.enabled===false),
  'legacy grants may not advertise org-mode app entitlement');
 for(const app of apps){
  const client=f.clients.find(x=>x.id===app.id);
  const data=pkce();
  const url=new URL('/connect',f.origin);
  for(const [name,value] of Object.entries({
   appId:client.appId,redirectUri:client.redirectUris[0],
   state:data.state,codeChallenge:data.codeChallenge
  }))url.searchParams.set(name,value);
  const registered=nativeConnectRequest(url.searchParams,f.clients);
  assert(registered,'registered native callback source syntax');
  const r=await fetch(f.origin+'/api/suite/auth/authorize',{
   method:'POST',headers:f.browserHeaders,body:JSON.stringify(registered)
  });
  assert.equal(r.status,403,app.id+' must not authorize from a global grant');
  assert.deepEqual(await r.json(),{error:'access_denied'});
  const forgedCode=randomBytes(32).toString('base64url');
  const attempted=await f.native(client,'/api/suite/auth/exchange',{
   clientId:client.id,code:forgedCode,state:data.state,
   codeVerifier:data.verifier,redirectUri:client.redirectUris[0]
  });
  assert.equal(attempted.status,401);
  assert.deepEqual(await attempted.json(),{error:'invalid_grant'});
 }
});
