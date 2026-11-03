// Test the actual seven-route Caddy HTTPS plan against the real Workspace
// broker and six synthetic, expressly NON-NATIVE, app route stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig,
 NATIVE_APP_IDS} from '../staging-preflight.mjs';
import {STAGING_PROXY_PORTS} from '../staging-seven-proxy-plan.mjs';

const env=process.env;
if(!env.DUCKBIO_SEVEN_RUNTIME_CONFIG||!env.DUCKBIO_SEVEN_STUB_CONFIG||
   !env.DUCKBIO_SEVEN_CA||!env.DUCKBIO_SEVEN_PROXY_FILE||
   !env.DUCKBIO_SEVEN_MANIFEST)
 throw Error('explicit synthetic seven-route CI input paths required');
const runtime=readPrivateConfiguration(env.DUCKBIO_SEVEN_RUNTIME_CONFIG);
const synthetic=readPrivateConfiguration(env.DUCKBIO_SEVEN_STUB_CONFIG);
if(!validateWorkspaceStagingConfig(runtime).ok||
   !validateWorkspaceStagingConfig(synthetic).ok)
 throw Error('synthetic_only_configuration_required');
const certificate=readFileSync(env.DUCKBIO_SEVEN_CA);
const manifest=JSON.parse(readFileSync(env.DUCKBIO_SEVEN_MANIFEST,'utf8'));
const rawPlan=readFileSync(env.DUCKBIO_SEVEN_PROXY_FILE,'utf8');
const digest=s=>createHash('sha256').update(s).digest('hex');
if(manifest.format!=='duckbio-seven-origin-staging-proxy-plan-v1'||
   manifest.routeCount!==7||manifest.routes?.length!==7||
   manifest.caddySha256!==digest(rawPlan))
 throw Error('seven_origin_plan_integrity_required');
assert.equal(manifest.sourceQaWorkspaceSha,synthetic.SUITE_BUILD_SHA);
assert.equal(runtime.SUITE_ORIGIN,synthetic.SUITE_ORIGIN);
const ids=['workspace',...NATIVE_APP_IDS];
assert.deepEqual(manifest.routes.map(x=>x.id),ids);
assert.deepEqual(manifest.routes.map(x=>x.loopbackPort),
 ids.map(x=>STAGING_PROXY_PORTS[x]));
const clients=new Map(JSON.parse(synthetic.SUITE_CLIENTS).map(x=>[x.id,x]));
const port=18443;
function get(host,path,servername=host){
 return new Promise((resolve,reject)=>{
  const request=https.request({hostname:'127.0.0.1',port,
   servername,method:'GET',path,ca:certificate,rejectUnauthorized:true,
   headers:{Host:host},timeout:3000},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));
   res.on('end',()=>{
    const body=Buffer.concat(chunks).toString('utf8');
    let json=null;try{json=JSON.parse(body)}catch{}
    resolve({status:res.statusCode,headers:res.headers,json,body});
   });
  });
  request.once('timeout',()=>request.destroy(Error('seven_https_timeout')));
  request.once('error',reject);request.end();
 });
}
async function ready(){
 const end=Date.now()+18000;
 let last=null;
 while(Date.now()<end){
  try{
   const r=await get(new URL(runtime.SUITE_ORIGIN).hostname,'/api/suite/health');
   if(r.status===200)return r;
   last=Error('workspace_not_healthy');
  }catch(error){last=error}
  await new Promise(r=>setTimeout(r,200));
 }
 throw Error('seven_https_not_ready_'+String(last?.code||'unavailable'));
}
test('real Workspace is reached ONLY at its intended TLS host on the seven-site proxy',
 {timeout:26000},async()=>{
 const response=await ready();
 assert.equal(response.status,200);
 assert.deepEqual({
  status:response.json?.status,buildVersion:response.json?.buildVersion,
  configured:response.json?.configured
 },{status:'ok',buildVersion:runtime.SUITE_BUILD_SHA,configured:false});
 assert.match(response.headers['cache-control']||'',/no-store/i);
 const home=await get(new URL(runtime.SUITE_ORIGIN).hostname,'/workspace');
 assert.equal(home.status,200);
 assert.match(home.body,/DuckBio/);
 const anonymous=await get(new URL(runtime.SUITE_ORIGIN).hostname,
  '/api/suite/organizations');
 assert.equal(anonymous.status,401,'organization API is not public');
 const fakeProbe=await get(new URL(runtime.SUITE_ORIGIN).hostname,
  '/__synthetic_route_probe');
 assert.notEqual(fakeProbe.status,200,
  'central Workspace must not serve a synthetic native route probe');
});
test('six distinct TLS hosts route to the correct distinct native LOOPBACK STUB',
 {timeout:26000},async()=>{
 for(const appId of NATIVE_APP_IDS){
  const registration=clients.get(appId);
  const route=manifest.routes.find(x=>x.id===appId);
  assert.ok(registration&&route);
  const host=new URL(registration.nativeOrigin).hostname;
  assert.equal(route.hostname,host);
  const result=await get(host,'/__synthetic_route_probe');
  assert.equal(result.status,200,'missing upstream '+appId);
  assert.deepEqual(result.json,{
   kind:'synthetic-native-route-stub-not-a-real-app',
   appId,origin:registration.nativeOrigin
  },'wrong native host routed to '+appId);
  assert.match(result.headers['cache-control']||'',/no-store/);
  const privateResult=await get(host,'/api/suite/native/communications/config');
  assert.equal(privateResult.status,401,
   'route stubs do not fake native Workspace authentication');
  const centralHealth=await get(host,'/api/suite/health');
  assert.equal(centralHealth.status,404,
   'native '+appId+' must not accidentally route to Workspace health');
 }
});
test('host separation, forged direct-native Host and untrusted TLS names do not cross boundaries',async()=>{
 for(const appId of NATIVE_APP_IDS){
  const host=new URL(clients.get(appId).nativeOrigin).hostname;
  const route=manifest.routes.find(x=>x.id===appId);
  const bad=await new Promise((resolve,reject)=>{
   const request=http.request({hostname:'127.0.0.1',
    port:route.loopbackPort,path:'/__synthetic_route_probe',
    headers:{Host:'wrong.example.invalid'}},res=>{
    res.resume();res.once('end',()=>resolve(res.statusCode));
   });
   request.once('error',reject);request.end();
  });
  assert.equal(bad,400,'synthetic upstream rejects incorrect direct Host '+appId);
  const ok=await get(host,'/__synthetic_route_probe');
  assert.equal(ok.json?.appId,appId);
 }
 await assert.rejects(
  get('staging-workspace.duckbio.net','/api/suite/health',
   'outside.example.invalid'),
  'untrusted TLS SNI must not validate against only the seven SAN names');
});
