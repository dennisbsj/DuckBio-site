import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EIGHT_SERVICE_SLOTS} from '../staging-eight-origin-candidate.mjs';
import {auditEightLocalSources} from '../staging-eight-source-gate.mjs';

const run=(directory,...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
function fixture(t){
 const scratch=mkdtempSync(join(tmpdir(),'duckbio-eight-checkouts-'));
 const root=join(scratch,'sources');mkdirSync(root);
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const entries=[];
 for(const slot of EIGHT_SERVICE_SLOTS){
  const location=join(root,slot.repo.split('/')[1]);
  mkdirSync(location);
  run(location,'-c','init.defaultBranch=main','init','-q');
  run(location,'config','user.name','Synthetic QA');
  run(location,'config','user.email','synthetic@example.test');
  writeFileSync(join(location,'sample.txt'),slot.id+'\n');
  run(location,'add','sample.txt');
  run(location,'commit','-qm','Synthetic source, no deployment');
  run(location,'remote','add','origin','https://github.com/'+slot.repo+'.git');
  const sha=run(location,'rev-parse','HEAD');
  const origin='https://staging-'+slot.id+'.duckbio.net';
  entries.push({id:slot.id,repo:slot.repo,sha,origin,
   callbackUri:slot.id==='workspace'?null:origin+'/auth/callback',
   sourceStatus:['workspace','dataduck'].includes(slot.id)?'draft':'merged-main'});
 }
 return {scratch,root,sourcesRoot:root,entries,stagingDomain:'duckbio.net',
  source:name=>join(root,name)};
}
test('all eight real pristine repositories match exact origins, remotes, revisions and proposed source tuples',t=>{
 const f=fixture(t);const result=auditEightLocalSources(f);
 assert.equal(result.ok,true);assert.equal(result.verified,8);
 for(const field of ['stagingAuthorized','productionAuthorized','licensesGranted',
  'liveSeatsVerified','eightOriginHttpsVerified','currentMainIndependentlyVerified'])
  assert.equal(result[field],false,field);
});
test('missing DataDuck, extra directory, or checkout symlink must deny',t=>{
 const f=fixture(t);
 mkdirSync(join(f.root,'unexpected'));
 assert.equal(auditEightLocalSources(f).ok,false);
 rmSync(join(f.root,'unexpected'),{recursive:true});
 rmSync(f.source('DataDuck'),{recursive:true});
 assert.equal(auditEightLocalSources(f).ok,false);
 symlinkSync(f.source('LabDuck'),f.source('DataDuck'),'dir');
 const result=auditEightLocalSources(f);
 assert.equal(result.ok,false);assert(result.errors.includes('unverified_dataduck_source'));
});
test('wrong remote, dirty content, moved HEAD are all rejected',t=>{
 const f=fixture(t);
 const target=f.source('DuckNote');
 run(target,'remote','set-url','origin','https://github.com/other/wrong.git');
 assert(auditEightLocalSources(f).errors.includes('unverified_eel_source'));
 run(target,'remote','set-url','origin','https://github.com/dennisbsj/DuckNote.git');
 writeFileSync(join(target,'sample.txt'),'tampered\n');
 assert(auditEightLocalSources(f).errors.includes('unverified_eel_source'));
 run(target,'add','sample.txt');run(target,'commit','-qm','Different source');
 assert(auditEightLocalSources(f).errors.includes('unverified_eel_source'));
});
test('malformed source inventory and fake source status never grants anything',t=>{
 const f=fixture(t);
 for(const bad of [
  f.entries.slice(0,7),
  [...f.entries.slice(0,7),{...f.entries[7],repo:'dennisbsj/CytoDuck'}],
  f.entries.map((x,i)=>i===7?{...x,sourceStatus:'active'}:x)
 ]){
  const report=auditEightLocalSources({...f,entries:bad});
  assert.equal(report.ok,false);assert.equal(report.productionAuthorized,false);
 }
 assert.equal(auditEightLocalSources({...f,sourcesRoot:'relative'}).ok,false);
});

test('inherited Git environment cannot redirect the checked repository',t=>{
 const f=fixture(t);
 const original=process.env.GIT_DIR;
 process.env.GIT_DIR=join(f.source('DuckMan'),'.git');
 try{
  const runGit=(command,args,options)=>{
   assert.equal(options.env.GIT_DIR,undefined);
   return execFileSync(command,args,options);
  };
  const result=auditEightLocalSources({...f,runGit});
  assert.equal(result.ok,true);
  assert.equal(result.verified,8);
 }finally{
  if(original===undefined)delete process.env.GIT_DIR;
  else process.env.GIT_DIR=original;
 }
});

test('tracked symlink stays disallowed even when git status is clean',t=>{
 const f=fixture(t);
 const location=f.source('DuckPipe');
 symlinkSync('sample.txt',join(location,'outside-linked-source'));
 run(location,'add','outside-linked-source');
 run(location,'commit','-qm','Synthetic tracked symlink fixture');
 assert.equal(run(location,'status','--porcelain','--untracked-files=all'),'',
  'tracked symlink looks clean to plain git status');
 assert.match(run(location,'ls-files','--stage'),/^120000 .*outside-linked-source$/m);
 const audit=auditEightLocalSources({...f,
  entries:f.entries.map(e=>e.id==='methpipe'?{
   ...e,sha:run(location,'rev-parse','HEAD')
  }:e)});
 assert.equal(audit.ok,false);
 assert(audit.errors.includes('unverified_methpipe_source'));
 assert.equal(audit.productionAuthorized,false);
});

test('ignored local source files cannot silently pass as a clean physical checkout',t=>{
 const f=fixture(t);
 const location=f.source('DuckNote');
 writeFileSync(join(location,'.gitignore'),'ignored-runtime.mjs\n');
 run(location,'add','.gitignore');
 run(location,'commit','-qm','Track ignore definition');
 writeFileSync(join(location,'ignored-runtime.mjs'),
  'export const secretlyInjected = true;\n');
 assert.equal(run(location,'status','--porcelain','--untracked-files=all'),'',
  'ordinary git status does not report ignored executable source');
 const audit=auditEightLocalSources({...f,
  entries:f.entries.map(e=>e.id==='eel'?{...e,
    sha:run(location,'rev-parse','HEAD')
  }:e)});
 assert.equal(audit.ok,false);
 assert(audit.errors.includes('unverified_eel_source'));
 assert.equal(audit.stagingAuthorized,false);
});

test('external Git metadata through a gitfile must not count as isolated source repository',t=>{
 const f=fixture(t);
 const location=f.source('DuckMan');
 renameSync(join(location,'.git'),join(location,'metadata'));
 writeFileSync(join(location,'.git'),'gitdir: metadata\n');
 assert.equal(run(location,'rev-parse','--show-toplevel'),location,
  'git can still report the same working-tree directory with external metadata');
 const report=auditEightLocalSources(f);
 assert.equal(report.ok,false);
 assert(report.errors.includes('unverified_duckman_source'));
});

test('a tracked gitlink/submodule cannot masquerade as ordinary reviewed source',t=>{
 const f=fixture(t);
 const location=f.source('LabDuck');
 const sha=run(location,'rev-parse','HEAD');
 run(location,'update-index','--add','--cacheinfo',
  '160000,'+sha+',unreviewed-native-submodule');
 const result=auditEightLocalSources(f);
 assert.equal(result.ok,false);
 assert(result.errors.includes('unverified_limsman_source'));
 assert.equal(result.nativeAuthorizationVerified,false);
});
