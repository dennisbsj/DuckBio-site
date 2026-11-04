// Independent review of the six REAL native mTLS sidecar source files.
// This audit reads private local Git metadata only. It never imports files,
// binds ports, contacts native services, reads credentials or authorizes login.
import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {auditSevenLocalSources} from './staging-seven-source-gate.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';

export const NATIVE_MTLS_FILES=Object.freeze([
 Object.freeze({id:'goflo',repo:'CytoDuck',
  path:'server/workspace-native-ownership-https.cjs',
  blob:'b2c123d9f824761da52b5a9d180bba7451d766ea'}),
 Object.freeze({id:'eel',repo:'DuckNote',
  path:'server/workspace-native-ownership-https.js',
  blob:'37955f955ad9abd6fcea95479be5d5cd1c2b212c'}),
 Object.freeze({id:'methpipe',repo:'DuckPipe',
  path:'server/workspace-native-ownership-https.cjs',
  blob:'108ee9ea40c1af7ec560001af62a75862c50ff12'}),
 Object.freeze({id:'mantrain',repo:'DuckTrain',
  path:'server/workspace-native-ownership-https.cjs',
  blob:'5baf1e4cdbbc8f3f54499ac1be31c2e30d8cacf7'}),
 Object.freeze({id:'duckman',repo:'DuckMan',
  path:'server/workspace-native-ownership-https.cjs',
  blob:'1c4b1fa59fa39683f5be1a8b53f3d27dd0d23bbc'}),
 Object.freeze({id:'limsman',repo:'LabDuck',
  path:'server/workspace-native-ownership-https.cjs',
  blob:'6114343a5988d53356bfe0a8193caa77f30b06eb'})
]);
const run=(git,dir,args)=>git('git',['-c','core.fsmonitor=false',...args],{
 cwd:dir,encoding:'utf8',timeout:10000,
 stdio:['ignore','pipe','ignore'],maxBuffer:131072
});
const fail=(error,verified=0)=>Object.freeze({
 ok:false,verified,errors:[error],deploymentAuthorized:false
});
const checked=(dir,segments)=>{
 let current=dir;
 for(const part of segments){
  current=join(current,part);
  const stat=lstatSync(current);
  if(!stat.isDirectory()&&!stat.isFile())throw Error('not_file_or_dir');
  if(stat.isSymbolicLink()||realpathSync(current)!==resolve(current))
   throw Error('untrusted_path');
 }
 return current;
};
const treeBlob=(git,dir,path)=>{
 const record=run(git,dir,['ls-tree','HEAD','--',path]);
 if(typeof record!=='string')return null;
 const m=/^100644 blob ([a-f0-9]{40})\t([^\r\n]+)\n?$/.exec(record);
 return m&&m[2]===path?m[1]:null;
};

/**
 * Only works with reviewed ownership-mTLS snapshot and seven pristine local
 * source checkouts. Requires the exact Git TREE objects of six native source
 * modules: a clean git status alone cannot re-label an arbitrary mTLS file.
 * No actual code execution: this attests SOURCE, not behavior or deployment.
 */
export function auditSixRealNativeMtlsFiles({
 lock,sourcesRoot,runGit=execFileSync
}={}){
 if(validateSixNativeStagingSnapshot(lock).kind!=='ownership-mtls')
  return fail('unreviewed_ownership_mtls_snapshot');
 if(!Array.isArray(lock.apps)||lock.apps.length!==6||
    NATIVE_MTLS_FILES.some((entry,i)=>{
     const row=lock.apps[i];
     return row?.id!==entry.id||
      row?.repo!=='dennisbsj/'+entry.repo;
    }))
  return fail('native_sidecar_inventory_mismatch');
 const sources=auditSevenLocalSources({
  sourcesRoot,workspaceBuildSha:lock.central.sha,lock,runGit
 });
 if(!sources.ok||sources.verified!==7)
  return fail('seven_source_prerequisite_unverified');
 let root;
 try{root=approvedPrivateRoot(sourcesRoot)}
 catch{return fail('unsafe_private_sources_root')}
 let verified=0;
 for(const entry of NATIVE_MTLS_FILES){
  const dir=join(root,entry.repo);
  try{
   const file=checked(dir,entry.path.split('/'));
   if(!lstatSync(file).isFile())throw Error('not_regular_file');
   const pinned=treeBlob(runGit,dir,entry.path);
   if(pinned!==entry.blob)throw Error('unexpected_source_blob');
   // Detect a dirty checkout, moved ref or replaced source file between
   // the existing seven-checkout preflight and this independent inspection.
   const row=lock.apps.find(a=>a.id===entry.id);
   if(run(runGit,dir,['rev-parse','--verify','HEAD']).trim()!==row.sha||
      run(runGit,dir,['status','--porcelain','--untracked-files=normal'])
       .trim()!==''||
      treeBlob(runGit,dir,entry.path)!==entry.blob||
      !lstatSync(file).isFile()||realpathSync(file)!==resolve(file))
    throw Error('source_changed_during_audit');
   verified++;
  }catch{
   return fail('unverified_native_mtls_file_'+entry.id,verified);
  }
 }
 return Object.freeze({
  ok:true,verified,errors:[],deploymentAuthorized:false,
  category:'six-exact-native-mtls-source-blobs-only'
 });
}

const invoked=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--sources-root'||
    args[2]!=='--confirm-offline-mtls-sources-only'){
  console.error('Usage: node six-native-mtls-sidecar-source-gate.mjs --sources-root PRIVATE_SEVEN_GIT_CHECKOUTS --confirm-offline-mtls-sources-only');
  process.exitCode=2;
 }else{
  try{
   const lock=JSON.parse(readFileSync(new URL(
    './six-native-ownership-mtls-compat-lock.json',import.meta.url),'utf8'));
   const result=auditSixRealNativeMtlsFiles({
    lock,sourcesRoot:args[1]
   });
   if(!result.ok){
    console.error('Native mTLS source gate: FAIL ('+
     result.errors.join(', ')+')');
    process.exitCode=1;
   }else{
    console.log('Native mTLS source gate: PASS (six exact reviewed private native Git sidecar blobs; OFFLINE SOURCE-ONLY; no native process, live HTTPS, credentials, entitlements or staging deployment)');
   }
  }catch{
   console.error('Native mTLS source gate: FAIL (unverified_input)');
   process.exitCode=1;
  }
 }
}
