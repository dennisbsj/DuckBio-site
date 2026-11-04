// Real Chromium and two separate local HTTPS sites, with the ACTUAL central
// Workspace broker. The native app here is a synthetic callback contract, NOT
// DuckNote production code; all private keys/accounts are disposable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';
import {createAccountService} from '../shared-auth/account-service.mjs';

const token=()=>randomBytes(32).toString('base64url');
const noStore={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function json(res,status,data,extra={}){
 res.writeHead(status,{...noStore,'Content-Type':'application/json',...extra});
 res.end(JSON.stringify(data));
}
function html(res,body,extra={}){
 res.writeHead(200,{...noStore,'Content-Type':'text/html',...extra});res.end(body);
}
function cookie(req,name){
 return String(req.headers.cookie||'').split(';').map(x=>x.trim())
  .find(x=>x.startsWith(name+'='))?.slice(name.length+1)||null;
}
async function body(req){
 let data='';for await(const chunk of req){data+=chunk;if(data.length>4096)throw Error('Too long')}
 const obj=JSON.parse(data);
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Invalid JSON');
 return obj;
}
function ephemeralTLS(dir){
 const key=join(dir,'key.pem'),crt=join(dir,'cert.pem');
 const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048',
  '-sha256','-nodes','-days','1','-subj','/CN=localhost',
  '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1',
  '-keyout',key,'-out',crt],{stdio:'pipe',timeout:10000});
 assert.equal(result.status,0,'ephemeral HTTPS test certificate');
 return {key:readFileSync(key),cert:readFileSync(crt)};
}
function trustedPost(origin,path,ca,secret,payload){
 const jsonBody=JSON.stringify(payload);
 return new Promise((resolve,reject)=>{
  const req=https.request(new URL(origin+path),{
   method:'POST',ca,
   headers:{Authorization:'Basic '+Buffer.from('eel:'+secret).toString('base64'),
    'Content-Type':'application/json','Content-Length':Buffer.byteLength(jsonBody)}
  },res=>{
   let output='';res.setEncoding('utf8');
   res.on('data',chunk=>{output+=chunk;if(output.length>4096)req.destroy(Error('Too much data'))});
   res.on('end',()=>{try{resolve({status:res.statusCode,
    data:output?JSON.parse(output):{}})}catch(e){reject(e)}});
  });
  req.on('error',reject);req.end(jsonBody);
 });
}
async function fixture(t,{standalone=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-two-https-'));
 const tls=ephemeralTLS(dir);
 const ids=createIdentityStore({databasePath:join(dir,'identity.sqlite')});
 const auth=createSqliteAuthStores({databasePath:join(dir,'auth.sqlite')});
 const org=createOrganizationStore({databasePath:join(dir,'org.sqlite')});
 const seed=token();ids.configureBootstrapToken(seed);
 const owner=await ids.bootstrap(seed,{email:'owner@example.test',
  displayName:'Owner',password:'Owner synthetic password 123456'});
 const worker=await ids.createUser({email:'worker@example.test',
  displayName:'Worker',password:'Worker synthetic password 123456'});
 org.setupOrganization({organizationId:'lab-a',name:'Lab A',owner:{
  accountId:owner.id,name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 org.applyVerifiedSeatPurchase({reference:'fake-verified-seat',organizationId:'lab-a',
  plan:'Single',apps:['eel'],seats:2});
 const member=roles=>({accountId:worker.id,name:'Worker',nickname:'Worker',
  email:'worker@example.test',admin:false,roles});
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:member({eel:'scientist'})});
 ids.grantAppAccess({userId:worker.id,appId:'eel',localUserId:'native-worker',organizationId:'lab-a'});
 const messages=createCommunicationsStore({databasePath:join(dir,'messages.sqlite'),
  ownerAccountId:owner.id});
 messages.sendChat({senderId:owner.id,recipientId:worker.id,body:'Synthetic review',clientId:'chat'});
 messages.sendMail({senderId:owner.id,recipientId:worker.id,
  toAddress:messages.addressFor(worker.id),subject:'Review',body:'Synthetic mail',clientId:'mail'});
 let service;
 const central=https.createServer(tls,async(req,res)=>{
  if(!await service.handle(req,res)){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>central.listen(0,'127.0.0.1',resolve));
 const workspace='https://127.0.0.1:'+central.address().port;
 const localToken=token(),handshakes=new Map(),linked=new Map(),callbackRequests=[];
 let nativeOrigin;
 const client={id:'eel',appId:'eel',secret:token(),redirectUris:[],nativeOrigin:null};
 const nativeName='test_native_session';
 const session=req=>cookie(req,nativeName)===localToken;
 const safePost=req=>req.headers.origin===nativeOrigin&&
   ['same-origin','none',undefined].includes(req.headers['sec-fetch-site']);
 const nativeScript="document.getElementById('connect').onclick=async()=>{"+
  "const r=await fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});"+
  "if(r.ok)location.assign((await r.json()).redirectUrl);};";
 const callbackScript="(async()=>{const q=new URL(location.href).searchParams;"+
  "const keys=[...q.keys()],state=q.get('state'),code=q.get('code');"+
  "history.replaceState(null,'','/auth/callback');"+
  "if(keys.length!==2||new Set(keys).size!==2||"+
  "!/^[A-Za-z0-9_-]{32,128}$/.test(state||'')||"+
  "!/^[A-Za-z0-9_-]{32,128}$/.test(code||'')){location.replace('/?result=error');return;}"+
  "try{const r=await fetch('/api/complete',{method:'POST',"+
  "headers:{'Content-Type':'application/json'},body:JSON.stringify({state,code})});"+
  "location.replace('/?result='+(r.ok?'connected':'error'));}"+
  "catch{location.replace('/?result=error')}})();";
 const native=https.createServer(tls,async(req,res)=>{
  try{
   const u=new URL(req.url,nativeOrigin);
   if(req.method==='GET'&&u.pathname==='/native-login'){
    res.writeHead(303,{...noStore,'Location':'/',
     'Set-Cookie':nativeName+'='+localToken+'; Path=/; Secure; HttpOnly; SameSite=Strict'});
    res.end();return;
   }
   if(req.method==='GET'&&u.pathname==='/'){
    if(!session(req))return json(res,401,{error:'Local session required'});
    return html(res,'<!doctype html><title>Synthetic native app</title>'+
     '<button id="connect">Connect Workspace</button><span id="result">'+
     (u.searchParams.get('result')||'')+'</span><script src="/native.js"></script>');
   }
   if(req.method==='GET'&&u.pathname==='/native.js'){
    res.writeHead(200,{...noStore,'Content-Type':'text/javascript'});res.end(nativeScript);return;
   }
   if(req.method==='GET'&&u.pathname==='/callback.js'){
    res.writeHead(200,{...noStore,'Content-Type':'text/javascript'});res.end(callbackScript);return;
   }
   if(req.method==='GET'&&u.pathname==='/auth/callback'){
    callbackRequests.push({cookie:req.headers.cookie||'',referer:req.headers.referer||'',
     params:[...u.searchParams.keys()],url:req.url});
    return html(res,'<!doctype html><title>Native callback</title>'+
     '<script src="/callback.js" defer></script>',{
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'"
     });
   }
   if(req.method==='GET'&&u.pathname==='/api/status'){
    return session(req)?json(res,200,{linked:linked.has(localToken)}):
     json(res,401,{error:'Native login required'});
   }
   if(req.method==='GET'&&u.pathname==='/api/unread'){
    if(!session(req))return json(res,401,{error:'Native login required'});
    const proof=linked.get(localToken);
    if(!proof)return json(res,409,{error:'No native Workspace grant'});
    const result=await trustedPost(workspace,'/api/suite/native/communications/unread',
     tls.cert,client.secret,{sessionToken:proof});
    return result.status===200?json(res,200,result.data):
     json(res,409,{error:'Unavailable native Workspace grant'});
   }
   if(req.method==='POST'&&['/api/start','/api/complete','/api/unlink'].includes(u.pathname)){
    if(!safePost(req))return json(res,403,{error:'Origin denied'});
    if(!session(req))return json(res,401,{error:'Native login required'});
    const data=await body(req);
    if(u.pathname==='/api/start'){
     if(Object.keys(data).length)return json(res,400,{error:'Invalid request'});
     const state=token(),verifier=token();
     handshakes.clear();handshakes.set(state,verifier);
     const url=new URL('/connect',workspace);
     const fields={appId:'eel',redirectUri:nativeOrigin+'/auth/callback',state,
      codeChallenge:createHash('sha256').update(verifier).digest('base64url')};
     Object.entries(fields).forEach(([k,v])=>url.searchParams.set(k,v));
     return json(res,200,{redirectUrl:url.href});
    }
    if(u.pathname==='/api/complete'){
     if(Object.keys(data).length!==2||typeof data.state!=='string'||
      typeof data.code!=='string')return json(res,400,{error:'Invalid callback'});
     const verifier=handshakes.get(data.state);handshakes.delete(data.state);
     if(!verifier)return json(res,409,{error:'Replay or wrong state'});
     const result=await trustedPost(workspace,'/api/suite/auth/exchange',
      tls.cert,client.secret,{clientId:'eel',code:data.code,state:data.state,
       codeVerifier:verifier,redirectUri:nativeOrigin+'/auth/callback'});
     if(result.status!==200||result.data.issuer!==workspace||
       result.data.audience!=='eel'||result.data.subject!==worker.id||
       result.data.localIdentity?.userId!=='native-worker'||
       result.data.localIdentity?.organizationId!=='lab-a'||
       !/^[A-Za-z0-9_-]{32,128}$/.test(result.data.sessionToken||''))
      return json(res,409,{error:'Broker identity mismatch'});
     linked.set(localToken,result.data.sessionToken);
     return json(res,200,{linked:true});
    }
    if(Object.keys(data).length)return json(res,400,{error:'Invalid unlink'});
    const proof=linked.get(localToken);linked.delete(localToken);
    if(proof)await trustedPost(workspace,'/api/suite/auth/revoke',
     tls.cert,client.secret,{clientId:'eel',sessionToken:proof,childOnly:true});
    return json(res,200,{linked:false});
   }
   json(res,404,{error:'Not found'});
  }catch{json(res,503,{error:'Synthetic native service unavailable'})}
 });
 await new Promise(resolve=>native.listen(0,'127.0.0.1',resolve));
 nativeOrigin='https://localhost:'+native.address().port;
 client.nativeOrigin=nativeOrigin;
 client.redirectUris=[nativeOrigin+'/auth/callback'];
 service=createAccountService({origin:workspace,issuer:workspace,clients:[client],
  identityStore:ids,authStore:auth.brokerStore,
  organizationStore:standalone?null:org,
  communicationsStore:messages,ownerAccountId:owner.id,
  assetRoot:fileURLToPath(new URL('../private-ui/',import.meta.url)),
  getClientAddress:req=>req.socket.remoteAddress});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox',
  '--host-resolver-rules=MAP localhost 127.0.0.1']});
 const context=await browser.newContext({ignoreHTTPSErrors:true});
 const page=await context.newPage(),requests=[];
 page.on('request',r=>requests.push(r.url()));
 t.after(async()=>{
  await browser.close();
  for(const server of [native,central]){
   server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
  }
  messages.close();org.close();ids.close();auth.close();
  rmSync(dir,{recursive:true,force:true});
 });
 return {page,context,workspace,nativeOrigin,org,owner,member,client,
  callbackRequests,requests,nativeName};
}
test('real Chromium HTTPS cross-site org-mode Connect denies legacy grants without child proof',{timeout:60000},async t=>{
 const f=await fixture(t);
 await f.page.goto(f.nativeOrigin+'/native-login');
 await f.page.waitForURL(f.nativeOrigin+'/');
 const localCookie=(await f.context.cookies(f.nativeOrigin))
  .find(row=>row.name===f.nativeName);
 assert(localCookie?.httpOnly&&localCookie?.secure);
 assert.equal(localCookie.sameSite,'Strict');
 await f.page.locator('#connect').click();
 await f.page.waitForURL(u=>u.origin===f.workspace&&u.pathname==='/connect');
 const params=new URL(f.page.url()).searchParams;
 assert.deepEqual([...params.keys()].sort(),['appId','codeChallenge','redirectUri','state']);
 assert.equal(params.get('redirectUri'),f.nativeOrigin+'/auth/callback');
 await f.page.locator('#login:not([hidden])').waitFor();
 await f.page.locator('#email').fill('worker@example.test');
 await f.page.locator('#password').fill('Worker synthetic password 123456');
 await f.page.getByRole('button',{name:'Sign in and continue'}).click();
 await f.page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('could not be authorized'));
 assert(f.page.url().startsWith(f.workspace+'/connect?'),
  'legacy grant cannot trigger native HTTPS callback even when IDs match');
 assert.equal(f.callbackRequests.length,0);
 const centralCookie=(await f.context.cookies(f.workspace))
  .find(row=>row.name.includes('suite_identity'));
 assert(centralCookie?.httpOnly&&centralCookie?.secure);
 assert(!(await f.context.cookies(f.nativeOrigin))
  .some(row=>row.name.includes('suite_identity')));
 // The local native login still works; its independent session was neither
 // promoted into a Workspace child proof nor revoked by denied central SSO.
 assert.deepEqual(await(await f.page.request.get(f.nativeOrigin+'/api/status')).json(),
  {linked:false});
 assert.equal((await f.page.request.get(f.nativeOrigin+'/api/unread')).status(),409,
  'native route cannot mistake an old global mapping for a child proof');
 await f.page.goto(f.nativeOrigin+'/native-login');
 await f.page.waitForURL(f.nativeOrigin+'/');
 const unlinked=await f.page.evaluate(async()=>{
  const r=await fetch('/api/unlink',{method:'POST',
   headers:{'Content-Type':'application/json'},body:'{}'});
  return r.json();
 });
 assert.deepEqual(unlinked,{linked:false});
 assert.deepEqual(await(await f.page.request.get(f.nativeOrigin+'/api/status')).json(),
  {linked:false});
});

test('standalone native HTTPS browser login still completes exact PKCE callback and child-only unlink',{timeout:90000},async t=>{
 const f=await fixture(t,{standalone:true});
 await f.page.goto(f.nativeOrigin+'/native-login');
 await f.page.waitForURL(f.nativeOrigin+'/');
 const nativeCookie=(await f.context.cookies(f.nativeOrigin))
  .find(row=>row.name===f.nativeName);
 assert(nativeCookie?.httpOnly&&nativeCookie?.secure);
 assert.equal(nativeCookie.sameSite,'Strict');
 await f.page.locator('#connect').click();
 await f.page.waitForURL(u=>u.origin===f.workspace&&u.pathname==='/connect');
 await f.page.locator('#login:not([hidden])').waitFor();
 await f.page.locator('#email').fill('worker@example.test');
 await f.page.locator('#password').fill('Worker synthetic password 123456');
 await f.page.getByRole('button',{name:'Sign in and continue'}).click();
 await f.page.waitForURL(f.nativeOrigin+'/?result=connected');
 assert.equal(f.callbackRequests.length,1);
 assert(!f.callbackRequests[0].cookie.includes(f.nativeName+'='),
  'Strict native cookie must NOT cross an external first-party SSO callback');
 assert.equal(f.callbackRequests[0].referer,'');
 assert.deepEqual(f.callbackRequests[0].params.sort(),['code','state']);
 assert.deepEqual(await(await f.page.request.get(f.nativeOrigin+'/api/status')).json(),
  {linked:true});
 // Native resource APIs independently enforce authorization. A child identity
 // proof is not a Workspace entitlement or a license for scientific operations.
 const child=await f.page.evaluate(async()=>{
  const r=await fetch('/api/unlink',{method:'POST',
   headers:{'Content-Type':'application/json'},body:'{}'});
  return r.json();
 });
 assert.deepEqual(child,{linked:false});
 assert.deepEqual(await(await f.page.request.get(f.nativeOrigin+'/api/status')).json(),
  {linked:false});
 const session=await f.page.request.get(f.workspace+'/api/suite/auth/session');
 assert.equal((await session.json()).authenticated,true,
  'child-only unlink must keep standalone parent session active');
});
