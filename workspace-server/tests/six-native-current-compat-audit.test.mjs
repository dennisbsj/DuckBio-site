import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCurrentCompatLock,validateCurrentCompatDocs,
 auditCurrentCompat,EXPECTED_NATIVE}
 from '../six-native-current-compat-audit.mjs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const docs=readFileSync(new URL(
 '../SIX_NATIVE_CURRENT_WORKSPACE_QA.md',import.meta.url),'utf8');
const clone=x=>structuredClone(x);
const successful=row=>({
 id:row.runId,workflow_id:row.workflowId,head_sha:row.sha,
 head_branch:'main',event:'push',status:'completed',
 conclusion:'success',path:row.workflow
});
const source=sha=>
 'name: Current central QA\nsteps:\n'+
 '  - uses: actions/checkout@v4\n'+
 '    with:\n      repository: dennisbsj/DuckBio-site\n'+
 '      ref: '+sha+'\n';
function fakeGithub(snapshot,{modifyRun,modifySource,failPath}={}){
 const requested=[];
 const fetchImpl=async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer synthetic-read-only-credential');
  assert.equal(new URL(url).origin,'https://api.github.com');
  const p=new URL(url).pathname+new URL(url).search;
  requested.push(p);
  if(failPath&&p.includes(failPath))return Response.json({}, {status:404});
  const c=snapshot.central;
  if(p==='/repos/'+c.repo+'/actions/runs/'+c.runId+'/jobs?per_page=100')
   return Response.json({jobs:[22,24].map(n=>({
    name:'core ('+n+')',status:'completed',conclusion:'success'}))});
  for(const row of [c,...snapshot.apps]){
   if(p==='/repos/'+row.repo+'/actions/runs/'+row.runId)
    return Response.json(modifyRun?modifyRun(row,successful(row)):
     successful(row));
   if(row.workflow&&p==='/repos/'+row.repo+'/contents/'+
      row.workflow+'?ref='+row.sha){
    const txt=modifySource?modifySource(row,source(c.sha)):source(c.sha);
    return Response.json({encoding:'base64',
     content:Buffer.from(txt).toString('base64')});
   }
  }
  throw Error('unexpected remote endpoint '+p);
 };
 return {fetchImpl,requested};
}

test('separate compatibility lock keeps six original native IDs in stable order',()=>{
 assert.deepEqual(validateCurrentCompatLock(lock),{ok:true,errors:[]});
 assert.deepEqual(lock.apps.map(x=>x.id),
  ['goflo','eel','methpipe','mantrain','duckman','limsman']);
 assert.deepEqual(lock.apps.map(x=>x.workflow),
  EXPECTED_NATIVE.map(x=>x.workflow));
 assert.deepEqual(validateCurrentCompatDocs(lock,docs),{ok:true,errors:[]});
});
test('fail closed on paid/deployable scope, a seventh app and wrong native source path',()=>{
 for(const mutate of [
  x=>x.scope='production',
  x=>x.version=2,
  x=>x.apps.push({...x.apps[0],id:'dataduck'}),
  x=>x.apps[0].workflow='.github/workflows/other.yml',
  x=>x.apps[1].id='dataduck',
  x=>x.apps[2].sha='main',
  x=>x.apps[3].runId=x.apps[0].runId,
  x=>x.apps[4].workflowId=x.apps[5].workflowId,
  x=>x.central.sha='f'.repeat(40),
  x=>x.billingAuthorized=true
 ]){
  const snapshot=clone(lock);mutate(snapshot);
  assert.equal(validateCurrentCompatLock(snapshot).ok,false);
 }
});
test('baseline documentation requires exact commit and main workflow evidence',()=>{
 assert.equal(validateCurrentCompatDocs(lock,
  docs.replaceAll(lock.apps[1].sha,'')).ok,false);
 assert.equal(validateCurrentCompatDocs(lock,
  docs.replaceAll('/actions/runs/'+lock.central.runId,'')).ok,false);
});
test('read-only remote audit verifies actual workflow pins and six push-to-main runs',async()=>{
 const github=fakeGithub(lock);
 const result=await auditCurrentCompat(lock,{
  fetchImpl:github.fetchImpl,readToken:'synthetic-read-only-credential'});
 assert.deepEqual(result,{ok:true,errors:[],verifiedApps:6});
 assert.equal(github.requested.length,14);
 assert(github.requested.every(x=>!x.includes('/secrets')&&
  !x.includes('/dispatches')&&!x.includes('/rerun')));
});
test('remote audit rejects PR-only runs and wrong app checkouts',async()=>{
 const github=fakeGithub(lock,{
  modifyRun:(row,run)=>row.id==='goflo'?{...run,event:'pull_request'}:run,
  modifySource:(row,txt)=>row.id==='eel'?
    txt.replace(lock.central.sha,'f'.repeat(40)):txt
 });
 const result=await auditCurrentCompat(lock,{
  fetchImpl:github.fetchImpl,readToken:'synthetic-read-only-credential'});
 assert.equal(result.ok,false);
 assert.equal(result.verifiedApps,4);
 assert(result.errors.includes('goflo_ci_mismatch'));
 assert(result.errors.includes('eel_central_pin_mismatch'));
});
test('read token is mandatory and inaccessible private source is not accepted',async()=>{
 assert.deepEqual(await auditCurrentCompat(lock,{
  fetchImpl:async()=>{throw Error('do not contact remote')},
  readToken:null
 }),{ok:false,errors:['private_read_token_required'],verifiedApps:0});
 const git=fakeGithub(lock,{failPath:'/LabDuck/contents/'});
 const result=await auditCurrentCompat(lock,{
  fetchImpl:git.fetchImpl,readToken:'synthetic-read-only-credential'});
 assert.equal(result.ok,false);
 assert.equal(result.verifiedApps,5);
 assert(result.errors.includes('unverified_limsman_workflow'));
});
