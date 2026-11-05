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

test('org-mode native unread refuses legacy global mapping even if user is member with assigned app role',async t=>{
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
 const basic='Basic '+Buffer.from(client.id+':'+client.secret).toString('base64');
 const request={appId:'eel',redirectUri:client.redirectUris[0],
  codeChallenge:createHash('sha256').update(verifier).digest('base64url'),
  codeChallengeMethod:'S256',state,returnPath:'/'};
 const authorize=await fetch(origin+'/api/suite/auth/authorize',{method:'POST',
  headers:{...browserHeaders,Cookie:csrfCookie+'; '+identityCookie},
  body:JSON.stringify(request)});
 assert.equal(authorize.status,403,
  'a global mapping must not create an org-mode child even when native IDs match');
 assert.deepEqual(await authorize.json(),{error:'access_denied'});
 const native=async(body,{authorization=basic,extraHeaders={}}={})=>
  fetch(origin+'/api/suite/native/communications/unread',{method:'POST',
   headers:{Authorization:authorization,'Content-Type':'application/json',...extraHeaders},
   body:JSON.stringify(body)});
 const nonexistentToken=randomBytes(32).toString('base64url');
 assert.equal((await native({sessionToken:nonexistentToken})).status,401);
 assert.equal((await native({sessionToken:nonexistentToken,accountId:owner.id})).status,400,
  'a native client cannot choose arbitrary central users');
 assert.equal((await native({sessionToken:nonexistentToken},{
  authorization:'Basic '+Buffer.from('eel:wrong-secret').toString('base64')})).status,401);
 assert.equal((await native({sessionToken:nonexistentToken},{
  extraHeaders:{Origin:origin}})).status,401);
 assert.equal((await native({sessionToken:nonexistentToken},{
  extraHeaders:{Cookie:identityCookie}})).status,401);
 assert.equal((await fetch(origin+'/api/suite/native/communications/unread')).status,405);
 assert.equal((await native({sessionToken:nonexistentToken})).status,401);
 // Neither revoking nor re-granting a global grant can mint an org-scoped
 // native session when the actual private organization broker remains dormant.
 identity.revokeAppAccess(worker.id,'eel');
 identity.grantAppAccess({userId:worker.id,appId:'eel',
  localUserId:'native-worker',organizationId:'lab-a'});
 assert.equal((await native({sessionToken:nonexistentToken})).status,401);
 const second=await fetch(origin+'/api/suite/auth/authorize',{method:'POST',
  headers:{...browserHeaders,Cookie:csrfCookie+'; '+identityCookie},
  body:JSON.stringify({...request,state:randomBytes(32).toString('base64url')})});
 assert.equal(second.status,403);
 assert.deepEqual(await second.json(),{error:'access_denied'});
});
