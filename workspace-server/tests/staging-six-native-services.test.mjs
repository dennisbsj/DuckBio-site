import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,
 renameSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {APPS,validateQaLock} from '../six-app-source-qa-audit.mjs';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {STAGING_PROXY_PORTS} from '../staging-seven-proxy-plan.mjs';
import {NATIVE_SERVICE_KINDS,prepareSixNativeServicePlan,
 writeSixNativeServicePlan} from '../staging-six-native-services.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const git=(dir,...args)=>execFileSync('git',args,{
 cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:12000
}).trim();
function setup(t,{legacyDuckNote=false}={}){
 const home=mkdtempSync(join(tmpdir(),'duckbio-native-unit-test-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 for(const name of ['sources','data','output','central']){
  mkdirSync(join(home,name),{mode:0o700});
 }
 const sources=join(home,'sources'),data=join(home,'data'),
  output=join(home,'output'),central=join(home,'central');
 const make=(name,repo,kind,centralSha)=>{
  const root=join(sources,name);
  mkdirSync(root,{mode:0o700});
  git(root,'init','-q');
  git(root,'remote','add','origin','https://github.com/'+repo+'.git');
  if(kind){
   const entry=join(root,kind.entrypoint);
   mkdirSync(dirname(entry),{mode:0o700,recursive:true});
   writeFileSync(entry,name==='DuckNote'&&!legacyDuckNote?
    '// Inert fixture: verifyDuckNoteRuntimeDir(appRoot,process.env.DUCKNOTE_RUNTIME_DIR)\n':
    '// Synthetic staging entrypoint fixture; never executed\n');
   if(name==='DuckNote'&&!legacyDuckNote)
    writeFileSync(join(root,'server','runtime-directory.js'),
     '// Synthetic DUCKNOTE_RUNTIME_DIR fixture; never imported\n');
   const workflow=join(root,kind.workflow);
   mkdirSync(dirname(workflow),{recursive:true});
   writeFileSync(workflow,
    'jobs:\n  qa:\n    steps:\n      - uses: actions/checkout@v4\n'+
    '        with:\n          repository: dennisbsj/DuckBio-site\n'+
    '          ref: '+centralSha+'\n');
  }else writeFileSync(join(root,'README.md'),'Central synthetic source fixture\n');
  git(root,'add','.');
  git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.test',
   'commit','-qm','Review synthetic source');
  return git(root,'rev-parse','HEAD');
 };
 const sha=make('DuckBio-site','dennisbsj/DuckBio-site');
 const apps=APPS.map((a,i)=>{
  const kind={...NATIVE_SERVICE_KINDS[a.id],workflow:a.workflow};
  const appSha=make(a.name,a.repo,kind,sha);
  return {...a,sha:appSha,runId:100001+i,workflowId:100101+i};
 });
 const lock={
  version:1,scope:'synthetic-source-ci-only',
  central:{repo:'dennisbsj/DuckBio-site',sha,runId:222222,workflowId:333333},
  apps
 };
 assert.equal(validateQaLock(lock).ok,true);
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:sha
 });
 return {home,sources,data,output,central,lock,config,apps};
}
const build=f=>prepareSixNativeServicePlan({
 config:f.config,lock:f.lock,sourcesRoot:f.sources,dataRoot:f.data
});
const store=f=>writeSixNativeServicePlan({
 config:f.config,lock:f.lock,sourcesRoot:f.sources,dataRoot:f.data,
 outputRoot:f.output
});

test('six real local Git fixtures produce distinct native service units matched to the seven-origin proxy',
 {timeout:60000},t=>{
 const f=setup(t),plan=build(f);
 assert.equal(plan.units.length,6);
 assert.equal(plan.manifest.serviceCount,6);
 assert.equal(plan.manifest.scope,'source-verified-template-only-no-deployment');
 assert.equal(plan.manifest.jointlyVerifiedWorkspaceSha,f.lock.central.sha);
 assert.deepEqual(plan.manifest.services.map(s=>s.appId),
  ['goflo','eel','methpipe','mantrain','duckman','limsman']);
 const all=new Set();
 for(const svc of plan.manifest.services){
  const k=NATIVE_SERVICE_KINDS[svc.appId];
  const unit=plan.units.find(u=>u.name===svc.unitName);
  assert(unit);
  assert.equal(svc.repo,'dennisbsj/'+k.repo);
  assert.equal(svc.entrypoint,k.entrypoint);
  assert.equal(svc.loopbackPort,STAGING_PROXY_PORTS[svc.appId]);
  assert.equal(svc.loopbackHost,'127.0.0.1');
  assert.equal(svc.storageKind,k.database);
  assert.deepEqual(svc.requiredPrivateSettings,k.requiredPrivateSettings);
  assert.equal(svc.unitSha256,hash(unit.content));
  assert.equal(svc.reviewedSourceSha,f.apps.find(a=>a.id===svc.appId).sha);
  assert.match(unit.content,/^User=duckbio-stg-[a-z]+$/m);
  assert.match(unit.content,/^Group=duckbio-stg-[a-z]+$/m);
  assert.match(unit.content,/^EnvironmentFile=\/[^\n]+\/native\.env$/m);
  const forcedPrivateRuntime=svc.appId==='eel'?
   ' DUCKNOTE_RUNTIME_DIR='+join(f.data,'eel','runtime'):'';
  assert(unit.content.includes(
   'ExecStart=/usr/bin/env NODE_ENV=production HOST=127.0.0.1 PORT='+
   svc.loopbackPort+forcedPrivateRuntime+' '+process.execPath+' '));
  if(svc.appId==='eel'){
   assert.equal(svc.privateRuntimeDirectory,join(f.data,'eel','runtime'));
   assert(unit.content.includes('ReadWritePaths='+join(f.data,'eel')));
  }else assert.equal(svc.privateRuntimeDirectory,undefined);
  assert(unit.content.includes('ReadWritePaths='+svc.privateDataDirectory));
  assert(unit.content.includes('ReadOnlyPaths='+join(f.sources,k.repo)));
  assert.match(unit.content,/^ProtectSystem=strict$/m);
  assert.match(unit.content,/^UMask=0077$/m);
  assert(!unit.content.includes('Environment=HOST='));
  for(const key of [svc.loopbackPort,svc.serviceUser,svc.environmentFile]){
   assert(key!==undefined);
  }
  all.add(svc.serviceUser);
 }
 assert.equal(all.size,6,'per-app service identities are distinct');
 assert.equal(new Set(plan.manifest.services.map(s=>s.environmentFile)).size,6);
 assert.equal(new Set(plan.manifest.services.map(s=>s.privateDataDirectory)).size,6);
 assert.equal(new Set(plan.manifest.services.map(s=>s.loopbackPort)).size,6);
 assert.equal(plan.manifest.services.find(s=>s.appId==='eel').storageKind,'postgresql');
 assert.equal(plan.manifest.services.find(s=>s.appId==='limsman').storageKind,
  'sqlite-config-and-sessions');
});

test('legacy committed DuckNote source cannot pass the private-runtime systemd plan',
 {timeout:60000},t=>{
 const f=setup(t,{legacyDuckNote:true});
 assert.equal(validateQaLock(f.lock).ok,true);
 assert.throws(()=>build(f),/ducknote_private_runtime_source_not_verified/);
 assert.deepEqual(readdirSync(f.output),[]);
});

test('never materializes app secrets, customer info, credentials, databases or environment files',
 {timeout:60000},t=>{
 const f=setup(t);
 assert.deepEqual(store(f),{ok:true,templates:6,workspaceSha:f.lock.central.sha});
 const dir=join(f.output,'six-native-service-plan');
 const names=readdirSync(dir);
 assert.equal(names.length,7);
 assert(names.includes('service-manifest.json'));
 assert.equal(names.filter(n=>n.endsWith('.service')).length,6);
 const all=names.map(n=>readFileSync(join(dir,n),'utf8')).join('\n');
 for(const secret of [f.config.SUITE_SETUP_TOKEN,
  ...JSON.parse(f.config.SUITE_CLIENTS).map(x=>x.secret)]){
  assert(!all.includes(secret));
 }
 assert(!all.includes(f.config.SUITE_AUTH_DB_PATH));
 assert(!all.includes('SUITE_CLIENTS'));
 assert(!all.includes('PGPASSWORD='));
 assert(!all.includes('DUCKBIO_WORKSPACE_VAULT_KEY='));
 assert(!all.includes('EEL_SETUP_TOKEN='));
 assert.deepEqual(readdirSync(f.data),[]);
 if(process.platform!=='win32'){
  assert.equal(statSync(dir).mode&0o777,0o700);
  for(const n of names)assert.equal(statSync(join(dir,n)).mode&0o777,0o600);
 }
 const initial=readFileSync(join(dir,'service-manifest.json'),'utf8');
 assert.throws(()=>store(f));
 assert.equal(readFileSync(join(dir,'service-manifest.json'),'utf8'),initial);
});

test('rejects changed central revision, dirty/foreign source and missing native entrypoint',
 {timeout:60000},t=>{
 const f=setup(t);
 assert.throws(()=>prepareSixNativeServicePlan({
  config:{...f.config,SUITE_BUILD_SHA:'f'.repeat(40)},
  lock:f.lock,sourcesRoot:f.sources,dataRoot:f.data
 }),/unverified_seven_source_checkouts|staging_workspace_sha_not_jointly_verified/);
 const native=join(f.sources,'DuckPipe');
 const untracked=join(native,'extra.txt');
 writeFileSync(untracked,'UNREVIEWED');
 assert.throws(()=>build(f),/unverified_seven_source_checkouts/);
 rmSync(untracked);
 git(native,'remote','set-url','origin','https://github.com/attacker/DuckPipe.git');
 assert.throws(()=>build(f),/unverified_seven_source_checkouts/);
 git(native,'remote','set-url','origin','https://github.com/dennisbsj/DuckPipe.git');
 assert.equal(build(f).units.length,6);
 const symlink=join(f.sources,'DuckMan','startup.cjs');
 const backup=join(f.home,'source-backup.cjs');
 renameSync(symlink,backup);
 symlinkSync(backup,symlink);
 assert.throws(()=>build(f),/unverified_seven_source_checkouts|missing_or_symlinked_native_entrypoint/);
 assert.deepEqual(readdirSync(f.output),[]);
});

test('refuses overlapping credentials/source roots, public directory, symlinks and invalid ports',
 {timeout:60000},t=>{
 const f=setup(t);
 for(const bad of [f.sources,f.central]){
  assert.throws(()=>prepareSixNativeServicePlan({
   config:f.config,lock:f.lock,sourcesRoot:f.sources,dataRoot:bad
  }),/service_data_sources_must_be_isolated/);
 }
 assert.throws(()=>writeSixNativeServicePlan({
  config:f.config,lock:f.lock,sourcesRoot:f.sources,
  dataRoot:f.data,outputRoot:f.central
 }),/native_service_plan_must_be_separate_private_root/);
 const pub=join(f.home,'public_html');
 mkdirSync(pub,{mode:0o700});
 assert.throws(()=>writeSixNativeServicePlan({
  config:f.config,lock:f.lock,sourcesRoot:f.sources,
  dataRoot:f.data,outputRoot:pub
 }),/public_or_repository_root/);
 const alias=join(f.home,'aliased');
 symlinkSync(f.output,alias);
 assert.throws(()=>writeSixNativeServicePlan({
  config:f.config,lock:f.lock,sourcesRoot:f.sources,
  dataRoot:f.data,outputRoot:alias
 }));
 const badPort={...STAGING_PROXY_PORTS,eel:3308};
 assert.throws(()=>prepareSixNativeServicePlan({
  config:f.config,lock:f.lock,sourcesRoot:f.sources,
  dataRoot:f.data,ports:badPort
 }),/invalid_or_duplicate_proxy_ports/);
 assert.deepEqual(readdirSync(f.output),[]);
});

test('unit templates are parseable by actual systemd-analyze when explicitly enabled on CI',
 {timeout:60000},t=>{
 if(process.env.DUCKBIO_VERIFY_NATIVE_SYSTEMD!=='1')return t.skip('explicit opt-in Linux CI only');
 const f=setup(t);
 store(f);
 const dir=join(f.output,'six-native-service-plan');
 const units=readdirSync(dir).filter(x=>x.endsWith('.service')).map(x=>join(dir,x));
 assert.equal(units.length,6);
 const result=spawnSync('systemd-analyze',['verify',...units],{
  encoding:'utf8',timeout:20000
 });
 assert.equal(result.status,0,result.stderr.slice(0,3000));
});

test('CLI refuses accidental invocation without explicit opt-in or mismatched source QA lock',
 {timeout:60000},t=>{
 const f=setup(t);
 const file=join(f.central,'workspace-staging.json');
 writeFileSync(file,JSON.stringify(f.config,null,2)+'\n',{mode:0o600});
 const script=fileURLToPath(new URL('../staging-six-native-services.mjs',import.meta.url));
 const args=[script,'--config',file,'--sources-root',f.sources,
  '--private-data-root',f.data,'--private-output-root',f.output];
 const denied=spawnSync(process.execPath,args,{encoding:'utf8',timeout:12000});
 assert.equal(denied.status,2);
 const rejected=spawnSync(process.execPath,
  [...args,'--confirm-uninstalled-only'],{encoding:'utf8',timeout:12000});
 // Test fixture has random synthetic SHAs; the standalone CLI requires the
 // actual immutable lock shipped with the tested Workspace tooling.
 assert.equal(rejected.status,1);
 assert.equal(readdirSync(f.output).length,0);
 const logs=denied.stdout+denied.stderr+rejected.stdout+rejected.stderr;
 for(const secret of [f.config.SUITE_SETUP_TOKEN,
   ...JSON.parse(f.config.SUITE_CLIENTS).map(x=>x.secret),f.sources,f.data,file])
  assert(!logs.includes(secret));
});
