import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticNativeRouteHandler} from '../staging-seven-loopback-stubs.mjs';

const client={id:'goflo',appId:'goflo',
 nativeOrigin:'https://staging-goflo.duckbio.net',
 secret:'this-secret-must-never-leak'};
function request({method='GET',path='/__synthetic_route_probe',
 host='staging-goflo.duckbio.net'}={}){
 return new Promise(resolve=>{
  let status,headers,result;
  const res={
   writeHead(s,h){status=s;headers=h},
   end(content){result=JSON.parse(content);resolve({status,headers,result})}
  };
  syntheticNativeRouteHandler(client)(
   {method,url:path,headers:{host}},res
  );
 });
}
test('synthetic routing stub is explicitly not a real native app or authenticated service',
 async()=>{
 const good=await request();
 assert.equal(good.status,200);
 assert.deepEqual(good.result,{
  kind:'synthetic-native-route-stub-not-a-real-app',
  appId:'goflo',origin:client.nativeOrigin
 });
 assert.equal(good.headers['Cache-Control'],'no-store');
 assert.equal(JSON.stringify(good).includes(client.secret),false);
 const blocked=await request({path:'/api/suite/native/communications/config'});
 assert.equal(blocked.status,401);
 assert.match(blocked.result.error,/never_authorizes/);
 const fakeHealth=await request({path:'/api/suite/health'});
 assert.equal(fakeHealth.status,404);
});
test('native stub fails closed for incorrect HTTP Host, POST or arbitrary paths',
 async()=>{
 assert.equal((await request({host:'staging-eel.duckbio.net'})).status,400);
 assert.equal((await request({host:'evil.invalid'})).status,400);
 assert.equal((await request({method:'POST'})).status,405);
 assert.equal((await request({path:'/__synthetic_route_probe?secret=1'})).status,404);
 assert.equal((await request({path:'/auth/callback'})).status,404);
});
