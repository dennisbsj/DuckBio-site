import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createSignedNativeOwnershipVerifier,
 canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';

const APPS=['limsman','eel','methpipe','mantrain','duckman','goflo'];
const NOW=1800000000000;
const TOKEN='synthetic-private-key-rotation-bearer-123456789';
const keys=Object.fromEntries(APPS.map(id=>[id,{
 old:generateKeyPairSync('ed25519'),
 next:generateKeyPairSync('ed25519')
}]));
const pub=x=>x.publicKey.export({format:'pem',type:'spki'});
const fixture=()=>{
 let now=NOW,activeSigner='old',fetches=0,mutatePayload=x=>x;
 const clients=Object.fromEntries(APPS.map(appId=>[appId,{
  endpoint:'https://'+appId+'.native.example.test/private/ownership',
  token:TOKEN,signingKeys:[
   {keyId:appId+'-old',publicKeyPem:pub(keys[appId].old),
    notBefore:NOW-10000,notAfter:NOW+10000},
   {keyId:appId+'-next',publicKeyPem:pub(keys[appId].next),
    notBefore:NOW-1000,notAfter:NOW+60000}
  ]
 }]));
 const transport=async(url,request)=>{
  fetches++;
  const appId=new URL(url).hostname.split('.')[0];
  assert.equal(request.headers.authorization,'Bearer '+TOKEN);
  const challenge=JSON.parse(request.body);
  assert.equal(challenge.appId,appId);
  const payload=mutatePayload({
   ...challenge,keyId:appId+'-'+activeSigner,
   issuedAt:now,expiresAt:now+1000,
   active:true,ownershipVerified:true
  });
  const signature=sign(null,canonicalNativeOwnershipProofBytes(payload),
   keys[appId][activeSigner].privateKey).toString('base64url');
  return Response.json({payload,signature});
 };
 const verifier=createSignedNativeOwnershipVerifier({
  clients,clock:()=>now,fetchImpl:transport
 });
 const input=appId=>({
  appId,workspaceAccountId:'central-person-'+appId,
  workspaceOrganizationId:'central-org-'+appId,
  nativeUserId:'native-account-'+appId,
  nativeOrganizationId:'native-org-'+appId
 });
 return {verifier,input,clients,
  now:()=>now,setTime:n=>{now=n},setSigner:x=>{activeSigner=x},
  requests:()=>fetches,setPayload:fn=>{mutatePayload=fn}
 };
};

test('all SIX independent apps accept both explicitly pinned Ed25519 keys during their overlap without an SSO grant',async()=>{
 const f=fixture();
 for(const appId of APPS){
  f.setSigner('old');
  assert.equal(await f.verifier.verifyNativeMapping(f.input(appId)),true,appId+' old');
  f.setSigner('next');
  assert.equal(await f.verifier.verifyNativeMapping(f.input(appId)),true,appId+' next');
 }
 assert.equal(f.requests(),12);
 assert(!APPS.includes('dataduck'));
 assert.equal(await f.verifier.verifyNativeMapping(f.input('dataduck')),false);
 assert.equal(f.requests(),12);
});

test('retired keys stop working exactly at notAfter even when a newer key remains valid',async()=>{
 const f=fixture();
 f.setTime(NOW+10000);
 f.setSigner('old');
 for(const appId of APPS)
  assert.equal(await f.verifier.verifyNativeMapping(f.input(appId)),false,appId+' retired');
 f.setSigner('next');
 for(const appId of APPS)
  assert.equal(await f.verifier.verifyNativeMapping(f.input(appId)),true,appId+' current');
 assert.equal(f.requests(),12);
});

test('no signer active: fail closed BEFORE any outbound native request',async()=>{
 const f=fixture();
 f.setTime(NOW+60000);
 for(const appId of APPS)
  assert.equal(await f.verifier.verifyNativeMapping(f.input(appId)),false,appId);
 assert.equal(f.requests(),0);
});

test('a key retiring during an awaited native response cannot finish authorization',async()=>{
 let now=NOW+9000,calls=0;
 const key=keys.goflo.old;
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:{
   endpoint:'https://goflo.native.example.test/private/ownership',
   token:TOKEN,signingKeys:[{
    keyId:'old',publicKeyPem:pub(key),
    notBefore:NOW-10000,notAfter:NOW+10000
   }]
  }},clock:()=>now,
  fetchImpl:async(_url,request)=>{
   calls++;
   const payload={...JSON.parse(request.body),keyId:'old',
    issuedAt:NOW+9000,expiresAt:NOW+9500,
    active:true,ownershipVerified:true};
   const signature=sign(null,canonicalNativeOwnershipProofBytes(payload),
    key.privateKey).toString('base64url');
   now=NOW+10000; // Simulate signed network response crossing retirement.
   return Response.json({payload,signature});
  }
 });
 assert.equal(await verifier.verifyNativeMapping(fixture().input('goflo')),false);
 assert.equal(calls,1);
});

test('a proof may not extend beyond the pinned public key retirement deadline',async()=>{
 const f=fixture();
 f.setTime(NOW+9000);
 f.setSigner('old');
 f.setPayload(p=>({...p,expiresAt:NOW+10500}));
 assert.equal(await f.verifier.verifyNativeMapping(f.input('goflo')),false);
 f.setPayload(p=>({...p,expiresAt:NOW+9500}));
 assert.equal(await f.verifier.verifyNativeMapping(f.input('goflo')),true);
});

test('pinned Ed25519 keys must not be reused as a different key ID or native app',async()=>{
 const f=fixture();
 const reused={...f.clients.goflo,signingKeys:[
  f.clients.goflo.signingKeys[0],
  {...f.clients.goflo.signingKeys[1],
   publicKeyPem:f.clients.goflo.signingKeys[0].publicKeyPem}
 ]};
 assert.throws(()=>createSignedNativeOwnershipVerifier({
  clients:{goflo:reused}
 }),/invalid_private_native_client/);
 // Even a correctly signed proof with GoFlo's private key cannot be
 // replayed as DuckNote's distinct pinned signing key.
 const expected=keys.eel.next;
 const gofloKey=keys.goflo.next;
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{eel:f.clients.eel},clock:()=>NOW,
  fetchImpl:async(_url,request)=>{
   const payload={...JSON.parse(request.body),keyId:'eel-next',
    issuedAt:NOW,expiresAt:NOW+1000,
    active:true,ownershipVerified:true};
   return Response.json({payload,signature:sign(null,
    canonicalNativeOwnershipProofBytes(payload),
    gofloKey.privateKey).toString('base64url')});
  }
 });
 assert(expected);
 assert.equal(await verifier.verifyNativeMapping(f.input('eel')),false);
});

test('public Ed25519 signing material cannot be pinned to two different native applications',()=>{
 const f=fixture();
 const eel={...f.clients.eel,signingKeys:[
  {...f.clients.eel.signingKeys[0],
   publicKeyPem:f.clients.goflo.signingKeys[0].publicKeyPem},
  f.clients.eel.signingKeys[1]
 ]};
 assert.throws(()=>createSignedNativeOwnershipVerifier({
  clients:{goflo:f.clients.goflo,eel}
 }),/invalid_private_native_client/,
 'a leaked or shared signing key must never cross app trust boundaries');
 assert.throws(()=>createSignedNativeOwnershipVerifier({
  clients:{eel,goflo:f.clients.goflo}
 }),/invalid_private_native_client/,
 'registration order must not bypass cross-app key isolation');
});

test('rotation config rejects missing, duplicated, mixed, reversed, unbounded and wrong-type signing schedules',()=>{
 const f=fixture();
 const valid=f.clients.goflo,old=valid.signingKeys[0],next=valid.signingKeys[1];
 const invalid=[
  {...valid,signingKeys:[]},
  {...valid,signingKeys:[old,old]},
  {...valid,signingKeys:[old,{...next,keyId:old.keyId}]},
  {...valid,signingKeys:[old,next,old,next]},
  {...valid,keyId:'legacy'},
  {...valid,publicKeyPem:pub(keys.goflo.old)},
  {...valid,signingKeys:[{...old,notBefore:old.notAfter}]},
  {...valid,signingKeys:[{...old,notAfter:old.notBefore}]},
  {...valid,signingKeys:[{...old,notBefore:undefined}]},
  {...valid,signingKeys:[{...old,notAfter:null}]},
  {...valid,signingKeys:[{...old,notBefore:'1800000000000'}]},
  {...valid,signingKeys:[{...old,notBefore:0}]},
  {...valid,signingKeys:[{...old,algorithm:'HS256'}]},
  {...valid,signingKeys:'array-not-present'},
  {...valid,signingKeys:null},
  {...valid,signingKeys:[{
   ...old,publicKeyPem:generateKeyPairSync('rsa',{modulusLength:2048})
     .publicKey.export({format:'pem',type:'spki'})
  }]}
 ];
 for(const bad of invalid)
  assert.throws(()=>createSignedNativeOwnershipVerifier({
   clients:{goflo:bad}
  }),/invalid_private_native_client/);
});

test('single-key legacy config remains compatible but cannot be mixed with scheduled keys',async()=>{
 const key=keys.goflo.old;
 const client={endpoint:'https://goflo.native.example.test/private/ownership',
  token:TOKEN,keyId:'legacy',publicKeyPem:pub(key)};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},clock:()=>NOW,
  fetchImpl:async(_url,request)=>{
   const payload={...JSON.parse(request.body),keyId:'legacy',
    issuedAt:NOW,expiresAt:NOW+1000,
    active:true,ownershipVerified:true};
   return Response.json({payload,signature:sign(null,
    canonicalNativeOwnershipProofBytes(payload),
    key.privateKey).toString('base64url')});
  }
 });
 assert.equal(await verifier.verifyNativeMapping(fixture().input('goflo')),true);
 assert.throws(()=>createSignedNativeOwnershipVerifier({
  clients:{goflo:{...client,signingKeys:[{
   keyId:'new',publicKeyPem:pub(keys.goflo.next),
   notBefore:NOW-1000,notAfter:NOW+5000
  }]}}
 }),/invalid_private_native_client/);
});
