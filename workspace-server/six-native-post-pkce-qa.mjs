// Immutable 2026-11-04 post-PKCE native source/CI evidence.
// Read-only offline/optional remote GitHub checks; NOT deployment approval.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCurrentCompatDocs,auditCurrentCompat}
 from './six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';

const KEPT=Object.freeze(['eel','duckman','limsman']);
const UPDATED=Object.freeze(['goflo','methpipe','mantrain']);
export function validatePostPkceEvidence(older,post,docs){
 const issues=[];
 if(validateSixNativeStagingSnapshot(older).kind!=='current')
  issues.push('older_current_baseline_invalid');
 if(validateSixNativeStagingSnapshot(post).kind!=='post-pkce')
  issues.push('post_pkce_baseline_invalid');
 if(issues.length)return {ok:false,issues};
 const records=validateCurrentCompatDocs(post,docs);
 if(!records.ok)issues.push(...records.errors);
 if(post.central.repo!==older.central.repo||
    post.central.sha!==older.central.sha||
    post.central.runId!==older.central.runId||
    post.central.workflowId!==older.central.workflowId||
    post.central.workflow!==older.central.workflow)
  issues.push('central_source_changed');
 for(const id of KEPT){
  const a=older.apps.find(x=>x.id===id);
  const b=post.apps.find(x=>x.id===id);
  if(JSON.stringify(a)!==JSON.stringify(b))
   issues.push('unchanged_native_source_changed_'+id);
 }
 for(const id of UPDATED){
  const a=older.apps.find(x=>x.id===id);
  const b=post.apps.find(x=>x.id===id);
  if(!a||!b||a.sha===b.sha||a.runId===b.runId||
     !['name','id','repo','workflow','workflowId']
      .every(k=>a[k]===b[k]))
   issues.push('unexpected_pkce_update_'+id);
 }
 return {ok:issues.length===0,issues};
}
const direct=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(direct){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--offline','--remote'].includes(args[0])){
  console.error('Usage: node six-native-post-pkce-qa.mjs --offline|--remote');
  process.exitCode=2;
 }else try{
  const older=JSON.parse(readFileSync(new URL(
   './six-native-current-compat-lock.json',import.meta.url),'utf8'));
  const post=JSON.parse(readFileSync(new URL(
   './six-native-post-pkce-compat-lock.json',import.meta.url),'utf8'));
  const docs=readFileSync(new URL(
   './SIX_NATIVE_POST_PKCE_QA.md',import.meta.url),'utf8');
  const local=validatePostPkceEvidence(older,post,docs);
  const result=!local.ok||args[0]==='--offline'?local:
   await auditCurrentCompat(post,{
    readToken:process.env.DUCKBIO_QA_READ_TOKEN||null
   });
  if(!result.ok){
   console.error('Six-native post-PKCE QA: FAIL ('+
    (result.issues||result.errors).join(', ')+')');
   process.exitCode=1;
  }else{
   console.log('Six-native post-PKCE QA: PASS ('+
    (args[0]==='--remote'?'six exact native main SSO CI records':
     'source/CI snapshot+documentation pin only')+
    '; NO deployment, native permissions, billing, or staging authorization)');
  }
 }catch{
  console.error('Six-native post-PKCE QA: FAIL (unverified_input)');
  process.exitCode=1;
 }
}
