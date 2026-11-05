import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseLocalQaArgs,browserFiles,summarizeQaStage,validQaNodeVersion,runLocalWorkspaceQa} from '../scripts/local-qa.mjs';

const SHA='a'.repeat(40);
const ok=stdout=>({ok:true,exitCode:0,stdout:stdout??'',stderr:'',error:null});
const fail=()=>({ok:false,exitCode:1,stdout:'',stderr:'fail',error:null});
function fake({dirty='',failName=null,playwright=true,
 endHead=SHA,endDirty=dirty}={}){
 const calls=[];
 let headReads=0,statusReads=0;
 const execute=(command,args)=>{
  calls.push([command,...args]);
  if(command==='git'&&args[0]==='rev-parse')
   return ok((headReads++===0?SHA:endHead)+'\n');
  if(command==='git'&&args[0]==='status')
   return ok(statusReads++===0?dirty:endDirty);
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
 assert.equal(f.calls.filter(x=>x[0]==='git'&&x[1]==='rev-parse').length,2);
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
 const execute=(cmd,args)=>{
  if(cmd==='git'&&args[0]==='rev-parse'&&calls++>0)return fail();
  return original(cmd,args);
 };
 const r=runLocalWorkspaceQa(['--json'],{execute,log:()=>{}});
 assert.equal(r.exitCode,1);
 assert.equal(r.report.exactHead,false);
 assert.equal(r.report.stages.at(-1).name,'git-head-integrity');
});
