// Exact six-original-native ownership mTLS source/CI evidence.
// No network by default; never a paid-seat grant, permission or deployment.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCurrentCompatDocs,auditCurrentCompat}
 from './six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';

export function validateOwnershipMtlsEvidence(previous,next,docs){
 const issues=[];
 if(validateSixNativeStagingSnapshot(previous).kind!=='post-pkce')
  issues.push('previous_post_pkce_snapshot_invalid');
 if(validateSixNativeStagingSnapshot(next).kind!=='ownership-mtls')
  issues.push('ownership_mtls_snapshot_invalid');
 if(issues.length)return {ok:false,issues};
 const documentation=validateCurrentCompatDocs(next,docs);
 if(!documentation.ok)issues.push(...documentation.errors);
 if(JSON.stringify(next.central)!==JSON.stringify(previous.central))
  issues.push('central_broker_changed');
 if(next.apps.length!==6)issues.push('six_native_apps_required');
 for(let i=0;i<6;i++){
  const old=previous.apps[i],row=next.apps[i];
  if(!old||!row||old.sha===row.sha||old.runId===row.runId||
     !['name','id','repo','workflow','workflowId'].every(k=>old[k]===row[k]))
   issues.push('unexpected_native_update_'+(row?.id||i));
 }
 return {ok:issues.length===0,issues};
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--offline','--remote'].includes(args[0])){
  console.error('Usage: node six-native-ownership-mtls-qa.mjs --offline|--remote');
  process.exitCode=2;
 }else try{
  const previous=JSON.parse(readFileSync(new URL(
   './six-native-post-pkce-compat-lock.json',import.meta.url),'utf8'));
  const next=JSON.parse(readFileSync(new URL(
   './six-native-ownership-mtls-compat-lock.json',import.meta.url),'utf8'));
  const docs=readFileSync(new URL(
   './SIX_NATIVE_OWNERSHIP_MTLS_QA.md',import.meta.url),'utf8');
  const local=validateOwnershipMtlsEvidence(previous,next,docs);
  const result=!local.ok||args[0]==='--offline'?local:
   await auditCurrentCompat(next,{
    readToken:process.env.DUCKBIO_QA_READ_TOKEN||null
   });
  if(!result.ok){
   console.error('Six-native ownership mTLS QA: FAIL ('+
    (result.issues||result.errors).join(', ')+')');
   process.exitCode=1;
  }else{
   console.log('Six-native ownership mTLS QA: PASS ('+
    (args[0]==='--remote'?'six pinned main-push native CI attestations':
     'exact local immutable source, CI and documentation evidence')+
    '; OFFLINE/SOURCE-ONLY; NOT LIVE NATIVE GRANTS OR STAGING DEPLOYMENT)');
  }
 }catch{
  console.error('Six-native ownership mTLS QA: FAIL (unverified_input)');
  process.exitCode=1;
 }
}
