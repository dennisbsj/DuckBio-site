import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signProof} from 'node:crypto';
import {
 createSignedNativeOwnershipVerifier,canonicalNativeOwnershipProofBytes
} from '../shared-auth/signed-native-ownership-verifier.mjs';

const NOW=1800000000000;
const endpoint='https://native.example.test/private/workspace/verify-ownership';
const token='synthetic-operator-native-bearer-token-123456789';
const signingKey=generateKeyPairSync('ed25519');
const client={
 endpoint,token,keyId:'native-test-key',
 publicKeyPem:signingKey.publicKey.export({format:'pem',type:'spki'})
};
const ids={
 appId:'goflo',workspaceAccountId:'user-alpha',
 workspaceOrganizationId:'workspace-org-alpha',
 nativeUserId:'native-user-alpha',
 nativeOrganizationId:'native-org-alpha'
};
const owner={actorId:'org-admin',userId:ids.workspaceAccountId,
 appId:ids.appId,workspaceOrganizationId:ids.workspaceOrganizationId,
 nativeUserId:ids.nativeUserId,nativeOrganizationId:ids.nativeOrganizationId,
 operation:'bind'};
function signedTransport(count){
 return async(_url,init)=>{
  count.calls++;
  const payload={...JSON.parse(init.body),keyId:client.keyId,
   issuedAt:NOW,expiresAt:NOW+15000,
   active:true,ownershipVerified:true};
  const signature=signProof(null,canonicalNativeOwnershipProofBytes(payload),
   signingKey.privateKey).toString('base64url');
  return new Response(JSON.stringify({payload,signature}),{
   headers:{'content-type':'application/json'}
  });
 };
}
test('malformed provisioning callback values never throw or contact a native endpoint',async()=>{
 const count={calls:0};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},clock:()=>NOW,fetchImpl:signedTransport(count)
 });
 for(const input of [null,false,0,42,[],Object.create(null)]){
  assert.equal(await verifier.verifyNativeOwnership(input),false);
 }
 const failingGetter={...owner};
 Object.defineProperty(failingGetter,'actorId',{
  get(){throw Error('untrusted callback accessor')}
 });
 assert.equal(await verifier.verifyNativeOwnership(failingGetter),false);
 assert.equal(count.calls,0);
});
test('malformed inspection properties are denied rather than escaping as exceptions',async()=>{
 const count={calls:0};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},clock:()=>NOW,fetchImpl:signedTransport(count)
 });
 const invalid={...ids};
 Object.defineProperty(invalid,'appId',{
  get(){throw Error('untrusted inspection accessor')}
 });
 assert.equal(await verifier.verifyNativeMapping(invalid),false);
 assert.equal(count.calls,0);
});
test('clock failure before fetch fails closed and makes zero native requests',async()=>{
 const count={calls:0};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},fetchImpl:signedTransport(count),
  clock:()=>{throw Error('clock failed')}
 });
 assert.equal(await verifier.verifyNativeMapping(ids),false);
 assert.equal(count.calls,0);
});
test('clock failure after signed native response fails closed without throwing',async()=>{
 const count={calls:0};let clockCalls=0;
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},fetchImpl:signedTransport(count),
  clock:()=>{
   if(++clockCalls===1)return NOW;
   throw Error('clock failed after await');
  }
 });
 assert.equal(await verifier.verifyNativeMapping(ids),false);
 assert.equal(count.calls,1);
 assert.equal(clockCalls,2);
});
test('valid inspection and signed provisioning remain supported after exception containment',async()=>{
 const count={calls:0};
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:client},clock:()=>NOW,fetchImpl:signedTransport(count)
 });
 assert.equal(await verifier.verifyNativeMapping(ids),true);
 assert.equal(await verifier.verifyNativeOwnership(owner),true);
 assert.equal(count.calls,2);
});
