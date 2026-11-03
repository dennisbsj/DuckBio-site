import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,
 readdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {APPS,validateQaLock} from '../six-app-source-qa-audit.mjs';
import {auditSevenLocalSources} from '../staging-seven-source-gate.mjs';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';

const git=(dir,...args)=>execFileSync('git',args,{
 cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:15000
}).trim();
function repository(root,name,repo,workflow=null,centralSha=''){
 const dir=join(root,name);
 mkdirSync(dir,{mode:0o700});
 git(dir,'init','-q');
 git(dir,'remote','add','origin','https://github.com/'+repo+'.git');
 if(workflow){
  const filename=join(dir,workflow);
  mkdirSync(dirname(filename),{recursive:true});
  writeFileSync(filename,'name: fixture\njobs:\n  test:\n    steps:\n'+
   '      - uses: actions/checkout@v4\n'+
   '        with:\n'+
   '          repository: dennisbsj/DuckBio-site\n'+
   '          ref: '+centralSha+'\n');
 }else writeFileSync(join(dir,'README.md'),'Synthetic test repository only\n');
 git(dir,'add','.');
 git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.test',
  'commit','-qm','Synthetic immutable checkout fixture');
 return {dir,sha:git(dir,'rev-parse','HEAD')};
}
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'duckbio-seven-source-fixture-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const central=repository(root,'DuckBio-site','dennisbsj/DuckBio-site');
 const apps=APPS.map((app,i)=>{
  const source=repository(root,app.name,app.repo,app.workflow,central.sha);
  return {...app,sha:source.sha,runId:200000+i,workflowId:300000+i};
 });
 const lock={
  version:1,scope:'synthetic-source-ci-only',
  central:{repo:'dennisbsj/DuckBio-site',sha:central.sha,
   runId:123456,workflowId:123457},
  apps
 };
 assert.deepEqual(validateQaLock(lock),{ok:true,errors:[]});
 return {root,central,apps,lock};
}
function verify(f,changes={}){
 return auditSevenLocalSources({
  sourcesRoot:f.root,workspaceBuildSha:f.central.sha,
  lock:f.lock,...changes
 });
}

test('checks seven ACTUAL pristine Git directories, remotes, SHAs, and six pinned workflows offline',
 {timeout:60000},t=>{
 const f=fixture(t);
 assert.deepEqual(verify(f),{ok:true,verified:7,errors:[]});
 assert.deepEqual(readdirSync(f.root).sort(),[
  'DuckBio-site',...APPS.map(x=>x.name)].sort());
});

test('a newer central deployment version cannot inherit six old native app test passes',
 {timeout:60000},t=>{
 const f=fixture(t);
 let gitCalls=0;
 const result=verify(f,{
  workspaceBuildSha:'f'.repeat(40),
  runGit:()=>{gitCalls++;throw Error('must not inspect sources');}
 });
 assert.deepEqual(result,{ok:false,verified:0,
  errors:['workspace_version_not_six_app_verified']});
 assert.equal(gitCalls,0);
});

test('rejects dirty checkout, altered Git remote, missing inventory and symlinks',
 {timeout:60000},t=>{
 const f=fixture(t);
 const native=join(f.root,'DuckTrain');
 const untracked=join(native,'unexpected-untracked.txt');
 writeFileSync(untracked,'new local changes');
 assert(verify(f).errors.includes('unverified_mantrain_source_checkout'));
 rmSync(untracked);
 git(native,'remote','set-url','origin','https://github.com/foreign/DuckTrain.git');
 assert(verify(f).errors.includes('unverified_mantrain_source_checkout'));
 git(native,'remote','set-url','origin','https://github.com/dennisbsj/DuckTrain.git');
 assert.deepEqual(verify(f),{ok:true,verified:7,errors:[]});
 const outer=mkdtempSync(join(tmpdir(),'duckbio-seven-removed-'));
 chmodSync(outer,0o700);
 t.after(()=>rmSync(outer,{recursive:true,force:true}));
 const missing=join(f.root,'CytoDuck'),relocated=join(outer,'CytoDuck');
 renameSync(missing,relocated);
 assert.deepEqual(verify(f),{ok:false,verified:0,errors:['unexpected_checkout_inventory']});
 symlinkSync(relocated,missing);
 assert(verify(f).errors.includes('unverified_goflo_source_checkout'));
 rmSync(missing);
 renameSync(relocated,missing);
 mkdirSync(join(f.root,'unapprovedExtra'),{mode:0o700});
 assert.deepEqual(verify(f),{ok:false,verified:0,errors:['unexpected_checkout_inventory']});
});
test('wrong central pin in a CLEAN native commit cannot impersonate an approved source',
 {timeout:60000},t=>{
 const f=fixture(t);
 const target=f.apps.find(x=>x.id==='eel');
 const root=join(f.root,target.name),file=join(root,target.workflow);
 const old=readFileSync(file,'utf8');
 writeFileSync(file,old.replace(f.central.sha,'f'.repeat(40)));
 git(root,'add','.');
 git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.test',
  'commit','-qm','Deliberately wrong immutable central pin');
 const edited=structuredClone(f.lock);
 edited.apps.find(x=>x.id==='eel').sha=git(root,'rev-parse','HEAD');
 assert.deepEqual(validateQaLock(edited),{ok:true,errors:[]});
 const checked=verify(f,{lock:edited});
 assert.equal(checked.ok,false);
 assert(checked.errors.includes('unverified_eel_source_checkout'));
});

test('CLI cannot run without explicit offline confirmation and emits no secret values',
 {timeout:60000},t=>{
 const f=fixture(t);
 const privateRoot=mkdtempSync(join(tmpdir(),'duckbio-seven-private-config-'));
 chmodSync(privateRoot,0o700);
 t.after(()=>rmSync(privateRoot,{recursive:true,force:true}));
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot,buildSha:f.central.sha
 });
 const filename=join(privateRoot,'workspace-staging.json');
 writeFileSync(filename,JSON.stringify(config),{mode:0o600});
 const script=fileURLToPath(new URL('../staging-seven-source-gate.mjs',import.meta.url));
 const partial=spawnSync(process.execPath,[script,'--config',filename,
  '--sources-root',f.root],{encoding:'utf8',timeout:10000});
 assert.equal(partial.status,2);
 assert.equal(partial.stdout,'');
 const denied=spawnSync(process.execPath,[script,'--config',filename,
  '--sources-root',f.root,'--confirm-offline-sources'],{
   encoding:'utf8',timeout:10000
  });
 // The standalone CLI intentionally reads the real reviewed source lock,
 // not this independent synthetic fixture. Therefore the SHA must differ.
 assert.equal(denied.status,1);
 assert.match(denied.stderr,/workspace_version_not_six_app_verified/);
 for(const value of [config.SUITE_SETUP_TOKEN,
  ...JSON.parse(config.SUITE_CLIENTS).map(c=>c.secret)]){
  assert(!denied.stderr.includes(value));
  assert(!denied.stdout.includes(value));
 }
 assert(!denied.stderr.includes(f.root));
 assert(!denied.stderr.includes(filename));
});
