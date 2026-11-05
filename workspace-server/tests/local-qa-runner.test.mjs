import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {parseLocalQaArgs,browserFiles,summarizeQaStage,validQaNodeVersion,ordinaryTrackedGitIndex,regularTrackedGitModes,runLocalWorkspaceQa} from '../scripts/local-qa.mjs';

const SHA='a'.repeat(40);
const ok=stdout=>({ok:true,exitCode:0,stdout:stdout??'',stderr:'',error:null});
const fail=()=>({ok:false,exitCode:1,stdout:'',stderr:'fail',error:null});
function fake({dirty='',failName=null,playwright=true,
 endHead=SHA,endDirty=dirty,wrongRoot=false,endWrongRoot=false,
 initialIndex='H package.json\0',endIndex=initialIndex,
 initialModes='100644 '+SHA+' 0\tpackage.json\0',endModes=initialModes}={}){
 const calls=[];
 let headReads=0,statusReads=0,indexReads=0,modeReads=0;
 let rootReads=0;
 const execute=(command,args,options={})=>{
  calls.push([command,...args]);
  if(command==='git'&&args[0]==='rev-parse'&&args[1]==='--show-toplevel'){
   const wrong=rootReads++===0?wrongRoot:endWrongRoot;
   return ok((wrong?join(dirname(options.cwd||'/tmp/workspace-server'),'unrelated'):
    dirname(options.cwd||'/tmp/workspace-server'))+'\n');
  }
  if(command==='git'&&args[0]==='rev-parse')
   return ok((headReads++===0?SHA:endHead)+'\n');
  if(command==='git'&&args[0]==='status')
   return ok(statusReads++===0?dirty:endDirty);
  if(command==='git'&&args[0]==='ls-files'&&args.includes('--stage'))
   return ok(modeReads++===0?initialModes:endModes);
  if(command==='git'&&args[0]==='ls-files')
   return ok(indexReads++===0?initialIndex:endIndex);
  if(args[0]==='--input-type=module')return playwright?ok():fail();
  if(args.includes('run')&&args.includes('check'))return failName==='syntax'?fail():ok();
  if(args.includes('test')||args[0]==='--test')return failName==='core'?fail():ok();
  return fail();
 };
 return {calls,execute};
}
test('flag parsing rejects unknown arguments and preserves opt-in browser behavior',()=>{
 assert.deepEqual(parseLocalQaArgs([]),{browser:false,json:false,allowDirty:false,help:false,expectHead:null});
 assert.equal(parseLocalQaArgs(['--browser']).browser,true);
 assert.throws(()=>parseLocalQaArgs(['--deploy']),/unknown_argument/);
});
test('runner refuses uncommitted changes rather than reporting exact-head success',()=>{
 const f=fake({dirty:' M workspace.js\n'});
 const r=runLocalWorkspaceQa([],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,2);assert.equal(r.report.exactHead,false);
 assert.equal(f.calls.filter(x=>x[0]!=='git').length,0);
});
test('all stages must pass; a failure cannot be reported as success',()=>{
 const f=fake({failName:'core'});
 const r=runLocalWorkspaceQa(['--json'],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,1);assert.equal(r.report.outcome,'failed');
 assert.deepEqual(r.report.stages.map(x=>x.status),['passed','failed']);
});
test('runner declares exact HEAD only on clean source and completed checks',()=>{
 const f=fake();const r=runLocalWorkspaceQa([],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,0);assert.equal(r.report.sha,SHA);
 assert.equal(r.report.outcome,'passed');assert.equal(r.report.exactHead,true);
});
test('browser requests are blocked explicitly when Playwright is absent',()=>{
 const f=fake({playwright:false});
 const r=runLocalWorkspaceQa(['--browser'],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,2);assert.equal(r.report.outcome,'blocked');
 assert.equal(r.report.stages.find(x=>x.name==='browser').status,'blocked');
});
test('dirty override runs tests but never returns release-grade green',()=>{
 const f=fake({dirty:' M source.mjs\n'});
 const r=runLocalWorkspaceQa(['--allow-dirty'],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,2);assert.equal(r.report.exactHead,false);
 assert.deepEqual(r.report.stages.map(x=>x.status),['passed','passed']);
});
test('browser file selection uses exact test files with stable order',()=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-qa-files-'));
 try{
  writeFileSync(join(dir,'b.test.mjs'),'');
  writeFileSync(join(dir,'a.test.mjs'),'');
  writeFileSync(join(dir,'random.mjs'),'');
  assert.deepEqual(browserFiles(dir),['a.test.mjs','b.test.mjs'].map(x=>join(dir,x)));
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.equal(summarizeQaStage('syntax',ok(),1).status,'passed');
});

test('QA restricts release-grade proof to Node 22.16+ or Node 24',()=>{
 assert.equal(validQaNodeVersion('22.16.0'),true);
 assert.equal(validQaNodeVersion('22.15.9'),false);
 assert.equal(validQaNodeVersion('24.1.0'),true);
 assert.equal(validQaNodeVersion('23.7.0'),false);
 const f=fake();
 const r=runLocalWorkspaceQa([],{execute:f.execute,log:()=>{},nodeVersion:'22.15.0'});
 assert.equal(r.exitCode,2);
 assert.equal(r.report.outcome,'blocked');
 assert.equal(f.calls.filter(x=>x[0]!=='git').length,0);
});

test('pinned exact SHA mismatches block before executing any code checks',()=>{
 const f=fake();
 const other='b'.repeat(40);
 assert.equal(parseLocalQaArgs(['--expect-head='+SHA]).expectHead,SHA);
 assert.throws(()=>parseLocalQaArgs(['--expect-head=nope']),/unknown_argument/);
 assert.throws(()=>parseLocalQaArgs(['--expect-head='+SHA,'--expect-head='+SHA]),/unknown_argument/);
 const r=runLocalWorkspaceQa(['--expect-head='+other],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,2);assert.equal(r.report.expectedHead,other);
 assert.equal(f.calls.filter(x=>x[0]!=='git').length,0);
});


test('a different Git HEAD after test stages cannot be reported as exact-head PASS',()=>{
 const other='b'.repeat(40);
 const f=fake({endHead:other});
 const r=runLocalWorkspaceQa(['--expect-head='+SHA],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,1);
 assert.equal(r.report.outcome,'failed');
 assert.equal(r.report.exactHead,false);
 assert.equal(r.report.sha,SHA,'never overwrite original expected source revision');
 assert.deepEqual(r.report.stages.map(x=>[x.name,x.status]),[
  ['syntax','passed'],['core','passed'],['git-head-integrity','failed']
 ]);
 assert.equal(f.calls.filter(x=>x[0]==='git'&&x[1]==='rev-parse'&&x[2]==='--verify').length,2);
});

test('new working-tree changes during tests fail despite a stable Git HEAD',()=>{
 const f=fake({endDirty:' M organization-store.mjs\n'});
 const r=runLocalWorkspaceQa([],{execute:f.execute,log:()=>{}});
 assert.equal(r.exitCode,1);
 assert.equal(r.report.outcome,'failed');
 assert.equal(r.report.exactHead,false);
 assert.equal(r.report.stages.at(-1).name,'working-tree-integrity');
});

test('a failed final Git HEAD query fails closed even if all test stages pass',()=>{
 const f=fake();
 const original=f.execute;
 let calls=0;
 const execute=(cmd,args,options)=>{
  if(cmd==='git'&&args[0]==='rev-parse'&&args[1]==='--verify'&&calls++>0)return fail();
  return original(cmd,args,options);
 };
 const r=runLocalWorkspaceQa(['--json'],{execute,log:()=>{}});
 assert.equal(r.exitCode,1);
 assert.equal(r.report.exactHead,false);
 assert.equal(r.report.stages.at(-1).name,'git-head-integrity');
});


test('real local QA ignores inherited GIT_DIR and GIT_WORK_TREE overrides',t=>{
 const scratch=mkdtempSync(join(tmpdir(),'duckbio-qa-env-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const first=join(scratch,'primary'),second=join(scratch,'unrelated');
 const git=(where,...args)=>execFileSync('git',args,{
  cwd:where,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 for(const where of [first,second]){
  mkdirSync(where);
  git(where,'init','-q');
  const localPackage=where===first?join(where,'workspace-server'):where;
  if(where===first)mkdirSync(localPackage);
  writeFileSync(join(localPackage,'package.json'),JSON.stringify({
   name:where===first?'isolated-workspace':'other-repository',
   private:true,scripts:{check:'node -e "process.exit(0)"',
    test:'node -e "process.exit(0)"'}
  })+'\n');
  git(where,'add',where===first?'workspace-server/package.json':'package.json');
  git(where,'-c','user.name=Private QA','-c','user.email=private@example.test',
   'commit','-qm','Isolated QA local source fixture');
 }
 const expected=git(first,'rev-parse','HEAD');
 const other=git(second,'rev-parse','HEAD');
 assert.notEqual(expected,other,'independently committed fixtures have different trees');
 const savedDir=process.env.GIT_DIR,savedWorkTree=process.env.GIT_WORK_TREE;
 process.env.GIT_DIR=join(second,'.git');
 process.env.GIT_WORK_TREE=second;
 try{
  const result=runLocalWorkspaceQa(['--expect-head='+expected],{
   cwd:join(first,'workspace-server'),log:()=>{},nodeVersion:'22.16.0'
  });
  assert.equal(result.exitCode,0,JSON.stringify(result.report));
  assert.equal(result.report.sha,expected);
  assert.equal(result.report.exactHead,true);
  assert.equal(result.report.outcome,'passed');
 }finally{
  if(savedDir===undefined)delete process.env.GIT_DIR;
  else process.env.GIT_DIR=savedDir;
  if(savedWorkTree===undefined)delete process.env.GIT_WORK_TREE;
  else process.env.GIT_WORK_TREE=savedWorkTree;
 }
});

test('a nested Git repository or noncanonical package directory cannot establish Workspace exact HEAD',()=>{
 for(const bad of [
  fake({wrongRoot:true}),
  fake({endWrongRoot:true})
 ]){
  const result=runLocalWorkspaceQa([],{
   cwd:'/tmp/workspace-server',execute:bad.execute,log:()=>{}
  });
  assert.notEqual(result.exitCode,0);
  assert.equal(result.report.exactHead,false);
 }
 const f=fake();
 const result=runLocalWorkspaceQa([],{cwd:'/tmp/not-workspace',execute:f.execute,log:()=>{}});
 assert.equal(result.exitCode,2);
 assert.equal(result.report.exactHead,false);
});

test('real nested Git checkout cannot impersonate the parent Workspace repository',t=>{
 const scratch=mkdtempSync(join(tmpdir(),'duckbio-qa-nested-root-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const root=join(scratch,'DuckBio-site'),nested=join(root,'workspace-server');
 mkdirSync(root);mkdirSync(nested);
 const git=(cwd,...args)=>execFileSync('git',args,{
  cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 git(root,'init','-q');
 writeFileSync(join(nested,'package.json'),'{"name":"workspace-root-qa","private":true}\n');
 git(root,'add','workspace-server/package.json');
 git(root,'-c','user.name=Private QA','-c','user.email=private@example.test',
  'commit','-qm','Parent Workspace source');
 const parentSha=git(root,'rev-parse','HEAD');
 const valid=runLocalWorkspaceQa(['--expect-head='+parentSha],{
  cwd:nested,nodeVersion:'22.16.0',log:()=>{},
  execute:(command,args,options)=>{
   if(command==='git'){
    const stdout=execFileSync(command,args,{
     cwd:options.cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    return ok(stdout);
   }
   return ok();
  }
 });
 assert.equal(valid.exitCode,0,'normal parent repository must remain acceptable');
 git(nested,'init','-q');
 git(nested,'add','package.json');
 git(nested,'-c','user.name=Private QA','-c','user.email=private@example.test',
  'commit','-qm','Nested untrusted repository');
 const nestedSha=git(nested,'rev-parse','HEAD');
 const blocked=runLocalWorkspaceQa(['--expect-head='+nestedSha],{
  cwd:nested,nodeVersion:'22.16.0',log:()=>{}
 });
 assert.equal(blocked.exitCode,2);
 assert.equal(blocked.report.exactHead,false);
 assert.equal(blocked.report.outcome,'blocked');
});


test('NUL-delimited tracked Git index requires every entry to be ordinary H',()=>{
 assert.equal(ordinaryTrackedGitIndex('H workspace-server/a.mjs\0H package.json\0'),true);
 for(const entry of [
  'h workspace-server/a.mjs\0', // assume-unchanged
  'S workspace-server/a.mjs\0', // skip-worktree
  's workspace-server/a.mjs\0',
  'M workspace-server/a.mjs\0',
  'H workspace-server/a.mjs', // truncated NUL response
  'H workspace-server/a.mjs\nH package.json\0',
  '',null,undefined
 ])assert.equal(ordinaryTrackedGitIndex(entry),false,String(entry));
});

test('a clean-looking index with hidden tracked source is blocked BEFORE running QA, even with dirty override',()=>{
 for(const marker of ['h','S']){
  const f=fake({initialIndex:marker+' workspace-server/app.mjs\0'});
  const result=runLocalWorkspaceQa(['--allow-dirty'],{execute:f.execute,log:()=>{}});
  assert.equal(result.exitCode,2);
  assert.equal(result.report.exactHead,false);
  assert.equal(f.calls.filter(call=>call[0]!=='git').length,0,
   'QA may not execute a substituted source whose Git status can lie');
 }
});

test('index flags changed DURING tests invalidate an otherwise clean matching SHA',()=>{
 for(const marker of ['h','S']){
  const f=fake({endIndex:marker+' workspace-server/app.mjs\0'});
  const result=runLocalWorkspaceQa(['--expect-head='+SHA],{
   execute:f.execute,log:()=>{}
  });
  assert.equal(result.exitCode,1);
  assert.equal(result.report.exactHead,false);
  assert.equal(result.report.outcome,'failed');
  assert.equal(result.report.stages.at(-1).name,'git-index-integrity');
 }
});

test('real local Git hides modifications with assume-unchanged and skip-worktree but QA denies both',t=>{
 const scratch=mkdtempSync(join(tmpdir(),'duckbio-qa-hidden-index-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const root=join(scratch,'DuckBio-site'),workspace=join(root,'workspace-server');
 mkdirSync(root);mkdirSync(workspace);
 const git=(...args)=>execFileSync('git',args,{
  cwd:workspace,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 execFileSync('git',['init','-q'],{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']
 });
 writeFileSync(join(workspace,'package.json'),'{"name":"isolated"}\n');
 writeFileSync(join(workspace,'app.mjs'),'export const secret="original";\n');
 git('add','.');
 git('-c','user.name=Private QA','-c','user.email=qa@example.test',
  'commit','-qm','Private regression fixture');
 const sha=git('rev-parse','HEAD');
 const source=join(workspace,'app.mjs');
 writeFileSync(source,'export const secret="modified";\n');
 for(const [enable,disable] of [
  ['--assume-unchanged','--no-assume-unchanged'],
  ['--skip-worktree','--no-skip-worktree']
 ]){
  git('update-index',enable,'app.mjs');
  assert.equal(git('status','--porcelain'),'',
   'Git deliberately hides a modified tracked source under '+enable);
  const result=runLocalWorkspaceQa(['--expect-head='+sha],{
   cwd:workspace,nodeVersion:'22.16.0',log:()=>{},
   execute:(command,args,options)=>{
    if(command!=='git')return ok();
    const stdout=execFileSync(command,args,{
     cwd:options.cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    return ok(stdout);
   }
  });
  assert.equal(result.exitCode,2,'must block hidden tracked source flag '+enable);
  assert.equal(result.report.exactHead,false);
  git('update-index',disable,'app.mjs');
 }
 assert.match(git('status','--porcelain'),/app\.mjs/,
  'normal Git status detects modified tracked source after removing hidden flags');
});


test('tracked source mode validator refuses symlinks, submodules and partial index entries',()=>{
 assert.equal(regularTrackedGitModes('100644 '+SHA+' 0\tpackage.json\0'),true);
 assert.equal(regularTrackedGitModes('100755 '+SHA+' 0\tscripts/qa.mjs\0'),true);
 for(const entry of [
  '120000 '+SHA+' 0\tworkspace-server/app.mjs\0',
  '160000 '+SHA+' 0\tworkspace-server/native\0',
  '100644 '+SHA+' 1\tworkspace-server/app.mjs\0',
  '100644 '+SHA+' 0\tworkspace-server/app.mjs',
  '100644 '+SHA+' 0\t\0',
  '100644 '+SHA+' 0\tapp.mjs\n100644 '+SHA+' 0\tother.mjs\0',
  '',null
 ])assert.equal(regularTrackedGitModes(entry),false,String(entry));
});

test('a tracked symlink to external executable source blocks QA even when status and index flags are ordinary',()=>{
 const f=fake({initialModes:'120000 '+SHA+' 0\tpackage.json\0'});
 const result=runLocalWorkspaceQa(['--allow-dirty'],{
  execute:f.execute,log:()=>{}
 });
 assert.equal(result.exitCode,2);
 assert.equal(result.report.exactHead,false);
 assert.equal(f.calls.filter(call=>call[0]!=='git').length,0);
});

test('tracked mode metadata changing during tests invalidates exact-head report',()=>{
 const f=fake({endModes:'120000 '+SHA+' 0\tpackage.json\0'});
 const r=runLocalWorkspaceQa(['--expect-head='+SHA],{
  execute:f.execute,log:()=>{}
 });
 assert.equal(r.exitCode,1);
 assert.equal(r.report.exactHead,false);
 assert.equal(r.report.stages.find(stage=>stage.name==='git-source-mode-integrity').status,'failed');
});

test('real Git tracked symlink remains clean when external JS changes, but QA refuses to execute it',t=>{
 const scratch=mkdtempSync(join(tmpdir(),'duckbio-qa-symlink-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const root=join(scratch,'DuckBio-site'),workspace=join(root,'workspace-server');
 mkdirSync(root);mkdirSync(workspace);
 const external=join(scratch,'external-app.mjs'),symlink=join(workspace,'app.mjs');
 writeFileSync(external,'export const version="original";\n');
 symlinkSync(external,symlink);
 const gitRoot=(...args)=>execFileSync('git',args,{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 gitRoot('init','-q');gitRoot('config','user.name','QA');
 gitRoot('config','user.email','qa@example.test');
 gitRoot('add','workspace-server/app.mjs');gitRoot('commit','-qm','Tracked symlink');
 const sha=gitRoot('rev-parse','HEAD');
 writeFileSync(external,'export const version="changed";\n');
 assert.equal(gitRoot('status','--porcelain'),'',
  'modifying outside symlink target must not alter the tracked Git tree');
 assert.match(gitRoot('ls-files','--stage'),/^120000 /);
 const result=runLocalWorkspaceQa(['--expect-head='+sha],{
  cwd:workspace,nodeVersion:'22.16.0',log:()=>{}
 });
 assert.equal(result.exitCode,2);
 assert.equal(result.report.exactHead,false);
 assert.equal(result.report.stages.length,0);
});
