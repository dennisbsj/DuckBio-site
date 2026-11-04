import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,
 writeFileSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {auditSixRealNativeMtlsFiles,NATIVE_MTLS_FILES}
 from '../six-native-mtls-sidecar-source-gate.mjs';
import {validateSixNativeStagingSnapshot}
 from '../staging-six-native-snapshot.mjs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-ownership-mtls-compat-lock.json',import.meta.url),'utf8'));
const previous=JSON.parse(readFileSync(new URL(
 '../six-native-post-pkce-compat-lock.json',import.meta.url),'utf8'));

function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'duckbio-mtls-sidecar-source-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const rows=[lock.central,...lock.apps];
 const byRepo=new Map(rows.map(x=>[x.repo.split('/')[1],x]));
 const sidecarByRepo=new Map(NATIVE_MTLS_FILES.map(x=>[x.repo,x]));
 for(const row of rows){
  const name=row.repo.split('/')[1];
  mkdirSync(join(root,name),{mode:0o700});
 }
 for(const sidecar of NATIVE_MTLS_FILES){
  const path=join(root,sidecar.repo,sidecar.path);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  writeFileSync(path,'// unexecuted synthetic native sidecar fixture\n',{
   mode:0o600});
 }
 const overrides={};
 const git=(bin,args,options)=>{
  assert.equal(bin,'git');
  assert.deepEqual(args.slice(0,2),['-c','core.fsmonitor=false']);
  const action=args.slice(2),row=byRepo.get(options.cwd.split('/').pop());
  assert(row,'unexpected checkout');
  const cmd=action.join(' ');
  if(cmd==='rev-parse --show-toplevel')return options.cwd+'\n';
  if(cmd==='remote get-url origin')return 'https://github.com/'+row.repo+'.git\n';
  if(cmd==='rev-parse --verify HEAD')return (
   overrides.wrongHead===row.id?'f'.repeat(40):row.sha)+'\n';
  if(cmd==='status --porcelain --untracked-files=normal')
   return overrides.dirty===row.id?' M server/workspace-native-ownership-https.cjs\n':'';
  if(action[0]==='show'&&action[1]==='HEAD:'+row.workflow)
   return 'steps:\n  - uses: actions/checkout@v4\n'+
    '    with:\n      repository: dennisbsj/DuckBio-site\n'+
    '      ref: '+lock.central.sha+'\n';
  if(action[0]==='ls-tree'&&action[1]==='HEAD'&&action[2]==='--'){
   const sidecar=sidecarByRepo.get(row.repo.split('/')[1]);
   assert.equal(action[3],sidecar.path);
   const blob=overrides.badBlob===row.id?'f'.repeat(40):sidecar.blob;
   const mode=overrides.badMode===row.id?'120000':'100644';
   return mode+' blob '+blob+'\t'+sidecar.path+'\n';
  }
  throw Error('unexpected synthetic Git command '+cmd);
 };
 return {root,git,overrides};
}

test('exact mTLS contract source inventory matches six distinct native apps',()=>{
 assert.equal(validateSixNativeStagingSnapshot(lock).kind,'ownership-mtls');
 assert.equal(NATIVE_MTLS_FILES.length,6);
 assert.deepEqual(NATIVE_MTLS_FILES.map(x=>x.id),
  ['goflo','eel','methpipe','mantrain','duckman','limsman']);
 assert.equal(new Set(NATIVE_MTLS_FILES.map(x=>x.blob)).size,6);
 assert.equal(NATIVE_MTLS_FILES[1].path.endsWith('.js'),true);
 assert(NATIVE_MTLS_FILES.filter(x=>x.path.endsWith('.cjs')).length===5);
 for(let i=0;i<6;i++)
  assert.equal(lock.apps[i].repo,'dennisbsj/'+NATIVE_MTLS_FILES[i].repo);
});

test('exact reviewed six private sidecar blobs pass only source-level gate',t=>{
 const f=fixture(t),result=auditSixRealNativeMtlsFiles({
  lock,sourcesRoot:f.root,runGit:f.git
 });
 assert.deepEqual(result,{
  ok:true,verified:6,errors:[],deploymentAuthorized:false,
  category:'six-exact-native-mtls-source-blobs-only'
 });
});

test('previous snapshot, arbitrary revision and added seventh native app fail closed',t=>{
 const f=fixture(t);
 assert.deepEqual(auditSixRealNativeMtlsFiles({
  lock:previous,sourcesRoot:f.root,runGit:f.git
 }).errors,['unreviewed_ownership_mtls_snapshot']);
 for(const change of [
  b=>b.apps[0].sha='f'.repeat(40),
  b=>b.apps[1].runId++,
  b=>b.apps[2].id='dataduck',
  b=>b.apps.push({...b.apps[3],id:'dataduck'})
 ]){
  const tampered=structuredClone(lock);change(tampered);
  assert.equal(auditSixRealNativeMtlsFiles({
   lock:tampered,sourcesRoot:f.root,runGit:f.git
  }).ok,false);
 }
});

test('incorrect mTLS Git blob, symlink mode and changed checkout are rejected',t=>{
 const f=fixture(t);
 for(const change of [{key:'badBlob',id:'goflo'},
  {key:'badMode',id:'eel'},
  {key:'wrongHead',id:'methpipe'},
  {key:'dirty',id:'duckman'}]){
  f.overrides[change.key]=change.id;
  const result=auditSixRealNativeMtlsFiles({
   lock,sourcesRoot:f.root,runGit:f.git
  });
  assert.equal(result.ok,false,change.key);
  assert.equal(result.deploymentAuthorized,false);
  delete f.overrides[change.key];
 }
});

test('missing, symlinked and extra source objects fail closed',t=>{
 const f=fixture(t);
 const row=NATIVE_MTLS_FILES[3];
 const path=join(f.root,row.repo,row.path);
 rmSync(path);
 symlinkSync(join(f.root,'DuckNote','server'),path);
 const link=auditSixRealNativeMtlsFiles({lock,sourcesRoot:f.root,runGit:f.git});
 assert.equal(link.ok,false);
 assert.deepEqual(link.errors,['unverified_native_mtls_file_mantrain']);
 rmSync(path);
 writeFileSync(path,'synthetic replacement',{mode:0o600});
 mkdirSync(join(f.root,'DataDuck'),{mode:0o700});
 const extra=auditSixRealNativeMtlsFiles({lock,sourcesRoot:f.root,runGit:f.git});
 assert.equal(extra.ok,false);
 assert.deepEqual(extra.errors,['seven_source_prerequisite_unverified']);
});

test('CLI requires explicit offline-only acknowledgement and verified private checkouts',()=>{
 const script=fileURLToPath(new URL(
  '../six-native-mtls-sidecar-source-gate.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[script,...args],{
  encoding:'utf8',timeout:10000,env:{...process.env,DUCKBIO_QA_READ_TOKEN:''}
 });
 for(const flags of [[],['--sources-root','/missing'],
  ['--sources-root','/missing','--confirm-offline']]){
  const result=run(flags);
  assert.equal(result.status,2);
 }
 const absent=run(['--sources-root',
  '/path/that/does/not/exist/seven-review-checkouts',
  '--confirm-offline-mtls-sources-only']);
 assert.equal(absent.status,1);
 assert.match(absent.stderr,/FAIL/);
 assert.doesNotMatch(absent.stderr,/Bearer|secret|PRIVATE_SEVEN_GIT_CHECKOUTS/);
});
