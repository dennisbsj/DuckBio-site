// Read-only historical evidence audit of one synthetic-only seven-repository
// SOURCE snapshot. No hosting, credentials, production data or deployment.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const APPS=Object.freeze([
 {name:'CytoDuck',id:'goflo',repo:'dennisbsj/CytoDuck',
  workflow:'.github/workflows/native-cytoduck-real-workspace-e2e.yml'},
 {name:'DuckNote',id:'eel',repo:'dennisbsj/DuckNote',
  workflow:'.github/workflows/workspace-native-real-browser.yml'},
 {name:'DuckPipe',id:'methpipe',repo:'dennisbsj/DuckPipe',
  workflow:'.github/workflows/native-duckpipe-real-workspace-e2e.yml'},
 {name:'DuckTrain',id:'mantrain',repo:'dennisbsj/DuckTrain',
  workflow:'.github/workflows/native-ducktrain-real-workspace-e2e.yml'},
 {name:'DuckMan',id:'duckman',repo:'dennisbsj/DuckMan',
  workflow:'.github/workflows/native-duckman-real-workspace-e2e.yml'},
 {name:'LabDuck',id:'limsman',repo:'dennisbsj/LabDuck',
  workflow:'.github/workflows/native-labduck-real-workspace-e2e.yml'}
]);
const SHA=/^[a-f0-9]{40}$/;
const exact=(obj,expected)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===expected.slice().sort().join(',');
const validRun=n=>Number.isSafeInteger(n)&&n>0;

export function validateQaLock(lock){
 const errors=[];
 const fail=code=>{if(!errors.includes(code))errors.push(code)};
 if(!exact(lock,['version','scope','central','apps'])||lock.version!==1||
    lock.scope!=='synthetic-source-ci-only')return {ok:false,errors:['invalid_snapshot']};
 const c=lock.central;
 if(!exact(c,['repo','sha','runId','workflowId'])||
    c.repo!=='dennisbsj/DuckBio-site'||!SHA.test(c.sha||'')||
    !validRun(c.runId)||!validRun(c.workflowId))fail('invalid_central');
 if(!Array.isArray(lock.apps)||lock.apps.length!==6)
  fail('exactly_six_native_apps_required');
 else{
  const runIds=new Set(),workflowIds=new Set();
  for(let i=0;i<APPS.length;i++){
   const actual=lock.apps[i],expected=APPS[i];
   if(!exact(actual,['name','id','repo','sha','workflow','runId','workflowId'])||
      actual.name!==expected.name||actual.id!==expected.id||
      actual.repo!==expected.repo||actual.workflow!==expected.workflow||
      !SHA.test(actual.sha||'')||!validRun(actual.runId)||
      !validRun(actual.workflowId)||runIds.has(actual.runId)||
      workflowIds.has(actual.workflowId))fail('invalid_native_app_'+expected.id);
   else{runIds.add(actual.runId);workflowIds.add(actual.workflowId)}
  }
 }
 return {ok:errors.length===0,errors};
}

export function validateDocumentation(lock,markdown){
 const parsed=validateQaLock(lock);
 if(!parsed.ok)return parsed;
 if(typeof markdown!=='string')return {ok:false,errors:['baseline_document_unavailable']};
 const errors=[];
 for(const row of [lock.central,...lock.apps]){
  if(!markdown.includes(row.sha)||!markdown.includes('/actions/runs/'+row.runId))
   errors.push('baseline_document_mismatch_'+(row.id||'central'));
 }
 return {ok:errors.length===0,errors};
}

export function validateRun(run,row){
 return Boolean(run&&typeof run==='object'&&
  run.head_sha===row.sha&&run.workflow_id===row.workflowId&&
  run.id===row.runId&&run.status==='completed'&&
  run.conclusion==='success'&&run.event==='push'&&
  run.head_branch==='main');
}

export function validatePinnedWorkflow(content,centralSha){
 if(typeof content!=='string')return false;
 const repos=content.match(/^\s*repository:\s*dennisbsj\/DuckBio-site\s*$/gm)||[];
 const pins=[...content.matchAll(/^\s*ref:\s*([a-f0-9]{40})\s*$/gm)];
 return repos.length===1&&pins.length===1&&pins[0][1]===centralSha;
}

export async function auditQaLock(lock,{fetchImpl=globalThis.fetch}={}){
 const schema=validateQaLock(lock);
 if(!schema.ok)return {...schema,verifiedApps:0};
 if(typeof fetchImpl!=='function')return {ok:false,errors:['missing_fetch'],verifiedApps:0};
 const errors=[];
 const github=async(endpoint)=>{
  const result=await fetchImpl('https://api.github.com/repos/'+endpoint,{
   method:'GET',redirect:'error',
   headers:{Accept:'application/vnd.github+json',
    'User-Agent':'DuckBio-public-source-qa-evidence'},
   signal:AbortSignal.timeout(12000)
  });
  if(!result?.ok)throw Error('github_read_failed');
  const json=await result.json();
  if(!json||typeof json!=='object'||Array.isArray(json))
   throw Error('invalid_github_result');
  return json;
 };
 async function query(label,operation){
  try{return await operation()}
  catch{errors.push('unverified_'+label);return null}
 }
 const central=await query('central_ci',()=>
  github(lock.central.repo+'/actions/runs/'+lock.central.runId));
 if(central&&!validateRun(central,lock.central))
  errors.push('central_ci_mismatch');
 const jobs=await query('central_node_matrix',()=>
  github(lock.central.repo+'/actions/runs/'+lock.central.runId+'/jobs?per_page=100'));
 if(jobs){
  if(!Array.isArray(jobs.jobs)||![22,24].every(n=>
    jobs.jobs.some(job=>job.name==='core ('+n+')'&&
     job.status==='completed'&&job.conclusion==='success')))
   errors.push('central_node_matrix_mismatch');
 }
 let verifiedApps=0;
 for(const row of lock.apps){
  const run=await query(row.id+'_ci',()=>
   github(row.repo+'/actions/runs/'+row.runId));
  const source=await query(row.id+'_workflow',()=>
   github(row.repo+'/contents/'+row.workflow+'?ref='+row.sha));
  let validSource=false;
  if(source){
   try{
    if(source.encoding==='base64'&&typeof source.content==='string')
     validSource=validatePinnedWorkflow(
      Buffer.from(source.content.replace(/\s/g,''),'base64').toString('utf8'),
      lock.central.sha);
   }catch{/* fixed error code below */}
   if(!validSource)errors.push(row.id+'_central_pin_mismatch');
  }
  if(run&&!validateRun(run,row))errors.push(row.id+'_ci_mismatch');
  if(run&&validateRun(run,row)&&source&&validSource)verifiedApps++;
 }
 return {ok:errors.length===0,errors,verifiedApps};
}

const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const args=process.argv.slice(2);
 if(args.length!==1||!['--offline','--remote'].includes(args[0])){
  console.error('Usage: node six-app-source-qa-audit.mjs --offline|--remote');
  process.exitCode=2;
 }else{
  try{
   const lock=JSON.parse(readFileSync(
    new URL('./six-app-source-qa-lock.json',import.meta.url),'utf8'));
   const markdown=readFileSync(
    new URL('./SIX_APP_SOURCE_QA_BASELINE.md',import.meta.url),'utf8');
   const docs=validateDocumentation(lock,markdown);
   const result=docs.ok&&args[0]==='--remote'?
    await auditQaLock(lock):docs;
   if(!result.ok){
    console.error('Source QA audit: FAIL ('+result.errors.join(', ')+')');
    process.exitCode=1;
   }else{
    console.log('Source QA audit: PASS ('+
     (args[0]==='--remote'?'public GitHub historical evidence for six apps':
       'locked offline manifest and documentation')+
     '; source-only, NOT deployment or current-head approval)');
   }
  }catch{
   console.error('Source QA audit: FAIL (unreadable_or_unverified_snapshot)');
   process.exitCode=1;
  }
 }
}
