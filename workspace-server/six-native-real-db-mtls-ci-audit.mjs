// Immutable original-six native database->Ed25519->mTLS source/CI EVIDENCE ONLY.
// Does not authorize staging, issue SSO tokens, or prove paid native permissions.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRun} from './six-app-source-qa-audit.mjs';

// Second, independent source-reviewed allowlist. Editing evidence JSON alone
// cannot make an unreviewed app version or workflow pass. Never use this as
// a stagingSnapshotFile() candidate or an entitlement source.
const EXPECTED=Object.freeze({
 "version": 1,
 "scope": "independent-original-six-real-database-mtls-ci-evidence-only",
 "releaseAuthorized": false,
 "workspace": {
  "repo": "dennisbsj/DuckBio-site",
  "sha": "3932361e7bd3f2b0bafaef49a62f2487a07b5e6b",
  "workflow": ".github/workflows/workspace-auth-core.yml",
  "workflowId": 403711277,
  "runId": 41830839811
 },
 "apps": [
  {
   "name": "CytoDuck",
   "id": "goflo",
   "repo": "dennisbsj/CytoDuck",
   "sha": "ba22006b75b75d6b1fbe680c3d59116768806798",
   "workflow": ".github/workflows/build.yml",
   "workflowId": 365920928,
   "runId": 41823086005,
   "testFile": "tests/workspace-native-ownership-https.test.cjs",
   "testLauncher": "package.json"
  },
  {
   "name": "DuckNote",
   "id": "eel",
   "repo": "dennisbsj/DuckNote",
   "sha": "83f3892442eabb64f050934d435d39c4e72b3d8b",
   "workflow": ".github/workflows/ci.yml",
   "workflowId": 373790435,
   "runId": 41837318986,
   "testFile": "scripts/workspace-native-ownership-mtls-pg-real.mjs",
   "testLauncher": ".github/workflows/ci.yml"
  },
  {
   "name": "DuckPipe",
   "id": "methpipe",
   "repo": "dennisbsj/DuckPipe",
   "sha": "6acd3fec8d8a3c057b15fb79c9f47351c54c8294",
   "workflow": ".github/workflows/api-checks.yml",
   "workflowId": 400754499,
   "runId": 41853056933,
   "testFile": "tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs",
   "testLauncher": "package.json"
  },
  {
   "name": "DuckTrain",
   "id": "mantrain",
   "repo": "dennisbsj/DuckTrain",
   "sha": "977bc15111004b71f9fc6e95d8facbb4bc2a3bcd",
   "workflow": ".github/workflows/verify.yml",
   "workflowId": 400802066,
   "runId": 41853561782,
   "testFile": "tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs",
   "testLauncher": "package.json"
  },
  {
   "name": "DuckMan",
   "id": "duckman",
   "repo": "dennisbsj/DuckMan",
   "sha": "a1cf2ff6ba7f1d7d95cbd7a8af1d3a3149667257",
   "workflow": ".github/workflows/verify.yml",
   "workflowId": 382858766,
   "runId": 41854693598,
   "testFile": "tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs",
   "testLauncher": "package.json"
  },
  {
   "name": "LabDuck",
   "id": "limsman",
   "repo": "dennisbsj/LabDuck",
   "sha": "e03f49d3df81719db6fc7c5d6c64a050edec9641",
   "workflow": ".github/workflows/verify.yml",
   "workflowId": 400452582,
   "runId": 41854484043,
   "testFile": "tests/workspace-native-ownership-sqlite-mtls.integration.test.cjs",
   "testLauncher": "package.json"
  }
 ]
});
const docsURL=row=>'https://github.com/'+row.repo+
 '/actions/runs/'+row.runId;
const textRecord=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x);

export function validateSixNativeDatabaseMtlsEvidence(lock,docs){
 const errors=[];
 if(!textRecord(lock)||JSON.stringify(lock)!==JSON.stringify(EXPECTED))
  errors.push('unreviewed_six_native_real_database_mtls_lock');
 if(typeof docs!=='string')errors.push('missing_reviewed_documentation');
 if(errors.length)return {ok:false,errors};
 if(lock.releaseAuthorized!==false||lock.apps.length!==6||
    lock.apps.some(x=>x.id==='dataduck'))
  errors.push('unexpected_app_or_release_authorization');
 for(const row of [lock.workspace,...lock.apps]){
  if(!docs.includes(row.sha)||!docs.includes(docsURL(row)))
   errors.push('undocumented_'+(row.id||'workspace')+'_source_ci');
 }
 for(const row of lock.apps)
  if(!docs.includes(row.testFile))
   errors.push('undocumented_'+row.id+'_native_test');
 if(!docs.includes('NOT a staging source lock'))
  errors.push('release_boundary_missing');
 return {ok:errors.length===0,errors};
}
const decoded=record=>{
 if(!textRecord(record)||record.encoding!=='base64'||
    typeof record.content!=='string')return null;
 try{
  const raw=record.content.replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)||raw.length<4||raw.length>1000000)
   return null;
  return Buffer.from(raw,'base64').toString('utf8');
 }catch{return null}
};
export async function auditSixNativeDatabaseMtlsEvidence(lock,docs,{
 fetchImpl=globalThis.fetch,readToken=null
}={}){
 const validation=validateSixNativeDatabaseMtlsEvidence(lock,docs);
 if(!validation.ok)return {...validation,verifiedApps:0};
 if(typeof fetchImpl!=='function'||typeof readToken!=='string'||
    readToken.length<16||/[\r\n]/.test(readToken))
  return {ok:false,errors:['private_read_token_required'],verifiedApps:0};
 const errors=[];
 async function get(repo,path,label){
  try{
   const response=await fetchImpl('https://api.github.com/repos/'+
     repo+'/'+path,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{Accept:'application/vnd.github+json',
     'User-Agent':'DuckBio-native-real-database-mtls-source-qa',
     Authorization:'Bearer '+readToken}
   });
   if(!response?.ok)throw Error('not_available');
   const value=await response.json();
   if(!textRecord(value))throw Error('invalid_response');
   return value;
  }catch{
   errors.push('unverified_'+label);
   return null;
  }
 }
 const workspace=lock.workspace;
 const wr=await get(workspace.repo,'actions/runs/'+workspace.runId,'workspace_main_ci');
 if(wr&&(!validateRun(wr,workspace)||wr.path!==workspace.workflow))
  errors.push('workspace_main_ci_mismatch');
 let verifiedApps=0;
 for(const row of lock.apps){
  const run=await get(row.repo,'actions/runs/'+row.runId,row.id+'_main_ci');
  const file=await get(row.repo,'contents/'+row.testFile+
   '?ref='+row.sha,row.id+'_native_test_source');
  const launch=await get(row.repo,'contents/'+row.testLauncher+
   '?ref='+row.sha,row.id+'_test_launcher');
  const goodRun=run&&validateRun(run,row)&&run.path===row.workflow;
  if(run&&!goodRun)errors.push(row.id+'_main_ci_mismatch');
  const src=file&&decoded(file),entry=launch&&decoded(launch);
  const goodSource=src&&
   /create[A-Za-z]+AuthoritativeOwnershipLookup/.test(src)&&
   /create[A-Za-z]+NativeOwnershipSigner/.test(src)&&
   /create[A-Za-z]+OwnershipHttpsSidecar/.test(src)&&
   (row.id==='eel'?src.includes("from 'pg'"):src.includes("node:sqlite"));
  if(file&&!goodSource)errors.push(row.id+'_native_test_source_mismatch');
  if(launch&&!entry?.includes(row.testFile))
   errors.push(row.id+'_test_launcher_mismatch');
  if(goodRun&&goodSource&&entry?.includes(row.testFile))verifiedApps++;
 }
 return {ok:errors.length===0&&verifiedApps===6,
  errors,verifiedApps,releaseAuthorized:false};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--offline','--remote'].includes(args[0])){
  console.error('Usage: node six-native-real-db-mtls-ci-audit.mjs --offline|--remote');
  process.exitCode=2;
 }else try{
  const lock=JSON.parse(readFileSync(new URL(
   './six-native-real-db-mtls-ci-evidence.json',import.meta.url),'utf8'));
  const docs=readFileSync(new URL(
   './SIX_NATIVE_REAL_DATABASE_MTLS_CI_QA.md',import.meta.url),'utf8');
  const result=args[0]==='--offline'?
   validateSixNativeDatabaseMtlsEvidence(lock,docs):
   await auditSixNativeDatabaseMtlsEvidence(lock,docs,{
    readToken:process.env.DUCKBIO_QA_READ_TOKEN||null
   });
  if(!result.ok){
   console.error('Six native real database/mTLS CI QA: FAIL ('+
    result.errors.join(', ')+')');
   process.exitCode=1;
  }else{
   console.log('Six native real database/mTLS CI QA: PASS ('+
    (args[0]==='--remote'?'six exact main CI+native test source checks':
     'immutable reviewed metadata/documentation only')+
    '; NOT A STAGING LOCK, NO SEATS, PERMISSIONS, SSO OR DEPLOYMENT)');
  }
 }catch{
  console.error('Six native real database/mTLS CI QA: FAIL (unverified_input)');
  process.exitCode=1;
 }
}
