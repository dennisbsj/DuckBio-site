/**
 * Regression: introspection must not assert active=true after an awaited
 * native/organization permission lookup outlives the child or parent TTL.
 * Uses a real Node HTTP broker and its existing memory test store only.
 * No LIVE billing, native services, accounts, or production session state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createAuthBroker,createMemoryBrokerStore} from '../shared-auth/broker.mjs';

const START=1_800_000_000_000;
const token=()=>randomBytes(32).toString('base64url');

async function fixture(t,{childUntil,parentUntil,afterAccess}){
 let now=START;
 const nativeToken=token();
 const secret=token();
 const localIdentity={userId:'private-native-user',organizationId:'private-native-tenant'};
 const parent={id:'private-session',subject:'private-central-user',
  displayName:'Private Test User',expiresAt:parentUntil,passwordChangeRequired:false};
 const store=createMemoryBrokerStore();
 await store.putProof(createHash('sha256').update(nativeToken).digest('hex'),{
  clientId:'goflo',appId:'goflo',parentSessionId:parent.id,
  subject:parent.subject,localIdentity,bindingRevision:'generation:1',
  expiresAt:childUntil
 });
 const identity={
  getSession:async()=>parent,
  authenticate:async()=>parent,
  getParentSession:async()=>parent,
  logout:async()=>{},
  async getAccess(){
   // A genuine asynchronous permission lookup can cross an expiry boundary.
   await Promise.resolve();
   now=afterAccess;
   return {localIdentity,bindingRevision:'generation:1'};
  }
 };
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 broker=createAuthBroker({
  origin,issuer:'https://identity.example.test',
  clients:[{id:'goflo',appId:'goflo',secret,
   redirectUris:['https://goflo.example.test/auth/callback']}],
  identity,store,clock:()=>now
 });
 const authorization='Basic '+Buffer.from('goflo:'+secret).toString('base64');
 return {
  now:()=>now,
  async introspect(){
   const response=await fetch(origin+'/api/suite/auth/introspect',{
    method:'POST',headers:{'Content-Type':'application/json',
     Authorization:authorization},
    body:JSON.stringify({clientId:'goflo',sessionToken:nativeToken})
   });
   assert.equal(response.status,200);
   return response.json();
  },
  nativeSession:()=>broker.authenticateNativeSession({
   headers:{authorization}
  },{clientId:'goflo',sessionToken:nativeToken})
 };
}

test('child proof expires DURING awaited native access check: HTTP introspection stays inactive',async t=>{
 const f=await fixture(t,{childUntil:START+1000,
  parentUntil:START+60_000,afterAccess:START+2000});
 assert.deepEqual(await f.introspect(),{active:false});
 assert.equal(await f.nativeSession(),null);
});

test('parent session expires DURING awaited native access check: HTTP introspection stays inactive',async t=>{
 const f=await fixture(t,{childUntil:START+60_000,
  parentUntil:START+1000,afterAccess:START+2000});
 assert.deepEqual(await f.introspect(),{active:false});
 assert.equal(await f.nativeSession(),null);
});

test('still-valid child and parent remain available after awaited native check',async t=>{
 const f=await fixture(t,{childUntil:START+60_000,
  parentUntil:START+60_000,afterAccess:START+2000});
 const assertion=await f.introspect();
 assert.equal(assertion.active,true);
 assert.equal(assertion.expiresAt,START+60_000);
 assert.deepEqual(assertion.localIdentity,{
  userId:'private-native-user',organizationId:'private-native-tenant'
 });
 assert.equal((await f.nativeSession()).active,true);
});


async function exchangeFixture(t,{codeUntil,parentUntil,afterAccess}){
 let now=START;
 const secret=token(),state=token(),verifier=token(),code=token();
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const redirectUri='https://goflo.example.test/auth/callback';
 const localIdentity={userId:'private-native-user',organizationId:'private-native-tenant'};
 const parent={id:'private-parent',subject:'private-subject',
  displayName:'Private User',expiresAt:parentUntil,passwordChangeRequired:false};
 const store=createMemoryBrokerStore();
 await store.putCode(createHash('sha256').update(code).digest('hex'),{
  clientId:'goflo',appId:'goflo',parentSessionId:parent.id,
  subject:parent.subject,state,challenge,redirectUri,returnPath:'/',
  localIdentity,bindingRevision:'generation:1',expiresAt:codeUntil
 });
 let writes=0;
 const originalPutProof=store.putProof.bind(store);
 store.putProof=async(...args)=>{writes++;return originalPutProof(...args)};
 const identity={
  getSession:async()=>parent,authenticate:async()=>parent,
  getParentSession:async()=>parent,logout:async()=>{},
  async getAccess(){
   await Promise.resolve();
   now=afterAccess;
   return {localIdentity,bindingRevision:'generation:1'};
  }
 };
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 broker=createAuthBroker({
  origin,issuer:'https://identity.example.test',
  clients:[{id:'goflo',appId:'goflo',secret,redirectUris:[redirectUri]}],
  identity,store,clock:()=>now
 });
 return {
  proofWrites:()=>writes,
  async exchange(){
   const response=await fetch(origin+'/api/suite/auth/exchange',{
    method:'POST',headers:{
     'Content-Type':'application/json',
     Authorization:'Basic '+Buffer.from('goflo:'+secret).toString('base64')
    },
    body:JSON.stringify({clientId:'goflo',code,state,
     codeVerifier:verifier,redirectUri})
   });
   return {status:response.status,data:await response.json()};
  }
 };
}

test('code expiry during awaited native lookup denies exchange without writing a proof',async t=>{
 const f=await exchangeFixture(t,{codeUntil:START+1000,
  parentUntil:START+60_000,afterAccess:START+2000});
 const result=await f.exchange();
 assert.deepEqual(result,{status:401,data:{error:'invalid_grant'}});
 assert.equal(f.proofWrites(),0);
});

test('parent expiry during awaited native lookup denies exchange without writing a proof',async t=>{
 const f=await exchangeFixture(t,{codeUntil:START+60_000,
  parentUntil:START+1000,afterAccess:START+2000});
 const result=await f.exchange();
 assert.deepEqual(result,{status:401,data:{error:'invalid_grant'}});
 assert.equal(f.proofWrites(),0);
});

test('a still-valid PKCE code and parent can issue one native proof after awaited check',async t=>{
 const f=await exchangeFixture(t,{codeUntil:START+60_000,
  parentUntil:START+60_000,afterAccess:START+2000});
 const result=await f.exchange();
 assert.equal(result.status,200);
 assert.equal(result.data.expiresAt,START+60_000);
 assert.deepEqual(result.data.localIdentity,{
  userId:'private-native-user',organizationId:'private-native-tenant'
 });
 assert.equal(f.proofWrites(),1);
});
