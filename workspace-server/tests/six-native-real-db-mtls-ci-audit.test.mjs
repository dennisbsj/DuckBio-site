import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateSixNativeDatabaseMtlsEvidence,
 auditSixNativeDatabaseMtlsEvidence}
 from '../six-native-real-db-mtls-ci-audit.mjs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-real-db-mtls-ci-evidence.json',import.meta.url),'utf8'));
const docs=readFileSync(new URL(
 '../SIX_NATIVE_REAL_DATABASE_MTLS_CI_QA.md',import.meta.url),'utf8');

test('six exact new native merged-main real-store mTLS sources and central CI pinned without staging promotion',()=>{
 assert.deepEqual(validateSixNativeDatabaseMtlsEvidence(lock,docs),
  {ok:true,errors:[]});
 assert.equal(lock.releaseAuthorized,false);
 assert.equal(lock.apps.length,6);
 assert.deepEqual(lock.apps.map(x=>x.id),
  ['goflo','eel','methpipe','mantrain','duckman','limsman']);
 assert.deepEqual(lock.apps.map(x=>x.runId),
  [41823086005,41837318986,41853056933,
   41853561782,41854693598,41854484043]);
 assert.equal(lock.workspace.runId,41830839811);
 assert(!lock.apps.some(x=>x.id==='dataduck'));
});

test('stale SHA, amended CI, edited launcher, extra native app and falsely authorized release fail closed',()=>{
 const edits=[
  x=>x.workspace.sha='f'.repeat(40),
  x=>x.workspace.runId++,
  x=>x.apps[0].sha='f'.repeat(40),
  x=>x.apps[1].runId++,
  x=>x.apps[2].workflowId++,
  x=>x.apps[3].workflow='.github/workflows/other.yml',
  x=>x.apps[4].testLauncher='other.json',
  x=>x.apps[5].testFile='fake.test.cjs',
  x=>x.apps.push({...x.apps[0],id:'dataduck'}),
  x=>x.releaseAuthorized=true
 ];
 for(const edit of edits){
  const changed=structuredClone(lock);edit(changed);
  assert.equal(validateSixNativeDatabaseMtlsEvidence(changed,docs).ok,false);
 }
 const missing=docs.replace(lock.apps[2].sha,'undocumented-commit');
 assert.equal(validateSixNativeDatabaseMtlsEvidence(lock,missing).ok,false);
 assert.equal(validateSixNativeDatabaseMtlsEvidence(lock,'').ok,false);
});

function simulateGitHub({wrongRun=null,wrongLauncher=null,missing=null}={}){
 const requested=[];
 const all=[lock.workspace,...lock.apps];
 const encoded=text=>({
  encoding:'base64',content:Buffer.from(text).toString('base64')
 });
 const fetchImpl=async url=>{
  requested.push(url);
  const repoAndPath=url.replace('https://api.github.com/repos/','');
  const row=all.find(x=>repoAndPath.startsWith(x.repo+'/'));
  if(!row||url===missing)return {ok:false,json:async()=>({})};
  if(repoAndPath===row.repo+'/actions/runs/'+row.runId){
   const run={
    id:row.runId,head_sha:row.sha,workflow_id:row.workflowId,
    event:'push',head_branch:'main',status:'completed',
    conclusion:'success',path:row.workflow
   };
   if(wrongRun===row.id)run.conclusion='failure';
   return {ok:true,json:async()=>run};
  }
  const source=lock.apps.find(a=>a.repo===row.repo);
  if(source&&repoAndPath===source.repo+'/contents/'+source.testFile+'?ref='+source.sha){
   const payload=source.id==='eel'?
    "import pg from 'pg';\n" : "require('node:sqlite');\n";
   const value=payload+
    'createSyntheticAuthoritativeOwnershipLookup\n'+
    'createSyntheticNativeOwnershipSigner\n'+
    'createSyntheticOwnershipHttpsSidecar\n';
   return {ok:true,json:async()=>encoded(value)};
  }
  if(source&&repoAndPath===source.repo+'/contents/'+source.testLauncher+'?ref='+source.sha)
   return {ok:true,json:async()=>encoded(
    wrongLauncher===source.id?'missing required script':source.testFile)};
  return {ok:false,json:async()=>({})};
 };
 return {requested,fetchImpl};
}

test('mocked read-only remote verifier checks each exact main CI plus exact source/test launcher',async()=>{
 const source=simulateGitHub();
 const accepted=await auditSixNativeDatabaseMtlsEvidence(lock,docs,{
  fetchImpl:source.fetchImpl,readToken:'synthetic-read-only-token-123456'
 });
 assert.deepEqual(accepted,{
  ok:true,errors:[],verifiedApps:6,releaseAuthorized:false
 });
 assert.equal(source.requested.length,19);
 assert(source.requested.every(x=>x.startsWith('https://api.github.com/repos/')));
});

test('unverified CI success or missing test launcher fails closed, no partial authorization',async()=>{
 for(const item of [{wrongRun:'duckman'},{wrongLauncher:'eel'},
  {missing:'https://api.github.com/repos/dennisbsj/LabDuck/actions/runs/41854484043'}]){
  const stub=simulateGitHub(item);
  const result=await auditSixNativeDatabaseMtlsEvidence(lock,docs,{
   fetchImpl:stub.fetchImpl,readToken:'synthetic-read-only-token-123456'
  });
  assert.equal(result.ok,false);
  assert.equal(result.releaseAuthorized,false);
 }
 const withoutToken=await auditSixNativeDatabaseMtlsEvidence(lock,docs,{
  fetchImpl:simulateGitHub().fetchImpl
 });
 assert.deepEqual(withoutToken,{
  ok:false,errors:['private_read_token_required'],verifiedApps:0
 });
});

test('CLI offline succeeds without any token/network; remote requires explicit read-only credentials',()=>{
 const path=fileURLToPath(new URL(
  '../six-native-real-db-mtls-ci-audit.mjs',import.meta.url));
 const run=argv=>spawnSync(process.execPath,[path,...argv],{
  encoding:'utf8',timeout:10000,env:{...process.env,DUCKBIO_QA_READ_TOKEN:''}
 });
 const valid=run(['--offline']);
 assert.equal(valid.status,0,valid.stderr);
 assert.match(valid.stdout,/PASS/);
 assert.match(valid.stdout,/NOT A STAGING LOCK/);
 assert.equal(run(['--remote']).status,1);
 for(const args of [[],['--future'],['--offline','--remote']])
  assert.equal(run(args).status,2);
});
