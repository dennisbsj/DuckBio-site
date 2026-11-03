// Current seven-repository synthetic SOURCE candidate audit.
// Historical immutable baseline remains separate; never relabel source CI
// as simultaneous seven-service staging, production release, or billing proof.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateQaLock,validateDocumentation,auditQaLock}
 from './six-app-source-qa-audit.mjs';

export function validateStagingCandidateLock(lock,documentation){
 const schema=validateQaLock(lock);
 if(!schema.ok)return schema;
 // Historical CI source remains an independent immutable reference. The
 // candidate is intentionally a later reviewed Workspace commit.
 if(lock.central.sha==='5e0924e9844d36de75ca8e10c08048b3db373359')
  return {ok:false,errors:['candidate_must_not_relabel_historical_lock']};
 return validateDocumentation(lock,documentation);
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--offline','--remote'].includes(args[0])){
  console.error('Usage: node staging-candidate-audit.mjs --offline|--remote');
  process.exitCode=2;
 }else try{
  const lock=JSON.parse(readFileSync(
   new URL('./six-app-staging-candidate-lock.json',import.meta.url),'utf8'));
  const docs=readFileSync(
   new URL('./STAGING_CANDIDATE.md',import.meta.url),'utf8');
  const result=validateStagingCandidateLock(lock,docs);
  const token=process.env.DUCKBIO_QA_READ_TOKEN||null;
  const audited=result.ok&&args[0]==='--remote'
   ?(token?await auditQaLock(lock,{readToken:token}):
     {ok:false,errors:['private_read_token_required']}):result;
  if(!audited.ok){
   console.error('Synthetic staging candidate audit: FAIL ('+
    audited.errors.join(', ')+')');
   process.exitCode=1;
  }else{
   console.log('Synthetic staging candidate audit: PASS ('+
    (args[0]==='--remote'?'verified private GitHub CI and exact workflow pins':
      'schema and documented immutable seven-repo source snapshot')+
    '; NOT a simultaneous staging deployment)');
  }
 }catch{
  console.error('Synthetic staging candidate audit: FAIL (unreadable_or_unverified_candidate)');
  process.exitCode=1;
 }
}
