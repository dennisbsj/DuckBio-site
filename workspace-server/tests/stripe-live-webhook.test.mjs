import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createStripeLiveWebhookVerifier} from '../stripe-live-webhook.mjs';

const secret='whsec_synthetic_live_secret_123456';
const other='whsec_synthetic_other_secret_123456';
const now=1800000000000;
const base=()=>({
 id:'evt_live_Fixture1234',type:'invoice.paid',livemode:true,
 created:Math.floor(now/1000),data:{object:{
  id:'in_live_Fixture1234',livemode:true,
  customer:'cus_live_Sensitive12345',metadata:{anything:'private'}
 }}
});
const signed=(event=base(),timestamp=Math.floor(now/1000),key=secret)=>{
 const rawBody=Buffer.isBuffer(event)?event:Buffer.from(typeof event==='string'?event:JSON.stringify(event));
 const signature=createHmac('sha256',key).update(String(timestamp)+'.').update(rawBody).digest('hex');
 return {rawBody,signature:'t='+timestamp+',v1='+signature};
};
const verifier=createStripeLiveWebhookVerifier({webhookSecret:secret,clock:()=>now});

test('signed raw LIVE invoice event yields bounded metadata and no license authorization',()=>{
 const x=verifier.verify(signed());
 assert.equal(x.id,'evt_live_Fixture1234');
 assert.equal(x.type,'invoice.paid');
 assert.equal(x.objectId,'in_live_Fixture1234');
 assert.equal(x.mode,'live');
 assert.equal(x.licensesGranted,false);
 assert.equal(x.authorizesSeatChanges,false);
 assert.match(x.digest,/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(x,'data'),false);
 assert.equal(Object.hasOwn(x,'customer'),false);
 assert(!JSON.stringify(x).includes('cus_live_Sensitive12345'));
 assert(Object.isFrozen(x));
});
test('recognized subscription and checkout events are metadata only, never payment proof',()=>{
 for(const [type,id] of [
  ['customer.subscription.created','sub_live_Fixture1234'],
  ['customer.subscription.updated','sub_live_Fixture1234'],
  ['customer.subscription.deleted','sub_live_Fixture1234'],
  ['checkout.session.completed','cs_live_Fixture1234'],
  ['invoice.payment_succeeded','in_live_Fixture1234'],
  ['invoice.payment_failed','in_live_Fixture1234'],
  ['invoice.finalization_failed','in_live_Fixture1234']
 ]){
  const event=base();
  event.type=type;event.data.object.id=id;
  const out=verifier.verify(signed(event));
  assert.equal(out.type,type);
  assert.equal(out.objectId,id);
  assert.equal(out.licensesGranted,false);
  assert.equal(out.authorizesSeatChanges,false);
 }
});
test('signature verification rejects raw-body tampering, wrong keys, old timestamps and unknown algorithms',()=>{
 const original=signed();
 const changed=Buffer.from(original.rawBody.toString().replace('invoice.paid','invoice.voided'));
 assert.throws(()=>verifier.verify({...original,rawBody:changed}),/Unverified/);
 assert.throws(()=>verifier.verify(signed(base(),Math.floor(now/1000),other)),/Unverified/);
 for(const t of [Math.floor(now/1000)-301,Math.floor(now/1000)+301]){
  assert.throws(()=>verifier.verify(signed(base(),t)),/Expired/);
 }
 const invalid=signed();
 assert.throws(()=>verifier.verify({...invalid,signature:'t=1800000000,v0='+invalid.signature.split('v1=')[1]}),/Missing/);
 assert.throws(()=>verifier.verify({...invalid,signature:invalid.signature+',t=1800000000'}),/Missing/);
 assert.throws(()=>verifier.verify({...invalid,signature:'t=nan,v1='+invalid.signature.split('v1=')[1]}),/Missing/);
 assert.throws(()=>createStripeLiveWebhookVerifier({
  webhookSecret:secret,clock:()=>Number.NaN}).verify(signed()),/Expired/);
});
test('test-mode, Connect events, spoofed object type and mismatched object mode are rejected',()=>{
 const invalid=[
  e=>e.livemode=false,
  e=>e.data.object.livemode=false,
  e=>e.account='acct_other1234',
  e=>e.data.object.id='sub_live_other1234',
  e=>e.id='evt invalid',
  e=>e.type='invoice.fake',
  e=>e.created=-1,
  e=>e.data={object:null},
 ];
 for(const change of invalid){
  const e=base();change(e);
  assert.throws(()=>verifier.verify(signed(e)),/Unsupported Stripe LIVE webhook event/);
 }
});
test('strict input size, JSON and private-secret checks',()=>{
 assert.throws(()=>verifier.verify({...signed(),rawBody:Buffer.alloc(65537)}),/Invalid Stripe LIVE webhook input/);
 assert.throws(()=>verifier.verify({...signed(),rawBody:'not-raw-bytes'}),/Invalid Stripe LIVE webhook input/);
 assert.throws(()=>verifier.verify({...signed(),signature:'x'.repeat(2049)}),/Invalid Stripe LIVE webhook input/);
 assert.throws(()=>verifier.verify(signed('invalid json')),/Invalid Stripe LIVE webhook JSON/);
 assert.throws(()=>createStripeLiveWebhookVerifier({webhookSecret:'whsec_short'}),/Private Stripe LIVE webhook/);
 assert.throws(()=>createStripeLiveWebhookVerifier({webhookSecret:secret,clock:42}),/Invalid Stripe LIVE webhook clock/);
});
test('multiple rotated v1 signatures may match, but verified metadata digest changes with bytes',()=>{
 const x=signed();
 const duplicate='0'.repeat(64);
 const result=verifier.verify({...x,signature:x.signature+',v1='+duplicate});
 assert.equal(result.id,'evt_live_Fixture1234');
 const e=base();e.data.object.metadata.another='different';
 const changed=verifier.verify(signed(e));
 assert.notEqual(changed.digest,result.digest);
});
