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

test('native app can read only its validated central identity unread counters, never arbitrary users',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-native-communications-'));
 const identity=createIdentityStore({databasePath:join(dir,'identity.sqlite')});
 const auth=createSqliteAuthStores({databasePath:join(dir,'auth.sqlite')});
 const org=createOrganizationStore({databasePath:join(dir,'org.sqlite')});
 const ownerToken=randomBytes(32).toString('base64url');
 identity.configureBootstrapToken(ownerToken);
 const owner=await identity.bootstrap(ownerToken,{email:'owner@example.test',
  displayName:'Owner',password:'Owner passphrase 123456'});
 const worker=await identity.createUser({email:'worker@example.test',
  displayName:'Worker',password:'Worker passphrase 123456'});
 org.setupOrganization({organizationId:'lab-a',name:'Lab A',
  owner:{accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 org.applyVerifiedSeatPurchase({reference:'test-seats',organizationId:'lab-a',
  plan:'Single',apps:['eel'],seats:2});
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:{
  accountId:worker.id,name:'Worker',nickname:'Worker',
  email:'worker@example.test',admin:false,roles:{eel:'scientist'}}});
 identity.grantAppAccess({userId:worker.id,appId:'eel',
  localUserId:'native-worker',organizationId:'lab-a'});
 const messages=createCommunicationsStore({databasePath:join(dir,'messages.sqlite'),
  ownerAccountId:owner.id});
 messages.sendChat({senderId:owner.id,recipientId:worker.id,
  body:'Review @u-'+Buffer.from(worker.id).toString('hex'),clientId:'native-chat'});
 messages.sendMail({senderId:owner.id,recipientId:worker.id,
  toAddress:messages.addressFor(worker.id),subject:'Review',body:'Please review',
  clientId:'native-mail'});
 const client={id:'eel',appId:'eel',secret:randomBytes(32).toString('base64url'),
  redirectUris:['https://ducknote.example.test/auth/callback'],
  nativeOrigin:'https://ducknote.example.test'};
 let service;
 const server=http.createServer(async(req,res)=>{
  if(!await service.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  messages.close();org.close();identity.close();auth.close();
  rmSync(dir,{recursive:true,force:true});
 });
 service=createAccountService({origin,issuer:'https://identity.example.test',
  clients:[client],identityStore:identity,organizationStore:org,
  communicationsStore:messages,ownerAccountId:owner.id,
  authStore:auth.brokerStore,assetRoot:dir,getClientAddress:req=>req.socket.remoteAddress});
 const csrfResponse=await fetch(origin+'/api/suite/auth/session');
 const csrfCookie=csrfResponse.headers.get('set-cookie').split(';')[0];
 const csrf=(await csrfResponse.json()).csrfToken;
 const browserHeaders={'Content-Type':'application/json','Origin':origin,
  'Cookie':csrfCookie,'X-CSRF-Token':csrf};
 const login=await fetch(origin+'/api/suite/account/login',{method:'POST',
  headers:browserHeaders,body:JSON.stringify({
   email:'worker@example.test',password:'Worker passphrase 123456'})});
 assert.equal(login.status,200);
 const identityCookie=login.headers.getSetCookie()
  .find(value=>value.includes('suite_identity')).split(';')[0];
 const verifier=randomBytes(32).toString('base64url');
 const state=randomBytes(32).toString('base64url');
 const authorize=await fetch(origin+'/api/suite/auth/authorize',{method:'POST',
  headers:{...browserHeaders,Cookie:csrfCookie+'; '+identityCookie},
  body:JSON.stringify({appId:'eel',redirectUri:client.redirectUris[0],
   codeChallenge:createHash('sha256').update(verifier).digest('base64url'),
   codeChallengeMethod:'S256',state,returnPath:'/'})});
 assert.equal(authorize.status,200);
 const code=new URL((await authorize.json()).redirectUrl).searchParams.get('code');
 const basic='Basic '+Buffer.from(client.id+':'+client.secret).toString('base64');
 const exchange=await fetch(origin+'/api/suite/auth/exchange',{method:'POST',
  headers:{Authorization:basic,'Content-Type':'application/json'},
  body:JSON.stringify({clientId:client.id,code,state,codeVerifier:verifier,
   redirectUri:client.redirectUris[0]})});
 assert.equal(exchange.status,200);
 const token=(await exchange.json()).sessionToken;
 assert.match(token,/^[A-Za-z0-9_-]{32,128}$/);
 const native=async(body,{authorization=basic,extraHeaders={}}={})=>
  fetch(origin+'/api/suite/native/communications/unread',{method:'POST',
   headers:{Authorization:authorization,'Content-Type':'application/json',...extraHeaders},
   body:JSON.stringify(body)});
 const good=await native({sessionToken:token});
 assert.equal(good.status,200);
 assert.deepEqual(await good.json(),{counts:{chat:1,mail:1,notifications:1}});
 assert.match(good.headers.get('cache-control'),/no-store/);
 assert.equal(good.headers.get('set-cookie'),null);
 assert.equal((await native({sessionToken:token,accountId:owner.id})).status,400);
 assert.equal((await native({sessionToken:'A'.repeat(43)})).status,401);
 assert.equal((await native({sessionToken:token},{
  authorization:'Basic '+Buffer.from('eel:wrong-secret').toString('base64')})).status,401);
 assert.equal((await native({sessionToken:token},{
  extraHeaders:{Origin:origin}})).status,401);
 assert.equal((await native({sessionToken:token},{
  extraHeaders:{Cookie:identityCookie}})).status,401);
 assert.equal((await fetch(origin+'/api/suite/native/communications/unread')).status,405);
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:{
  accountId:worker.id,name:'Worker',nickname:'Worker',
  email:'worker@example.test',admin:false,roles:{}}});
 assert.equal((await native({sessionToken:token})).status,403,
  'revoking the current organization app role blocks unread counts');
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:{
  accountId:worker.id,name:'Worker',nickname:'Worker',
  email:'worker@example.test',admin:false,roles:{eel:'scientist'}}});
 assert.equal((await native({sessionToken:token})).status,200);
 identity.revokeAppAccess(worker.id,'eel');
 assert.equal((await native({sessionToken:token})).status,401,
  'revoking the app mapping immediately invalidates the native proof');
});
