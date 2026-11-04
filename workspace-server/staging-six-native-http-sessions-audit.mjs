// Operator-only, no-mutation integration witness for six actual native HTTP
// application sessions AFTER genuine seven-service+central broker attestation.
// It sends exact, already-existing synthetic native cookies only to each
// registered native HTTPS origin. It NEVER logs credentials, starts/stops
// services, grants access, logs in/out, or calls mutation/payment endpoints.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateConfiguration} from './staging-preflight.mjs';
import {EXPECTED_NATIVE} from './six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from './staging-six-native-snapshot.mjs';
import {validateSixNativeProofBundle,readPrivateSixNativeProofBundle,
 auditSixNativeAuthenticatedStaging}
 from './staging-six-native-auth-proof-audit.mjs';

const IDS=Object.freeze(EXPECTED_NATIVE.map(row=>row.id));
const ROUTES=Object.freeze({
 goflo:Object.freeze({cookie:'science_goflo_session',
  identity:'/api/auth/status',link:'/api/suite/workspace/status',
  unread:'/api/suite/workspace/unread',kind:'standard'}),
 eel:Object.freeze({cookie:'eln_session',
  identity:'/api/auth/status',link:'/api/suite/workspace/status',
  unread:'/api/suite/workspace/unread',kind:'standard'}),
 methpipe:Object.freeze({cookie:'science_methpipe_session',
  identity:'/api/auth/status',link:'/api/suite/workspace/status',
  unread:'/api/suite/workspace/unread',kind:'standard'}),
 mantrain:Object.freeze({cookie:'science_mantrain_session',
  identity:'/api/auth/status',link:'/api/suite/workspace/status',
  unread:'/api/suite/workspace/unread',kind:'standard'}),
 duckman:Object.freeze({cookie:'duckman_session',
  identity:'/api/auth/status',link:'/api/suite/communications/link-status',
  unread:'/api/suite/communications/unread',kind:'duckman'}),
 limsman:Object.freeze({cookie:'LIMSMAN_SESSION',
  identity:'/api.php?action=session',link:'/api.php?action=workspace_status',
  unread:'/api.php?action=workspace_unread',kind:'standard'})
});
const TOKEN=/^[A-Za-z0-9_-]{32,256}$/;
const COUNTS=['chat','mail','notifications'];
const EXACT=['version','scope','workspaceSha','sessions'];
const okKeys=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===names.slice().sort().join('|');
const fail=(checks,id,code)=>Object.freeze({
 ok:false,checks:[...checks,{id,ok:false,code}],
 category:'six-native-http-session-witness-unverified',
 deploymentAuthorized:false
});
const positive=(checks,id)=>checks.push({id,ok:true,code:'ok'});
export function validateSixNativeCookieBundle(config,lock,proofBundle,cookieBundle){
 if(!validateSixNativeProofBundle(config,lock,proofBundle).ok||
    !['current','post-pkce','ownership-mtls'].includes(validateSixNativeStagingSnapshot(lock).kind))
  return {ok:false,code:'central_native_proofs_not_preverified'};
 if(!okKeys(cookieBundle,EXACT)||cookieBundle.version!==1||
    cookieBundle.scope!=='synthetic-six-native-http-session-cookies'||
    cookieBundle.workspaceSha!==lock.central.sha||
    !Array.isArray(cookieBundle.sessions)||cookieBundle.sessions.length!==6)
  return {ok:false,code:'invalid_synthetic_cookie_bundle'};
 const cookieValues=new Set();
 for(let i=0;i<6;i++){
  const row=cookieBundle.sessions[i],id=IDS[i],name=ROUTES[id].cookie;
  if(!okKeys(row,['appId','cookie'])||row.appId!==id||
     typeof row.cookie!=='string'||!row.cookie.startsWith(name+'=')||
     !TOKEN.test(row.cookie.slice(name.length+1))||
     cookieValues.has(row.cookie))
   return {ok:false,code:'invalid_'+id+'_native_session'};
  cookieValues.add(row.cookie);
 }
 return {ok:true,code:'ok'};
}
async function nativeGet(url,cookie,{fetchImpl,timeoutMs}){
 try{
  const response=await fetchImpl(url,{
   method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
   referrerPolicy:'no-referrer',headers:{
    Accept:'application/json',...(cookie?{Cookie:cookie}:{})
   },signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response||!Number.isSafeInteger(response.status)||
     response.redirected||(response.url&&response.url!==url)||
     ![200,401,403].includes(response.status))return null;
  if(response.status!==200){
   // Only a true HTTP authorization denial is acceptable for a foreign
   // cookie. No redirects, upstream faults or successful 204 shortcuts.
   return {status:response.status};
  }
  if(!response.body)return null;
  if(!/^application\/json(?:\s*;|$)/i.test(
   response.headers?.get('content-type')||''))return null;
  const chunks=[];let length=0;
  for await(const chunk of response.body){
   length+=chunk.byteLength;
   if(length>4096)return null;
   chunks.push(Buffer.from(chunk));
  }
  const json=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!json||typeof json!=='object'||Array.isArray(json))return null;
  return {status:200,json};
 }catch{return null}
}
function validCounts(payload,kind){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  return false;
 if(!okKeys(payload,kind==='duckman'?['connected','counts']:['counts']))
  return false;
 if(kind==='duckman'&&payload.connected!==true)return false;
 if(!okKeys(payload.counts,COUNTS))return false;
 return COUNTS.every(k=>Number.isSafeInteger(payload.counts[k])&&
  payload.counts[k]>=0&&payload.counts[k]<=1_000_000);
}
const positiveIdentity=(resp,localId)=>resp?.status===200&&
 resp.json?.user?.id===localId;
const positiveLink=(resp,kind)=>resp?.status===200&&(
 kind==='duckman'?
   okKeys(resp.json,['connected'])&&resp.json.connected===true:
   okKeys(resp.json,['enabled','linked'])&&
    resp.json.enabled===true&&resp.json.linked===true
);
const noForeignSession=resp=>
 resp?.status===401||resp?.status===403||
 (resp?.status===200&&resp.json?.user===null);

export async function auditSixNativeHttpSessions({
 config,lock,proofBundle,cookieBundle,sourcesRoot,
 preflight=auditSixNativeAuthenticatedStaging,
 fetchImpl=globalThis.fetch,timeoutMs=8000
}={}){
 const checks=[];
 const validation=validateSixNativeCookieBundle(
  config,lock,proofBundle,cookieBundle);
 if(!validation.ok)return fail(checks,'configuration',validation.code);
 if(typeof preflight!=='function'||typeof fetchImpl!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30_000)
  return fail(checks,'configuration','invalid_readonly_probe_options');
 // Pre-existing central broker/tenant-bound session proofs must pass
 // FIRST. This also invokes the seven genuine systemd+TLS witness.
 try{
  const previous=await preflight({
   config,lock,bundle:proofBundle,sourcesRoot,fetchImpl,timeoutMs
  });
  if(previous?.ok!==true||previous.deploymentAuthorized!==false||
     previous.category!==
      'seven-genuine-services-plus-six-broker-native-proof-boundaries-only')
   return fail(checks,'broker-and-seven-real-services',
    'verified_broker_preflight_required');
 }catch{
  return fail(checks,'broker-and-seven-real-services',
   'verified_broker_preflight_required');
 }
 positive(checks,'broker-and-seven-real-services');
 const byId=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 for(let i=0;i<6;i++){
  const id=IDS[i],client=byId.get(id),row=proofBundle.assertions[i];
  const nativeCookie=cookieBundle.sessions[i].cookie;
  const foreignCookie=cookieBundle.sessions[(i+1)%6].cookie;
  if(!client||client.appId!==id)return fail(checks,id,'native_origin_not_registered');
  const origin=client.nativeOrigin,route=ROUTES[id];
  const opts={fetchImpl,timeoutMs};
  const [self,link,unread,foreign]=await Promise.all([
   nativeGet(origin+route.identity,nativeCookie,opts),
   nativeGet(origin+route.link,nativeCookie,opts),
   nativeGet(origin+route.unread,nativeCookie,opts),
   nativeGet(origin+route.identity,foreignCookie,opts)
  ]);
  if(!positiveIdentity(self,row.localUserId))
   return fail(checks,id,'native_session_identity_mismatch');
  if(!positiveLink(link,route.kind))
   return fail(checks,id,'native_workspace_link_mismatch');
  if(unread?.status!==200||!validCounts(unread.json,route.kind))
   return fail(checks,id,'native_protected_get_unavailable');
  if(!noForeignSession(foreign))
   return fail(checks,id,'foreign_native_session_accepted');
  positive(checks,id+'-native-http');
 }
 return Object.freeze({
  ok:true,checks,
  category:'six-genuine-native-http-session-and-workspace-link-boundaries-only',
  deploymentAuthorized:false
 });
}

const direct=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(direct){
 const a=process.argv.slice(2);
 const oldArgs=a.length===9&&a[8]==='--confirm-readonly-synthetic-sessions-only';
 const postPkce=a.length===11&&a[8]==='--snapshot'&&
  ['post-pkce','ownership-mtls'].includes(a[9])&&a[10]==='--confirm-readonly-synthetic-sessions-only';
 if((!oldArgs&&!postPkce)||a[0]!=='--config'||a[2]!=='--sources-root'||
    a[4]!=='--broker-proofs'||a[6]!=='--native-cookies'){
  console.error('Usage: node staging-six-native-http-sessions-audit.mjs --config PRIVATE_STAGING_JSON --sources-root PRIVATE_SEVEN_CHECKOUTS --broker-proofs PRIVATE_SYNTHETIC_BROKER_PROOFS_JSON --native-cookies PRIVATE_SYNTHETIC_NATIVE_COOKIES_JSON [--snapshot post-pkce|ownership-mtls] --confirm-readonly-synthetic-sessions-only');
  process.exitCode=2;
 }else try{
  const config=readPrivateConfiguration(a[1]);
  const lock=JSON.parse(readFileSync(new URL(
   './'+stagingSnapshotFile(postPkce?a[9]:'current'),import.meta.url),'utf8'));
  const report=await auditSixNativeHttpSessions({
   config,lock,sourcesRoot:a[3],
   proofBundle:readPrivateSixNativeProofBundle(a[5]),
   cookieBundle:readPrivateSixNativeProofBundle(a[7])
  });
  for(const check of report.checks)
   console.log((check.ok?'PASS ':'FAIL ')+check.id+': '+check.code);
  if(!report.ok)process.exitCode=1;
  else console.log('PASS synthetic native session, linked Workspace and six read-only native boundaries; NOT native permissions, live seats, production or multi-browser release');
 }catch{
  console.error('FAIL synthetic native HTTP sessions: unsafe_or_unverified_private_input');
  process.exitCode=1;
 }
}
