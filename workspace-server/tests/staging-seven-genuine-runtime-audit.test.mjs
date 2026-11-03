import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {auditSevenGenuineStaging,
 inspectStagingUnit,inspectStagingProcess}
 from '../staging-seven-genuine-runtime-audit.mjs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const privateFixture=mkdtempSync(join(tmpdir(),'duckbio-seven-genuine-fixture-'));
chmodSync(privateFixture,0o700);
process.once('exit',()=>rmSync(privateFixture,{recursive:true,force:true}));
const sourceRoot='/srv/duckbio-private/seven-reviewed-sources';
const names=['workspace','goflo','eel','methpipe','mantrain','duckman','limsman'];
const repos=['DuckBio-site','CytoDuck','DuckNote','DuckPipe',
 'DuckTrain','DuckMan','LabDuck'];
const config=()=>createSyntheticStagingConfig({
 baseDomain:'duckbio.net',privateRoot:privateFixture,
 buildSha:lock.central.sha
});
const clone=x=>structuredClone(x);
function fixture({edit,changeAfter=0,smokeResult}={}){
 const calls={sources:0,units:0,processes:0,http:0},records=new Map();
 for(let i=0;i<names.length;i++){
  const id=names[i],repo=repos[i],user=i===0?
   'duckbio-staging':'duckbio-stg-'+id;
  const cwd=sourceRoot+'/'+repo+(i===0?'/workspace-server':'');
  const entry=cwd+'/'+(i===0?'shared-auth/runtime.mjs':
   id==='eel'?'server/index.js':'startup.cjs');
  const record={id,pid:3100+i,user,cwd,entry,
   unit:i===0?'duckbio-workspace-staging.service':
    'duckbio-native-'+id+'-staging.service'};
  records.set(record.unit,record);
 }
 const sourceAudit=()=>{calls.sources++;return {ok:true,verified:7,errors:[]}};
 const inspectUnit=unit=>{
  calls.units++;
  const row=records.get(unit);
  if(!row)throw Error('unexpected service name');
  const props={LoadState:'loaded',ActiveState:'active',SubState:'running',
   MainPID:String(row.pid),User:row.user,Group:row.user,WorkingDirectory:row.cwd};
  if(edit)edit({row,props,phase:calls.units>7?'second':'first'});
  if(changeAfter&&calls.units>7&&row.id==='eel')
   props.MainPID=String(row.pid+changeAfter);
  return props;
 };
 const inspectProcess=pid=>{
  calls.processes++;
  const row=[...records.values()].find(item=>item.pid===pid);
  if(!row)throw Error('unexpected pid');
  return {args:['/usr/bin/node',row.entry],cwd:row.cwd,exe:'/usr/bin/node'};
 };
 const smoke=async()=>{calls.http++;return smokeResult??{
  ok:true,checks:Array.from({length:9},(_,i)=>({
   target:'synthetic-'+i,passed:true,code:'ok'}))
 }};
 return {calls,sourceAudit,inspectUnit,inspectProcess,smoke,records};
}
const run=(f,overrides={})=>auditSevenGenuineStaging({
 config:config(),lock,sourcesRoot,sourceAudit:f.sourceAudit,
 inspectUnit:f.inspectUnit,inspectProcess:f.inspectProcess,smoke:f.smoke,
 ...overrides
});
test('checks all seven distinct actual process command lines before HTTPS, then checks stability',
 async()=>{
 const f=fixture(),result=await run(f);
 assert.equal(result.ok,true);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.category,
  'seven-real-systemd-processes-and-anonymous-https-only');
 assert.deepEqual(f.calls,{sources:1,units:14,processes:14,http:1});
 assert(result.checks.some(c=>c.name==='seven-https'&&c.ok));
});
test('refuses unreviewed central SHA or missing native app before inspecting source or network',
 async()=>{
 const f=fixture(),invalid=config();
 invalid.SUITE_BUILD_SHA='f'.repeat(40);
 assert.equal((await run(f,{config:invalid})).ok,false);
 const broken=clone(lock);broken.apps.pop();
 assert.equal((await run(f,{lock:broken})).ok,false);
 assert.deepEqual(f.calls,{sources:0,units:0,processes:0,http:0});
});
test('rejects source gate failure before contacting any systemd or HTTPS host',
 async()=>{
 const f=fixture();f.sourceAudit=()=>{f.calls.sources++;return {
  ok:false,verified:6,errors:['unverified_eel_source_checkout']}};
 const result=await run(f);
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'seven_current_checkouts_unverified');
 assert.deepEqual(f.calls,{sources:1,units:0,processes:0,http:0});
});
test('wrong service account or a masked unit fails with no network requests',
 async()=>{
 for(const edit of [
  ({row,props})=>{if(row.id==='eel')props.User='root'},
  ({row,props})=>{if(row.id==='duckman')props.ActiveState='inactive'},
  ({row,props})=>{if(row.id==='workspace')props.WorkingDirectory='/tmp'}
 ]){
  const f=fixture({edit}),result=await run(f);
  assert.equal(result.ok,false);
  assert.equal(f.calls.http,0);
 }
});
test('synthetic routing stub posing as a native app cannot pass process provenance',
 async()=>{
 const f=fixture();
 const original=f.inspectProcess;
 f.inspectProcess=pid=>{
  const p=original(pid);
  if(pid===3102)p.args=['/usr/bin/node','/tmp/synthetic-stub.mjs'];
  return p;
 };
 const result=await run(f);
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).name,'eel-process');
 assert.equal(f.calls.http,0);
});
test('a duplicated process PID is not considered two real applications',
 async()=>{
 const f=fixture({edit:({row,props})=>{
  if(row.id==='mantrain')props.MainPID='3101';
 }});
 assert.equal((await run(f)).ok,false);
 assert.equal(f.calls.http,0);
});
test('network denial or a restarted native process invalidates the seven-service attestation',
 async()=>{
 const f=fixture({smokeResult:{ok:false,checks:[]}});
 assert.equal((await run(f)).checks.at(-1).code,
  'native_https_contract_unverified');
 assert.equal(f.calls.http,1);
 const restarted=fixture({changeAfter:10});
 const result=await run(restarted);
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'service_changed_during_probe');
 assert.equal(restarted.calls.http,1);
});
test('the systemd reader uses only allowlisted units, never systemctl mutations',
 ()=>{
 let invoked=0;
 const props={LoadState:'loaded',ActiveState:'active',SubState:'running',
  MainPID:'3001',User:'duckbio-staging',Group:'duckbio-staging',
  WorkingDirectory:'/srv/duckbio-private/seven-reviewed-sources/DuckBio-site/workspace-server'};
 const run=(cmd,argv,opts)=>{
  invoked++;
  assert.equal(cmd,'systemctl');
  assert.equal(argv[0],'show');
  assert(argv.includes('--no-pager'));
  assert.equal(argv.at(-1),'duckbio-workspace-staging.service');
  assert.equal(opts.timeout,5000);
  return Object.entries(props).map(([k,v])=>k+'='+v).join('\n')+'\n';
 };
 assert.equal(inspectStagingUnit('duckbio-workspace-staging.service',{run}).MainPID,'3001');
 assert.equal(invoked,1);
 assert.throws(()=>inspectStagingUnit('ssh.service',{run}));
 assert.equal(invoked,1);
});
test('unsafe systemctl duplicate fields and invalid or leaked process data are rejected',
 ()=>{
 const unit='duckbio-workspace-staging.service';
 const lines=['LoadState=loaded','ActiveState=active','SubState=running',
  'MainPID=3001','User=duckbio-staging','Group=duckbio-staging',
  'WorkingDirectory=/srv/root'].join('\n');
 assert.throws(()=>inspectStagingUnit(unit,{run:()=>lines+'\nUser=root\n'}));
 assert.throws(()=>inspectStagingUnit(unit,{run:()=>lines.replace(
  'ActiveState=active','')}));
 assert.throws(()=>inspectStagingProcess(0,{
  read:()=>Buffer.alloc(0),link:()=>'/tmp'}));
 const good=inspectStagingProcess(3001,{
  read:()=>Buffer.from('/usr/bin/node\0/private/startup.cjs\0'),
  link:p=>p.endsWith('/cwd')?'/private':'/usr/bin/node'
 });
 assert.deepEqual(good,{args:['/usr/bin/node','/private/startup.cjs'],
  cwd:'/private',exe:'/usr/bin/node'});
});
test('CLI without explicit opt-in cannot access systemd, network or user secrets',
 ()=>{
 const script=fileURLToPath(new URL(
  '../staging-seven-genuine-runtime-audit.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[script],{
  encoding:'utf8',timeout:5000});
 assert.equal(out.status,2);
 assert.match(out.stderr,/--confirm-installed-synthetic-staging-readonly/);
 assert(!out.stderr.includes('/srv/duckbio-private/seven-reviewed-sources'));
});
