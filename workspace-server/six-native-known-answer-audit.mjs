/**
 * OFFLINE, OPERATOR OPT-IN: six genuine native canonicalizer + signer exports
 * against fixed EXTERNALLY signed synthetic v1 proof bytes.
 *
 * Never loads the native modules until all six private source roots, Git
 * remotes, exact reviewed HEADs, clean files, signer+lookup+sidecar blobs
 * have passed the existing pinned-source trust checks.
 *
 * Public CI tests this harness with injected synthetic functions ONLY;
 * no native private source or production credentials are bundled.
 */
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign as signEd25519,verify as verifyEd25519}
 from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {SIX_NATIVE_SIGNER_CHECKOUTS}
 from './six-native-signer-interoperability.mjs';
import {verifySixNativeMtlSidecarSources}
 from './six-native-ownership-lookup-interoperability.mjs';

const fixture=JSON.parse(readFileSync(new URL(
 './tests/fixtures/native-ownership-v1-known-answer.json',import.meta.url
),'utf8'));
const six=SIX_NATIVE_SIGNER_CHECKOUTS;
const REQUEST_FIELDS=Object.freeze([
 'version','purpose','nonce','appId','workspaceAccountId',
 'workspaceOrganizationId','nativeUserId','nativeOrganizationId'
]);
const BINDING_FIELDS=Object.freeze([
 'appId','workspaceAccountId','workspaceOrganizationId',
 'nativeUserId','nativeOrganizationId','purpose'
]);
const REPORT={deploymentAuthorized:false,accessGranted:false,
 licensesGranted:false,loginEnabled:false};
const deny=(reason,checks=[])=>Object.freeze({
 ok:false,reason,checks,...REPORT
});
const isExact=(o,keys)=>o!==null&&typeof o==='object'&&
 !Array.isArray(o)&&Object.keys(o).length===keys.length&&
 keys.every(k=>Object.hasOwn(o,k));
const sameBytes=(actual,expected)=>
 (Buffer.isBuffer(actual)||actual instanceof Uint8Array)&&
 Buffer.from(actual).equals(Buffer.from(expected,'utf8'));
function frozenFixture(){
 if(!isExact(fixture,['description','format','publicKeys','vectors'])||
    fixture.format!=='duckbio.native-ownership.v1'||
    !Array.isArray(fixture.vectors)||fixture.vectors.length!==6||
    !isExact(fixture.publicKeys,six.map(x=>x.id)))return false;
 const ids=new Set(),purposes=new Set();
 for(const row of fixture.vectors){
  if(!isExact(row,['proof','canonicalUtf8','signatureBase64url'])||
     !isExact(row.proof,[
      'version','keyId','purpose','nonce','appId',
      'workspaceAccountId','workspaceOrganizationId','nativeUserId',
      'nativeOrganizationId','issuedAt','expiresAt','active','ownershipVerified'
     ])||
     !six.some(x=>x.id===row.proof.appId)||
     ids.has(row.proof.appId)||
     typeof row.canonicalUtf8!=='string'||
     typeof row.signatureBase64url!=='string')return false;
  ids.add(row.proof.appId);purposes.add(row.proof.purpose);
 }
 return ids.size===6&&purposes.size===3;
}

/**
 * Test-injectable seam. In genuine-source operator mode, encoders and signer
 * factories come ONLY from six verified private Git module exports.
 * The six immutable static payloads are generated OUTSIDE these factories.
 *
 * Checks (1) every native encoder against every frozen expected UTF-8 string,
 * (2) each native signer with an ephemeral NEW private key against the frozen
 * expected UTF-8 bytes and deterministic Ed25519 signature, and
 * (3) exact binding denial, wrong native app and never a grant.
 */
export async function rehearseSixNativeKnownAnswers({
 encoders,factories
}={}){
 const checks=[];
 if(!frozenFixture()||!(encoders instanceof Map)||
    !(factories instanceof Map)||encoders.size!==6||factories.size!==6||
    six.some(row=>typeof encoders.get(row.id)!=='function'||
       typeof factories.get(row.id)!=='function'))
  return deny('invalid_six_native_known_answer_exports');
 const vectors=new Map(fixture.vectors.map(v=>[v.proof.appId,v]));
 try{
  for(const row of six){
   const canonical=encoders.get(row.id);
   for(const vector of fixture.vectors){
    if(!sameBytes(canonical(vector.proof),vector.canonicalUtf8))
     return deny('native_canonical_bytes_mismatch_'+row.id,checks);
   }
   const vector=vectors.get(row.id),p=vector.proof;
   const pair=generateKeyPairSync('ed25519');
   const key=pair.privateKey.export({type:'pkcs8',format:'pem'});
   let lookups=0;
   const signer=factories.get(row.id)({
    privateKeyPem:key,keyId:p.keyId,
    clock:()=>p.issuedAt,ttlMs:p.expiresAt-p.issuedAt,
    lookupOwnership:async binding=>{
     lookups++;
     if(!isExact(binding,BINDING_FIELDS))return null;
     for(const field of BINDING_FIELDS){
      if(binding[field]!==p[field])return null;
     }
     return {active:true,ownershipVerified:true};
    }
   });
   if(typeof signer?.prove!=='function')
    return deny('native_signer_abi_mismatch_'+row.id,checks);
   const body=Object.fromEntries(REQUEST_FIELDS.map(field=>[field,p[field]]));
   const response=await signer.prove(body);
   if(!isExact(response,['payload','signature'])||
      !isExact(response.payload,Object.keys(p))||
      Object.keys(p).some(field=>response.payload[field]!==p[field])||
      typeof response.signature!=='string'||lookups!==1)
    return deny('native_signer_known_payload_mismatch_'+row.id,checks);
   const signature=Buffer.from(response.signature,'base64url');
   const expectedBytes=Buffer.from(vector.canonicalUtf8,'utf8');
   const expectedSignature=signEd25519(null,expectedBytes,pair.privateKey);
   if(signature.length!==64||!signature.equals(expectedSignature)||
      signature.toString('base64url')!==response.signature||
      !verifyEd25519(null,expectedBytes,pair.publicKey,signature))
    return deny('native_signer_known_signature_mismatch_'+row.id,checks);
   // The canonical function itself must not bless a signed proof with a
   // changed native organization. The caller must independently reject it.
   const altered=await signer.prove({...body,
    nativeOrganizationId:p.nativeOrganizationId+'-wrong'});
   if(altered!==null)
    return deny('native_signer_wrong_tenant_accepted_'+row.id,checks);
   const wrongApp=six.find(x=>x.id!==row.id).id;
   if(await signer.prove({...body,appId:wrongApp})!==null)
    return deny('native_signer_wrong_app_accepted_'+row.id,checks);
   if(lookups!==2)
    return deny('native_signer_binding_lookup_mismatch_'+row.id,checks);
   checks.push(Object.freeze({id:row.id,ok:true,
    code:'public_frozen_v1_protocol_only'}));
  }
 }catch{return deny('native_known_answer_execution_failed',checks)}
 return Object.freeze({
  ok:true,checks,canonicalComparisons:36,signerComparisons:6,
  wrongTenantChecks:6,wrongAppChecks:6,
  category:'offline-native-source-v1-known-answer-contract-only',...REPORT
 });
}

/** Actual genuine-source path: refuse unreviewed, dirty or missing checkouts.
 * No automatic cloning, network calls or production imports.
 */
export async function auditSixGenuineNativeKnownAnswers({sourcesRoot}={}){
 const before=verifySixNativeMtlSidecarSources(sourcesRoot);
 if(!before.ok)return deny('unverified_native_source_before_import');
 const encoders=new Map(),factories=new Map();
 try{
  for(const row of six){
   const source=await import(pathToFileURL(
    join(sourcesRoot,row.repo,row.file)).href);
   const module=source.default??source;
   const encoder=source.canonicalNativeOwnershipProofBytes??
    module.canonicalNativeOwnershipProofBytes;
   const factory=source[row.factory]??module[row.factory];
   if(typeof encoder!=='function'||typeof factory!=='function')
    return deny('native_export_missing_'+row.id);
   encoders.set(row.id,encoder);factories.set(row.id,factory);
  }
 }catch{return deny('native_private_source_load_failed')}
 const result=await rehearseSixNativeKnownAnswers({encoders,factories});
 if(!result.ok)return result;
 const after=verifySixNativeMtlSidecarSources(sourcesRoot);
 if(!after.ok)return deny('native_source_changed_during_audit');
 return Object.freeze({...result,
  category:'six-reviewed-private-native-source-known-answer-interop',
  exactSourcePinsChecked:true,...REPORT});
}

if(process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--sources-root'||
   args[2]!=='--confirm-private-six-native-known-answer-only'){
  console.error('Usage: node six-native-known-answer-audit.mjs --sources-root PRIVATE_SIX_NATIVE_REPOS --confirm-private-six-native-known-answer-only');
  process.exitCode=2;
 }else{
  const report=await auditSixGenuineNativeKnownAnswers({
   sourcesRoot:args[1]
  });
  if(!report.ok){
   console.error('BLOCKED private six-native known-answer source QA: '+report.reason);
   process.exitCode=1;
  }else{
   for(const row of report.checks)console.log('PASS '+row.id);
   console.log('PASS six reviewed genuine native signer exports against fixed public v1 Ed25519 contract (OFFLINE ONLY; NO SSO, LIVE BILLING OR DEPLOYMENT)');
  }
 }
}
