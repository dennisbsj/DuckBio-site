// READ-ONLY operator staging witness for seven concurrently installed services.
// No service start/stop, privileged mutation, credentials, login, payment,
// host discovery or unknown network destinations. Source/CI alone is not proof
// of installed staging, and this is NOT native role/paid-entitlement QA.
import {execFileSync} from 'node:child_process';
import {readFileSync,readlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';
import {EXPECTED_NATIVE} from './six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';
import {auditSevenLocalSources} from './staging-seven-source-gate.mjs';
import {runWorkspaceStagingReadOnlySmoke}
 from './staging-readonly-smoke.mjs';

const PROPERTIES=['LoadState','ActiveState','SubState','MainPID',
 'User','Group','WorkingDirectory'];
const SOURCE_ROWS=Object.freeze([
 Object.freeze({id:'workspace',repo:'DuckBio-site',
  unit:'duckbio-workspace-staging.service',user:'duckbio-staging',
  entrypoint:'shared-auth/runtime.mjs',subdir:'workspace-server'}),
 ...EXPECTED_NATIVE.map(row=>Object.freeze({
  id:row.id,repo:row.repo.split('/')[1],
  unit:'duckbio-native-'+row.id+'-staging.service',
  user:'duckbio-stg-'+row.id,
  entrypoint:row.id==='eel'?'server/index.js':'startup.cjs',
  subdir:''
 }))
]);
const report=(name,ok,code)=>Object.freeze({name,ok:Boolean(ok),code});
const stop=(checks,name,code)=>Object.freeze({
 ok:false,checks:[...checks,report(name,false,code)],
 category:'live-seven-staging-unverified',deploymentAuthorized:false
});
const noPathLeak=e=>typeof e==='string'&&
 /^[a-z][a-z0-9_-]{0,70}$/.test(e);

// Keep systemd queries read only, with fixed unit names and a short timeout.
// systemctl show may expose private paths; never print its raw output.
export function inspectStagingUnit(unit,{run=execFileSync}={}){
 if(!SOURCE_ROWS.some(row=>row.unit===unit))
  throw Error('unknown_staging_service');
 const body=run('systemctl',[
  'show','--no-pager','--property='+PROPERTIES.join(','),unit
 ],{encoding:'utf8',timeout:5000,maxBuffer:32768,
    stdio:['ignore','pipe','ignore']});
 if(typeof body!=='string'||body.length>32768)
  throw Error('unreadable_service');
 const values=Object.create(null);
 for(const line of body.split('\n')){
  if(!line)continue;
  const at=line.indexOf('='),key=line.slice(0,at);
  if(at<1||!PROPERTIES.includes(key)||Object.hasOwn(values,key))
   throw Error('invalid_service_properties');
  values[key]=line.slice(at+1);
 }
 if(!PROPERTIES.every(k=>Object.hasOwn(values,k)))
  throw Error('incomplete_service_properties');
 return values;
}

// Inspect the actual Linux process, not only a (forgeable) HTTP response
// or a systemd unit filename. No process environment values are read.
export function inspectStagingProcess(pid,{
 read=readFileSync,link=readlinkSync
}={}){
 if(!Number.isSafeInteger(pid)||pid<2||pid>2147483647)
  throw Error('invalid_staging_pid');
 const dir='/proc/'+pid;
 const raw=read(dir+'/cmdline');
 if(!Buffer.isBuffer(raw)||raw.length<6||raw.length>8192)
  throw Error('invalid_staging_argv');
 const args=raw.toString('utf8').split('\0');
 if(args.at(-1)==='')args.pop();
 return {args,cwd:link(dir+'/cwd'),exe:link(dir+'/exe')};
}

function verifiedService(row,properties,proc,sourcesRoot){
 if(!properties||properties.LoadState!=='loaded'||
    properties.ActiveState!=='active'||
    properties.SubState!=='running'||
    properties.User!==row.user||properties.Group!==row.user)
  return null;
 const pid=Number(properties.MainPID);
 if(!Number.isSafeInteger(pid)||pid<2||pid>2147483647)
  return null;
 const cwd=join(sourcesRoot,row.repo,row.subdir);
 const entry=join(cwd,row.entrypoint);
 if(properties.WorkingDirectory!==cwd||
    !proc||proc.cwd!==cwd||
    !Array.isArray(proc.args)||proc.args.length!==2||
    proc.args[1]!==entry||
    typeof proc.args[0]!=='string'||
    !/^\/[A-Za-z0-9_./+-]+\/node$/.test(proc.args[0])||
    typeof proc.exe!=='string'||
    !/^\/[A-Za-z0-9_./+-]+\/node$/.test(proc.exe))
  return null;
 return pid;
}

// PASS = seven clean source checkouts, seven distinct currently active
// systemd native application processes with the expected executable/script,
// cwd and user; seven HTTPS contracts; and unchanged second process check.
// This is still NOT an authenticated cross-app role/seat browser test.
export async function auditSevenGenuineStaging({
 config,lock,sourcesRoot,runGit,
 sourceAudit=auditSevenLocalSources,
 inspectUnit=inspectStagingUnit,inspectProcess=inspectStagingProcess,
 smoke=runWorkspaceStagingReadOnlySmoke
}={}){
 const checks=[];
 if(!config||!lock||!validateWorkspaceStagingConfig(config).ok||
    validateSixNativeStagingSnapshot(lock).kind!=='current'||
    config.SUITE_BUILD_SHA!==lock.central.sha)
  return stop(checks,'configuration','invalid_source_locked_staging');
 if(process.platform!=='linux')
  return stop(checks,'host','linux_systemd_host_required');
 let root;
 try{
  if(typeof sourcesRoot!=='string'||!sourcesRoot.startsWith('/')||
     resolve(sourcesRoot)!==sourcesRoot)
   throw Error('unsafe_root');
  // The strict Git-source audit checks canonical, private, non-symlink roots.
  const source=await sourceAudit({
   sourcesRoot,workspaceBuildSha:config.SUITE_BUILD_SHA,
   lock,...(runGit?{runGit}:{})
  });
  if(!source.ok||source.verified!==7)
   throw Error('source_not_verified');
  root=sourcesRoot;
 }catch{return stop(checks,'sources','seven_current_checkouts_unverified')}
 checks.push(report('sources',true,'ok'));
 const first=new Map(),used=new Set();
 for(const row of SOURCE_ROWS){
  try{
   const properties=await inspectUnit(row.unit);
   const pid=Number(properties.MainPID);
   const proc=await inspectProcess(pid);
   if(verifiedService(row,properties,proc,root)!==pid||used.has(pid))
    throw Error('invalid_service');
   used.add(pid);
   first.set(row.id,pid);
   checks.push(report(row.id+'-process',true,'ok'));
  }catch{return stop(checks,row.id+'-process','service_not_genuine_or_active')}
 }
 if(used.size!==7)return stop(checks,'inventory','distinct_processes_required');
 // Anonymous HTTPS smoke ONLY runs after source and process checks pass.
 // It checks exact broker build version before probing any native hosts;
 // sends no cookies, POST or redirects.
 try{
  const result=await smoke(config);
  if(!result?.ok||!Array.isArray(result.checks)||
     result.checks.length!==9||
     result.checks.some(c=>!c.passed||
      typeof c.target!=='string'||typeof c.code!=='string'||
      !noPathLeak(c.code)))
   return stop(checks,'seven-https','native_https_contract_unverified');
 }catch{return stop(checks,'seven-https','native_https_contract_unverified')}
 checks.push(report('seven-https',true,'ok'));
 // Detect process exit/replacement between local and HTTPS checks.
 for(const row of SOURCE_ROWS){
  try{
   const properties=await inspectUnit(row.unit);
   const pid=Number(properties.MainPID);
   const proc=await inspectProcess(pid);
   if(first.get(row.id)!==pid||
      verifiedService(row,properties,proc,root)!==pid)
    throw Error('service_changed');
  }catch{return stop(checks,row.id+'-stability','service_changed_during_probe')}
 }
 checks.push(report('seven-process-stability',true,'ok'));
 return Object.freeze({
  ok:true,checks,category:'seven-real-systemd-processes-and-anonymous-https-only',
  deploymentAuthorized:false
 });
}

const isCLI=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(isCLI){
 const args=process.argv.slice(2);
 if(args.length!==5||args[0]!=='--config'||
    args[2]!=='--sources-root'||
    args[4]!=='--confirm-installed-synthetic-staging-readonly'){
  console.error('Usage: node staging-seven-genuine-runtime-audit.mjs --config PRIVATE_JSON --sources-root PRIVATE_SEVEN_CHECKOUTS --confirm-installed-synthetic-staging-readonly');
  process.exitCode=2;
 }else{
  try{
   const config=readPrivateConfiguration(args[1]);
   const lock=JSON.parse(readFileSync(new URL(
    './six-native-current-compat-lock.json',import.meta.url),'utf8'));
   const result=await auditSevenGenuineStaging({
    config,lock,sourcesRoot:args[3]
   });
   // Fixed codes/app IDs only; never raw systemd, env, private paths,
   // credential values, response bodies, tokens or URLs.
   for(const check of result.checks)
    console.log((check.ok?'PASS ':'FAIL ')+check.name+': '+check.code);
   if(!result.ok)process.exitCode=1;
   else console.log('PASS seven actual staging processes and anonymous HTTPS contracts; NOT authenticated cross-app, native roles, payment, restore or release');
  }catch{
   console.error('FAIL seven genuine staging: unsafe_or_unverified_input');
   process.exitCode=1;
  }
 }
}
