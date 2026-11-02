import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationsStore} from '../communications-store.mjs';
import {createPublicContactHandler,createResendContactMailer,dispatchContactMail} from '../public-contact-relay.mjs';
const origin='https://dennisbsj.github.io';
const valid={submissionId:'request-20261102-123',name:'Visitor',
 email:'visitor@example.test',organisation:'Laboratory',
 subject:'DuckBio question',message:'Please contact us',
 turnstileToken:'synthetic-verified-token-1234'};
async function fixture(t,{verification={success:true,hostname:'dennisbsj.github.io',action:'contact'}}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-public-contact-'));
 let now=1800000000000;
 const store=createCommunicationsStore({databasePath:join(dir,'private','contact.sqlite'),
  clock:()=>now,ownerAccountId:'owner1'});
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify')
   return {ok:true,json:async()=>verification};
  if(url==='https://api.resend.com/emails')
   return {ok:true,json:async()=>({id:'mail_provider_fixture'})};
  throw Error('Unexpected external destination');
 };
 let handler;
 const server=http.createServer((req,res)=>{void handler(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const host='127.0.0.1:'+server.address().port;
 handler=createPublicContactHandler({communicationsStore:store,
  turnstileSecret:'synthetic-private-turnstile-secret1234567',
  allowedOrigins:[origin],host,fetchImpl});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));
  store.close();rmSync(dir,{recursive:true,force:true});});
 async function request(body=valid,headers={},method='POST'){
  return fetch('http://'+host,{method,headers:{Origin:origin,
   ...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
 }
 const mailer=createResendContactMailer({apiKey:'re_fake_synthetic_private_key1234',
  from:'DuckBio <contact@duckbio.net>',to:'actual-owner@example.test',fetchImpl});
 return {request,store,calls,mailer,setTime:value=>{now=value;}};
}
test('public contact requires exact origin and positive Turnstile verification before writing inbox',async t=>{
 const f=await fixture(t);
 const bad=await f.request(valid,{Origin:'https://attacker.example'});
 assert.equal(bad.status,403);
 assert.equal(f.store.listMail('owner1').length,0);
 const opts=await f.request(null,{},'OPTIONS');
 assert.equal(opts.status,204);
 assert.equal(opts.headers.get('access-control-allow-origin'),origin);
 const resp=await f.request();
 assert.equal(resp.status,202);
 assert.deepEqual(await resp.json(),{accepted:true,internalDelivered:true,externalStatus:'queued'});
 const inbox=f.store.listMail('owner1');
 assert.equal(inbox.length,1);
 assert.equal(inbox[0].kind,'contact');
 assert.equal(inbox[0].to,'support@duckbio.internal');
 assert.match(inbox[0].body,/External email: visitor@example.test/);
 assert(!JSON.stringify(inbox).includes('synthetic-verified-token'));
 const receipt=await f.request();
 assert.equal(receipt.status,202);
 assert.equal(f.store.listMail('owner1').length,1,'retry has idempotent internal mail');
});
test('wrong turnstile hostname/action/success fails closed and sends nothing',async t=>{
 for(const verification of [
  {success:false,hostname:'dennisbsj.github.io',action:'contact'},
  {success:true,hostname:'another.example',action:'contact'},
  {success:true,hostname:'dennisbsj.github.io',action:'other'}
 ]){
  const f=await fixture(t,{verification});
  assert.equal((await f.request()).status,403);
  assert.equal(f.store.listMail('owner1').length,0);
 }
});
test('contact outbox sends actual Resend mail with stable idempotency and private support copy',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request()).status,202);
 const outcome=await dispatchContactMail({communicationsStore:f.store,mailer:f.mailer});
 assert.deepEqual(outcome,{accepted:1,retry:0});
 const req=f.calls.find(x=>x.url==='https://api.resend.com/emails');
 assert(req);
 assert.equal(req.options.method,'POST');
 assert.equal(req.options.headers['Idempotency-Key'],'duckbio-contact-'+valid.submissionId);
 const sent=JSON.parse(req.options.body);
 assert.deepEqual(sent.to,['actual-owner@example.test']);
 assert.equal(sent.reply_to,'visitor@example.test');
 assert.match(sent.text,/Please contact us/);
 assert.equal(f.store.claimPublicContactDelivery(),null);
 assert.equal(f.store.listMail('owner1').length,1);
});
test('contact abuse bounds reject subject/header spoofing, conflicting replay, excessive submissions',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request({...valid,subject:'Spoof\nBcc: fake@example.test'})).status,400);
 assert.equal((await f.request()).status,202);
 assert.equal((await f.request({...valid,subject:'Changed'})).status,409);
 for(let i=1;i<=4;i++)assert.equal((await f.request({...valid,
  submissionId:'contact-repeat-'+i})).status,202);
 assert.equal((await f.request({...valid,submissionId:'contact-repeat-six'})).status,429);
 assert.equal(f.store.listMail('owner1').length,5);
});
test('failed outgoing provider delivery remains queued and retries after exponential backoff',async t=>{
 const f=await fixture(t);
 await f.request();
 const errorMailer={async send(){throw Error('provider offline');}};
 const failed=await dispatchContactMail({communicationsStore:f.store,mailer:errorMailer});
 assert.equal(failed.retry,1);
 assert.equal(f.store.claimPublicContactDelivery(),null);
 f.setTime(1800000000000+120001);
 const delivered=await dispatchContactMail({communicationsStore:f.store,mailer:f.mailer});
 assert.equal(delivered.accepted,1);
 assert.equal(f.store.claimPublicContactDelivery(),null);
 assert.equal(f.store.listMail('owner1').length,1);
});
