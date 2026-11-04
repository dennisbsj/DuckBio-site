/** Source-only eight-origin candidate acceptance; NO DNS, TLS, seats or native services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EIGHT_SERVICE_SLOTS,buildEightOriginCandidate}
 from '../staging-eight-origin-candidate.mjs';

const domain='duckbio.net';
const source=(status='merged-main')=>EIGHT_SERVICE_SLOTS.map((slot,i)=>({
 id:slot.id,repo:slot.repo,
 sha:(i+1).toString(16).repeat(40),
 origin:'https://staging-'+slot.id+'.'+domain,
 callbackUri:slot.id==='workspace'?null:
  'https://staging-'+slot.id+'.'+domain+'/auth/callback',
 sourceStatus:slot.id==='dataduck'?'draft':status
}));
const result=(entries=source(),stagingDomain=domain)=>
 buildEightOriginCandidate({stagingDomain,entries});

test('eight distinct staging origin candidates preserve six legacy app IDs and keep DataDuck disabled',()=>{
 const planned=result();
 assert.equal(planned.ok,true);
 assert.equal(planned.serviceCount,8);
 assert.equal(planned.appCount,7);
 assert.deepEqual(planned.entries.map(x=>x.id),[
  'workspace','goflo','eel','methpipe','mantrain','duckman',
  'limsman','dataduck'
 ]);
 assert.equal(planned.entries.at(-1).repo,'dennisbsj/DataDuck');
 assert.equal(planned.entries.at(-1).port,3414);
 assert.deepEqual(planned.pendingSourceMerges,['dataduck']);
 assert.equal(planned.dataduckMergedInThisProposal,false);
 assert.equal(planned.stagingAuthorized,false);
 assert.equal(planned.deploymentAuthorized,false);
 assert.equal(planned.sourceIntegrityExternallyVerified,false);
 assert.equal(planned.nativePermissionsVerified,false);
 assert.equal(planned.genuineEightServiceStagingVerified,false);
 assert.equal(planned.accessGranted,false);
 assert.equal(planned.licensesGranted,false);
 assert.equal(planned.caddyTemplate.match(/reverse_proxy 127\.0\.0\.1:/g).length,8);
 assert.match(planned.caddyTemplate,/staging-dataduck\.duckbio\.net/);
 assert(!planned.caddyTemplate.includes('clientSecret'));
});

test('a seven-origin historical inventory can never be mislabeled as eight-service evidence',()=>{
 assert.equal(result(source().slice(0,7)).ok,false);
 assert.equal(result(source().slice(1)).ok,false);
 const missing=source().filter(x=>x.id!=='dataduck');
 missing.push({...missing.at(-1),id:'other'});
 assert.equal(result(missing).ok,false);
 assert.equal(result([...source(),source()[0]]).ok,false);
 for(const denied of [result(source().slice(0,7)),result([...source(),source()[0]])]){
  assert.equal(denied.deploymentAuthorized,false);
  assert.equal(denied.licensesGranted,false);
 }
});

test('wrong app identity, duplicate origin, wrong callback, unknown source ref and secrets fail closed',()=>{
 const mutations=[
  e=>{e[7].repo='dennisbsj/DuckMan'},
  e=>{e[7].sha='main'},
  e=>{e[7].sha='a'.repeat(39)},
  e=>{e[7].origin=e[6].origin},
  e=>{e[7].origin='http://localhost:3414'},
  e=>{e[7].origin='https://staging-dataduck.duckbio.net:443'},
  e=>{e[7].callbackUri=e[6].callbackUri},
  e=>{e[7].callbackUri='https://staging-dataduck.duckbio.net/other'},
  e=>{e[7].sourceStatus='unknown'},
  e=>{e[7].clientSecret='not-allowed-in-public-candidate'},
  e=>{e[6].id='dataduck'},
  e=>{e[0].callbackUri='https://staging-workspace.duckbio.net/auth/callback'}
 ];
 for(const mutate of mutations){
  const entries=source();mutate(entries);
  const denied=result(entries);
  assert.equal(denied.ok,false,JSON.stringify(entries.at(-1)));
  assert.equal(denied.stagingAuthorized,false);
  assert.equal(denied.accessGranted,false);
 }
});

test('unsafe or ambiguous staging domain values always fail before creating routes',()=>{
 for(const value of [
  'localhost','duckbio.test','example.invalid','duckbio.local',
  'DUCKBIO.NET','duckbio.net/path','duckbio.net:443',
  'duckbio..net','-duckbio.net','duckbio.net.','duckbio_net',
  'duckbio.net?foo=bar','duckbio.net/#foo',null,''
 ]){
  const denied=result(source(),value);
  assert.equal(denied.ok,false,String(value));
  assert.equal(denied.deploymentAuthorized,false);
 }
});

test('even an all-main source proposal is not independently verified or authorized',()=>{
 const all=source().map(e=>({...e,sourceStatus:'merged-main'}));
 const plan=result(all);
 assert.equal(plan.ok,true);
 assert.equal(plan.dataduckMergedInThisProposal,true);
 assert.deepEqual(plan.pendingSourceMerges,[]);
 assert.equal(plan.sourceIntegrityExternallyVerified,false);
 assert.equal(plan.genuineEightServiceStagingVerified,false);
 assert.equal(plan.stagingAuthorized,false);
 assert.equal(plan.deploymentAuthorized,false);
 assert.equal(plan.licensesGranted,false);
 assert.equal(plan.accessGranted,false);
});
