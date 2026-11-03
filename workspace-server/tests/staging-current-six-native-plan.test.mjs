import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,
 writeFileSync,existsSync,renameSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {validateQaLock} from '../six-app-source-qa-audit.mjs';
import {validateCurrentCompatLock} from '../six-native-current-compat-audit.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from '../staging-six-native-snapshot.mjs';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {NATIVE_SERVICE_KINDS,writeSixNativeServicePlan,
 prepareSixNativeServicePlan} from '../staging-six-native-services.mjs';
import {writeSevenOriginProxyPlan,buildSevenOriginProxyPlan}
 from '../staging-seven-proxy-plan.mjs';
import {auditSevenServicePrestart}
 from '../staging-seven-prestart-gate.mjs';

const current=JSON.parse(readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const historical=JSON.parse(readFileSync(new URL(
 '../six-app-source-qa-lock.json',import.meta.url),'utf8'));
const key=()=>randomBytes(32).toString('base64url');
const info=id=>id==='eel'||id==='duckman'?
 'DUCKBIO_WORKSPACE_ORGANIZATION_ID':'DUCKBIO_WORKSPACE_ORG_ID';

function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-current-six-plan-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const roots={};
 for(const name of ['source','data','central','proxy','units']){
  roots[name]=join(home,name);
  mkdirSync(roots[name],{mode:0o700});
 }
 const {source,data,central,proxy,units}=roots;
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:current.central.sha
 });
 const clients=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 const repos=[current.central,...current.apps];
 const sourceByDir=new Map();
 for(const row of repos){
  const repoName=row.repo.split('/')[1],dir=join(source,repoName);
  mkdirSync(dir,{mode:0o700});
  sourceByDir.set(dir,row);
  if(!row.id)continue;
  const entry=join(dir,NATIVE_SERVICE_KINDS[row.id].entrypoint);
  mkdirSync(dirname(entry),{recursive:true,mode:0o700});
  writeFileSync(entry,row.id==='eel'?
   '// inert fixture: verifyDuckNoteRuntimeDir(appRoot,process.env.DUCKNOTE_RUNTIME_DIR)\n':
   '// inert native test fixture only: NEVER EXECUTED\n');
  if(row.id==='eel')
   writeFileSync(join(dir,'server','runtime-directory.js'),
    '// fixture DUCKNOTE_RUNTIME_DIR check only; no real runtime\n');
 }
 const gitCalls=[];
 function runGit(binary,args,{cwd}={}){
  assert.equal(binary,'git');
  assert.equal(args[0],'-c');
  assert.equal(args[1],'core.fsmonitor=false');
  const row=sourceByDir.get(cwd);
  assert(row,'unexpected Git source checkout');
  const parts=args.slice(2);
  gitCalls.push(parts.join(' '));
  const command=parts.join(' ');
  if(command==='rev-parse --show-toplevel')return cwd+'\n';
  if(command==='remote get-url origin')return 'https://github.com/'+row.repo+'.git\n';
  if(command==='rev-parse --verify HEAD')return row.sha+'\n';
  if(command==='status --porcelain --untracked-files=normal')return '';
  if(parts[0]==='show'&&parts[1]==='HEAD:'+row.workflow)
   return 'name: synthetic immutable workflow metadata only\nsteps:\n'+
    '  - uses: actions/checkout@v4\n'+
    '    with:\n      repository: dennisbsj/DuckBio-site\n'+
    '      ref: '+current.central.sha+'\n';
  throw Error('unrecognized Git command '+command);
 }
 const envs=new Map();
 for(const row of current.apps){
  const id=row.id,c=clients.get(id),dir=join(data,id);
  mkdirSync(dir,{mode:0o700});
  const env={
   DUCKBIO_WORKSPACE_ORIGIN:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_ISSUER:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_CLIENT_SECRET:c.secret,
   [info(id)]:'synthetic-staging-'+id
  };
  if(id==='eel'){
   mkdirSync(join(dir,'runtime'),{mode:0o700});
   Object.assign(env,{
    FRONTEND_ORIGIN:c.nativeOrigin,APP_BASE_URL:c.nativeOrigin,
    CANONICAL_ORIGIN:c.nativeOrigin,
    DUCKBIO_WORKSPACE_NATIVE_ORIGIN:c.nativeOrigin,
    DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED:'true',
    DUCKBIO_WORKSPACE_VAULT_KEY:key(),
    PGHOST:'127.0.0.1',PGDATABASE:'ducknote_staging',
    PGUSER:'ducknote_test',PGPASSWORD:key()
   });
  }else{
   if(id!=='limsman')env.APP_BASE_URL=c.nativeOrigin;
   env[id==='duckman'?'DUCKMAN_DATABASE_PATH':
    id==='limsman'?'LIMSMAN_CONFIG_PATH':'SCIENCE_DATABASE_PATH']=
    join(dir,id==='limsman'?'private-config.json':'native.sqlite');
   if(id==='duckman')Object.assign(env,{
    DUCKBIO_WORKSPACE_PROOF_KEY:key(),
    DUCKBIO_WORKSPACE_CLIENT_ID:'duckman'
   });
  }
  const path=join(dir,'native.env');
  writeFileSync(path,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',
   {mode:0o600});
  envs.set(id,{path,env});
 }
 return {home,...roots,config,gitCalls,runGit,envs,
  lock:current};
}
function plans(f){
 return {
  proxy:buildSevenOriginProxyPlan(f.config,f.lock),
  native:prepareSixNativeServicePlan({
   config:f.config,lock:f.lock,sourcesRoot:f.source,
   dataRoot:f.data,runGit:f.runGit
  })
 };
}
function writePlans(f){
 writeSevenOriginProxyPlan({config:f.config,lock:f.lock,
  outputRoot:f.proxy});
 writeSixNativeServicePlan({
  config:f.config,lock:f.lock,sourcesRoot:f.source,
  dataRoot:f.data,outputRoot:f.units,runGit:f.runGit
 });
}
function prestart(f,overrides={}){
 return auditSevenServicePrestart({
  config:f.config,lock:f.lock,sourcesRoot:f.source,
  dataRoot:f.data,proxyOutputRoot:f.proxy,
  nativeOutputRoot:f.units,runGit:f.runGit,
  ...overrides
 });
}
const failed=(result,name)=>result.checks.some(c=>c.name===name&&c.ok===false);
test('historical and current six-app source snapshots both remain individually strict',()=>{
 assert.deepEqual(validateSixNativeStagingSnapshot(historical),
  {ok:true,kind:'historical'});
 assert.deepEqual(validateSixNativeStagingSnapshot(current),
  {ok:true,kind:'current'});
 assert.equal(validateQaLock(current).ok,false);
 assert.equal(validateCurrentCompatLock(historical).ok,false);
 assert.equal(stagingSnapshotFile(),'six-app-source-qa-lock.json');
 assert.equal(stagingSnapshotFile('current'),
  'six-native-current-compat-lock.json');
 for(const invalid of ['main','latest','dataduck','seven','./current',null])
  assert.throws(()=>stagingSnapshotFile(invalid));
 const bad=structuredClone(current);
 bad.apps.push({...bad.apps[0],id:'dataduck'});
 assert.equal(validateSixNativeStagingSnapshot(bad).ok,false);
});
test('current exact six-app source can build six native service units and seven host Caddy without running services',
 {timeout:120000},t=>{
 const f=fixture(t),result=plans(f);
 assert.equal(result.proxy.manifest.routeCount,7);
 assert.equal(result.native.manifest.serviceCount,6);
 assert.equal(result.proxy.manifest.sourceQaWorkspaceSha,current.central.sha);
 assert.equal(result.native.manifest.jointlyVerifiedWorkspaceSha,current.central.sha);
 assert.equal(result.native.manifest.routesSha256,
  result.proxy.manifest.caddySha256);
 assert.deepEqual(result.native.manifest.services.map(x=>x.appId),
  current.apps.map(x=>x.id));
 assert.equal(new Set(result.native.manifest.services.map(x=>x.loopbackPort)).size,6);
 assert.equal(new Set(result.native.manifest.services.map(x=>x.serviceUser)).size,6);
 assert(result.native.units.find(x=>x.name.includes('eel')).content.includes(
  'DUCKNOTE_RUNTIME_DIR='+join(f.data,'eel','runtime')));
 assert(result.native.units.every(x=>x.content.includes(
  'ProtectSystem=strict')));
 assert(!existsSync(join(f.proxy,'seven-origin-proxy-plan')));
 assert(!existsSync(join(f.units,'six-native-service-plan')));
 assert.equal(f.gitCalls.filter(x=>x.startsWith('show HEAD:')).length,6,
  'Only the six native workflows pin Workspace; central CI must not pin itself');
});
test('CURRENT uninstalled generated artifacts pass the exact four-step private prestart audit',
 {timeout:120000},t=>{
 const f=fixture(t);
 writePlans(f);
 const passed=prestart(f);
 assert.deepEqual(passed.checks.map(x=>x.name),[
  'isolated-private-roots','seven-exact-source-checkouts',
  'six-private-native-env-files','exact-seven-origin-proxy-artifacts',
  'exact-six-native-unit-artifacts'
 ]);
 assert.equal(passed.ok,true);
 assert.equal(passed.deploymentAuthorized,false);
 assert.equal(passed.category,'offline-prestart-source-and-policy-only');
 assert.throws(()=>writePlans(f)); // never overwrite previously created plans
});
test('cannot reuse historical configs and plans with current lock, or current sources with older lock',
 {timeout:120000},t=>{
 const f=fixture(t);
 const changed={...f.config,SUITE_BUILD_SHA:historical.central.sha};
 assert.throws(()=>buildSevenOriginProxyPlan(changed,current),
  /staging_workspace_sha_not_jointly_verified/);
 assert.throws(()=>buildSevenOriginProxyPlan(f.config,historical),
  /staging_workspace_sha_not_jointly_verified/);
 assert.equal(prestart(f,{config:changed}).ok,false);
 assert(failed(prestart(f,{config:changed}),'reviewed-source-configuration'));
 assert.throws(()=>prepareSixNativeServicePlan({
  config:f.config,lock:historical,sourcesRoot:f.source,
  dataRoot:f.data,runGit:f.runGit
 }),/unverified_seven_source_checkouts|invalid_synthetic_staging_config/);
});
test('tampered native Caddy/unit files, non-private runtime or wrong env secrets fail closed',
 {timeout:120000},t=>{
 const f=fixture(t);writePlans(f);
 const proxy=join(f.proxy,'seven-origin-proxy-plan','Caddyfile.seven-origin-staging');
 const caddy=readFileSync(proxy,'utf8');
 writeFileSync(proxy,caddy+'\n#tampered\n');
 assert(failed(prestart(f),'exact-seven-origin-proxy-artifacts'));
 writeFileSync(proxy,caddy);
 const unit=join(f.units,'six-native-service-plan',
  'duckbio-native-eel-staging.service');
 const original=readFileSync(unit,'utf8');
 writeFileSync(unit,original.replace('ReadWritePaths=','ReadWritePaths=/tmp '));
 assert(failed(prestart(f),'exact-six-native-unit-artifacts'));
 writeFileSync(unit,original);
 const native=join(f.data,'eel','runtime');
 renameSync(native,native+'-old');
 assert(failed(prestart(f),'six-private-native-env-files'));
 renameSync(native+'-old',native);
 const ent=f.envs.get('methpipe');
 const before=readFileSync(ent.path,'utf8');
 writeFileSync(ent.path,before.replace(
  ent.env.DUCKBIO_WORKSPACE_CLIENT_SECRET,key()));
 assert(failed(prestart(f),'six-private-native-env-files'));
});
test('prestart refuses extra source/app, missing reviewed source and a changed current SHA',
 {timeout:120000},t=>{
 const f=fixture(t);writePlans(f);
 const extra=join(f.source,'DataDuck');
 mkdirSync(extra,{mode:0o700});
 assert(failed(prestart(f),'seven-exact-source-checkouts'));
 rmSync(extra,{recursive:true});
 const invalid=structuredClone(current);
 invalid.apps[1].sha='f'.repeat(40);
 assert(failed(prestart(f,{lock:invalid}),'reviewed-source-configuration'));
});
test('old CLI invocations remain unchanged; new snapshot can only be explicitly opted into offline',
 ()=>{
 const scripts=[
  ['staging-seven-proxy-plan.mjs','--confirm-uninstalled-only'],
  ['staging-six-native-services.mjs','--confirm-uninstalled-only'],
  ['staging-seven-prestart-gate.mjs','--confirm-offline-prestart-only'],
  ['staging-seven-source-gate.mjs','--confirm-offline-sources']
 ];
 for(const [name,ack] of scripts){
  const path=fileURLToPath(new URL('../'+name,import.meta.url));
  const noArgs=spawnSync(process.execPath,[path],{
   encoding:'utf8',timeout:5000});
  assert.equal(noArgs.status,2);
  const invalid=spawnSync(process.execPath,[path,
   '--snapshot','latest',ack],{encoding:'utf8',timeout:5000});
  assert.equal(invalid.status,2);
  assert(!noArgs.stderr.includes('DUCKBIO_WORKSPACE_CLIENT_SECRET'));
 }
});
