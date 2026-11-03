import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {APPS,validateQaLock,validateDocumentation,
 validateRun,validatePinnedWorkflow,auditQaLock}
 from '../six-app-source-qa-audit.mjs';

const frozen=JSON.parse(readFileSync(
 new URL('../six-app-source-qa-lock.json',import.meta.url),'utf8'));
const docs=readFileSync(
 new URL('../SIX_APP_SOURCE_QA_BASELINE.md',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const okRun=row=>({id:row.runId,workflow_id:row.workflowId,
 head_sha:row.sha,status:'completed',conclusion:'success',
 event:'push',head_branch:'main'});

function fakeGithub(lock,{overrideRun,overrideSource,overrideJobs,notFound}={}){
 const requested=[];
 const calls=async(url,options)=>{
  const parsed=new URL(url),endpoint=parsed.pathname+parsed.search;
  assert.equal(parsed.origin,'https://api.github.com');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,undefined);
  assert.equal(options.headers.Accept,'application/vnd.github+json');
  requested.push(endpoint);
  if(notFound&&endpoint.includes(notFound))return Response.json({error:'not found'},{status:404});
  if(endpoint.endsWith('/jobs?per_page=100')){
   const good={jobs:[22,24].map(n=>({name:'core ('+n+')',
    status:'completed',conclusion:'success'}))};
   return Response.json(overrideJobs?overrideJobs(good):good);
  }
  for(const row of [lock.central,...lock.apps]){
   if(endpoint==='/repos/'+row.repo+'/actions/runs/'+row.runId){
    const good=okRun(row);
    return Response.json(overrideRun?overrideRun(row,good):good);
   }
   if(row.workflow&&endpoint==='/repos/'+row.repo+'/contents/'+
      row.workflow+'?ref='+row.sha){
    const good=[
     'name: Synthetic native browser QA',
     'steps:',
     '  - uses: actions/checkout@v4',
     '    with:',
     '      repository: dennisbsj/DuckBio-site',
     '      ref: '+lock.central.sha
    ].join('\n');
    const content=overrideSource?overrideSource(row,good):good;
    return Response.json({encoding:'base64',
     content:Buffer.from(content,'utf8').toString('base64')});
   }
  }
  throw Error('unexpected_public_endpoint');
 };
 return {fetchImpl:calls,requested};
}

test('manifest locks exactly one reviewed Workspace SHA and six allowlisted native sources',()=>{
 assert.deepEqual(validateQaLock(frozen),{ok:true,errors:[]});
 assert.deepEqual(APPS.map(x=>x.id),['goflo','eel','methpipe','mantrain','duckman','limsman']);
 assert.deepEqual(validateDocumentation(frozen,docs),{ok:true,errors:[]});
});
test('snapshot rejects schema drift, foreign origins, duplicate runs and invented registration',()=>{
 for(const mutate of [
  s=>s.scope='production',
  s=>s.version=2,
  s=>s.central.repo='evil/another',
  s=>s.apps.pop(),
  s=>s.apps[0].repo='unreviewed/CytoDuck',
  s=>s.apps[1].id='goflo',
  s=>s.apps[1].runId=s.apps[0].runId,
  s=>s.apps[0].workflowId=s.apps[1].workflowId,
  s=>s.apps[0].workflow='../../other.yml',
  s=>s.apps[0].sha='main',
  s=>s.extra='unsafe'
 ]){
  const snapshot=clone(frozen);mutate(snapshot);
  assert.equal(validateQaLock(snapshot).ok,false);
 }
});
test('documentation must contain each exact immutable SHA and real evidence run ID',()=>{
 assert.deepEqual(validateDocumentation(frozen,docs),{ok:true,errors:[]});
 assert.equal(validateDocumentation(frozen,docs.replace(frozen.apps[1].sha,'' )).ok,false);
 assert.equal(validateDocumentation(frozen,docs.replace(
  '/actions/runs/'+frozen.central.runId,'/actions/runs/0')).ok,false);
});
test('a successful CI run is only accepted for the locked main push and workflow',()=>{
 const row=frozen.apps[0];
 assert.equal(validateRun(okRun(row),row),true);
 for(const [key,val] of [
  ['head_sha','f'.repeat(40)],['conclusion','cancelled'],
  ['status','in_progress'],['event','pull_request'],
  ['head_branch','test/new'],['workflow_id',1],['id',0]
 ])assert.equal(validateRun({...okRun(row),[key]:val},row),false,key);
});
test('a native source pin must be unique, exact and owned by the central repository',()=>{
 const sha=frozen.central.sha;
 const valid='repository: dennisbsj/DuckBio-site\nref: '+sha;
 assert.equal(validatePinnedWorkflow(valid,sha),true);
 assert.equal(validatePinnedWorkflow(valid+'\nref: '+'f'.repeat(40),sha),false);
 assert.equal(validatePinnedWorkflow(valid.replace(sha,'f'.repeat(40)),sha),false);
 assert.equal(validatePinnedWorkflow(valid.replace('dennisbsj/DuckBio-site','foreign/site'),sha),false);
 assert.equal(validatePinnedWorkflow(valid+'\nrepository: dennisbsj/DuckBio-site',sha),false);
});
test('read-only public evidence audit checks all six pins, seven completed runs and both central Node jobs',async()=>{
 const git=fakeGithub(frozen);
 const result=await auditQaLock(frozen,git);
 assert.deepEqual(result,{ok:true,errors:[],verifiedApps:6});
 assert.equal(git.requested.length,14,'one central run + central jobs + six pairs');
 assert(git.requested.every(x=>!x.includes('/secrets')&&!x.includes('/dispatches')));
});
test('fail closed when a native browser run, workflow pin or Node matrix is not verified',async()=>{
 const cancelled=fakeGithub(frozen,{overrideRun:(row,run)=>
  row.id==='eel'?{...run,conclusion:'cancelled'}:run});
 const invalidRun=await auditQaLock(frozen,cancelled);
 assert.equal(invalidRun.ok,false);
 assert(invalidRun.errors.includes('eel_ci_mismatch'));
 assert.equal(invalidRun.verifiedApps,5);
 const wrongPin=fakeGithub(frozen,{overrideSource:(row,src)=>
  row.id==='goflo'?src.replace(frozen.central.sha,'f'.repeat(40)):src});
 const invalidPin=await auditQaLock(frozen,wrongPin);
 assert.equal(invalidPin.ok,false);
 assert(invalidPin.errors.includes('goflo_central_pin_mismatch'));
 const jobs=fakeGithub(frozen,{overrideJobs:()=>({jobs:[{
  name:'core (22)',status:'completed',conclusion:'success'}]})});
 const missingMatrix=await auditQaLock(frozen,jobs);
 assert(missingMatrix.errors.includes('central_node_matrix_mismatch'));
});
test('fail closed on inaccessible GitHub evidence without leaking remote content',async()=>{
 const git=fakeGithub(frozen,{notFound:'/DuckMan/contents/'});
 const result=await auditQaLock(frozen,git);
 assert.equal(result.ok,false);
 assert(result.errors.includes('unverified_duckman_workflow'));
 assert.equal(result.verifiedApps,5);
});

test('remote CLI refuses to inspect private repositories without explicit read permission',()=>{
 const script=fileURLToPath(new URL('../six-app-source-qa-audit.mjs',import.meta.url));
 const env={...process.env};
 delete env.DUCKBIO_QA_READ_TOKEN;
 const result=spawnSync(process.execPath,[script,'--remote'],{
  encoding:'utf8',env,timeout:10000
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/private_read_token_required/);
 assert(!result.stderr.includes('https://api.github.com'));
});
test('authenticated verification confines private token to approved GitHub REST GETs',async()=>{
 const plain=fakeGithub(frozen);
 const seen=[];
 const auth=(url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer isolated-read-only-test-credential');
  seen.push(url);
  return plain.fetchImpl(url,{...init,headers:{...init.headers,Authorization:undefined}});
 };
 const result=await auditQaLock(frozen,{
  fetchImpl:auth,readToken:'isolated-read-only-test-credential'
 });
 assert.equal(result.ok,true);
 assert.equal(seen.length,14);
 const invalid=await auditQaLock(frozen,{fetchImpl:auth,readToken:'a\nb'});
 assert.deepEqual(invalid.errors,['invalid_read_only_token']);
});
