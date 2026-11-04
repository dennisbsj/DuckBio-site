import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from '../staging-six-native-snapshot.mjs';
import {validatePostPkceEvidence}
 from '../six-native-post-pkce-qa.mjs';

const read=name=>JSON.parse(readFileSync(
 new URL('../'+name,import.meta.url),'utf8'));
const old=read('six-native-current-compat-lock.json');
const newLock=read('six-native-post-pkce-compat-lock.json');
const historical=read('six-app-source-qa-lock.json');
const docs=readFileSync(new URL(
 '../SIX_NATIVE_POST_PKCE_QA.md',import.meta.url),'utf8');

test('three independent exact reviewed snapshots remain reproducible',()=>{
 assert.equal(validateSixNativeStagingSnapshot(historical).kind,'historical');
 assert.equal(validateSixNativeStagingSnapshot(old).kind,'current');
 assert.equal(validateSixNativeStagingSnapshot(newLock).kind,'post-pkce');
 assert.equal(stagingSnapshotFile(),'six-app-source-qa-lock.json');
 assert.equal(stagingSnapshotFile('current'),'six-native-current-compat-lock.json');
 assert.equal(stagingSnapshotFile('post-pkce'),'six-native-post-pkce-compat-lock.json');
 for(const invalid of ['latest','main','postpkce','DataDuck',null])
  assert.throws(()=>stagingSnapshotFile(invalid),/unsupported_staging_snapshot/);
});
test('post-PKCE source CI evidences are exactly three newly merged-main fixes',()=>{
 assert.deepEqual(validatePostPkceEvidence(old,newLock,docs),
  {ok:true,issues:[]});
 const changed=newLock.apps.filter((x,i)=>x.sha!==old.apps[i].sha);
 assert.deepEqual(changed.map(x=>x.id),['goflo','methpipe','mantrain']);
 assert.deepEqual(changed.map(x=>x.runId),
  [41786859215,41786886411,41786905381]);
 for(const x of [...newLock.apps,newLock.central])
  assert.match(docs,/main|merged-main/);
});
test('changing app SHA or workflow run even with updated documentation cannot promote code',()=>{
 for(const edit of [
  x=>x.apps[0].sha='f'.repeat(40),
  x=>x.apps[2].runId+=1,
  x=>x.apps[3].workflowId+=1,
  x=>x.apps[4].sha='a'.repeat(40),
  x=>x.apps.push({...x.apps[0],id:'dataduck'}),
  x=>x.central.runId+=1,
  x=>x.central.sha='f'.repeat(40)
 ]){
  const tampered=structuredClone(newLock);edit(tampered);
  assert.equal(validateSixNativeStagingSnapshot(tampered).ok,false);
  assert.equal(validatePostPkceEvidence(old,tampered,docs).ok,false);
 }
});
test('rejects old current lock substituted as post-PKCE, and wrong prior current baseline',()=>{
 assert.equal(validatePostPkceEvidence(old,old,docs).ok,false);
 assert.equal(validatePostPkceEvidence(historical,newLock,docs).ok,false);
});
test('rejects undocumented source evidence, old SHA and edited unchanged app records',()=>{
 assert.equal(validatePostPkceEvidence(old,newLock,'').ok,false);
 assert.equal(validatePostPkceEvidence(old,newLock,docs.replace(
  newLock.apps[0].sha,'redacted-sha')).ok,false);
 const fake=structuredClone(old);fake.apps[4].runId+=1;
 assert.equal(validatePostPkceEvidence(fake,newLock,docs).ok,false);
});
test('offline command accepts exact immutable source set only, no network or private credentials',()=>{
 const path=fileURLToPath(new URL('../six-native-post-pkce-qa.mjs',import.meta.url));
 const good=spawnSync(process.execPath,[path,'--offline'],{
  encoding:'utf8',timeout:10000,env:{...process.env,DUCKBIO_QA_READ_TOKEN:''}
 });
 assert.equal(good.status,0,good.stderr);
 assert.match(good.stdout,/PASS/);
 const missing=spawnSync(process.execPath,[path],{
  encoding:'utf8',timeout:10000});
 assert.equal(missing.status,2);
 assert.doesNotMatch(good.stdout,/Bearer|private token|secret/i);
});
