// Separate reviewed 2026-11-03 native compatibility evidence. READ ONLY.
// This does not modify the historical six-app source lock or authorize staging.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePinnedWorkflow,validateRun} from './six-app-source-qa-audit.mjs';

export const EXPECTED_NATIVE=Object.freeze([
 {name:'CytoDuck',id:'goflo',repo:'dennisbsj/CytoDuck',
  workflow:'.github/workflows/native-cytoduck-workspace-1a3b19c-qa.yml'},
 {name:'DuckNote',id:'eel',repo:'dennisbsj/DuckNote',
  workflow:'.github/workflows/native-ducknote-workspace-1a3b19c-qa.yml'},
 {name:'DuckPipe',id:'methpipe',repo:'dennisbsj/DuckPipe',
  workflow:'.github/workflows/native-duckpipe-workspace-1a3b19c-qa.yml'},
 {name:'DuckTrain',id:'mantrain',repo:'dennisbsj/DuckTrain',
  workflow:'.github/workflows/native-ducktrain-current-workspace-1a3b19c.yml'},
 {name:'DuckMan',id:'duckman',repo:'dennisbsj/DuckMan',
  workflow:'.github/workflows/native-duckman-workspace-1a3b19c-qa.yml'},
 {name:'LabDuck',id:'limsman',repo:'dennisbsj/LabDuck',
  workflow:'.github/workflows/native-labduck-workspace-1a3b19c-qa.yml'}
]);
const SHA=/^[a-f0-9]{40}$/;
const keys=(v,expected)=>v!==null&&typeof v==='object'&&
 !Array.isArray(v)&&Object.keys(v).sort().join(',')===
 expected.slice().sort().join(',');
const integer=value=>Number.isSafeInteger(value)&&value>0;
const CENTRAL_SHA='1a3b19c993fcd63ff625113cc2628b2642fe2d2f';
const CENTRAL_WORKFLOW='.github/workflows/workspace-auth-core.yml';

// Versioned separately from the historical seven-source prestart lock.
// No automatic promotion to deployment or native effective-role enforcement.
export function validateCurrentCompatLock(lock){
 if(!keys(lock,['version','scope','central','apps'])||lock.version!==1||
    lock.scope!=='independent-six-native-https-compatibility')
  return {ok:false,errors:['invalid_snapshot']};
 const errors=[];
 const central=lock.central;
 if(!keys(central,['repo','sha','workflow','workflowId','runId'])||
    central.repo!=='dennisbsj/DuckBio-site'||central.sha!==CENTRAL_SHA||
    central.workflow!==CENTRAL_WORKFLOW||
    !integer(central.workflowId)||!integer(central.runId))
  errors.push('invalid_central');
 if(!Array.isArray(lock.apps)||lock.apps.length!==EXPECTED_NATIVE.length){
  errors.push('exactly_six_native_apps_required');
 }else{
  const runIds=new Set(),workflowIds=new Set();
  for(let i=0;i<EXPECTED_NATIVE.length;i++){
   const row=lock.apps[i],expected=EXPECTED_NATIVE[i];
   if(!keys(row,['name','id','repo','sha','workflow','workflowId','runId'])||
      row.name!==expected.name||row.id!==expected.id||
      row.repo!==expected.repo||row.workflow!==expected.workflow||
      !SHA.test(row.sha||'')||!integer(row.workflowId)||
      !integer(row.runId)||runIds.has(row.runId)||
      workflowIds.has(row.workflowId))
    errors.push('invalid_native_'+expected.id);
   else{runIds.add(row.runId);workflowIds.add(row.workflowId)}
  }
 }
 return {ok:errors.length===0,errors};
}
export function validateCurrentCompatDocs(lock,docs){
 const schema=validateCurrentCompatLock(lock);
 if(!schema.ok)return schema;
 if(typeof docs!=='string')return {ok:false,errors:['documentation_missing']};
 const errors=[];
 for(const row of [lock.central,...lock.apps]){
  if(!docs.includes(row.sha)||!docs.includes('/actions/runs/'+row.runId))
   errors.push('documentation_mismatch_'+(row.id||'central'));
 }
 return {ok:errors.length===0,errors};
}
export async function auditCurrentCompat(lock,{fetchImpl=globalThis.fetch,
 readToken=null}={}){
 const schema=validateCurrentCompatLock(lock);
 if(!schema.ok)return {...schema,verifiedApps:0};
 if(typeof fetchImpl!=='function')
  return {ok:false,errors:['missing_fetch'],verifiedApps:0};
 if(typeof readToken!=='string'||readToken.length<16||
    /[\r\n]/.test(readToken))
  return {ok:false,errors:['private_read_token_required'],verifiedApps:0};
 const failures=[];
 async function get(repo,suffix,label){
  const url='https://api.github.com/repos/'+repo+'/'+suffix;
  try{
   const reply=await fetchImpl(url,{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{Accept:'application/vnd.github+json',
     'User-Agent':'DuckBio-six-native-current-compat-audit',
     Authorization:'Bearer '+readToken}});
   if(!reply?.ok)throw Error('unavailable');
   const data=await reply.json();
   if(!data||typeof data!=='object'||Array.isArray(data))
    throw Error('invalid');
   return data;
  }catch{
   failures.push('unverified_'+label);
   return null;
  }
 }
 const c=lock.central;
 const central=await get(c.repo,'actions/runs/'+c.runId,'workspace_ci');
 if(central&&(!validateRun(central,c)||central.path!==c.workflow))
  failures.push('workspace_ci_mismatch');
 const jobs=await get(c.repo,'actions/runs/'+c.runId+'/jobs?per_page=100',
  'workspace_matrix');
 if(jobs&&(!Array.isArray(jobs.jobs)||![22,24].every(n=>
   jobs.jobs.some(j=>j.name==='core ('+n+')'&&
      j.status==='completed'&&j.conclusion==='success'))))
  failures.push('workspace_matrix_mismatch');
 let verifiedApps=0;
 for(const row of lock.apps){
  const run=await get(row.repo,'actions/runs/'+row.runId,
   row.id+'_main_ci');
  const source=await get(row.repo,'contents/'+row.workflow+
   '?ref='+row.sha,row.id+'_workflow');
  const validRunRecord=run&&validateRun(run,row)&&run.path===row.workflow;
  if(run&&!validRunRecord)failures.push(row.id+'_ci_mismatch');
  let validSource=false;
  if(source){
   try{
    if(source.encoding==='base64'&&typeof source.content==='string')
     validSource=validatePinnedWorkflow(Buffer.from(
      source.content.replace(/\s/g,''),'base64').toString('utf8'),c.sha);
   }catch{ /* malformed private workflow never grants QA */ }
   if(!validSource)failures.push(row.id+'_central_pin_mismatch');
  }
  if(validRunRecord&&validSource)verifiedApps++;
 }
 return {ok:failures.length===0,errors:failures,verifiedApps};
}
const direct=process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url);
if(direct){
 const arg=process.argv.slice(2);
 if(arg.length!==1||!['--offline','--remote'].includes(arg[0])){
  console.error('Usage: node six-native-current-compat-audit.mjs --offline|--remote');
  process.exitCode=2;
 }else try{
  const lock=JSON.parse(readFileSync(new URL(
   './six-native-current-compat-lock.json',import.meta.url),'utf8'));
  const docs=readFileSync(new URL(
   './SIX_NATIVE_CURRENT_WORKSPACE_QA.md',import.meta.url),'utf8');
  const offline=validateCurrentCompatDocs(lock,docs);
  const result=!offline.ok||arg[0]==='--offline'?offline:
   await auditCurrentCompat(lock,{
    readToken:process.env.DUCKBIO_QA_READ_TOKEN||null});
  if(!result.ok){
   console.error('Current native compatibility QA: FAIL ('+
    result.errors.join(', ')+')');
   process.exitCode=1;
  }else{
   console.log('Current native compatibility QA: PASS ('+
    (arg[0]==='--remote'?'six exact native main HTTPS source CI attestations':
     'snapshot schema and documented immutable links')+
    '; READ ONLY; NOT deployed, native role policy, billing or staging approval)');
  }
 }catch{
  console.error('Current native compatibility QA: FAIL (unreadable_or_unsafe_snapshot)');
  process.exitCode=1;
 }
}