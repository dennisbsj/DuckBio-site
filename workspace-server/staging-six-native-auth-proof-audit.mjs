// OPT-IN, NO-MUTATION operator witness for existing synthetic native SSO
// proofs against the seven REAL running staging services. Only the Workspace
// broker's read-only POST /api/suite/auth/introspect contract is exercised.
// Does not create/revoke sessions, modify grants, evaluate native app resource
// permissions or claim a successful production/paid-seat deployment.
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';
import {EXPECTED_NATIVE} from './six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';
import {auditSevenGenuineStaging}
 from './staging-seven-genuine-runtime-audit.mjs';

const IDS=Object.freeze(EXPECTED_NATIVE.map(row=>row.id));
const ALLOWED_KEYS=Object.freeze([
 'appId','activeToken','inactiveToken','subject','localUserId','organizationId'
]);
const TOKEN=/^[A-Za-z0-9_-]{32,128}$/;
const IDENTIFIER=/^[A-Za-z0-9_.:@-]{1,128}$/;
const fail=(checks,name,code)=>Object.freeze({
 ok:false,checks:[...checks,{name,ok:false,code}],
 category:'synthetic-native-proof-witness-unverified',
 deploymentAuthorized:false
});
const pass=(checks,name)=>checks.push({name,ok:true,code:'ok'});
const ownKeys=(value,names)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).sort().join('|')===
 names.slice().sort().join('|');

// Operator-supplied proofs MUST be synthetic disposable sessions created via
// independent normal browser/PKCE flows. No password, client secret or
// production subject is stored in the proof bundle.
export function validateSixNativeProofBundle(config,lock,bundle){
 if(!validateWorkspaceStagingConfig(config).ok||
    validateSixNativeStagingSnapshot(lock).kind!=='current'||
    config.SUITE_BUILD_SHA!==lock.central.sha)
  return {ok:false,code:'unverified_six_native_staging'};
 if(!ownKeys(bundle,['version','scope','workspaceSha','assertions'])||
    bundle.version!==1||
    bundle.scope!=='synthetic-six-original-native-broker-proofs'||
    bundle.workspaceSha!==lock.central.sha||
    !Array.isArray(bundle.assertions)||bundle.assertions.length!==6)
  return {ok:false,code:'invalid_synthetic_proof_bundle'};
 const allTokens=new Set();
 for(let i=0;i<6;i++){
  const row=bundle.assertions[i];
  if(!ownKeys(row,ALLOWED_KEYS)||row.appId!==IDS[i]||
     !TOKEN.test(row.activeToken||'')||
     !TOKEN.test(row.inactiveToken||'')||
     !IDENTIFIER.test(row.subject||'')||
     !IDENTIFIER.test(row.localUserId||'')||
     !IDENTIFIER.test(row.organizationId||'')||
     !row.localUserId.startsWith('synthetic-')||
     !row.organizationId.startsWith('synthetic-')||
     row.activeToken===row.inactiveToken||
     allTokens.has(row.activeToken)||allTokens.has(row.inactiveToken))
   return {ok:false,code:'invalid_synthetic_'+IDS[i]+'_proof'};
  allTokens.add(row.activeToken);
  allTokens.add(row.inactiveToken);
 }
 return {ok:true,code:'ok'};
}
export function readPrivateSixNativeProofBundle(filename){
 if(typeof filename!=='string'||!filename.startsWith('/')||
    resolve(filename)!==filename)
  throw Error('unsafe_private_proof_path');
 approvedPrivateRoot(dirname(filename));
 const stat=lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16_384||
    stat.size<100||(process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('unsafe_private_proof_file');
 const data=JSON.parse(readFileSync(filename,'utf8'));
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw Error('invalid_private_proof_file');
 return data;
}

const MIME=/^application\/json(?:\s*;|$)/i;
async function brokerIntrospect(config,client,token,{
 fetchImpl,timeoutMs
}={}){
 const url=config.SUITE_ORIGIN+'/api/suite/auth/introspect';
 const auth='Basic '+Buffer.from(client.id+':'+client.secret).toString('base64');
 let response;
 try{
  response=await fetchImpl(url,{
   method:'POST',redirect:'error',cache:'no-store',
   credentials:'omit',referrerPolicy:'no-referrer',
   headers:{
    Authorization:auth,'Content-Type':'application/json',
    Accept:'application/json'
   },
   body:JSON.stringify({clientId:client.id,sessionToken:token}),
   signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response||response.status!==200||response.redirected||
     (response.url&&response.url!==url)||
     !MIME.test(response.headers?.get('content-type')||'')||
     !/no-store/i.test(response.headers?.get('cache-control')||'')||
     response.headers?.get('set-cookie')||!response.body)
   throw Error('invalid_response');
  const parts=[];let size=0;
  for await(const part of response.body){
   size+=part.byteLength;
   if(size>2048)throw Error('oversized_response');
   parts.push(Buffer.from(part));
  }
  const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!body||typeof body!=='object'||Array.isArray(body))
   throw Error('invalid_response');
  return body;
 }catch{
  return null;
 }
}

// Real process provenance + anonymous TLS checks FIRST. Then, and only then,
// inspect six valid synthetic proofs and six already-revoked/expired proofs.
// Each positive proof must be opaque to a FOREIGN native app. This does not
// issue new tokens or actively revoke existing tokens.
export async function auditSixNativeAuthenticatedStaging({
 config,lock,bundle,sourcesRoot,
 realServices=auditSevenGenuineStaging,
 fetchImpl=globalThis.fetch,timeoutMs=8000,now=Date.now
}={}){
 const checks=[];
 const schema=validateSixNativeProofBundle(config,lock,bundle);
 if(!schema.ok)return fail(checks,'configuration',schema.code);
 if(typeof fetchImpl!=='function'||typeof realServices!=='function'||
    typeof now!=='function'||!Number.isInteger(timeoutMs)||
    timeoutMs<100||timeoutMs>30_000)
  return fail(checks,'configuration','invalid_audit_options');
 try{
  const witness=await realServices({config,lock,sourcesRoot});
  if(!witness||witness.ok!==true||
     witness.category!=='seven-real-systemd-processes-and-anonymous-https-only'||
     witness.deploymentAuthorized!==false)
   return fail(checks,'real-seven-services','genuine_staging_not_verified');
 }catch{
  return fail(checks,'real-seven-services','genuine_staging_not_verified');
 }
 pass(checks,'real-seven-services');
 const clients=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 for(let i=0;i<6;i++){
  const row=bundle.assertions[i];
  const app=IDS[i],client=clients.get(app);
  const foreign=clients.get(IDS[(i+1)%6]);
  if(!client||!foreign)
   return fail(checks,app,'registered_native_client_missing');
  const active=await brokerIntrospect(config,client,row.activeToken,{
   fetchImpl,timeoutMs});
  if(!active||active.active!==true||active.issuer!==config.SUITE_ISSUER||
     active.audience!==app||active.subject!==row.subject||
     active.localIdentity?.userId!==row.localUserId||
     active.localIdentity?.organizationId!==row.organizationId||
     !Number.isSafeInteger(active.expiresAt)||
     active.expiresAt<=now())
   return fail(checks,app,'native_proof_identity_or_scope_mismatch');
  const inactive=await brokerIntrospect(config,client,row.inactiveToken,{
   fetchImpl,timeoutMs});
  if(!inactive||Object.keys(inactive).length!==1||
     inactive.active!==false)
   return fail(checks,app,'revoked_or_expired_proof_still_active');
  const foreignAccess=await brokerIntrospect(
   config,foreign,row.activeToken,{fetchImpl,timeoutMs});
  if(!foreignAccess||Object.keys(foreignAccess).length!==1||
     foreignAccess.active!==false)
   return fail(checks,app,'foreign_native_audience_accepted');
  pass(checks,app+'-native-proof');
 }
 return Object.freeze({
  ok:true,checks,
  category:'seven-genuine-services-plus-six-broker-native-proof-boundaries-only',
  deploymentAuthorized:false
 });
}
const invoked=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(invoked){
 const a=process.argv.slice(2);
 if(a.length!==7||a[0]!=='--config'||a[2]!=='--sources-root'||
    a[4]!=='--proofs'||a[6]!=='--confirm-synthetic-auth-proof-inspection-only'){
  console.error('Usage: node staging-six-native-auth-proof-audit.mjs --config PRIVATE_JSON --sources-root PRIVATE_SEVEN_GIT_SOURCES --proofs PRIVATE_SYNTHETIC_PROOFS_JSON --confirm-synthetic-auth-proof-inspection-only');
  process.exitCode=2;
 }else{
  try{
   const lock=JSON.parse(readFileSync(new URL(
    './six-native-current-compat-lock.json',import.meta.url),'utf8'));
   const result=await auditSixNativeAuthenticatedStaging({
    config:readPrivateConfiguration(a[1]),sourcesRoot:a[3],lock,
    bundle:readPrivateSixNativeProofBundle(a[5])
   });
   // Never output identity, URL, token, client secret, response or raw errors.
   for(const check of result.checks)
    console.log((check.ok?'PASS ':'FAIL ')+check.name+': '+check.code);
   if(!result.ok)process.exitCode=1;
   else console.log('PASS six native broker audience/session scopes on seven existing staging processes; NOT native API resource permissions, paid seats, MFA, rollback or production');
  }catch{
   console.error('FAIL synthetic native proofs: unsafe_or_unverified_private_input');
   process.exitCode=1;
  }
 }
}
