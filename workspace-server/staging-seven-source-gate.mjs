// Exact-source readiness gate for SEVEN local, owner-controlled Git checkouts.
// Offline; does not build, start, deploy, install, network-fetch or open secrets.
// A successful source check is NOT a seven-service runtime/staging test.
import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';
import {validatePinnedWorkflow} from './six-app-source-qa-audit.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from './staging-six-native-snapshot.mjs';

const nameOf=row=>row.repo.split('/')[1];
const validRemote=(value,repo)=>{
 const expected='dennisbsj/'+nameOf({repo});
 return [
  'https://github.com/'+expected,
  'https://github.com/'+expected+'.git',
  'git@github.com:'+expected+'.git',
  'ssh://git@github.com/'+expected+'.git'
 ].includes(value);
};
const gitOptions=path=>({
 cwd:path,encoding:'utf8',timeout:10000,stdio:['ignore','pipe','ignore'],
 maxBuffer:1024*1024
});
function checkedGit(path,args,runGit){
 const result=runGit('git',['-c','core.fsmonitor=false',...args],gitOptions(path));
 if(typeof result!=='string')throw Error('invalid_git_result');
 return result.trim();
}

// Expected Workspace version is the exact source tested with ALL SIX native
// CI workflows, not a newer service-plan source tree by implicit inheritance.
export function auditSevenLocalSources({sourcesRoot,workspaceBuildSha,lock,
 runGit=execFileSync}={}){
 // Preserve the historical lock unchanged while also permitting the new
 // independently reviewed, exactly six-native current-Workspace QA snapshot.
 // Both schemas are allowlisted, fixed-source and deny extra app IDs.
 if(!validateSixNativeStagingSnapshot(lock).ok)
  return {ok:false,verified:0,errors:['invalid_source_qa_lock']};
 if(typeof workspaceBuildSha!=='string'||
    workspaceBuildSha!==lock.central.sha)
  return {ok:false,verified:0,errors:['workspace_version_not_six_app_verified']};
 let root;
 try{root=approvedPrivateRoot(sourcesRoot)}
 catch{return {ok:false,verified:0,errors:['unsafe_private_sources_root']}}
 const rows=[lock.central,...lock.apps];
 const expected=rows.map(nameOf).sort();
 try{
  const actual=readdirSync(root).sort();
  if(actual.length!==expected.length||
     actual.some((v,i)=>v!==expected[i]))
   return {ok:false,verified:0,errors:['unexpected_checkout_inventory']};
 }catch{return {ok:false,verified:0,errors:['unreadable_checkout_inventory']}}
 const errors=[];
 let verified=0;
 for(const row of rows){
  const tag=row.id||'workspace';
  const directory=join(root,nameOf(row));
  try{
   const stat=lstatSync(directory);
   if(!stat.isDirectory()||stat.isSymbolicLink()||
      realpathSync(directory)!==resolve(directory))
    throw Error('untrusted_checkout_directory');
   const gitRoot=checkedGit(directory,['rev-parse','--show-toplevel'],runGit);
   if(resolve(gitRoot)!==resolve(directory))
    throw Error('nested_git_checkout');
   const remote=checkedGit(directory,['remote','get-url','origin'],runGit);
   if(!validRemote(remote,row.repo))throw Error('wrong_git_origin');
   const head=checkedGit(directory,['rev-parse','--verify','HEAD'],runGit);
   if(head!==row.sha)throw Error('checkout_sha_mismatch');
   if(checkedGit(directory,['status','--porcelain','--untracked-files=normal'],
       runGit)!=='')throw Error('checkout_not_clean');
   // The central Workspace source has its own CI workflow but does not
   // checkout itself: only the SIX native workflows must pin the broker.
   if(row.id&&row.workflow){
    const workflow=checkedGit(directory,['show','HEAD:'+row.workflow],runGit);
    if(!validatePinnedWorkflow(workflow,lock.central.sha))
     throw Error('native_workspace_pin_mismatch');
   }
   // Detect a source change between the earlier checks and final acceptance.
   if(checkedGit(directory,['rev-parse','--verify','HEAD'],runGit)!==row.sha)
    throw Error('checkout_sha_mismatch');
   verified++;
  }catch{
   // Never expose paths, remote URLs, Git error text or secret-bearing filenames.
   errors.push('unverified_'+tag+'_source_checkout');
  }
 }
 return {ok:errors.length===0,verified,errors};
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 const historical=args.length===5&&args[4]==='--confirm-offline-sources';
 const current=args.length===7&&args[4]==='--snapshot'&&
  ['current','post-pkce','ownership-mtls'].includes(args[5])&&args[6]==='--confirm-offline-sources';
 if((!historical&&!current)||args[0]!=='--config'||
    args[2]!=='--sources-root'){
  console.error('Usage: node staging-seven-source-gate.mjs --config PRIVATE_STAGING_JSON --sources-root PRIVATE_SEVEN_CHECKOUTS [--snapshot current|post-pkce|ownership-mtls] --confirm-offline-sources');
  process.exitCode=2;
 }else{
  try{
   const config=readPrivateConfiguration(args[1]);
   if(!validateWorkspaceStagingConfig(config).ok)throw Error('invalid_config');
   const filename=stagingSnapshotFile(current?args[5]:'historical');
   const lock=JSON.parse(await import('node:fs').then(
    fs=>fs.readFileSync(new URL('./'+filename,import.meta.url),'utf8')));
   const report=auditSevenLocalSources({sourcesRoot:args[3],
    workspaceBuildSha:config.SUITE_BUILD_SHA,lock});
   if(!report.ok){
    console.error('Seven-source staging gate: FAIL ('+
     report.errors.join(', ')+')');
    process.exitCode=1;
   }else{
    console.log('Seven-source staging gate: PASS ('+report.verified+
     ' pristine reviewed Git source trees; OFFLINE only, NOT staging or deployment)');
   }
  }catch{
   console.error('Seven-source staging gate: FAIL (invalid_or_unsafe_input)');
   process.exitCode=1;
  }
 }
}
