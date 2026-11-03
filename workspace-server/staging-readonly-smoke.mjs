// Anonymous, read-only HTTPS staging probe. No credentials, cookies, POSTs,
// redirects, database access, secret output or deployment operations.
// Explicitly opt-in from a previously validated synthetic-only PRIVATE config.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateConfiguration,validateWorkspaceStagingConfig} from './staging-preflight.mjs';

const ROUTES=Object.freeze({
 goflo:'/api/suite/communications/config',
 eel:'/api/suite/communications/config',
 methpipe:'/api/suite/communications/config',
 mantrain:'/api/suite/communications/config',
 duckman:'/api/suite/communications/config',
 limsman:'/api.php?action=workspace_communications_config'
});
const MAX_BODY=4096;
const MIME=/^application\/json(?:\s*;|$)/i;
const status=(target,passed,code)=>({target,passed,code});

async function getJSON(url,fetchImpl,timeoutMs){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetchImpl(url,{
   method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
   referrerPolicy:'no-referrer',
   headers:{Accept:'application/json'},
   signal:controller.signal
  });
  if(!response||!Number.isInteger(response.status)||response.redirected||
     (response.url&&response.url!==url))return {error:'untrusted_response'};
  if(!MIME.test(response.headers?.get('content-type')||''))
   return {error:'non_json_response'};
  if(!response.body)return {error:'missing_response_body'};
  const parts=[];let size=0;
  for await(const piece of response.body){
   size+=piece.byteLength;
   if(size>MAX_BODY)return {error:'oversized_response'};
   parts.push(Buffer.from(piece));
  }
  let body;
  try{body=JSON.parse(Buffer.concat(parts).toString('utf8'))}
  catch{return {error:'invalid_json'}}
  if(!body||typeof body!=='object'||Array.isArray(body))
   return {error:'invalid_json'};
  return {response,body};
 }catch{return {error:'request_unavailable'}}
 finally{clearTimeout(timer)}
}
function inspectError(result,target){
 return status(target,false,result.error||'unexpected_status');
}

export async function runWorkspaceStagingReadOnlySmoke(config,{
 fetchImpl=globalThis.fetch,timeoutMs=8000
}={}){
 const preflight=validateWorkspaceStagingConfig(config);
 if(!preflight.ok){
  return {ok:false,checks:[status('configuration',false,'offline_preflight_required')]};
 }
 if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||
    timeoutMs<100||timeoutMs>30000){
  return {ok:false,checks:[status('configuration',false,'invalid_probe_options')]};
 }
 const workspace=await getJSON(config.SUITE_ORIGIN+'/api/suite/health',fetchImpl,timeoutMs);
 if(workspace.error)return {ok:false,checks:[inspectError(workspace,'workspace-health')]};
 const {body,response}=workspace;
 if(response.status!==200||body.status!=='ok'||body.mode!=='local'||
    body.buildVersion!==config.SUITE_BUILD_SHA||body.configured!==true||
    !/no-store/i.test(response.headers.get('cache-control')||'')){
  return {ok:false,checks:[status('workspace-health',false,'workspace_identity_or_setup_mismatch')]};
 }
 const checks=[status('workspace-health',true,'ok')];
 // Workspace must pass first; never issue requests to other configured hosts
 // on an invalid, retired, unconfigured or unexpectedly deployed broker.
 const clientById=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 const requests=Object.entries(ROUTES).map(async([id,route])=>{
  const client=clientById.get(id);
  const origin=client.nativeOrigin;
  const native=await getJSON(origin+route,fetchImpl,timeoutMs);
  let protectedCheck;
  if(native.error)protectedCheck=inspectError(native,id+'-auth-boundary');
  else if(native.response.status===200)
   protectedCheck=status(id+'-auth-boundary',false,'anonymous_private_endpoint_exposed');
  else if(![401,403].includes(native.response.status)||
    typeof native.body.error!=='string'||!native.body.error)
   protectedCheck=status(id+'-auth-boundary',false,'native_auth_boundary_mismatch');
  else protectedCheck=status(id+'-auth-boundary',true,'ok');

  // Health is only published with distinct contracts by these two apps.
  if(id!=='eel'&&id!=='limsman')return [protectedCheck];
  const healthUrl=origin+(id==='eel'?'/health':'/api.php?action=health');
  const health=await getJSON(healthUrl,fetchImpl,timeoutMs);
  if(health.error)return [protectedCheck,inspectError(health,id+'-health')];
  const matches=health.response.status===200&&health.body.ok===true&&
   (id==='eel'?health.body.database===true:
    health.body.runtime==='node'&&health.body.schemaVersion===1);
  return [protectedCheck,status(id+'-health',matches,
   matches?'ok':'native_database_or_runtime_unready')];
 });
 for(const entries of await Promise.all(requests))checks.push(...entries);
 return {ok:checks.every(c=>c.passed),checks};
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--config'||args[2]!=='--confirm-read-only-staging'){
  console.error('Usage: node staging-readonly-smoke.mjs --config /absolute/private/staging.json --confirm-read-only-staging');
  process.exitCode=2;
 }else{
  try{
   const report=await runWorkspaceStagingReadOnlySmoke(readPrivateConfiguration(args[1]));
   for(const check of report.checks){
    // Stable app IDs and fixed error codes only; never URLs, body, tokens or secrets.
    console.log((check.passed?'PASS ':'FAIL ')+check.target+': '+check.code);
   }
   if(!report.ok)process.exitCode=1;
  }catch{
   console.error('FAIL configuration: unreadable_or_unsafe_config');
   process.exitCode=1;
  }
 }
}
