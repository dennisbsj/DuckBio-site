/**
 * Eight actual local Git checkout audit. Source-only and fully offline.
 * Unlike the historical six-native QA lock, this gate requires Workspace,
 * all six old native apps, and unreleased DataDuck in separate repositories.
 * A PASS is NEVER evidence of LIVE paid seats, TLS, or native authorization.
 */
import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync,readdirSync,readFileSync} from 'node:fs';
import {basename,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildEightOriginCandidate,EIGHT_SERVICE_SLOTS} from './staging-eight-origin-candidate.mjs';

const report=(verified,errors)=>Object.freeze({
 ok:errors.length===0,verified,errors:Object.freeze(errors),
 sourceOnly:true,currentMainIndependentlyVerified:false,
 nativeAuthorizationVerified:false,liveSeatsVerified:false,
 eightOriginHttpsVerified:false,stagingAuthorized:false,
 productionAuthorized:false,licensesGranted:false
});
const safeRoot=value=>{
 if(typeof value!=='string'||!isAbsolute(value))return null;
 const parts=resolve(value).split(sep);
 if(parts.includes('public_html'))return null;
 try{
  const stat=lstatSync(value);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     realpathSync(value)!==resolve(value))return null;
  return resolve(value);
 }catch{return null;}
};
const expectedRemote=repo=>new Set([
 'https://github.com/'+repo,
 'https://github.com/'+repo+'.git',
 'git@github.com:'+repo+'.git',
 'ssh://git@github.com/'+repo+'.git'
]);
const git=(runGit,directory,args)=>{
 const value=runGit('git',['-c','core.fsmonitor=false',...args],{
  cwd:directory,encoding:'utf8',timeout:10000,
  stdio:['ignore','pipe','ignore'],maxBuffer:1024*1024,
  // Do not allow GIT_DIR, GIT_WORK_TREE or GIT_CONFIG_* from callers
  // to redirect what the offline source audit actually inspects.
  env:Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('GIT_')))
 });
 if(typeof value!=='string')throw Error('untrusted_git_response');
 return value.trim();
};

/**
 * Operator-supplied entries are claims, not remote attestations. Check each
 * physical checkout instead of trusting a printed SHA.
 * No network, package installs, credential handling, service startup or push.
 */
export function auditEightLocalSources({sourcesRoot,stagingDomain,entries,
 runGit=execFileSync}={}){
 const proposed=buildEightOriginCandidate({stagingDomain,entries});
 if(!proposed.ok)return report(0,['invalid_eight_origin_proposal']);
 const root=safeRoot(sourcesRoot);
 if(!root)return report(0,['invalid_private_source_root']);
 const expected=EIGHT_SERVICE_SLOTS.map(slot=>slot.repo.split('/')[1]).sort();
 try{
  const found=readdirSync(root).sort();
  if(found.length!==8||found.some((v,i)=>v!==expected[i]))
   return report(0,['unexpected_eight_checkout_inventory']);
 }catch{return report(0,['unreadable_eight_checkout_inventory']);}
 const errors=[];
 let verified=0;
 for(const row of proposed.entries){
  const directory=join(root,basename(row.repo));
  try{
   const stat=lstatSync(directory);
   if(!stat.isDirectory()||stat.isSymbolicLink()||
      realpathSync(directory)!==resolve(directory))
    throw Error('untrusted_checkout_path');
   if(resolve(git(runGit,directory,['rev-parse','--show-toplevel']))!==resolve(directory))
    throw Error('nested_or_other_git_checkout');
   const remote=git(runGit,directory,['config','--local','--no-includes','--get','remote.origin.url']);
   if(!expectedRemote(row.repo).has(remote))throw Error('unexpected_git_origin');
   if(git(runGit,directory,['rev-parse','--verify','HEAD'])!==row.sha)
    throw Error('wrong_source_commit');
   if(git(runGit,directory,['status','--porcelain','--untracked-files=all'])!=='')
    throw Error('dirty_checkout');
   // Re-read after status to deny a concurrent checkout.
   if(git(runGit,directory,['rev-parse','--verify','HEAD'])!==row.sha)
    throw Error('source_changed_during_audit');
   verified++;
  }catch{
   // Never print filesystem paths, Git remotes, or checkout contents.
   errors.push('unverified_'+row.id+'_source');
  }
 }
 return report(verified,errors);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==5||args[0]!=='--proposal'||
    args[2]!=='--sources-root'||args[4]!=='--confirm-offline-only'){
  console.error('Usage: node staging-eight-source-gate.mjs --proposal PRIVATE_SOURCE_PROPOSAL_JSON --sources-root PRIVATE_EIGHT_CHECKOUTS --confirm-offline-only');
  process.exitCode=2;
 }else{
  try{
   const input=JSON.parse(readFileSync(args[1],'utf8'));
   if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).sort().join(',')!=='entries,stagingDomain')
    throw Error('invalid_source_proposal');
   const result=auditEightLocalSources({
    stagingDomain:input.stagingDomain,entries:input.entries,
    sourcesRoot:args[3]
   });
   if(result.ok)console.log('Eight local sources: PASS (8 pristine exact Git trees, OFFLINE SOURCE ONLY; no TLS, seats, native authorization or staging approval)');
   else{
    console.error('Eight local sources: FAIL ('+result.errors.join(', ')+')');
    process.exitCode=1;
   }
  }catch{
   console.error('Eight local sources: FAIL (unsafe_or_unreadable_proposal)');
   process.exitCode=1;
  }
 }
}
