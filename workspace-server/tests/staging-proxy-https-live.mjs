// Real HTTPS over an actual Caddy reverse-proxy to the actual Workspace Node
// runtime. Only for temporary CI-generated, synthetic-only config. Never DNS.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {NATIVE_APP_IDS,readPrivateConfiguration,
 validateWorkspaceStagingConfig} from '../staging-preflight.mjs';

const configFile=process.env.DUCKBIO_PROXY_TEST_CONFIG;
const certPath=process.env.DUCKBIO_PROXY_TEST_CA;
const port=Number(process.env.DUCKBIO_PROXY_TEST_PORT);
const config=configFile?readPrivateConfiguration(configFile):null;
if(!config||!certPath||!Number.isInteger(port)||port<1024||
   !validateWorkspaceStagingConfig(config).ok)
 throw Error('Only a verified ephemeral synthetic staging config may run this HTTPS probe');
const tlsCert=readFileSync(certPath);
const hostname=new URL(config.SUITE_ORIGIN).hostname;
const defaultOrigin=config.SUITE_ORIGIN;
if(hostname!=='staging-workspace.duckbio.net')
 throw Error('Unexpected synthetic-only TLS test hostname');
const keyNames=['goflo','eel','methpipe','mantrain','duckman','limsman'];
assert.deepEqual(NATIVE_APP_IDS,keyNames);

function call(path,{method='GET',body=null,headers={},host=hostname,servername=hostname}={}){
 return new Promise((resolve,reject)=>{
  const raw=body===null?null:JSON.stringify(body);
  const req=https.request({
   hostname:'127.0.0.1',port,servername,method,path,
   ca:tlsCert,rejectUnauthorized:true,
   headers:{Host:host,...(raw===null?{}:{'Content-Type':'application/json'}),...headers},
   timeout:5000
  },res=>{
   const chunks=[];
   res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>{
    const text=Buffer.concat(chunks).toString('utf8');
    let json=null;try{json=JSON.parse(text)}catch{}
    resolve({status:res.statusCode,headers:res.headers,text,json});
   });
  });
  req.once('timeout',()=>req.destroy(Error('local_tls_request_timeout')));
  req.once('error',reject);
  req.end(raw===null?undefined:raw);
 });
}
async function healthy(){
 const deadline=Date.now()+15000;
 for(;;){
  try{
   const r=await call('/api/suite/health');
   if(r.status===200)return r;
  }catch{}
  if(Date.now()>deadline)throw Error('local_https_upstream_unavailable');
  await new Promise(r=>setTimeout(r,250));
 }
}
function cookies(response){
 return (response.headers['set-cookie']||[])
  .map(value=>value.split(';')[0]).join('; ');
}

test('real Caddy to real Workspace HTTPS preserves origin, certificate, no-store and private UI',
 {timeout:30000},async()=>{
 const health=await healthy();
 assert.equal(health.status,200);
 assert.deepEqual({
  status:health.json?.status,
  mode:health.json?.mode,
  configured:health.json?.configured,
  buildVersion:health.json?.buildVersion
 },{status:'ok',mode:'local',configured:false,buildVersion:config.SUITE_BUILD_SHA});
 assert.match(health.headers['content-type']||'',/^application\/json/);
 assert.match(health.headers['cache-control']||'',/no-store/i);
 assert.equal(health.headers['x-content-type-options'],'nosniff');
 for(const path of ['/','/workspace','/owner','/messages','/connect?appId=unknown']){
  const response=await call(path);
  if(path.startsWith('/connect?')){
   assert.equal(response.status,400,'unregistered native app must not connect');
   continue;
  }
  assert.equal(response.status,200,'real HTTPS page '+path);
  assert.match(response.headers['content-type']||'',/^text\/html/);
  assert.match(response.headers['cache-control']||'',/no-store/);
  assert.match(response.text,/DuckBio/);
 }
 const page=await call('/workspace');
 assert.match(page.text,/id="login-form"/);
 const asset=await call('/workspace.js');
 assert.equal(asset.status,200,'private Workspace client must load over HTTPS');
 assert.match(asset.headers['content-type']||'',/javascript/);
});

test('real reverse-proxy retains same-origin CSRF and Secure HttpOnly cookies',async()=>{
 const session=await call('/api/suite/auth/session');
 assert.equal(session.status,200);
 assert.equal(session.json?.authenticated,false);
 assert.match(session.json?.csrfToken||'',/^[A-Za-z0-9_-]{32,128}$/);
 const setCookie=session.headers['set-cookie']||[];
 assert.ok(setCookie.length>0,'broker must issue CSRF cookie');
 assert.ok(setCookie.every(s=>/;\s*Secure\b/i.test(s)&&
  /;\s*HttpOnly\b/i.test(s)&&/;\s*SameSite=Strict\b/i.test(s)),
 'the actual proxied HTTPS origin must set secure strict cookies');
 const invalid=await call('/api/suite/setup',{
  method:'POST',
  headers:{Origin:'https://wrong.example.invalid',Cookie:cookies(session),
   'X-CSRF-Token':session.json.csrfToken},
  body:{setupToken:config.SUITE_SETUP_TOKEN,
   email:'proxy-owner@example.test',displayName:'Synthetic Proxy Owner',
   password:'A sufficiently long synthetic password 12345678'}
 });
 assert.equal(invalid.status,403,'cross-origin setup must be rejected');
 const notSetup=await call('/api/suite/health');
 assert.equal(notSetup.json?.configured,false,'bad origin must never bootstrap admin');
 const bootstrap=await call('/api/suite/setup',{
  method:'POST',
  headers:{Origin:defaultOrigin,Cookie:cookies(session),
   'X-CSRF-Token':session.json.csrfToken},
  body:{setupToken:config.SUITE_SETUP_TOKEN,
   email:'proxy-owner@example.test',displayName:'Synthetic Proxy Owner',
   password:'A sufficiently long synthetic password 12345678'}
 });
 assert.equal(bootstrap.status,201,'real HTTPS CSRF-authenticated setup through Caddy');
 const merged=[cookies(session),cookies(bootstrap)].filter(Boolean).join('; ');
 const own=await call('/api/suite/account',{headers:{Cookie:merged}});
 assert.equal(own.status,200);
 assert.equal(own.json?.user?.email,'proxy-owner@example.test');
 assert.deepEqual(own.json?.apps?.filter(a=>a.enabled),[],
  'synthetic first admin must not receive native licenses');
 const health=await call('/api/suite/health');
 assert.equal(health.json?.configured,true);
});

test('broker Host validation, proxy authorization and TLS hostname verification are independent',async()=>{
 // The broker must reject a forged Host on its *actual loopback socket*.
 // Caddy can normalize Host during routing; do not assume it preserves a
 // forged header across all versions and transports.
 const direct=await new Promise((resolve,reject)=>{
  const request=http.request({hostname:'127.0.0.1',port:3307,
   path:'/api/suite/health',headers:{Host:'evil.example.invalid'}},res=>{
    res.resume();res.on('end',()=>resolve(res.statusCode));
   });
  request.once('error',reject);request.end();
 });
 assert.equal(direct,400,'broker rejects forged HTTP Host even without Caddy');
 const privateRoute=await call('/api/suite/organizations');
 assert.equal(privateRoute.status,401,'anonymous visitor cannot list organizations');
 await assert.rejects(call('/api/suite/health',{
  servername:'unrelated.example.invalid'
 }),
 'wrong TLS hostname must not be accepted by generated test certificate');
});
