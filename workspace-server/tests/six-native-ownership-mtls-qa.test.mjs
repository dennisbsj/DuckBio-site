import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from '../staging-six-native-snapshot.mjs';
import {validateOwnershipMtlsEvidence}
 from '../six-native-ownership-mtls-qa.mjs';
const read=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const older=read('six-native-post-pkce-compat-lock.json');
const candidate=read('six-native-ownership-mtls-compat-lock.json');
const current=read('six-native-current-compat-lock.json');
const historical=read('six-app-source-qa-lock.json');
const docs=readFileSync(new URL('../SIX_NATIVE_OWNERSHIP_MTLS_QA.md',import.meta.url),'utf8');

test('four independently approved source snapshots are distinct',()=>{
 assert.equal(validateSixNativeStagingSnapshot(historical).kind,'historical');
 assert.equal(validateSixNativeStagingSnapshot(current).kind,'current');
 assert.equal(validateSixNativeStagingSnapshot(older).kind,'post-pkce');
 assert.equal(validateSixNativeStagingSnapshot(candidate).kind,'ownership-mtls');
 assert.equal(stagingSnapshotFile(),'six-app-source-qa-lock.json');
 assert.equal(stagingSnapshotFile('current'),'six-native-current-compat-lock.json');
 assert.equal(stagingSnapshotFile('post-pkce'),'six-native-post-pkce-compat-lock.json');
 assert.equal(stagingSnapshotFile('ownership-mtls'),'six-native-ownership-mtls-compat-lock.json');
 for(const bad of ['latest','main','DataDuck','ownership_mtls',null])
  assert.throws(()=>stagingSnapshotFile(bad),/unsupported_staging_snapshot/);
});

test('all six newer native main versions have distinct verified CI with fixed central broker',()=>{
 assert.deepEqual(validateOwnershipMtlsEvidence(older,candidate,docs),
  {ok:true,issues:[]});
 assert.equal(candidate.apps.length,6);
 assert.deepEqual(candidate.apps.map(x=>x.id),
  ['goflo','eel','methpipe','mantrain','duckman','limsman']);
 assert.deepEqual(candidate.apps.map(x=>x.runId),
  [41823086283,41825543890,41825060709,
   41825092520,41825150001,41825121913]);
 for(const row of candidate.apps){
  assert.match(docs,new RegExp(row.sha));
  assert.match(docs,new RegExp('/actions/runs/'+row.runId));
  assert.notEqual(row.sha,older.apps.find(x=>x.id===row.id).sha);
 }
});

test('changed SHA, run, workflow ID, central pin or unexpected seventh app fail closed',()=>{
 const mutations=[
  lock=>lock.apps[0].sha='f'.repeat(40),
  lock=>lock.apps[1].runId++,
  lock=>lock.apps[2].workflowId++,
  lock=>lock.apps[3].workflow='.github/workflows/fake.yml',
  lock=>lock.apps[4].id='dataduck',
  lock=>lock.apps.push({...lock.apps[0],id:'dataduck'}),
  lock=>lock.central.sha='f'.repeat(40),
  lock=>lock.central.runId++,
  lock=>lock.central.workflowId++
 ];
 for(const mutation of mutations){
  const tampered=structuredClone(candidate);mutation(tampered);
  assert.equal(validateSixNativeStagingSnapshot(tampered).ok,false);
  assert.equal(validateOwnershipMtlsEvidence(older,tampered,docs).ok,false);
 }
});

test('old snapshot, edited previous baseline, and removed documentation cannot masquerade as new QA',()=>{
 assert.equal(validateOwnershipMtlsEvidence(older,older,docs).ok,false);
 assert.equal(validateOwnershipMtlsEvidence(current,candidate,docs).ok,false);
 assert.equal(validateOwnershipMtlsEvidence(older,candidate,'').ok,false);
 assert.equal(validateOwnershipMtlsEvidence(older,candidate,
  docs.replace(candidate.apps[2].sha,'removed-sha')).ok,false);
 const changed=structuredClone(older);changed.apps[0].sha='0'.repeat(40);
 assert.equal(validateOwnershipMtlsEvidence(changed,candidate,docs).ok,false);
});

test('new QA CLI is explicit offline by default, and never reads a network token',()=>{
 const script=fileURLToPath(new URL('../six-native-ownership-mtls-qa.mjs',import.meta.url));
 const good=spawnSync(process.execPath,[script,'--offline'],{
  encoding:'utf8',timeout:10000,env:{...process.env,DUCKBIO_QA_READ_TOKEN:''}
 });
 assert.equal(good.status,0,good.stderr);
 assert.match(good.stdout,/PASS/);
 assert.match(good.stdout,/SOURCE-ONLY/);
 for(const flags of [[],['--untrusted'],['--offline','--remote']]){
  const invalid=spawnSync(process.execPath,[script,...flags],{
   encoding:'utf8',timeout:10000
  });
  assert.equal(invalid.status,2);
 }
 assert.doesNotMatch(good.stdout,/Bearer|private token|secret/i);
});
