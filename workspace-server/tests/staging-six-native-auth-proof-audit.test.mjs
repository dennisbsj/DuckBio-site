import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdtempSync,rmSync,writeFileSync,symlinkSync}
 from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {auditSixNativeAuthenticatedStaging,
 validateSixNativeProofBundle,readPrivateSixNativeProofBundle}
 from '../staging-six-native-auth-proof-audit.mjs';

const lock=JSON.parse((await import('node:fs')).readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const IDs=['goflo','eel','methpipe','mantrain','duckman','limsman'];
const token=()=>randomBytes(36).toString('base64url');
const witness=async()=>({
 ok:true,category:'seven-real-systemd-processes-and-anonymous-https-only',
 deploymentAuthorized:false
});
const clone=structuredClone;
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'duckbio-six-native-proofs-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:root,buildSha:lock.central.sha
 });
 const assertions=IDs.map((appId,i)=>({
  appId,activeToken:token(),inactiveToken:token(),
  subject:'synthetic-identity-01',
  localUserId:'synthetic-'+appId+'-worker',
  organizationId:'synthetic-lab-a'
 }));
 return {root,config,bundle:{
  version:1,scope:'synthetic-six-original-native-broker-proofs',
  workspaceSha:lock.central.sha,assertions
 }};
}
function fakeBroker(f,{modifyActive,modifyInactive}={}){
 const peers=new Map(JSON.parse(f.config.SUITE_CLIENTS).map(x=>[x.id,x]));
 const active=new Map(f.bundle.assertions.map(x=>[x.activeToken,x]));
 const inactive=new Set(f.bundle.assertions.map(x=>x.inactiveToken));
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  assert.equal(url,f.config.SUITE_ORIGIN+'/api/suite/auth/introspect');
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.credentials,'omit');
  assert.equal(opts.headers['Content-Type'],'application/json');
  assert.equal(opts.headers.Accept,'application/json');
  assert.equal(opts.headers.Cookie,undefined);
  assert.equal(opts.headers.Origin,undefined);
  const decoded=Buffer.from(opts.headers.Authorization.slice(6),
   'base64').toString('utf8');
  const separator=decoded.indexOf(':');
  const caller=decoded.slice(0,separator);
  assert.equal(decoded.slice(separator+1),peers.get(caller)?.secret);
  const body=JSON.parse(opts.body);
  assert.deepEqual(Object.keys(body).sort(),['clientId','sessionToken']);
  assert.equal(body.clientId,caller);
  calls.push({caller,token:body.sessionToken});
  const row=active.get(body.sessionToken);
  let reply;
  if(inactive.has(body.sessionToken)){
   reply=modifyInactive?modifyInactive(caller):{active:false};
  }else if(row&&row.appId===caller){
   reply={
    active:true,issuer:f.config.SUITE_ISSUER,audience:caller,
    subject:row.subject,localIdentity:{
     userId:row.localUserId,organizationId:row.organizationId
    },expiresAt:Date.now()+3600_000
   };
   if(modifyActive)reply=modifyActive(caller,reply);
  }else reply={active:false};
  return Response.json(reply,{
   headers:{'Cache-Control':'no-store','Content-Type':'application/json'}
  });
 };
 return {calls,fetchImpl};
}
const run=(f,other={})=>auditSixNativeAuthenticatedStaging({
 config:f.config,lock,bundle:f.bundle,
 sourcesRoot:'/not-touched-by-stub',
 realServices:witness,...other
});
test('strict snapshot requires exactly six unique synthetic broker proofs, no seventh app',t=>{
 const f=fixture(t);
 assert.deepEqual(validateSixNativeProofBundle(f.config,lock,f.bundle),
  {ok:true,code:'ok'});
 for(const edit of [
  b=>b.assertions.push({...b.assertions[0],appId:'dataduck'}),
  b=>b.assertions[0].appId='dataduck',
  b=>b.assertions[1].activeToken=b.assertions[0].activeToken,
  b=>b.assertions[1].inactiveToken=b.assertions[0].inactiveToken,
  b=>b.assertions[1].activeToken=b.assertions[1].inactiveToken,
  b=>b.assertions[3].organizationId='lab-a',
  b=>b.assertions[2].localUserId='native-user',
  b=>b.assertions[4].subject='line\ninjection',
  b=>b.assertions[4].activeToken='A',
  b=>b.assertions[1].extraProperty='unsafe',
  b=>b.workspaceSha='f'.repeat(40),
  b=>b.scope='production'
 ]){
  const bad=clone(f.bundle);edit(bad);
  assert.equal(validateSixNativeProofBundle(f.config,lock,bad).ok,false);
 }
 const forged=clone(lock);forged.apps[0].runId+=1;
 assert.equal(validateSixNativeProofBundle(f.config,forged,f.bundle).ok,false);
});
test('all six live proofs pass, six expired/withdrawn proofs fail, and foreign apps see no identity',async t=>{
 const f=fixture(t),remote=fakeBroker(f);
 const result=await run(f,{fetchImpl:remote.fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.category,
  'seven-genuine-services-plus-six-broker-native-proof-boundaries-only');
 assert.equal(remote.calls.length,18,'one positive, one inactive, one foreign for each');
 assert.deepEqual(result.checks.map(x=>x.name),
  ['real-seven-services',...IDs.map(id=>id+'-native-proof')]);
 const clients=remote.calls.map(x=>x.caller);
 assert.deepEqual(clients.slice(0,3),['goflo','goflo','eel']);
 assert.deepEqual(clients.slice(-3),['limsman','limsman','goflo']);
});
test('will not make any authenticated request until real seven-service source/process/HTTPS witness passes',
 async t=>{
 const f=fixture(t),remote=fakeBroker(f);
 const denied=await run(f,{fetchImpl:remote.fetchImpl,
  realServices:async()=>({ok:false,category:'blocked',
   deploymentAuthorized:false})});
 assert.equal(denied.ok,false);
 assert.equal(denied.checks.at(-1).code,'genuine_staging_not_verified');
 assert.equal(remote.calls.length,0);
 const wrongCategory=await run(f,{fetchImpl:remote.fetchImpl,
  realServices:async()=>({ok:true,category:'source-only',
   deploymentAuthorized:false})});
 assert.equal(wrongCategory.ok,false);
 assert.equal(remote.calls.length,0);
});
test('rejects native proof mapped to different account, organization, audience or expiry',async t=>{
 const f=fixture(t);
 for(const modifyActive of [
  (_,a)=>({...a,localIdentity:{...a.localIdentity,organizationId:'synthetic-lab-b'}}),
  (_,a)=>({...a,subject:'synthetic-imposter'}),
  (_,a)=>({...a,audience:'eel'}),
  (_,a)=>({...a,expiresAt:0}),
  (_,a)=>({...a,active:false})
 ]){
  const broker=fakeBroker(f,{modifyActive});
  const result=await run(f,{fetchImpl:broker.fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(result.checks.at(-1).code,'native_proof_identity_or_scope_mismatch');
 }
});
test('native revoked or expired proof must return ONLY active:false',async t=>{
 const f=fixture(t);
 for(const modifyInactive of [
  ()=>({active:true}),
  ()=>({active:false,subject:'synthetic-leaked-user'})
 ]){
  const broker=fakeBroker(f,{modifyInactive});
  const result=await run(f,{fetchImpl:broker.fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(result.checks.at(-1).code,'revoked_or_expired_proof_still_active');
 }
});
test('foreign native app accepting a different app token fails closed',async t=>{
 const f=fixture(t),broker=fakeBroker(f);
 const wrapper=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  const result=await broker.fetchImpl(url,opts);
  if(body.sessionToken===f.bundle.assertions[0].activeToken&&
     Buffer.from(opts.headers.Authorization.slice(6),'base64')
      .toString('utf8').startsWith('eel:'))
   return Response.json({active:true},{
    headers:{'Cache-Control':'no-store','Content-Type':'application/json'}
   });
  return result;
 };
 const out=await run(f,{fetchImpl:wrapper});
 assert.equal(out.ok,false);
 assert.equal(out.checks.at(-1).code,'foreign_native_audience_accepted');
});
test('refuses missing response security headers, redirection or oversized identity replies',async t=>{
 const f=fixture(t),broker=fakeBroker(f);
 for(const wrapper of [
  async()=>Response.json({active:true}),
  async()=>new Response('test',{status:302,headers:{Location:'https://invalid.example'}}),
  async()=>new Response('x'.repeat(4096),{
   headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}),
  async()=>{throw Error('network unavailable')}
 ]){
  const result=await run(f,{fetchImpl:async(url,opts)=>{
   await broker.fetchImpl(url,opts);return wrapper();
  }});
  assert.equal(result.ok,false);
  assert.equal(result.checks.at(-1).code,'native_proof_identity_or_scope_mismatch');
 }
});
test('read private synthetic proofs only from an owner-only regular file, reject symlinks',t=>{
 const f=fixture(t);
 const path=join(f.root,'synthetic-proofs.json');
 writeFileSync(path,JSON.stringify(f.bundle),{mode:0o600});
 assert.deepEqual(readPrivateSixNativeProofBundle(path),f.bundle);
 chmodSync(path,0o644);
 assert.throws(()=>readPrivateSixNativeProofBundle(path));
 chmodSync(path,0o600);
 const alias=join(f.root,'proofs-alias.json');
 symlinkSync(path,alias);
 assert.throws(()=>readPrivateSixNativeProofBundle(alias));
 assert.throws(()=>readPrivateSixNativeProofBundle('/tmp/nonexistent-proofs.json'));
});
test('CLI refuses missing explicit synthetic opt-in and never prints secrets',t=>{
 const f=fixture(t);
 const path=fileURLToPath(new URL(
  '../staging-six-native-auth-proof-audit.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[path],{
  encoding:'utf8',timeout:5000
 });
 assert.equal(out.status,2);
 assert.match(out.stderr,/--confirm-synthetic-auth-proof-inspection-only/);
 assert(!out.stdout.includes(f.bundle.assertions[0].activeToken));
 assert(!out.stderr.includes(f.config.SUITE_SETUP_TOKEN));
});
