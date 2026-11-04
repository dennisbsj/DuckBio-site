import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicKey,verify as verifyEd25519} from 'node:crypto';
import {canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';

// Static PUBLIC contract answers were independently signed using Python's
// cryptography Ed25519 implementation; the six throwaway private keys were
// not stored. NEVER configure these public keys as production app pins.
const fixture=JSON.parse(readFileSync(
 new URL('./fixtures/native-ownership-v1-known-answer.json',import.meta.url),'utf8'
));
const FIELDS=Object.freeze([
 'version','keyId','purpose','nonce','appId','workspaceAccountId',
 'workspaceOrganizationId','nativeUserId','nativeOrganizationId',
 'issuedAt','expiresAt','active','ownershipVerified'
]);
const APPS=Object.freeze(['limsman','eel','methpipe','mantrain','duckman','goflo']);
const PURPOSES=Object.freeze(['inspect','bind','migrate','inspect','bind','migrate']);
const keyFor=appId=>createPublicKey(fixture.publicKeys[appId]);
const signatureBytes=signature=>Buffer.from(signature,'base64url');
function verifyStatic(proof,signature,key){
 return verifyEd25519(null,canonicalNativeOwnershipProofBytes(proof),
  key,signatureBytes(signature));
}

test('six independent Python-signed public Ed25519 known-answer vectors pin v1 UTF-8 tuple bytes',()=>{
 assert.equal(fixture.format,'duckbio.native-ownership.v1');
 assert.equal(fixture.vectors.length,APPS.length);
 assert.deepEqual(Object.keys(fixture.publicKeys),APPS);
 const publicKeyMaterials=APPS.map(app=>{
  const key=keyFor(app);
  assert.equal(key.asymmetricKeyType,'ed25519');
  return key.export({type:'spki',format:'der'}).toString('base64url');
 });
 assert.equal(new Set(publicKeyMaterials).size,APPS.length,
  'each app must have its own independently pinned Ed25519 public key');
 for(const [index,{proof,canonicalUtf8,signatureBase64url}] of
      fixture.vectors.entries()){
  const appId=APPS[index];
  assert.deepEqual(Object.keys(proof),FIELDS);
  assert.equal(proof.appId,appId);
  assert.equal(proof.purpose,PURPOSES[index]);
  assert.equal(proof.version,fixture.format);
  assert.equal(proof.keyId,'synthetic-'+appId+'-v1');
  assert.equal(proof.nonce.length,43);
  assert.equal(Buffer.from(proof.nonce,'base64url').length,32);
  assert.equal(proof.expiresAt-proof.issuedAt,15000);
  assert.equal(proof.active,true);
  assert.equal(proof.ownershipVerified,true);
  // Expected text is frozen in the JSON fixture; never derive the
  // expectation from the canonicalization helper being tested.
  assert.equal(canonicalNativeOwnershipProofBytes(proof).toString('utf8'),
   canonicalUtf8,'wire ABI changed for '+appId);
  const signature=signatureBytes(signatureBase64url);
  assert.equal(signature.length,64);
  assert.equal(signature.toString('base64url'),signatureBase64url);
  assert.equal(verifyEd25519(null,Buffer.from(canonicalUtf8,'utf8'),
   keyFor(appId),signature),true,'independent signer '+appId);
  assert.equal(verifyStatic(proof,signatureBase64url,keyFor(appId)),true);
  assert.equal(verifyEd25519(null,Buffer.from(JSON.stringify(proof),'utf8'),
   keyFor(appId),signature),false,'unordered object JSON cannot replace tuple');
 }
});

test('reordering JSON proof object properties changes neither canonical bytes nor pinned signature',()=>{
 for(const {proof,canonicalUtf8,signatureBase64url} of fixture.vectors){
  const permuted=Object.fromEntries(Object.entries(proof).reverse());
  assert.notDeepEqual(Object.keys(permuted),FIELDS);
  assert.equal(canonicalNativeOwnershipProofBytes(permuted).toString('utf8'),
   canonicalUtf8);
  assert.equal(verifyStatic(permuted,signatureBase64url,keyFor(proof.appId)),
   true);
 }
});

test('all six signatures fail under every other native app public key',()=>{
 let checked=0;
 for(const {proof,signatureBase64url} of fixture.vectors){
  for(const appId of APPS){
   if(appId===proof.appId)continue;
   assert.equal(verifyStatic(proof,signatureBase64url,keyFor(appId)),false,
    'a '+proof.appId+' signature cannot authenticate as '+appId);
   checked++;
  }
 }
 assert.equal(checked,30);
});

test('fixed independently signed answers reject modification of every signed identity, tenant, nonce, purpose and time field',()=>{
 const mutate={
  version:v=>'duckbio.native-ownership.v2',
  keyId:v=>v+'-attacker',
  purpose:v=>v==='inspect'?'bind':'inspect',
  nonce:v=>'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  appId:v=>v==='limsman'?'eel':'limsman',
  workspaceAccountId:v=>v+'-attacker',
  workspaceOrganizationId:v=>v+'-attacker',
  nativeUserId:v=>v+'-attacker',
  nativeOrganizationId:v=>v+'-attacker',
  issuedAt:v=>v+1,
  expiresAt:v=>v+1,
  active:v=>!v,
  ownershipVerified:v=>!v
 };
 assert.deepEqual(Object.keys(mutate),FIELDS);
 let negatives=0;
 for(const {proof,signatureBase64url} of fixture.vectors){
  for(const field of FIELDS){
   const changed={...proof,[field]:mutate[field](proof[field])};
   assert.equal(verifyStatic(changed,signatureBase64url,keyFor(proof.appId)),
    false,proof.appId+' altered '+field);
   negatives++;
  }
 }
 assert.equal(negatives,78);
});

test('public contract fixture cannot be confused with real operator credentials or native authentication',()=>{
 assert.match(fixture.description,/PUBLIC SYNTHETIC/);
 assert.match(fixture.description,/NEVER PIN/);
 assert.deepEqual(Object.keys(fixture).sort(),
  ['description','format','publicKeys','vectors']);
 assert(!Object.hasOwn(fixture,'privateKey'));
 assert(!Object.hasOwn(fixture,'token'));
 assert.deepEqual(Object.keys(fixture.publicKeys),APPS);
 for(const appId of APPS){
  assert.match(fixture.publicKeys[appId],/^-----BEGIN PUBLIC KEY-----/);
  assert(!fixture.publicKeys[appId].includes('PRIVATE KEY'));
 }
 for(const v of fixture.vectors){
  assert.deepEqual(Object.keys(v).sort(),
   ['canonicalUtf8','proof','signatureBase64url']);
 }
});
