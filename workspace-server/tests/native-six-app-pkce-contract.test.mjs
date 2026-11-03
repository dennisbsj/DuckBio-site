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
async function fixture(t){
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
  identityStore:identity,authStore:auth.brokerStore,organizationStore:org,
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

test('six separate first-party native clients exchange only their own PKCE codes and proofs',{timeout:60000},async t=>{
 const f=await fixture(t);
 const proofs=new Map();
 for(const app of apps){
  const client=f.clients.find(x=>x.id===app.id);
  const link=await f.handoff(app.id);
  const other=f.clients.find(x=>x.id!==app.id);
  assert.equal((await f.native(client,'/api/suite/auth/exchange',link.exchangePayload,other)).status,401,
   'another native app cannot redeem '+app.id+' code');
  const response=await link.exchange();
  assert.equal(response.status,200,app.id);
  const details=await response.json();
  assert.equal(details.subject,f.worker.id);
  assert.equal(details.audience,app.id);
  assert.equal(details.issuer,'https://identity.example.test');
  assert.deepEqual(details.localIdentity,{
   userId:'native-'+app.id+'-worker',organizationId:'lab-a'
  },'no email matching or cross-app role promotion');
  assert.match(details.sessionToken,/^[A-Za-z0-9_-]{32,128}$/);
  assert(!JSON.stringify(details).includes(client.secret));
  proofs.set(app.id,details.sessionToken);
  assert.equal((await link.exchange()).status,401,'PKCE code must be single-use');
  const own=await f.native(client,'/api/suite/auth/introspect',{
   clientId:app.id,sessionToken:details.sessionToken});
  assert.equal(own.status,200);
  assert.equal((await own.json()).active,true);
  // RFC-style introspection deliberately returns 200 + active:false
  // rather than revealing whether another app's token exists.
  const foreign=await f.native(client,'/api/suite/auth/introspect',{
   clientId:other.id,sessionToken:details.sessionToken},other);
  assert.equal(foreign.status,200);
  assert.deepEqual(await foreign.json(),{active:false},
   'a foreign app must see no identity, audience, organization or validity');
  const unread=await f.native(client,'/api/suite/native/communications/unread',{
   sessionToken:details.sessionToken});
  assert.equal(unread.status,200);
  assert.deepEqual(await unread.json(),{counts:{chat:1,mail:1,notifications:0}});
 }
 assert.equal(proofs.size,6);
 const goflo=f.clients.find(x=>x.id==='goflo');
 const eel=f.clients.find(x=>x.id==='eel');
 const duckman=f.clients.find(x=>x.id==='duckman');
 // Revoking ONE app role does not revoke six independent parent entitlements.
 const roles=Object.fromEntries(apps.filter(x=>x.id!=='eel').map(x=>[x.id,x.role]));
 f.org.saveMember({organizationId:'lab-a',actorId:f.owner.id,member:f.member(roles)});
 assert.equal((await f.native(eel,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('eel')})).status,403);
 assert.equal((await f.native(goflo,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('goflo')})).status,200);
 // A valid proof mapped to the WRONG organization cannot borrow Lab A's seats.
 f.identity.grantAppAccess({userId:f.worker.id,appId:'duckman',
  localUserId:'native-duckman-worker',organizationId:'lab-b'});
 assert.equal((await f.native(duckman,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('duckman')})).status,401,
  'changing the registered native organization invalidates the old broker proof');
 assert.equal((await f.native(goflo,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('goflo')})).status,200);
 f.identity.revokeAppAccess(f.worker.id,'goflo');
 assert.equal((await f.native(goflo,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('goflo')})).status,401);
 // Retaining a central login cookie never reinstates revoked native grants.
 assert.equal((await f.native(eel,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('eel')})).status,403);

 // Cross-app child-only disconnect must be idempotent, local to the native
 // audience and independent of the worker's central Workspace login.
 const methpipe=f.clients.find(x=>x.id==='methpipe');
 const mantrain=f.clients.find(x=>x.id==='mantrain');
 const methpipeToken=proofs.get('methpipe');
 const foreignRevoke=await f.native(mantrain,'/api/suite/auth/revoke',{
  clientId:'mantrain',sessionToken:methpipeToken,childOnly:true});
 assert.equal(foreignRevoke.status,204,
  'foreign child-only revoke does not reveal whether a different app has a grant');
 const untouched=await f.native(methpipe,'/api/suite/auth/introspect',{
  clientId:'methpipe',sessionToken:methpipeToken});
 assert.equal((await untouched.json()).active,true,
  'foreign app cannot revoke another app native proof');
 const disconnect=()=>f.native(methpipe,'/api/suite/auth/revoke',{
  clientId:'methpipe',sessionToken:methpipeToken,childOnly:true});
 assert.equal((await disconnect()).status,204);
 assert.equal((await disconnect()).status,204,'repeated child-only logout stays safe');
 const revoked=await f.native(methpipe,'/api/suite/auth/introspect',{
  clientId:'methpipe',sessionToken:methpipeToken});
 assert.deepEqual(await revoked.json(),{active:false},
  'native app cannot revive its own disconnected child grant');
 assert.equal((await f.native(methpipe,'/api/suite/native/communications/unread',
  {sessionToken:methpipeToken})).status,401,
  'revoked child cannot fetch Workspace messages');
 assert.equal((await f.native(mantrain,'/api/suite/native/communications/unread',
  {sessionToken:proofs.get('mantrain')})).status,200,
  'another registered app keeps its independent proof');
 const parent=await fetch(f.origin+'/api/suite/auth/session',{
  headers:f.browserHeaders});
 assert.equal(parent.status,200);
 assert.equal((await parent.json()).authenticated,true,
  'native child-only disconnect must preserve independent Workspace parent login');

 // Global Workspace parent logout invalidates every existing native child
 // proof, even for clients whose local role was not individually revoked.
 const logout=await fetch(f.origin+'/api/suite/account/logout',{
  method:'POST',headers:f.browserHeaders,body:'{}'});
 assert.equal(logout.status,200,'central logout succeeds with authenticated CSRF');
 assert.equal((await logout.json()).loggedOut,true);
 for(const app of apps){
  const client=f.clients.find(x=>x.id===app.id);
  const proof=proofs.get(app.id);
  const introspection=await f.native(client,'/api/suite/auth/introspect',{
   clientId:app.id,sessionToken:proof});
  assert.equal(introspection.status,200,app.id+' introspection is opaque');
  assert.deepEqual(await introspection.json(),{active:false},
   app.id+' child cannot survive global parent logout');
  assert.equal((await f.native(client,'/api/suite/native/communications/unread',
   {sessionToken:proof})).status,401,
   app.id+' stale proof cannot access communications after central logout');
 }
 const signedOut=await fetch(f.origin+'/api/suite/auth/session',{
  headers:f.browserHeaders});
 assert.equal(signedOut.status,200);
 assert.equal((await signedOut.json()).authenticated,false,
  'replaying a stale central browser cookie must not reinstate Workspace login');
});
