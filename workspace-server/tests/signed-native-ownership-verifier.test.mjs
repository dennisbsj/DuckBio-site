import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signProof} from 'node:crypto';
import {
 createSignedNativeOwnershipVerifier,canonicalNativeOwnershipProofBytes
} from '../shared-auth/signed-native-ownership-verifier.mjs';

const ENDPOINT='https://native.example.test/private/workspace/verify-ownership';
const TOKEN='synthetic-private-operator-bearer-token-123456789';
const NOW=1800000000000;
const ID=Object.freeze({
 appId:'goflo',workspaceAccountId:'central-user-alpha',
 workspaceOrganizationId:'central-org-alpha',
 nativeUserId:'native-user-alpha',
 nativeOrganizationId:'native-org-alpha'
});
const keys=generateKeyPairSync('ed25519');
const publicKeyPem=keys.publicKey.export({type:'spki',format:'pem'});
const client=Object.freeze({
 endpoint:ENDPOINT,keyId:'native-test-v1',publicKeyPem,token:TOKEN
});
function fixture({
 now=NOW,mutateProof=p=>p,mutateEnvelope=x=>x,
 httpStatus=200,contentType='application/json',
 transportError=null
}={}){
 const requests=[];
 let responseBytes=0;
 const transport=async(url,init)=>{
  requests.push({url,init});
  if(transportError)throw transportError;
  const input=JSON.parse(init.body);
  const payload=mutateProof({
   ...input,keyId:client.keyId,issuedAt:now,expiresAt:now+15_000,
   active:true,ownershipVerified:true
  });
  const signed=signProof(null,canonicalNativeOwnershipProofBytes(payload),
   keys.privateKey).toString('base64url');
  const response=mutateEnvelope({payload,signature:signed});
  const json=JSON.stringify(response);
  responseBytes=Buffer.byteLength(json);
  return new Response(json,{status:httpStatus,headers:{
   'content-type':contentType
  }});
 };
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},fetchImpl:transport,
  clock:()=>now
 });
 return {
  verifier,requests,
  setNow:x=>{now=x},
  bytes:()=>responseBytes
 };
}

test('native Ed25519 proof must bind exact IDs, purpose, one-time nonce and trusted pinned native key',async()=>{
 const f=fixture();
 const yes=await f.verifier.verifyNativeMapping(ID);
 assert.equal(yes,true);
 assert.equal(f.requests.length,1);
 const {url,init}=f.requests[0];
 const body=JSON.parse(init.body);
 assert.equal(url,ENDPOINT);
 assert.equal(init.method,'POST');
 assert.equal(init.redirect,'error');
 assert.equal(init.credentials,'omit');
 assert.equal(init.cache,'no-store');
 assert.equal(init.headers.authorization,'Bearer '+TOKEN);
 assert.equal(body.version,'duckbio.native-ownership.v1');
 assert.equal(body.purpose,'inspect');
 assert.equal(body.nonce.length,43);
 assert.deepEqual(Object.keys(body).sort(),[
  'appId','nativeOrganizationId','nativeUserId','nonce','purpose','version',
  'workspaceAccountId','workspaceOrganizationId'
 ].sort());
 assert.equal(await f.verifier.verifyNativeMapping(ID),true);
 assert.notEqual(JSON.parse(f.requests[0].init.body).nonce,
  JSON.parse(f.requests[1].init.body).nonce);
});
test('provisioning and migration require actor identity and differently scoped signed purposes',async()=>{
 const f=fixture(),x={
  actorId:'operator-one',userId:ID.workspaceAccountId,appId:ID.appId,
  workspaceOrganizationId:ID.workspaceOrganizationId,
  nativeUserId:ID.nativeUserId,nativeOrganizationId:ID.nativeOrganizationId
 };
 assert.equal(await f.verifier.verifyNativeOwnership({...x,operation:'bind'}),true);
 assert.equal(JSON.parse(f.requests[0].init.body).purpose,'bind');
 assert.equal(await f.verifier.verifyNativeOwnership({...x,operation:'migrate'}),true);
 assert.equal(JSON.parse(f.requests[1].init.body).purpose,'migrate');
 assert.equal(await f.verifier.verifyNativeOwnership({...x,operation:'revoke'}),false);
 assert.equal(await f.verifier.verifyNativeOwnership({...x,actorId:null,operation:'bind'}),false);
 assert.equal(f.requests.length,2,'no fetch for invalid actor or unsupported operation');
});
test('unregistered apps including DataDuck fail without an HTTPS attempt',async()=>{
 const f=fixture();
 for(const appId of ['dataduck','unknown','goflo/../duckman']){
  assert.equal(await f.verifier.verifyNativeMapping({...ID,appId}),false);
 }
 assert.equal(f.requests.length,0);
});
test('replayed signed native response fails because Workspace generates a fresh challenge',async()=>{
 const previous=fixture();
 let stale=null;
 const capturing=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},clock:()=>NOW,
  fetchImpl:async(_url,init)=>{
   if(!stale){
    const input=JSON.parse(init.body);
    const payload={...input,keyId:client.keyId,
     issuedAt:NOW,expiresAt:NOW+15_000,active:true,ownershipVerified:true};
    stale={payload,signature:signProof(null,
     canonicalNativeOwnershipProofBytes(payload),keys.privateKey)
      .toString('base64url')};
   }
   return new Response(JSON.stringify(stale),{headers:{
    'content-type':'application/json'
   }});
  }
 });
 assert.equal(await capturing.verifyNativeMapping(ID),true);
 assert.equal(await capturing.verifyNativeMapping(ID),false);
 assert.equal(previous.requests.length,0);
});
test('native proof with valid signature but wrong identities or inactive native account fails closed',async()=>{
 const mutations=[
  p=>({...p,workspaceAccountId:'different-user'}),
  p=>({...p,workspaceOrganizationId:'other-org'}),
  p=>({...p,nativeUserId:'other-native-user'}),
  p=>({...p,nativeOrganizationId:'other-native-org'}),
  p=>({...p,appId:'duckman'}),
  p=>({...p,purpose:'bind'}),
  p=>({...p,nonce:'different-nonce'}),
  p=>({...p,active:false}),
  p=>({...p,ownershipVerified:false}),
  p=>({...p,keyId:'attacker-kid'}),
  p=>({...p,version:'other-version'})
 ];
 for(const mutateProof of mutations){
  const f=fixture({mutateProof});
  assert.equal(await f.verifier.verifyNativeMapping(ID),false);
 }
});
test('tampering signed payload without native signing private key fails verification',async()=>{
 const f=fixture({mutateEnvelope:x=>({
  ...x,payload:{...x.payload,nativeOrganizationId:'forged'}
 })});
 assert.equal(await f.verifier.verifyNativeMapping(ID),false);
 const h=fixture({mutateEnvelope:x=>({...x,signature:'A'.repeat(86)})});
 assert.equal(await h.verifier.verifyNativeMapping(ID),false);
});
test('expired, future-dated or overlong native proof TTL fails even when signed',async()=>{
 for(const bad of [
  p=>({...p,issuedAt:NOW-40_000,expiresAt:NOW+1_000}),
  p=>({...p,issuedAt:NOW+6_000,expiresAt:NOW+10_000}),
  p=>({...p,expiresAt:NOW}),
  p=>({...p,expiresAt:NOW+45_000}),
  p=>({...p,issuedAt:'1800000000000'}),
  p=>({...p,expiresAt:null})
 ]){
  const f=fixture({mutateProof:bad});
  assert.equal(await f.verifier.verifyNativeMapping(ID),false);
 }
});
test('native transport outage, redirect status, non-JSON and enormous replies fail closed',async()=>{
 for(const opts of [
  {transportError:Error('connection reset')},
  {httpStatus:302},
  {httpStatus:403},
  {contentType:'text/html'},
  {mutateEnvelope:e=>({...e,extra:'unexpected'})},
  {mutateEnvelope:e=>({...e,payload:{...e.payload,role:'Admin'}})},
  {mutateEnvelope:e=>({...e,garbage:'x'.repeat(10_000)})}
 ]){
  const f=fixture(opts);
  assert.equal(await f.verifier.verifyNativeMapping(ID),false);
 }
});
test('safely rejects browser-selected endpoint, HTTP URL, weak/unsupported key, redirects and credentials',()=>{
 const invalid=[
  {endpoint:'http://native.example.test/private/workspace/verify-ownership'},
  {endpoint:'https://user:secret@native.example.test/private/verify'},
  {endpoint:'https://native.example.test/private/verify?org=other'},
  {endpoint:'https://native.example.test/private/verify#x'},
  {endpoint:'https://native.example.test/private/verify',token:'short'},
  {endpoint:ENDPOINT,keyId:'not allowed'},
  {endpoint:ENDPOINT,publicKeyPem:'not a valid key'}
 ];
 for(const change of invalid){
  assert.throws(()=>createSignedNativeOwnershipVerifier({
   clients:{goflo:{...client,...change}},
   fetchImpl:async()=>{throw Error('should not happen')}
  }),/invalid_private_native_client/);
 }
 assert.throws(()=>createSignedNativeOwnershipVerifier({
  clients:{dataduck:client}
 }),/invalid_private_native_client/);
 assert.throws(()=>createSignedNativeOwnershipVerifier({clients:{}}),
  /private_native_clients_required/);
});
test('only a complete exact mapping tuple can request verification, no browser role assertions',async()=>{
 const f=fixture();
 for(const input of [
  {...ID,role:'Admin'}, {...ID,permission:'*'},
  {...ID,workspaceAccountId:'other@domain.example'},
  {...ID,nativeUserId:''},{...ID,nativeOrganizationId:null},
  {...ID,appId:'__proto__'},
  {appId:'goflo',workspaceAccountId:ID.workspaceAccountId}
 ]){
  assert.equal(await f.verifier.verifyNativeMapping(input),false);
 }
 assert.equal(f.requests.length,0);
});

test('key rotation accepts only explicitly pinned keys inside their individual windows',async()=>{
 const old=generateKeyPairSync('ed25519'),next=generateKeyPairSync('ed25519');
 const pinned=key=>key.publicKey.export({type:'spki',format:'pem'});
 const config={
  endpoint:ENDPOINT,token:TOKEN,
  signingKeys:[
   {keyId:'old',publicKeyPem:pinned(old),
    notBeforeMs:NOW-10_000,notAfterMs:NOW+7_000},
   {keyId:'next',publicKeyPem:pinned(next),
    notBeforeMs:NOW,notAfterMs:NOW+20_000}
  ]
 };
 let now=NOW-2_000,keyId='old',privateKey=old.privateKey;
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:config},clock:()=>now,
  fetchImpl:async(_url,init)=>{
   const payload={...JSON.parse(init.body),keyId,
    issuedAt:now,expiresAt:now+1_000,
    active:true,ownershipVerified:true};
   const signature=signProof(null,canonicalNativeOwnershipProofBytes(payload),
    privateKey).toString('base64url');
   return new Response(JSON.stringify({payload,signature}),{
    headers:{'content-type':'application/json'}
   });
  }
 });
 assert.equal(await verifier.verifyNativeMapping(ID),true,'old key valid before rollout');
 keyId='next';privateKey=next.privateKey;
 assert.equal(await verifier.verifyNativeMapping(ID),false,'new key cannot predate rollout');
 now=NOW;
 assert.equal(await verifier.verifyNativeMapping(ID),true,'new key valid in overlap');
 keyId='old';privateKey=old.privateKey;
 assert.equal(await verifier.verifyNativeMapping(ID),true,'old key valid in overlap');
 now=NOW+8_000;
 assert.equal(await verifier.verifyNativeMapping(ID),false,'old key retired');
 keyId='next';privateKey=next.privateKey;
 assert.equal(await verifier.verifyNativeMapping(ID),true,'new key survives cutover');
 now=NOW+19_500;
 assert.equal(await verifier.verifyNativeMapping(ID),false,
  'proof may not extend beyond pinned key expiry');
 now=NOW+20_000;
 assert.equal(await verifier.verifyNativeMapping(ID),false,
  'retired key cannot be accepted at the expiry instant');
 now=NOW;
 keyId='not-pinned';
 assert.equal(await verifier.verifyNativeMapping(ID),false,
  'a genuine signature cannot introduce a new key ID');
});

test('cross-app Ed25519 signing keys stay isolated even for equal key IDs',async()=>{
 const other=generateKeyPairSync('ed25519');
 const duckman={...client,endpoint:'https://duckman.example.test/private/verify',
  publicKeyPem:other.publicKey.export({type:'spki',format:'pem'})};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client,duckman},clock:()=>NOW,
  fetchImpl:async(_url,init)=>{
   const payload={...JSON.parse(init.body),keyId:client.keyId,
    issuedAt:NOW,expiresAt:NOW+1000,
    active:true,ownershipVerified:true};
   // The GoFlo private signing key must not verify for DuckMan.
   const signature=signProof(null,canonicalNativeOwnershipProofBytes(payload),
    keys.privateKey).toString('base64url');
   return new Response(JSON.stringify({payload,signature}),{
    headers:{'content-type':'application/json'}
   });
  }
 });
 assert.equal(await verifier.verifyNativeMapping(ID),true);
 assert.equal(await verifier.verifyNativeMapping({...ID,appId:'duckman'}),false);
});

test('rejects ambiguous, duplicate, unbounded or malformed key-rotation policies',()=>{
 const k=key=>key.publicKey.export({type:'spki',format:'pem'});
 const one={keyId:'old',publicKeyPem:k(keys),
  notBeforeMs:NOW-1000,notAfterMs:NOW+20_000};
 const different={...one,keyId:'new'};
 const invalid=[
  {signingKeys:[]},
  {signingKeys:[one,one]},
  {signingKeys:[one,different,{...one,keyId:'third'}]},
  {signingKeys:[{...one,notAfterMs:one.notBeforeMs}]},
  {signingKeys:[{...one,notBeforeMs:-1}]},
  {signingKeys:[{...one,notAfterMs:Infinity}]},
  {signingKeys:[{...one,notAfterMs:'tomorrow'}]},
  {signingKeys:[{...one,keyId:'bad key'}]},
  {signingKeys:[{...one,unexpected:true}]},
  {signingKeys:[{...one,publicKeyPem:'invalid'}]},
  {signingKeys:[{keyId:one.keyId,publicKeyPem:one.publicKeyPem}]},
  {signingKeys:[one],keyId:'also-configured'},
  {signingKeys:[one],publicKeyPem:one.publicKeyPem},
  {signingKeys:'not-an-array'}
 ];
 for(const overrides of invalid){
  assert.throws(()=>createSignedNativeOwnershipVerifier({
   clients:{goflo:{endpoint:ENDPOINT,token:TOKEN,...overrides}}
  }),/invalid_private_native_client/);
 }
});
