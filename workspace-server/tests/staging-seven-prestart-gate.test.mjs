import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,
 writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {APPS,validateQaLock} from '../six-app-source-qa-audit.mjs';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {NATIVE_SERVICE_KINDS,writeSixNativeServicePlan}
 from '../staging-six-native-services.mjs';
import {writeSevenOriginProxyPlan} from '../staging-seven-proxy-plan.mjs';
import {auditSevenServicePrestart} from '../staging-seven-prestart-gate.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{
 cwd,encoding:'utf8',timeout:12000,stdio:['ignore','pipe','ignore']
}).trim();
const key=()=>randomBytes(32).toString('base64url');
function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-seven-prestart-fixture-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const directories={};
 for(const name of ['source','data','central','proxy','units']){
  directories[name]=join(home,name);
  mkdirSync(directories[name],{mode:0o700});
 }
 const {source,data,central,proxy,units}=directories;
 function repository(name,repo,app,centralSha){
  const dir=join(source,name);mkdirSync(dir,{mode:0o700});
  git(dir,'init','-q');
  git(dir,'remote','add','origin','https://github.com/'+repo+'.git');
  if(app){
   const kind=NATIVE_SERVICE_KINDS[app.id];
   const executable=join(dir,kind.entrypoint);
   mkdirSync(dirname(executable),{recursive:true});
   writeFileSync(executable,name==='DuckNote'?
    '// Inert fixture: verifyDuckNoteRuntimeDir(appRoot,process.env.DUCKNOTE_RUNTIME_DIR)\\n':
    '// inert fixture, never executed\\n');
   if(name==='DuckNote')
    writeFileSync(join(dir,'server','runtime-directory.js'),
     '// Synthetic DUCKNOTE_RUNTIME_DIR fixture; never imported\\n');
   const workflow=join(dir,app.workflow);
   mkdirSync(dirname(workflow),{recursive:true});
   writeFileSync(workflow,'jobs:\n  test:\n    steps:\n'+
    '      - uses: actions/checkout@v4\n'+
    '        with:\n'+
    '          repository: dennisbsj/DuckBio-site\n'+
    '          ref: '+centralSha+'\n');
  }else writeFileSync(join(dir,'README.md'),'inert synthetic Workspace source\n');
  git(dir,'add','.');
  git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.test',
   'commit','-qm','Inert synthetic source fixture');
  return git(dir,'rev-parse','HEAD');
 }
 const sha=repository('DuckBio-site','dennisbsj/DuckBio-site');
 const apps=APPS.map((app,i)=>({
  ...app,sha:repository(app.name,app.repo,app,sha),
  runId:500000+i,workflowId:600000+i
 }));
 const lock={version:1,scope:'synthetic-source-ci-only',
  central:{repo:'dennisbsj/DuckBio-site',sha,runId:700000,workflowId:800000},
  apps};
 assert.equal(validateQaLock(lock).ok,true);
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:sha
 });
 const clients=new Map(JSON.parse(config.SUITE_CLIENTS).map(x=>[x.id,x]));
 const envs=new Map();
 const envFile=id=>join(data,id,'native.env');
 for(const app of apps){
  const id=app.id,dir=join(data,id);mkdirSync(dir,{mode:0o700});
  const c=clients.get(id),env={
   DUCKBIO_WORKSPACE_ORIGIN:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_ISSUER:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_CLIENT_SECRET:c.secret
  };
  env[id==='eel'||id==='duckman'?'DUCKBIO_WORKSPACE_ORGANIZATION_ID':
   'DUCKBIO_WORKSPACE_ORG_ID']='synthetic-staging-'+id;
  if(id==='eel'){
   mkdirSync(join(dir,'runtime'),{mode:0o700});
   Object.assign(env,{
    DUCKBIO_WORKSPACE_NATIVE_ORIGIN:c.nativeOrigin,
    DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED:'true',
    DUCKBIO_WORKSPACE_VAULT_KEY:key(),
    FRONTEND_ORIGIN:c.nativeOrigin,APP_BASE_URL:c.nativeOrigin,
    CANONICAL_ORIGIN:c.nativeOrigin,
    PGHOST:'127.0.0.1',PGDATABASE:'ducknote_staging',
    PGUSER:'ducknote_test',PGPASSWORD:key()
   });
  }else{
   if(id!=='limsman')env.APP_BASE_URL=c.nativeOrigin;
   env[id==='duckman'?'DUCKMAN_DATABASE_PATH':
    id==='limsman'?'LIMSMAN_CONFIG_PATH':'SCIENCE_DATABASE_PATH']=
    join(dir,id==='limsman'?'private-labduck.json':'native.sqlite');
   if(id==='duckman')Object.assign(env,{
    DUCKBIO_WORKSPACE_PROOF_KEY:key(),
    DUCKBIO_WORKSPACE_CLIENT_ID:'duckman'
   });
  }
  envs.set(id,env);
  writeFileSync(envFile(id),
   Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 }
 writeSevenOriginProxyPlan({config,lock,outputRoot:proxy});
 writeSixNativeServicePlan({config,lock,sourcesRoot:source,dataRoot:data,
  outputRoot:units});
 return {home,...directories,config,lock,apps,clients,envs,envFile};
}
function audit(f,overrides={}){
 return auditSevenServicePrestart({
  config:f.config,lock:f.lock,sourcesRoot:f.source,dataRoot:f.data,
  proxyOutputRoot:f.proxy,nativeOutputRoot:f.units,...overrides
 });
}
const failed=(result,name)=>result.checks.find(x=>x.name===name)?.ok===false;
test('checks 7 actual pristine Git source fixtures, six envs, exact proxy and six unit artifacts',
 {timeout:120000},t=>{
 const f=fixture(t);
 const report=audit(f);
 assert.deepEqual(report,{
  ok:true,checked:5,checks:[
   {name:'isolated-private-roots',ok:true},
   {name:'seven-exact-source-checkouts',ok:true},
   {name:'six-private-native-env-files',ok:true},
   {name:'exact-seven-origin-proxy-artifacts',ok:true},
   {name:'exact-six-native-unit-artifacts',ok:true}
  ],category:'offline-prestart-source-and-policy-only',
  deploymentAuthorized:false
 });
 assert(!JSON.stringify(report).includes(f.config.SUITE_SETUP_TOKEN));
 for(const c of f.clients.values())
  assert(!JSON.stringify(report).includes(c.secret));
});
test('tampered Caddy contents, routing manifest and unknown extra output fail closed',
 {timeout:120000},t=>{
 const f=fixture(t);
 const dir=join(f.proxy,'seven-origin-proxy-plan');
 const path=join(dir,'Caddyfile.seven-origin-staging');
 const original=readFileSync(path,'utf8');
 writeFileSync(path,original.replace('127.0.0.1:3307','0.0.0.0:3307'));
 assert(failed(audit(f),'exact-seven-origin-proxy-artifacts'));
 writeFileSync(path,original);
 const manifest=join(dir,'routing-manifest.json');
 const saved=readFileSync(manifest,'utf8');
 writeFileSync(manifest,saved.replace('"routeCount": 7','"routeCount": 6'));
 assert(failed(audit(f),'exact-seven-origin-proxy-artifacts'));
 writeFileSync(manifest,saved);
 writeFileSync(join(dir,'unexpected-router'),'not permitted');
 assert(failed(audit(f),'exact-seven-origin-proxy-artifacts'));
});
test('tampered native unit or a different Node executable fails without reading secrets',
 {timeout:120000},t=>{
 const f=fixture(t);
 const unit=join(f.units,'six-native-service-plan',
  'duckbio-native-eel-staging.service');
 const original=readFileSync(unit,'utf8');
 writeFileSync(unit,original.replace('HOST=127.0.0.1','HOST=0.0.0.0'));
 assert(failed(audit(f),'exact-six-native-unit-artifacts'));
 writeFileSync(unit,original);
 assert.equal(audit(f).ok,true);
});
test('stale Git source or changed registered Workspace SHA cannot falsely pass',
 {timeout:120000},t=>{
 const f=fixture(t);
 writeFileSync(join(f.source,'DuckPipe','unreviewed.txt'),'changed');
 assert(failed(audit(f),'seven-exact-source-checkouts'));
 rmSync(join(f.source,'DuckPipe','unreviewed.txt'));
 const changed={...f.config,SUITE_BUILD_SHA:'f'.repeat(40)};
 assert(failed(audit(f,{config:changed}),'reviewed-source-configuration'));
});
test('missing or altered private DuckNote runtime blocks seven-service prestart',
 {timeout:120000},t=>{
 const f=fixture(t),runtime=join(f.data,'eel','runtime');
 assert.equal(audit(f).ok,true);
 const marker=join(runtime,'reset-eel-database.once');
 writeFileSync(marker,'synthetic reset marker',{mode:0o600});
 assert(failed(audit(f),'six-private-native-env-files'));
 rmSync(marker);
 rmSync(runtime,{recursive:true});
 assert(failed(audit(f),'six-private-native-env-files'));
});
test('wrong per-app secret and unsafe native DB location fail before reading plans',
 {timeout:120000},t=>{
 const f=fixture(t);
 const env=f.envs.get('goflo');
 env.DUCKBIO_WORKSPACE_CLIENT_SECRET=f.clients.get('eel').secret;
 writeFileSync(f.envFile('goflo'),
  Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n');
 assert(failed(audit(f),'six-private-native-env-files'));
 const str=JSON.stringify(audit(f));
 assert(!str.includes(f.clients.get('eel').secret));
});
test('rejects overlapping private outputs and unsafe source roots', {timeout:120000},t=>{
 const f=fixture(t);
 assert(failed(audit(f,{proxyOutputRoot:f.data}),'isolated-private-roots'));
 assert(failed(audit(f,{nativeOutputRoot:f.source}),'isolated-private-roots'));
});
test('CLI refuses no acknowledgement and never prints private arguments',
 {timeout:120000},t=>{
 const f=fixture(t),path=fileURLToPath(new URL('../staging-seven-prestart-gate.mjs',import.meta.url));
 const cfg=join(f.central,'workspace-staging.json');
 writeFileSync(cfg,JSON.stringify(f.config),{mode:0o600});
 const args=[path,'--config',cfg,'--sources-root',f.source,
  '--private-data-root',f.data,'--proxy-plan-root',f.proxy,
  '--native-plan-root',f.units];
 const denied=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});
 assert.equal(denied.status,2);
 const actual=spawnSync(process.execPath,
  [...args,'--confirm-offline-prestart-only'],{encoding:'utf8',timeout:10000});
 // The executable CLI intentionally loads the actual reviewed QA lock,
 // not the disposable seven-repository synthetic lock used in this test.
 assert.equal(actual.status,1);
 assert.match(actual.stderr,/reviewed-source-configuration/);
 for(const string of [f.home,cfg,f.config.SUITE_SETUP_TOKEN,
  ...Array.from(f.clients.values()).map(x=>x.secret)])
  assert(!(denied.stdout+denied.stderr+actual.stdout+actual.stderr).includes(string));
});
