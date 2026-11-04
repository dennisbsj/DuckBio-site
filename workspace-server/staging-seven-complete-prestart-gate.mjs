// Uninstalled, READ-ONLY exact seven-service prestart *including* Workspace.
// Existing historical/native-only prestart CLI is intentionally unchanged.
// This extra gate requires the current six-original-app source lock and a
// separately generated, source-exact seventh Workspace private unit/UI plan.
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateConfiguration}
 from './staging-preflight.mjs';
import {auditSevenServicePrestart}
 from './staging-seven-prestart-gate.mjs';
import {auditSeventhWorkspaceUnit}
 from './staging-workspace-seventh-unit-audit.mjs';
import {auditSevenLocalSources}
 from './staging-seven-source-gate.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from './staging-six-native-snapshot.mjs';

const stop=(name,checks)=>Object.freeze({
 ok:false,checks:[...checks,{name,ok:false}],
 category:'offline_seven_complete_unverified',
 deploymentAuthorized:false
});
export function auditSevenCompleteUninstalledPrestart({
 config,lock,sourcesRoot,dataRoot,proxyOutputRoot,nativeOutputRoot,
 nodeBinary=process.execPath,runGit,
 sixGate=auditSevenServicePrestart,
 workspaceGate=auditSeventhWorkspaceUnit,
 sourceGate=auditSevenLocalSources
}={}){
 const checks=[];
 if(!['current','post-pkce'].includes(validateSixNativeStagingSnapshot(lock).kind))
  return stop('current-six-native-qa-lock-required',checks);
 let native;
 try{
  native=sixGate({config,lock,sourcesRoot,dataRoot,proxyOutputRoot,
   nativeOutputRoot,nodeBinary,...(runGit?{runGit}:{})});
 }catch{
  return stop('six-native-source-prestart',checks);
 }
 if(native?.ok!==true||native?.deploymentAuthorized!==false||
    native.checked!==5||native.checks?.length!==5||
    native.checks.some(x=>!x.ok))
  return stop('six-native-source-prestart',checks);
 checks.push({name:'six-native-source-prestart',ok:true});
 let workspace;
 try{
  workspace=workspaceGate({config,lock,sourcesRoot,nodeBinary});
 }catch{
  return stop('seventh-workspace-service-unit',checks);
 }
 if(workspace?.ok!==true||workspace?.deploymentAuthorized!==false||
    workspace.unitVerified!==true||workspace.uiVerified!==true)
  return stop('seventh-workspace-service-unit',checks);
 checks.push({name:'seventh-workspace-service-unit',ok:true});
 // The native prestart checked pristine Git trees BEFORE the seventh unit
 // read them. Close the source verification window: re-check all seven
 // immutable checkouts after reading the private Workspace UI and unit.
 // Otherwise a source file swapped between the first Git check and the UI
 // comparison could be accepted along with a forged private UI manifest.
 let source;
 try{
  source=sourceGate({
   sourcesRoot,workspaceBuildSha:lock.central.sha,lock,
   ...(runGit?{runGit}:{})
  });
 }catch{
  return stop('seven-final-source-recheck',checks);
 }
 if(source?.ok!==true||source.verified!==7||
    !Array.isArray(source.errors)||source.errors.length!==0)
  return stop('seven-final-source-recheck',checks);
 checks.push({name:'seven-final-source-recheck',ok:true});
 return Object.freeze({
  ok:true,checks,category:'offline-exact-seven-private-uninstalled-plans-only',
  deploymentAuthorized:false
 });
}
const direct=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(direct){
 const args=process.argv.slice(2);
 const expected=['--config','--sources-root','--private-data-root',
  '--proxy-plan-root','--native-plan-root'];
 const prior=args.length===11&&args[10]==='--confirm-offline-seven-uninstalled-only';
 const newer=args.length===13&&args[10]==='--snapshot'&&
  args[11]==='post-pkce'&&args[12]==='--confirm-offline-seven-uninstalled-only';
 if((!prior&&!newer)||!expected.every((flag,i)=>args[i*2]===flag)){
  console.error('Usage: node staging-seven-complete-prestart-gate.mjs --config PRIVATE_STAGING_JSON --sources-root PRIVATE_SEVEN_GIT_CHECKOUTS --private-data-root PRIVATE_NATIVE_ROOT --proxy-plan-root PRIVATE_PROXY_ROOT --native-plan-root PRIVATE_UNIT_ROOT [--snapshot post-pkce] --confirm-offline-seven-uninstalled-only');
  process.exitCode=2;
 }else{
  try{
   const config=readPrivateConfiguration(args[1]);
   const lock=JSON.parse(readFileSync(new URL(
    './'+stagingSnapshotFile(newer?'post-pkce':'current'),import.meta.url),'utf8'));
   const result=auditSevenCompleteUninstalledPrestart({
    config,lock,sourcesRoot:args[3],dataRoot:args[5],
    proxyOutputRoot:args[7],nativeOutputRoot:args[9]
   });
   for(const c of result.checks)
    console.log((c.ok?'PASS ':'BLOCKED ')+c.name);
   if(!result.ok)process.exitCode=1;
   else console.log('PASS seven reviewed private source/uninstalled templates; NOT INSTALLED, TLS, native permissions, paid seats or production');
  }catch{
   console.error('BLOCKED seven uninstalled prestart: unsafe_or_unverified_input');
   process.exitCode=1;
  }
 }
}
