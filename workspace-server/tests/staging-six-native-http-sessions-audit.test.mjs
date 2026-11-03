import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdtempSync,rmSync,writeFileSync,symlinkSync}
 from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {readPrivateSixNativeProofBundle}
 from '../staging-six-native-auth-proof-audit.mjs';
import {auditSixNativeHttpSessions,
 validateSixNativeCookieBundle}
 from '../staging-six-native-http-sessions-audit.mjs';
import {readFileSync} from 'node:fs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const IDS=['goflo','eel','methpipe','mantrain','duckman','limsman'];
const names={
 goflo:'science_goflo_session',
 eel:'eln_session',
 methpipe:'science_methpipe_session',
 mantrain:'science_mantrain_session',
 duckman:'duckman_session',
 limsman:'LIMSMAN_SESSION'
};
const token=()=>randomBytes(32).toString('base64url');
function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-native-http-session-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{force:true,recursive:true}));
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:home,buildSha:lock.central.sha
 });
 const proofBundle={
  version:1,scope:'synthetic-six-original-native-broker-proofs',
  workspaceSha:lock.central.sha,
  assertions:IDS.map(id=>({
   appId:id,activeToken:token(),inactiveToken:token(),
   subject:'synthetic-central-member',
   localUserId:'synthetic-'+id+'-native-user',
   organizationId:'synthetic-lab-a'
  }))
 };
 const cookieBundle={
  version:1,scope:'synthetic-six-native-http-session-cookies',
  workspaceSha:lock.central.sha,
  sessions:IDS.map(id=>({appId:id,cookie:names[id]+'='+token()}))
 };
 const client=Object.fromEntries(JSON.parse(config.SUITE_CLIENTS)
  .map(c=>[c.id,c]));
 return {home,config,proofBundle,cookieBundle,client};
}
function fakeNative(f,{editResponse}={}){
 const calls=[];
 const routes=id=>id==='limsman'?{
  identity:'/api.php?action=session',
  link:'/api.php?action=workspace_status',
  unread:'/api.php?action=workspace_unread'
 }:id==='duckman'?{
  identity:'/api/auth/status',
  link:'/api/suite/communications/link-status',
  unread:'/api/suite/communications/unread'
 }:{
  identity:'/api/auth/status',
  link:'/api/suite/workspace/status',
  unread:'/api/suite/workspace/unread'
 };
 const fetchImpl=async(url,opts)=>{
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.credentials,'omit');
  assert.equal(opts.headers.Accept,'application/json');
  assert.equal(opts.referrerPolicy,'no-referrer');
  assert.equal(opts.body,undefined);
  assert.equal(opts.headers.Authorization,undefined);
  const parsed=new URL(url),id=IDS.find(name=>
   f.client[name].nativeOrigin===parsed.origin);
  assert(id,'never contact an unregistered synthetic native origin');
  const route=parsed.pathname+parsed.search;
  const known=routes(id);
  assert(Object.values(known).includes(route),
   'never contact unexpected native API routes');
  const cookie=opts.headers.Cookie;
  const own=cookie===f.cookieBundle.sessions[IDS.indexOf(id)].cookie;
  const foreign=IDS.some((other,i)=>other!==id&&
   cookie===f.cookieBundle.sessions[i].cookie);
  assert(own||foreign,'no broker cookie, mixed sessions or other headers');
  calls.push({id,route,own,foreign});
  if(foreign)return Response.json({user:null});
  const expected=f.proofBundle.assertions[IDS.indexOf(id)].localUserId;
  const res=route===known.identity?{user:{id:expected}}:
   route===known.link?(id==='duckman'?{connected:true}:
    {enabled:true,linked:true}):
   id==='duckman'?{connected:true,
    counts:{chat:2,mail:1,notifications:0}}:
    {counts:{chat:2,mail:1,notifications:0}};
  const modified=editResponse?editResponse({id,route,body:res}):null;
  if(modified instanceof Response)return modified;
  return Response.json(modified??res);
 };
 return {calls,fetchImpl};
}
const prior=async()=>({
 ok:true,category:'seven-genuine-services-plus-six-broker-native-proof-boundaries-only',
 deploymentAuthorized:false
});
const audit=(f,override={})=>auditSixNativeHttpSessions({
 config:f.config,lock,proofBundle:f.proofBundle,
 cookieBundle:f.cookieBundle,sourcesRoot:'/unused-in-synthetic-fixture',
 preflight:prior,...override
});
test('exact six old native cookie names and reviewed six-native SSO sessions only',t=>{
 const f=fixture(t);
 assert.deepEqual(validateSixNativeCookieBundle(f.config,lock,
  f.proofBundle,f.cookieBundle),{ok:true,code:'ok'});
 for(const edit of [
  b=>b.sessions.push({...b.sessions[0],appId:'dataduck'}),
  b=>b.sessions[0].appId='eel',
  b=>b.sessions[1].cookie=b.sessions[0].cookie,
  b=>b.sessions[2].cookie='suite_identity='+token(),
  b=>b.sessions[3].cookie='science_mantrain_session='+'a',
  b=>b.sessions[4].cookie+='; suite_identity=unsafe',
  b=>b.sessions[5].cookie=names.limsman+'='+token()+'\r\nunsafe',
  b=>b.sessions[0].foreign='malicious',
  b=>b.workspaceSha='f'.repeat(40),
  b=>b.scope='production-native-session'
 ]){
  const bad=structuredClone(f.cookieBundle);
  edit(bad);
  assert.equal(validateSixNativeCookieBundle(
   f.config,lock,f.proofBundle,bad).ok,false);
 }
 const fabricated=structuredClone(lock);
 fabricated.apps[0].sha='f'.repeat(40);
 assert.equal(validateSixNativeCookieBundle(
  f.config,fabricated,f.proofBundle,f.cookieBundle).ok,false);
});
test('requires prior seven actual processes and six broker proofs BEFORE any native session request',
 async t=>{
 const f=fixture(t),remote=fakeNative(f);
 const result=await audit(f,{fetchImpl:remote.fetchImpl,
  preflight:async()=>({ok:false,deploymentAuthorized:false})});
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'verified_broker_preflight_required');
 assert.equal(remote.calls.length,0);
});
test('all six real native HTTP login identities/linked Workspace/unread and foreign-cookie denials',
 async t=>{
 const f=fixture(t),remote=fakeNative(f);
 const result=await audit(f,{fetchImpl:remote.fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(result.category,
  'six-genuine-native-http-session-and-workspace-link-boundaries-only');
 assert.equal(remote.calls.length,24);
 assert.deepEqual(result.checks.map(x=>x.id),[
  'broker-and-seven-real-services',...IDS.map(x=>x+'-native-http')
 ]);
 assert(remote.calls.every(x=>x.own!==x.foreign));
 assert.equal(remote.calls.filter(x=>x.foreign).length,6);
});
test('fails on a native local identity mismatch against real broker-scoped identity',async t=>{
 const f=fixture(t),remote=fakeNative(f,{
  editResponse:({route,body})=>
   route==='/api/auth/status'?{user:{id:'synthetic-other-user'}}:body
 });
 const result=await audit(f,{fetchImpl:remote.fetchImpl});
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'native_session_identity_mismatch');
});
test('fails when native Workspace link reports stale/unlinked session',async t=>{
 const f=fixture(t),remote=fakeNative(f,{
  editResponse:({route,body})=>
   route==='/api/suite/workspace/status'?{enabled:true,linked:false}:body
 });
 const result=await audit(f,{fetchImpl:remote.fetchImpl});
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'native_workspace_link_mismatch');
});
test('fails on false zero counts, corrupted unread data or downstream native failure',async t=>{
 const f=fixture(t);
 for(const reply of [
  {counts:{chat:-1,mail:0,notifications:0}},
  {counts:{chat:0,mail:0,notifications:0},token:'unexpected'},
  Response.json({error:'upstream unavailable'},{status:503}),
  new Response('HTML login page',{status:200,
   headers:{'Content-Type':'text/html'}}),
  Response.redirect('https://outside.example.invalid'),
  new Response('x'.repeat(5000),{status:200,
   headers:{'Content-Type':'application/json'}})
 ]){
  const remote=fakeNative(f,{
   editResponse:({route,body})=>route==='/api/suite/workspace/unread'?reply:body
  });
  const result=await audit(f,{fetchImpl:remote.fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(result.checks.at(-1).code,'native_protected_get_unavailable');
 }
});
test('a different native app cookie can never authenticate the original app',async t=>{
 const f=fixture(t),remote=fakeNative(f),wrapper=async(url,opts)=>{
  const reply=await remote.fetchImpl(url,opts);
  if(opts.headers.Cookie===f.cookieBundle.sessions[1].cookie&&
   url===f.client.goflo.nativeOrigin+'/api/auth/status')
   return Response.json({user:{id:f.proofBundle.assertions[0].localUserId}});
  return reply;
 };
 const result=await audit(f,{fetchImpl:wrapper});
 assert.equal(result.ok,false);
 assert.equal(result.checks.at(-1).code,'foreign_native_session_accepted');
});
test('an HTTP 401 or 403 on a foreign cookie is an accepted denial; a 503 is not',async t=>{
 const f=fixture(t);
 for(const status of [401,403,503]){
  const remote=fakeNative(f),wrapper=async(url,opts)=>{
   await remote.fetchImpl(url,opts);
   const id=IDS.find(name=>f.client[name].nativeOrigin===new URL(url).origin);
   if(opts.headers.Cookie!==f.cookieBundle.sessions[IDS.indexOf(id)].cookie)
    return new Response(null,{status});
   return remote.fetchImpl(url,opts);
  };
  const result=await audit(f,{fetchImpl:wrapper});
  assert.equal(result.ok,status!==503);
 }
});
test('operator-only cookie bundle is a private regular file, not symlink or world-readable',t=>{
 const f=fixture(t),file=join(f.home,'synthetic-native-cookies.json');
 writeFileSync(file,JSON.stringify(f.cookieBundle),{mode:0o600});
 assert.deepEqual(readPrivateSixNativeProofBundle(file),f.cookieBundle);
 chmodSync(file,0o644);
 assert.throws(()=>readPrivateSixNativeProofBundle(file));
 chmodSync(file,0o600);
 const alias=join(f.home,'native-cookies-link.json');
 symlinkSync(file,alias);
 assert.throws(()=>readPrivateSixNativeProofBundle(alias));
});
test('no CLI arguments never inspect a real host or echo synthetic secrets',t=>{
 const f=fixture(t);
 const path=fileURLToPath(new URL(
  '../staging-six-native-http-sessions-audit.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[path],{
  encoding:'utf8',timeout:5000
 });
 assert.equal(out.status,2);
 assert.match(out.stderr,/confirm-readonly-synthetic-sessions-only/);
 assert(!out.stdout.includes(f.cookieBundle.sessions[0].cookie));
 assert(!out.stderr.includes(f.config.SUITE_SETUP_TOKEN));
});
