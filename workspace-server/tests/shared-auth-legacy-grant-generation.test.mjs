/** Legacy global grant ABA negative regression against REAL broker + private SQLite.
 * All identities and keys are synthetic. No native login, Stripe, DNS or production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {createIdentityStore,createLocalIdentityAdapter} from '../shared-auth/identity-store.mjs';
import {createAuthBroker,createMemoryBrokerStore} from '../shared-auth/broker.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createAccountService} from '../shared-auth/account-service.mjs';
import {createOrganizationStore} from '../organization-store.mjs';

const NOW=1800000000000;
const nativeUser='same-native-user';
const nativeOrg='same-native-tenant';
const password='Synthetic password long enough!';
const redirectUri='https://goflo.example.test/auth/callback';

async function serverFixture(t,{organizationMode=false}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-legacy-epoch-'));
 const store=createIdentityStore({databasePath:path.join(root,'identity.sqlite'),clock:()=>NOW});
 const user=await store.createUser({email:'legacy-test@example.test',displayName:'Legacy Test',password});
 store.grantAppAccess({userId:user.id,appId:'goflo',localUserId:nativeUser,organizationId:nativeOrg});
 let org=null;
 if(organizationMode){
  org=createOrganizationStore({databasePath:path.join(root,'organizations.sqlite'),
   clock:()=>NOW,verifyLiveSubscriptionEvidence:x=>x});
  org.setupOrganization({organizationId:'alpha',name:'Alpha',
   owner:{accountId:user.id,name:'Legacy',nickname:'Tester',email:user.email}});
  org.applyVerifiedSubscriptionTransition({source:'stripe_live',eventKey:'synthetic-event',
   organizationId:'alpha',subscriptionId:'synthetic-sub',revision:1,plan:'Single',
   apps:['goflo'],seats:1,status:'active',paidThrough:1900000000});
  org.saveMember({organizationId:'alpha',actorId:user.id,
   member:{accountId:user.id,name:'Legacy',nickname:'Tester',
    email:user.email,admin:true,roles:{goflo:'Analyst'}}});
 }
 const client={id:'goflo',appId:'goflo',secret:randomBytes(32).toString('base64url'),redirectUris:[redirectUri]};
 let broker,service,auth;
 writeFileSync(path.join(root,'index.html'),'<html><body>Synthetic</body></html>');
 const server=http.createServer(async(req,res)=>{
  if(organizationMode){
   if(!await service.handle(req,res)){res.statusCode=404;res.end();}
  }else if(!await broker.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 // Always register cleanup BEFORE constructing the service, so even a
 // configuration validation failure cannot leave the HTTP listener alive.
 t.after(async()=>{server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  auth?.close();org?.close();store.close();rmSync(root,{recursive:true,force:true})});
 if(organizationMode){
  auth=createSqliteAuthStores({databasePath:path.join(root,'broker.sqlite'),clock:()=>NOW});
  service=createAccountService({origin,issuer:'https://sso.example.test',
   clients:[client],identityStore:store,
   organizationStore:org,authStore:auth.brokerStore,assetRoot:root,clock:()=>NOW});
 }else broker=createAuthBroker({origin,issuer:'https://sso.example.test',
  clients:[client],identity:createLocalIdentityAdapter({store,origin}),
  store:createMemoryBrokerStore(),clock:()=>NOW});

 const cookies=new Map();
 let csrf=null;
 const call=async(route,body,{serverAuth=false}={})=>{
  const headers={'Content-Type':'application/json'};
  if(serverAuth)headers.Authorization='Basic '+Buffer.from(client.id+':'+client.secret).toString('base64');
  else {
   if(cookies.size)headers.Cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');
   headers.Origin=origin;
   if(csrf)headers['X-CSRF-Token']=csrf;
  }
  const response=await fetch(origin+'/api/suite/'+route,{
   method:body===undefined?'GET':'POST',headers,signal:AbortSignal.timeout(15000),
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!serverAuth)for(const header of response.headers.getSetCookie()){
   const [k,v]=header.split(';')[0].split('=');
   if(v)cookies.set(k,v);else cookies.delete(k);
  }
  return {status:response.status,data:response.status===204?null:await response.json()};
 };
 const begin=async()=>{
  const r=await call('auth/session');assert.equal(r.status,200);csrf=r.data.csrfToken;
 };
 const request=()=>{
  const state=randomBytes(32).toString('base64url');
  const verifier=randomBytes(32).toString('base64url');
  const codeChallenge=createHash('sha256').update(verifier).digest('base64url');
  return {state,verifier,target:{appId:'goflo',state,codeChallenge,
   codeChallengeMethod:'S256',redirectUri,returnPath:'/' }};
 };
 const authorize=async(kind='authorize')=>{
  const r=request();
  const issued=await call('auth/'+kind,{...r.target,...(kind==='login'?{email:user.email,password}:{})});
  return {...r,issued,code:issued.status===200?
   new URL(issued.data.redirectUrl).searchParams.get('code'):null};
 };
 const exchange=async(ticket)=>call('auth/exchange',{
  clientId:'goflo',code:ticket.code,state:ticket.state,
  codeVerifier:ticket.verifier,redirectUri},{serverAuth:true});
 const introspect=async(token)=>call('auth/introspect',{sessionToken:token},{serverAuth:true});
 return {root,store,user,org,call,begin,authorize,exchange,introspect};
}

test('a live broker child proof cannot resurrect after global grant revoke + identical rebind',async t=>{
 const f=await serverFixture(t);
 await f.begin();
 const initial=await f.authorize('login');
 assert.equal(initial.issued.status,200);
 const issued=await f.exchange(initial);
 assert.equal(issued.status,200);
 const token=issued.data.sessionToken;
 assert.equal((await f.introspect(token)).data.active,true);
 const pending=await f.authorize();
 assert.equal(pending.issued.status,200);
 f.store.revokeAppAccess(f.user.id,'goflo');
 f.store.grantAppAccess({userId:f.user.id,appId:'goflo',
  localUserId:nativeUser,organizationId:nativeOrg});
 assert.deepEqual((await f.introspect(token)).data,{active:false},
  'old proof must stay revoked after identical tuple is re-granted');
 assert.equal((await f.exchange(pending)).status,401,
  'a code from before revoke/regrant must not exchange');
 const fresh=await f.authorize();
 assert.equal(fresh.issued.status,200,'standalone native login remains supported');
 const exchanged=await f.exchange(fresh);
 assert.equal(exchanged.status,200);
 assert.equal((await f.introspect(exchanged.data.sessionToken)).data.active,true);
});

test('org-mode local identity adapter rejects all legacy grants even with current membership and paid app seat',async t=>{
 const f=await serverFixture(t,{organizationMode:true});
 await f.begin();
 const login=await f.authorize('login');
 assert.equal(login.issued.status,403,'legacy global grant is not org-native evidence');
 const accountLogin=await f.call('account/login',{email:f.user.email,password});
 assert.equal(accountLogin.status,200,'central login itself still works');
 const account=await f.call('account');
 assert.equal(account.status,200);
 const app=account.data.apps.find(a=>a.id==='goflo');
 assert.equal(app.enabled,false,
  'legacy mapping must not advertise an organization app as enabled');
 assert.equal(f.store.getAccess(f.user.id,'goflo')?.localIdentity.userId,nativeUser,
  'legacy standalone mapping remains stored but cannot authorize org mode');
});

test('global grant generation persists across fresh SQLite handles and same-tuple revoke/rebind',async t=>{
 const f=await serverFixture(t);
 const peer=createIdentityStore({databasePath:path.join(f.root,'identity.sqlite'),clock:()=>NOW});
 t.after(()=>peer.close());
 const before=f.store.getAccessWithRevision(f.user.id,'goflo');
 assert.match(before.bindingRevision,/^legacy-global:[1-9][0-9]*$/);
 peer.revokeAppAccess(f.user.id,'goflo');
 assert.equal(f.store.getAccessWithRevision(f.user.id,'goflo'),null);
 peer.grantAppAccess({userId:f.user.id,appId:'goflo',
  localUserId:nativeUser,organizationId:nativeOrg});
 const latest=f.store.getAccessWithRevision(f.user.id,'goflo');
 assert.deepEqual(latest.localIdentity,before.localIdentity);
 assert.notEqual(latest.bindingRevision,before.bindingRevision);
 const reopened=createIdentityStore({databasePath:path.join(f.root,'identity.sqlite'),clock:()=>NOW});
 t.after(()=>reopened.close());
 assert.equal(reopened.getAccessWithRevision(f.user.id,'goflo').bindingRevision,
  latest.bindingRevision,'a fresh Workspace connection must never reseed an established version');
 assert.deepEqual(f.store.getAccess(f.user.id,'goflo'),{
  localIdentity:{userId:nativeUser,organizationId:nativeOrg}
 },'direct standalone mapping shape stays unchanged');
});

test('one-time legacy DB migration seeds existing grants atomically, and subsequent opens preserve revisions',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'duckbio-legacy-migration-'));
 const dbPath=path.join(dir,'identity.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let store=createIdentityStore({databasePath:dbPath,clock:()=>NOW});
 const user=await store.createUser({email:'old-legacy@example.test',displayName:'Old',
  password});
 store.grantAppAccess({userId:user.id,appId:'eel',localUserId:'old-native',organizationId:'old-org'});
 store.close();
 // Simulate a genuine pre-migration v1 schema and SQLite header.
 // Never reset a deployed/modern database's migration marker.
 let db=new DatabaseSync(dbPath);
 try{
  db.exec('DROP TABLE suite_identity_grant_versions');
  db.exec('PRAGMA user_version=0');
 }finally{db.close();}
 store=createIdentityStore({databasePath:dbPath,clock:()=>NOW});
 assert.equal(store.getAccessWithRevision(user.id,'eel').bindingRevision,'legacy-global:1');
 store.revokeAppAccess(user.id,'eel');
 store.grantAppAccess({userId:user.id,appId:'eel',localUserId:'old-native',organizationId:'old-org'});
 assert.equal(store.getAccessWithRevision(user.id,'eel').bindingRevision,'legacy-global:3');
 store.close();
 store=createIdentityStore({databasePath:dbPath,clock:()=>NOW});
 try{assert.equal(store.getAccessWithRevision(user.id,'eel').bindingRevision,'legacy-global:3');}
 finally{store.close();}
});

test('established-but-corrupted grant version denies and refuses silent reset',async t=>{
 const f=await serverFixture(t);
 const db=new DatabaseSync(path.join(f.root,'identity.sqlite'));
 try{db.prepare('DELETE FROM suite_identity_grant_versions WHERE user_id=? AND app_id=?')
  .run(f.user.id,'goflo');}finally{db.close();}
 assert.equal(f.store.getAccessWithRevision(f.user.id,'goflo'),null);
 assert.throws(()=>f.store.revokeAppAccess(f.user.id,'goflo'),/invalid_grant_revision/);
 assert.throws(()=>f.store.grantAppAccess({userId:f.user.id,appId:'goflo',
  localUserId:nativeUser,organizationId:nativeOrg}),/invalid_grant_revision/);
 const reopened=createIdentityStore({databasePath:path.join(f.root,'identity.sqlite'),clock:()=>NOW});
 try{assert.equal(reopened.getAccessWithRevision(f.user.id,'goflo'),null);}
 finally{reopened.close();}
});

test('legacy grant revision overflow rolls back without deleting an existing mapping',async t=>{
 const f=await serverFixture(t);
 let db=new DatabaseSync(path.join(f.root,'identity.sqlite'));
 try{db.prepare('UPDATE suite_identity_grant_versions SET revision=? WHERE user_id=? AND app_id=?')
  .run(Number.MAX_SAFE_INTEGER,f.user.id,'goflo');}finally{db.close();}
 assert.equal(f.store.getAccessWithRevision(f.user.id,'goflo').bindingRevision,
  'legacy-global:'+Number.MAX_SAFE_INTEGER);
 assert.throws(()=>f.store.revokeAppAccess(f.user.id,'goflo'));
 assert.equal(f.store.getAccessWithRevision(f.user.id,'goflo')?.localIdentity.userId,nativeUser);
 assert.equal(f.store.getAccessWithRevision(f.user.id,'goflo').bindingRevision,
  'legacy-global:'+Number.MAX_SAFE_INTEGER);
});

test('a migrated identity DB refuses restart if the complete grant-generation table is lost',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'duckbio-legacy-table-loss-'));
 const dbPath=path.join(dir,'identity.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=createIdentityStore({databasePath:dbPath,clock:()=>NOW});
 const user=await store.createUser({email:'lost-table@example.test',displayName:'Lost Table',
  password});
 store.grantAppAccess({userId:user.id,appId:'goflo',localUserId:'stable-native'});
 assert.match(store.getAccessWithRevision(user.id,'goflo').bindingRevision,/^legacy-global:/);
 store.close();
 const db=new DatabaseSync(dbPath);
 try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1,
   'migration marker must survive closing the original SQLite handle');
  db.exec('DROP TABLE suite_identity_grant_versions');
 }finally{db.close();}
 assert.throws(()=>createIdentityStore({databasePath:dbPath,clock:()=>NOW}),
  /invalid_grant_revision/,
  'a lost version table cannot re-seed live grants at the original epoch');
 const check=new DatabaseSync(dbPath);
 try{
  assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='suite_identity_grant_versions'").get().n,0,
   'failed initialization must roll back without constructing new versions');
  assert.equal(check.prepare('PRAGMA user_version').get().user_version,1);
 }finally{check.close();}
});
