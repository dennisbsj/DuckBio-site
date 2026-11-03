import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {NATIVE_APP_IDS} from '../staging-preflight.mjs';
import {runWorkspaceStagingReadOnlySmoke} from '../staging-readonly-smoke.mjs';

function config(){
 const root='/srv/private/duckbio-synthetic-staging';
 const clients=NATIVE_APP_IDS.map(id=>({
  id,appId:id,
  secret:'synthetic-only-'+randomBytes(40).toString('base64url'),
  nativeOrigin:'https://stage-'+id+'.duckbio.net',
  redirectUris:['https://stage-'+id+'.duckbio.net/auth/callback']
 }));
 return {
  SUITE_STAGING_ACK:'synthetic-accounts-only',
  SUITE_MODE:'broker',SUITE_BUILD_SHA:'a'.repeat(40),
  SUITE_ORIGIN:'https://stage-workspace.duckbio.net',
  SUITE_ISSUER:'https://stage-workspace.duckbio.net',
  SUITE_CLIENTS:JSON.stringify(clients),
  SUITE_AUTH_DB_PATH:root+'/auth.sqlite',
  SUITE_IDENTITY_DB_PATH:root+'/identity.sqlite',
  SUITE_ORGANIZATION_DB_PATH:root+'/organizations.sqlite',
  SUITE_COMMUNICATIONS_DB_PATH:root+'/communications.sqlite',
  SUITE_ASSET_ROOT:root+'/assets'
 };
}
const response=(body,status=200,headers={})=>
 new Response(JSON.stringify(body),{status,headers:{
  'Content-Type':'application/json',...headers
 }});
function stub(cfg,{central,override,fetchError}={}){
 const calls=[];
 const clients=JSON.parse(cfg.SUITE_CLIENTS);
 const origins=new Map(clients.map(c=>[new URL(c.nativeOrigin).hostname,c.id]));
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.cache,'no-store');
  assert.equal(options.credentials,'omit');
  assert.equal(options.referrerPolicy,'no-referrer');
  assert.deepEqual(options.headers,{Accept:'application/json'});
  assert.equal('body' in options,false);
  assert.equal('Authorization' in options.headers,false);
  assert.equal('Cookie' in options.headers,false);
  if(fetchError)throw Error('Synthetic blocked network');
  const target=new URL(url);
  if(target.href===cfg.SUITE_ORIGIN+'/api/suite/health')
   return central??response({status:'ok',mode:'local',
    buildVersion:cfg.SUITE_BUILD_SHA,configured:true},200,{'Cache-Control':'private, no-store'});
  const id=origins.get(target.hostname);
  assert.ok(id,'Unexpected external hostname');
  const over=override?.(id,target);
  if(over)return over;
  if(id==='eel'&&target.pathname==='/health')
   return response({ok:true,database:true});
  if(id==='limsman'&&target.pathname==='/api.php'&&target.search==='?action=health')
   return response({ok:true,schemaVersion:1,runtime:'node'});
  assert.equal(target.pathname,id==='limsman'?'/api.php':'/api/suite/communications/config');
  if(id==='limsman')assert.equal(target.search,'?action=workspace_communications_config');
  return response({error:'Native session required'},id==='methpipe'?403:401);
 };
 return {fetchImpl,calls};
}
const byId=(result,id)=>result.checks.find(x=>x.target===id);
test('probe exercises one broker and six exact private native origins without credentials or writes',async()=>{
 const cfg=config(),f=stub(cfg);
 const report=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
 assert.equal(report.ok,true);
 assert.equal(report.checks.length,9);
 assert.equal(report.checks.filter(c=>c.passed).length,9);
 assert.equal(f.calls.length,9);
 assert.equal(f.calls[0].url,cfg.SUITE_ORIGIN+'/api/suite/health');
 const urls=new Set(f.calls.map(c=>new URL(c.url).origin));
 assert.equal(urls.size,7);
 for(const id of NATIVE_APP_IDS)assert.equal(byId(report,id+'-auth-boundary')?.code,'ok');
 assert.equal(byId(report,'eel-health')?.code,'ok');
 assert.equal(byId(report,'limsman-health')?.code,'ok');
 for(const client of JSON.parse(cfg.SUITE_CLIENTS)){
  assert(!JSON.stringify(report).includes(client.secret),
   'reports never echo private client secrets');
 }
});
test('offline preflight failures cause zero outbound requests',async()=>{
 const cfg={...config(),SUITE_STAGING_ACK:''},f=stub(cfg);
 const result=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
 assert.equal(result.ok,false);
 assert.equal(byId(result,'configuration').code,'offline_preflight_required');
 assert.equal(f.calls.length,0);
});
test('untrusted, outdated or unconfigured central health fails before any native host is contacted',async()=>{
 for(const value of [
  {status:'ok',mode:'local',configured:false,buildVersion:'a'.repeat(40)},
  {status:'ok',mode:'local',configured:true,buildVersion:'b'.repeat(40)},
  {status:'ok',mode:'static',configured:true,buildVersion:'a'.repeat(40)},
  {error:'unavailable'}
 ]){
  const cfg=config(),f=stub(cfg,{central:response(value,200,{'Cache-Control':'no-store'})});
  const report=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
  assert.equal(report.ok,false);
  assert.equal(byId(report,'workspace-health').code,'workspace_identity_or_setup_mismatch');
  assert.equal(f.calls.length,1);
 }
});
test('broker health without no-store, with redirect or with HTML is rejected',async()=>{
 const cfg=config();
 for(const central of [
  response({status:'ok',mode:'local',configured:true,buildVersion:cfg.SUITE_BUILD_SHA}),
  new Response(null,{status:302,headers:{Location:'https://attacker.duckbio.net'}}),
  new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})
 ]){
  const f=stub(cfg,{central});
  const report=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
  assert.equal(report.ok,false);
  assert.equal(f.calls.length,1);
 }
});
test('missing, exposed and non-JSON native boundaries are fail-closed even with live health',async()=>{
 const cfg=config();
 for(const bad of [
  response({enabled:true,origin:cfg.SUITE_ORIGIN},200),
  response({error:'route missing'},404),
  new Response('<html>fallback</html>',{status:401,headers:{'Content-Type':'text/html'}}),
  response({message:'not authorized'},401)
 ]){
  const f=stub(cfg,{override:(id,target)=>id==='goflo'&&target.pathname.includes('/communications/')
   ?bad:null});
  const report=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
  assert.equal(report.ok,false);
  const check=byId(report,'goflo-auth-boundary');
  assert.equal(check.passed,false);
  if(bad.status===200)assert.equal(check.code,'anonymous_private_endpoint_exposed');
 }
});
test('DuckNote database and LabDuck native Node runtime must be healthy',async()=>{
 const cfg=config();
 for(const id of ['eel','limsman']){
  const f=stub(cfg,{override:(name,target)=>{
   if(name!==id)return null;
   if(name==='eel'&&target.pathname==='/health')return response({ok:true,database:false});
   if(name==='limsman'&&target.search==='?action=health')
    return response({ok:true,schemaVersion:1,runtime:'php'});
   return null;
  }});
  const result=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
  assert.equal(result.ok,false);
  assert.equal(byId(result,id+'-health').code,'native_database_or_runtime_unready');
 }
});
test('network outages, oversized payloads, malformed JSON and redirects never count as passes',async()=>{
 const cfg=config(),f=stub(cfg,{fetchError:true});
 const offline=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:f.fetchImpl});
 assert.equal(byId(offline,'workspace-health').code,'request_unavailable');
 assert.equal(f.calls.length,1);
 for(const bad of [
  new Response('x'.repeat(4097),{headers:{'Content-Type':'application/json'}}),
  new Response('{broken', {headers:{'Content-Type':'application/json'}}),
  new Response(null,{status:302,headers:{Location:'https://attacker.duckbio.net'}})
 ]){
  const testFetch=stub(cfg,{override:(id,target)=>id==='mantrain'&&
   target.pathname.includes('/communications/')?bad:null});
  const report=await runWorkspaceStagingReadOnlySmoke(cfg,{fetchImpl:testFetch.fetchImpl});
  assert.equal(report.ok,false);
  assert.equal(byId(report,'mantrain-auth-boundary').passed,false);
 }
});
test('CLI refuses to contact hosts without explicit confirmation flag',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 const path=fileURLToPath(new URL('../staging-readonly-smoke.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[path,'--config','/not-a-real-private-file.json'],{
  encoding:'utf8',timeout:5000
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/confirm-read-only-staging/);
 assert.equal(r.stdout,'');
});
