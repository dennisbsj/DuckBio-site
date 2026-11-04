import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateKey,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SIX_NATIVE_SIGNER_CHECKOUTS}
 from '../six-native-signer-interoperability.mjs';
import {canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';
import {rehearseSixNativeKnownAnswers,auditSixGenuineNativeKnownAnswers}
 from '../six-native-known-answer-audit.mjs';

const rows=SIX_NATIVE_SIGNER_CHECKOUTS;
const names=rows.map(row=>row.id);
const encoder=p=>canonicalNativeOwnershipProofBytes(p);
function fakeFactory(appId,{badSignature=false,forgedTenant=false,
 badPayload=false,wrongKey=false}={}){
 return ({privateKeyPem,keyId,lookupOwnership,clock,ttlMs})=>{
  const key=createPrivateKey(privateKeyPem);
  return {async prove(request){
   if(request?.version!=='duckbio.native-ownership.v1'||
      request.appId!==appId||!['inspect','bind','migrate'].includes(
       request.purpose))return null;
   const binding={appId,
    workspaceAccountId:request.workspaceAccountId,
    workspaceOrganizationId:request.workspaceOrganizationId,
    nativeUserId:request.nativeUserId,
    nativeOrganizationId:request.nativeOrganizationId,
    purpose:request.purpose};
   const verified=await lookupOwnership(binding);
   if(!verified||(!forgedTenant&&verified.active!==true)||
      verified?.ownershipVerified!==true)return null;
   const payload={...request,keyId,issuedAt:clock(),
    expiresAt:clock()+ttlMs,active:true,ownershipVerified:true};
   if(badPayload)payload.workspaceOrganizationId+='-attacker';
   const bytes=badSignature?Buffer.from(JSON.stringify(payload)):
    canonicalNativeOwnershipProofBytes(payload);
   const signature=wrongKey?'A'.repeat(86):
    sign(null,bytes,key).toString('base64url');
   return {payload,signature};
  }};
 };
}
function allFactories(modifications={}){
 return new Map(rows.map(row=>[
  row.id,fakeFactory(row.id,modifications[row.id]??{})
 ]));
}
function allEncoders(modifications={}){
 return new Map(rows.map(row=>[row.id,modifications[row.id]??encoder]));
}

test('six-app frozen contract detects 36 signer byte matches and six real-looking proof shapes without authorizing anything',async()=>{
 const result=await rehearseSixNativeKnownAnswers({
  encoders:allEncoders(),factories:allFactories()
 });
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(result.checks.map(x=>x.id),names);
 assert.equal(result.canonicalComparisons,36);
 assert.equal(result.signerComparisons,6);
 assert.equal(result.wrongTenantChecks,6);
 assert.equal(result.wrongAppChecks,6);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.loginEnabled,false);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.accessGranted,false);
});

test('a single native serializer drift fails even if signer roundtrip tests would self-agree',async()=>{
 const bad=allEncoders({eel:proof=>Buffer.from(JSON.stringify(proof))});
 const result=await rehearseSixNativeKnownAnswers({
  encoders:bad,factories:allFactories()
 });
 assert.equal(result.ok,false);
 assert.equal(result.reason,'native_canonical_bytes_mismatch_eel');
 assert.equal(result.deploymentAuthorized,false);
});

test('a wrong signature representation is detected by the independently frozen byte string',async()=>{
 const result=await rehearseSixNativeKnownAnswers({
  encoders:allEncoders(),
  factories:allFactories({methpipe:{badSignature:true}})
 });
 assert.equal(result.ok,false);
 assert.equal(result.reason,'native_signer_known_signature_mismatch_methpipe');
 assert.deepEqual(result.checks.map(x=>x.id),
  names.slice(0,names.indexOf('methpipe')));
});

test('wrong-organization signed identity and signature-substitution fail closed',async()=>{
 for(const modifications of [
  {duckman:{badPayload:true}},
  {goflo:{wrongKey:true}}
 ]){
  const result=await rehearseSixNativeKnownAnswers({
   encoders:allEncoders(),factories:allFactories(modifications)
  });
  assert.equal(result.ok,false);
  assert.equal(result.deploymentAuthorized,false);
  assert.equal(result.accessGranted,false);
 }
});

test('malicious native signer cannot skip exact binding ownership check on changed tenant',async()=>{
 const badFactory=({privateKeyPem,keyId,clock,ttlMs})=>{
  const key=createPrivateKey(privateKeyPem);
  return {async prove(body){
   if(body.appId!=='limsman')return null;
   const payload={...body,keyId,issuedAt:clock(),
    expiresAt:clock()+ttlMs,active:true,ownershipVerified:true};
   return {payload,signature:sign(null,
    canonicalNativeOwnershipProofBytes(payload),key).toString('base64url')};
  }};
 };
 const result=await rehearseSixNativeKnownAnswers({
  encoders:allEncoders(),
  factories:allFactories({}).set('limsman',badFactory)
 });
 assert.equal(result.ok,false);
 assert.equal(result.reason,'native_signer_known_payload_mismatch_limsman');
});

test('incomplete or extra unknown signer/encoder app matrices fail without tests or grants',async()=>{
 const factories=allFactories();
 factories.delete('duckman');
 assert.equal((await rehearseSixNativeKnownAnswers({
  encoders:allEncoders(),factories
 })).reason,'invalid_six_native_known_answer_exports');
 const encoders=allEncoders();
 encoders.set('dataduck',encoder);
 assert.equal((await rehearseSixNativeKnownAnswers({
  encoders,factories:allFactories()
 })).reason,'invalid_six_native_known_answer_exports');
});

test('private operator import fails closed when no approved six-source root is provided',async()=>{
 const result=await auditSixGenuineNativeKnownAnswers();
 assert.equal(result.ok,false);
 assert.equal(result.reason,'unverified_native_source_before_import');
 assert.equal(result.deploymentAuthorized,false);
});

test('CLI refuses startup without explicit private reviewed source opt-in',()=>{
 const file=fileURLToPath(new URL('../six-native-known-answer-audit.mjs',
  import.meta.url));
 const run=spawnSync(process.execPath,[file],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(run.status,2);
 assert.match(run.stderr,/--confirm-private-six-native-known-answer-only/);
 assert.doesNotMatch(run.stdout,/PASS /);
});
