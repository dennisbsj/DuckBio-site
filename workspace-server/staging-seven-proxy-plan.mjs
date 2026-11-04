// UNINSTALLED seven-origin Caddy plan for synthetic-only Workspace staging.
// No DNS, public certificate, server, account, database or network operations.
// The exact six-app-tested Workspace SHA is mandatory, but a PASS is NOT a
// release approval or a proof that any native service actually runs.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from './staging-six-native-snapshot.mjs';

export const STAGING_PROXY_PORTS=Object.freeze({
 workspace:3307,goflo:3308,eel:3309,methpipe:3310,
 mantrain:3311,duckman:3312,limsman:3313
});
const sha256=value=>createHash('sha256').update(value).digest('hex');
const keys=Object.keys(STAGING_PROXY_PORTS);
const isPlainObject=value=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

export function validateStagingProxyPorts(ports){
 if(!isPlainObject(ports)||Object.keys(ports).length!==keys.length||
  Object.keys(ports).some(id=>!keys.includes(id)))return false;
 const all=Object.values(ports);
 return all.every(port=>Number.isSafeInteger(port)&&
   port>=1024&&port<=65535)&&new Set(all).size===all.length;
}

export function buildSevenOriginProxyPlan(config,lock,ports=STAGING_PROXY_PORTS){
 if(!validateWorkspaceStagingConfig(config).ok)
  throw Error('invalid_synthetic_staging_config');
 if(!validateSixNativeStagingSnapshot(lock).ok)
  throw Error('invalid_source_qa_lock');
 if(config.SUITE_BUILD_SHA!==lock.central.sha)
  throw Error('staging_workspace_sha_not_jointly_verified');
 if(!validateStagingProxyPorts(ports))throw Error('invalid_or_duplicate_proxy_ports');

 const clients=JSON.parse(config.SUITE_CLIENTS);
 const byId=new Map(clients.map(client=>[client.id,client]));
 const origins=[{id:'workspace',name:'Workspace',
  origin:config.SUITE_ORIGIN,repo:lock.central.repo,
  sha:lock.central.sha,port:ports.workspace}];
 for(const app of lock.apps){
  const native=byId.get(app.id);
  if(!native||native.appId!==app.id)throw Error('native_source_registration_mismatch');
  origins.push({id:app.id,name:app.name,origin:native.nativeOrigin,
   repo:app.repo,sha:app.sha,port:ports[app.id]});
 }
 if(origins.length!==7||new Set(origins.map(o=>o.origin)).size!==7)
  throw Error('seven_distinct_staging_origins_required');

 const lines=[
  '# UNINSTALLED TEMPLATE: validating this file does NOT provision DNS/TLS.',
  '# All seven destinations MUST be separate native services on loopback.',
  '# Do not include this alongside the older Workspace-only Caddy site block.',
  '# Never copy to /etc/caddy without independent host, backup and TLS review.',
  ''
 ];
 for(const item of origins){
  const host=new URL(item.origin).hostname;
  lines.push(
   host+' {',
   '  @wrongHost not host '+host,
   '  respond @wrongHost 421',
   '  header {',
   '    ?X-Content-Type-Options "nosniff"',
   '    ?X-Frame-Options "DENY"',
   '    ?Referrer-Policy "no-referrer"',
   '  }',
   '  reverse_proxy 127.0.0.1:'+item.port+' {',
   '    header_up Host {http.request.host}',
   '    header_up -Forwarded',
   '    header_up -X-Forwarded-For',
   '    header_up -X-Forwarded-Host',
   '    header_up X-Forwarded-Proto https',
   '  }',
   '}',''
  );
 }
 const caddy=lines.join('\n');
 const routes=origins.map(o=>Object.freeze({
  id:o.id,repo:o.repo,reviewedSourceSha:o.sha,
  hostname:new URL(o.origin).hostname,loopbackPort:o.port
 }));
 const manifest=Object.freeze({
  format:'duckbio-seven-origin-staging-proxy-plan-v1',
  scope:'uninstalled-caddy-source-template-only',
  sourceQaWorkspaceSha:lock.central.sha,
  routeCount:routes.length,routes,
  caddySha256:sha256(caddy)
 });
 return Object.freeze({caddy,manifest});
}

export function writeSevenOriginProxyPlan({
 config,lock,outputRoot,ports=STAGING_PROXY_PORTS
}={}){
 // Validate all source and policy data BEFORE attempting any file writes.
 const plan=buildSevenOriginProxyPlan(config,lock,ports);
 const root=approvedPrivateRoot(outputRoot);
 const dir=join(root,'seven-origin-proxy-plan');
 // Exclusive mkdir: never update/replace an existing or symlinked plan.
 mkdirSync(dir,{mode:0o700});
 try{
  writeFileSync(join(dir,'Caddyfile.seven-origin-staging'),plan.caddy,
   {mode:0o600,flag:'wx'});
  writeFileSync(join(dir,'routing-manifest.json'),
   JSON.stringify(plan.manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 }catch(error){
  // Only remove the new, exclusively created plan directory.
  rmSync(dir,{recursive:true,force:true});
  throw error;
 }
 return Object.freeze({ok:true,origins:7,workspaceSha:lock.central.sha});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 const historical=args.length===5&&args[4]==='--confirm-uninstalled-only';
 const current=args.length===7&&args[4]==='--snapshot'&&
    ['current','post-pkce','ownership-mtls'].includes(args[5])&&args[6]==='--confirm-uninstalled-only';
 if((!historical&&!current)||args[0]!=='--config'||
    args[2]!=='--private-output-root'){
  console.error('Usage: node staging-seven-proxy-plan.mjs --config PRIVATE_JSON --private-output-root PRIVATE_ROOT [--snapshot current|post-pkce|ownership-mtls] --confirm-uninstalled-only');
  process.exitCode=2;
 }else{
  try{
   const config=readPrivateConfiguration(args[1]);
   const filename=stagingSnapshotFile(current?args[5]:'historical');
   const lock=JSON.parse(readFileSync(
    new URL('./'+filename,import.meta.url),'utf8'));
   writeSevenOriginProxyPlan({config,lock,outputRoot:args[3]});
   console.log('PASS seven distinct synthetic HTTPS proxy templates, uninstalled only');
  }catch{
   // No paths, URLs, secret values, Git refs or raw error stacks in CLI output.
   console.error('FAIL seven-origin proxy plan (private_config_source_or_destination_unverified)');
   process.exitCode=1;
  }
 }
}
