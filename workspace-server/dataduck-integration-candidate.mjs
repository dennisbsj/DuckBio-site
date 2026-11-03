// DataDuck is the seventh DuckBio application INTEGRATION CANDIDATE.
// This is an inert, source-only compatibility contract. It is deliberately
// not imported by the live Workspace account, billing or staging runtimes.
// DataDuck's unmerged local prototype is not a verified paid service.
export const DATADUCK_APP=Object.freeze({
 id:'dataduck',
 name:'DataDuck',
 repository:'dennisbsj/DataDuck',
 nativeRoles:Object.freeze(['Admin','Analyst','Reviewer','ReadOnly']),
 licenseModel:'independent-per-app-seat',
 lifecycle:'unreleased-integration-candidate',
 productionEnabled:false,
 stagingEnabled:false,
 nativeUserProvisioning:'explicit-user-and-organization-id-mapping',
 nativeAuthorization:'server-enforced-and-rechecked-per-request',
 workspaceClientId:'dataduck',
 callbackPath:'/auth/callback'
});

export const EXISTING_DUCKBIO_APP_IDS=Object.freeze([
 'goflo','eel','methpipe','mantrain','duckman','limsman'
]);

const validHttpsOrigin=value=>{
 if(typeof value!=='string')return false;
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&url.origin===value&&
   url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&
   !url.password&&!url.port&&url.hostname.includes('.')&&
   !['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&
   !url.hostname.endsWith('.test')&&!url.hostname.endsWith('.example')&&
   !url.hostname.endsWith('.invalid');
 }catch{return false;}
};

const unique=values=>new Set(values).size===values.length;

// Inspect an *opt-in* proposed seventh client registration without
// modifying the currently approved six-client broker configuration.
// A PASS is not a seat grant, native session, live entitlement, public
// launch or permission to extend historical seven-origin staging claims.
export function inspectDataDuckClientCandidate({workspaceOrigin,clients}={}){
 const failures=[];
 const block=code=>{if(!failures.includes(code))failures.push(code);};
 if(!validHttpsOrigin(workspaceOrigin))block('invalid_workspace_origin');
 if(!Array.isArray(clients)||clients.length!==7){
  block('exactly_seven_clients_required');
  return Object.freeze({ok:false,failures,productionAuthorized:false,
   licensesGranted:false,deployable:false});
 }
 const ids=clients.map(client=>client?.id);
 const expected=[...EXISTING_DUCKBIO_APP_IDS,DATADUCK_APP.id];
 if(!unique(ids)||!unique(expected)||!expected.every(id=>ids.includes(id)))
  block('registered_app_set_mismatch');
 const origins=clients.map(c=>c?.nativeOrigin);
 const secrets=clients.map(c=>c?.secret);
 if(!unique(origins)||origins.includes(workspaceOrigin))
  block('native_origins_not_isolated');
 if(!unique(secrets))block('client_secrets_not_independent');
 for(const client of clients){
  if(!client||typeof client!=='object'||Array.isArray(client)||
     client.id!==client.appId||!expected.includes(client.id))
   {block('invalid_client_identity');continue;}
  if(!validHttpsOrigin(client.nativeOrigin))block('invalid_native_origin');
  if(!Array.isArray(client.redirectUris)||client.redirectUris.length!==1||
     client.redirectUris[0]!==client.nativeOrigin+DATADUCK_APP.callbackPath)
   block('invalid_native_callback');
  if(typeof client.secret!=='string'||client.secret.length<32||
     client.secret.length>512||/[\x00-\x1f\x7f]/.test(client.secret))
   block('invalid_private_client_secret');
 }
 return Object.freeze({ok:failures.length===0,failures,
  productionAuthorized:false,licensesGranted:false,deployable:false});
}

// DataDuck's native backend, not Workspace UI or a central role, decides
// project/dataset authorization. A verified paid entitlement MUST be
// independently bound to the exact native UUIDs and rechecked on every
// protected operation; this function never issues access.
export function inspectDataDuckNativeEntitlement({entitlement,localIdentity}={}){
 const fail=reason=>Object.freeze({ready:false,reason,accessGranted:false});
 if(!localIdentity||typeof localIdentity!=='object'||
    typeof localIdentity.userId!=='string'||
    typeof localIdentity.organizationId!=='string'||
    !localIdentity.userId||!localIdentity.organizationId)
  return fail('missing_exact_native_identity');
 const e=entitlement;
 if(!e||e.source!=='verified-live'||e.allowed!==true||
    e.appId!==DATADUCK_APP.id||
    e.userId!==localIdentity.userId||
    e.organizationId!==localIdentity.organizationId||
    !Number.isSafeInteger(e.expiresAt)||e.expiresAt<=Date.now())
  return fail('unverified_or_unmatched_paid_entitlement');
 return Object.freeze({ready:true,reason:'source-contract-only',
  accessGranted:false});
}
