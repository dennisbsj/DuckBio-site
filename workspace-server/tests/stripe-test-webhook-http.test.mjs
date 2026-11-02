import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSuiteRuntime} from '../shared-auth/runtime.mjs';

const secret='whsec_synthetic_test_secret_123456',now=1783090000000;
const origin='http://127.0.0.1',endpoint='/api/suite/billing/stripe-test-webhook';
const event={id:'evt_signed0001',type:'checkout.session.completed',created:Math.floor(now/1000),
 livemode:false,data:{object:{id:'cs_test_not_locally_known'}}};
function signed(value=event,t=Math.floor(now/1000),key=secret){
 const body=Buffer.from(JSON.stringify(value));
 return {body,signature:'t='+t+',v1='+createHmac('sha256',key).update(t+'.').update(body).digest('hex')};
}
async function fixture(t,{enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-test-webhook-http-'));
 mkdirSync(join(dir,'frontend'));writeFileSync(join(dir,'frontend','index.html'),'<html>Private Workspace</html>');
 const db=join(dir,'private','org.sqlite');
 const env={SUITE_MODE:'broker',SUITE_ORIGIN:origin,SUITE_ISSUER:'https://login.example.test',SUITE_CLIENTS:'[]',
  SUITE_AUTH_DB_PATH:join(dir,'auth.sqlite'),SUITE_IDENTITY_DB_PATH:join(dir,'identity.sqlite'),
  SUITE_ORGANIZATION_DB_PATH:db,SUITE_ASSET_ROOT:join(dir,'frontend'),
  SUITE_STRIPE_TEST_KEY:'sk_test_synthetic_private_key_12345',
  SUITE_STRIPE_TEST_PRICES_JSON:JSON.stringify({'Single:eel':'price_synthetic_12345'}),
  ...(enabled?{SUITE_STRIPE_TEST_WEBHOOK_SECRET:secret}:{})};
 const runtime=createSuiteRuntime({env,clock:()=>now});
 await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
 const port=runtime.server.address().port;
 t.after(async()=>{await new Promise(resolve=>runtime.server.close(resolve));runtime.close();rmSync(dir,{recursive:true,force:true});});
 const request=(path=endpoint,options={})=>new Promise((resolve,reject)=>{
  const headers={Host:'127.0.0.1',...options.headers};
  const req=http.request({hostname:'127.0.0.1',port,path,method:options.method||'POST',headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
  });
  req.on('error',reject);req.end(options.body);
 });
 const send=(input=signed(),options={})=>request(options.path??endpoint,{
  method:options.method??'POST',
  body:input.body,
  headers:{'Content-Type':'application/json','Stripe-Signature':input.signature,...options.headers}
 });
 return {send,request,db};
}
test('runtime ingests only valid raw Stripe test webhooks with no cookies or CSRF and no seats',async t=>{
 const f=await fixture(t);
 const known=signed();
 assert.equal((await f.send(known)).status,200);
 assert.deepEqual((await f.send(known)).body,{received:true,licensesGranted:false},'replay is harmless');
 assert.equal((await f.send({...known,body:Buffer.from(known.body.toString().replace('completed','updated'))})).status,400);
 assert.equal((await f.send(signed(event,Math.floor(now/1000)-301))).status,400);
 assert.equal((await f.send(signed({...event,livemode:true}))).status,400);
 assert.equal((await f.send(signed({...event,id:'evt_signed0001',data:{object:{id:'cs_test_other'}}}))).status,409);
 assert.equal((await f.send(known,{headers:{Host:'attacker.example.test'}})).status,400);
 assert.equal((await f.send(known,{headers:{Origin:'https://attacker.example.test'}})).status,400);
 assert.equal((await f.send(known,{headers:{'Content-Type':'text/plain'}})).status,400);
 assert.equal((await f.send(known,{path:endpoint+'?should=reject'})).status,400);
 assert.equal((await f.send(known,{method:'PUT'})).status,405);
 assert.equal((await f.send({body:Buffer.alloc(65537),signature:known.signature})).status,413);
 const db=new DatabaseSync(f.db);
 try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM stripe_test_webhook_events').get().n,1);
  assert.equal(db.prepare('SELECT org FROM stripe_test_webhook_events').get().org,null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM assignments').get().n,0);
 }finally{db.close();}
 const health=await f.request('/api/suite/health',{method:'GET'});
 assert.equal(health.status,200,'ordinary Workspace routing still works');
});
test('test webhook URL is not exposed when private signing secret is absent',async t=>{
 const f=await fixture(t,{enabled:false});
 assert.equal((await f.send()).status,404);
 const db=new DatabaseSync(f.db);
 try{assert.equal(db.prepare('SELECT count(*) AS n FROM stripe_test_webhook_events').get().n,0);}
 finally{db.close();}
});
