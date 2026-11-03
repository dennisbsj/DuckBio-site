import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateStagingCandidateLock}
 from '../staging-candidate-audit.mjs';
import {auditQaLock} from '../six-app-source-qa-audit.mjs';

const lock=JSON.parse(readFileSync(
 new URL('../six-app-staging-candidate-lock.json',import.meta.url),'utf8'));
const old=JSON.parse(readFileSync(
 new URL('../six-app-source-qa-lock.json',import.meta.url),'utf8'));
const docs=readFileSync(new URL('../STAGING_CANDIDATE.md',import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));

test('newer source candidate is consistent, complete, distinct from immutable historical QA',()=>{
 assert.deepEqual(validateStagingCandidateLock(lock,docs),{ok:true,errors:[]});
 assert.notEqual(lock.central.sha,old.central.sha);
 assert.deepEqual(lock.apps.map(x=>x.id),old.apps.map(x=>x.id));
 assert.deepEqual(lock.apps.map(x=>x.workflowId),old.apps.map(x=>x.workflowId));
 assert.equal(new Set(lock.apps.map(x=>x.sha)).size,6);
 assert.equal(lock.central.sha,'233ca6d376efa2fbddca042cea5106aae92679c0');
 for(const row of [lock.central,...lock.apps]){
  assert.match(row.sha,/^[a-f0-9]{40}$/);
  assert.ok(docs.includes(row.sha));
  assert.ok(docs.includes('/actions/runs/'+row.runId));
 }
});
test('wrong metadata, historical relabel or unproven CI in documentation fail closed',()=>{
 const changed=copy(lock);
 changed.apps[1].runId+=99;
 assert.equal(validateStagingCandidateLock(changed,docs).ok,false);
 assert.deepEqual(validateStagingCandidateLock(old,docs),{
  ok:false,errors:['candidate_must_not_relabel_historical_lock']
 });
 const missing=docs.replace(lock.apps[0].sha,'not-the-review-sha');
 assert.deepEqual(validateStagingCandidateLock(lock,missing),{
  ok:false,errors:['baseline_document_mismatch_goflo']
 });
 const extra=copy(lock);extra.apps[0].sha='not-a-commit';
 assert.equal(validateStagingCandidateLock(extra,docs).ok,false);
});
test('synthetic remote evidence rejects false success, wrong central pin and pending runs',async()=>{
 const urls=[];
 const fetchImpl=async(url)=>{
  urls.push(url);
  const path=new URL(url).pathname;
  const row=[lock.central,...lock.apps].find(item=>
   path.startsWith('/repos/'+item.repo+'/'));
  assert.ok(row,'only known exact GitHub repo may be checked');
  let data;
  if(path.endsWith('/actions/runs/'+row.runId)){
   data={id:row.runId,workflow_id:row.workflowId,
    head_sha:row.sha,status:'completed',conclusion:'success',
    event:'push',head_branch:'main'};
  }else if(path.endsWith('/actions/runs/'+lock.central.runId+'/jobs')){
   data={jobs:[{name:'core (22)',status:'completed',conclusion:'success'},
    {name:'core (24)',status:'completed',conclusion:'success'}]};
  }else{
   assert.ok(row.id);
   const text='name: synthetic broker CI\nsteps:\n  - uses: actions/checkout@v4\n'+
    '    with:\n      repository: dennisbsj/DuckBio-site\n'+
    '      ref: '+lock.central.sha+'\n';
   data={encoding:'base64',content:Buffer.from(text).toString('base64')};
  }
  return {ok:true,async json(){return data}};
 };
 const result=await auditQaLock(lock,{fetchImpl});
 assert.deepEqual(result,{ok:true,errors:[],verifiedApps:6});
 assert.equal(urls.length,14);
});
test('remote audit fails closed when one native CI is unsuccessful',async()=>{
 const fake=async url=>{
  const path=new URL(url).pathname;
  const row=[lock.central,...lock.apps].find(item=>
   path.startsWith('/repos/'+item.repo+'/'));
  if(path.endsWith('/jobs'))return {ok:true,async json(){return {
   jobs:[{name:'core (22)',conclusion:'success',status:'completed'},
    {name:'core (24)',conclusion:'success',status:'completed'}]}}};
  if(path.includes('/actions/runs/'))return {ok:true,async json(){
   return {id:row.runId,workflow_id:row.workflowId,
    head_sha:row.sha,status:'completed',
    conclusion:row.id==='eel'?'failure':'success',
    event:'push',head_branch:'main'};
  }};
  const txt='  repository: dennisbsj/DuckBio-site\n  ref: '+lock.central.sha+'\n';
  return {ok:true,async json(){return {encoding:'base64',
   content:Buffer.from(txt).toString('base64')}}};
 };
 const result=await auditQaLock(lock,{fetchImpl:fake});
 assert.equal(result.ok,false);
 assert.equal(result.verifiedApps,5);
 assert.ok(result.errors.includes('eel_ci_mismatch'));
});
test('candidate CLI is offline by default, remote requires private read token',()=>{
 const script=fileURLToPath(new URL('../staging-candidate-audit.mjs',import.meta.url));
 const offline=spawnSync(process.execPath,[script,'--offline'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(offline.status,0,offline.stderr);
 assert.match(offline.stdout,/NOT a simultaneous staging deployment/);
 const remote=spawnSync(process.execPath,[script,'--remote'],{
  encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH}
 });
 assert.equal(remote.status,1);
 assert.match(remote.stderr,/private_read_token_required/);
 const wrong=spawnSync(process.execPath,[script,'--live'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(wrong.status,2);
});
test('seven-source CLI requires exact opt-in candidate lock flag',()=>{
 const script=fileURLToPath(new URL('../staging-seven-source-gate.mjs',import.meta.url));
 for(const suffix of ['--candidate','--lock=/tmp/arbitrary','--candidate-source-lock-extra']){
  const r=spawnSync(process.execPath,[script,'--config','/not-a-file',
   '--sources-root','/none','--confirm-offline-sources',suffix],{
    encoding:'utf8',timeout:10000
   });
  assert.equal(r.status,2,suffix);
  assert.match(r.stderr,/candidate-source-lock/);
 }
 const candidate=spawnSync(process.execPath,[script,'--config','/not-a-file',
  '--sources-root','/none','--confirm-offline-sources','--candidate-source-lock'],{
   encoding:'utf8',timeout:10000
  });
 assert.equal(candidate.status,1,'known candidate flag is accepted but invalid config fails');
 assert.match(candidate.stderr,/invalid_or_unsafe_input/);
});
