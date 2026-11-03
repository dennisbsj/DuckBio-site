// Disposable CI-only loopback native ROUTING STUBS: NOT DuckBio apps.
// Never reads native app databases, performs auth/PKCE, connects to the
// network, or makes claims about genuine native app implementations.
import http from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateConfiguration,validateWorkspaceStagingConfig,
 NATIVE_APP_IDS} from './staging-preflight.mjs';
import {STAGING_PROXY_PORTS} from './staging-seven-proxy-plan.mjs';

export function syntheticNativeRouteHandler(client){
 const hostname=new URL(client.nativeOrigin).host;
 return (req,res)=>{
  const headers={'Content-Type':'application/json; charset=utf-8',
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const reply=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body))};
  if(req.headers.host!==hostname)return reply(400,{error:'invalid_host'});
  if(req.method!=='GET')return reply(405,{error:'method_not_allowed'});
  const url=new URL(req.url,client.nativeOrigin);
  if(url.pathname==='/__synthetic_route_probe'&&!url.search)
   return reply(200,{
    kind:'synthetic-native-route-stub-not-a-real-app',
    appId:client.appId,origin:client.nativeOrigin
   });
  if(url.pathname==='/api/suite/native/communications/config')
   return reply(401,{error:'synthetic_stub_never_authorizes'});
  return reply(404,{error:'not_found'});
 };
}
export async function startSixSyntheticNativeStubs(config){
 if(!validateWorkspaceStagingConfig(config).ok)
  throw Error('synthetic_staging_config_required');
 const byId=new Map(JSON.parse(config.SUITE_CLIENTS).map(x=>[x.id,x]));
 const listeners=[];
 try{
  for(const appId of NATIVE_APP_IDS){
   const client=byId.get(appId);
   if(!client||client.appId!==appId)throw Error('native_app_id_mismatch');
   const server=http.createServer(syntheticNativeRouteHandler(client));
   server.requestTimeout=5_000;server.headersTimeout=5_000;
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(STAGING_PROXY_PORTS[appId],'127.0.0.1',resolve);
   });
   listeners.push(server);
  }
 }catch(error){
  await Promise.all(listeners.map(server=>new Promise(resolve=>
   server.close(()=>resolve()))));
  throw error;
 }
 return async()=>{
  for(const server of listeners)server.closeAllConnections?.();
  await Promise.all(listeners.map(server=>new Promise(resolve=>
   server.close(()=>resolve()))));
 };
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--config'||
    args[2]!=='--confirm-disposable-routing-stubs-only'){
  console.error('Usage: node staging-seven-loopback-stubs.mjs --config SYNTHETIC_PRIVATE_JSON --confirm-disposable-routing-stubs-only');
  process.exitCode=2;
 }else try{
  const close=await startSixSyntheticNativeStubs(
   readPrivateConfiguration(args[1]));
  console.log('PASS six synthetic loopback routing stubs active (NOT real native apps)');
  for(const signal of ['SIGTERM','SIGINT'])
   process.once(signal,()=>void close().then(()=>process.exit(0)));
 }catch{
  console.error('FAIL isolated synthetic native route stubs (no native apps started)');
  process.exitCode=1;
 }
}
