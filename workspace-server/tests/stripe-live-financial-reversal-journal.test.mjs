import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStripeLiveWebhookVerifier} from '../stripe-live-webhook.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {STRIPE_LIVE_EVENT_PREFIXES,stripeLiveReviewCategory}
 from '../stripe-live-review-event-catalog.mjs';

const NOW=1800000000000;
const secret='whsec_synthetic_reversal123456789';
const stamp=Math.floor(NOW/1000);
const verifier=createStripeLiveWebhookVerifier({webhookSecret:secret,clock:()=>NOW});
const reviewTypes=[
 ['charge.refunded','ch_','charge','refund_review'],
 ['charge.dispute.created','dp_','dispute','dispute_review'],
 ['charge.dispute.updated','dp_','dispute','dispute_review'],
 ['charge.dispute.closed','dp_','dispute','dispute_review'],
 ['charge.dispute.funds_withdrawn','dp_','dispute','dispute_review'],
 ['charge.dispute.funds_reinstated','dp_','dispute','dispute_review'],
 ['refund.created','re_','refund','refund_review'],
 ['refund.updated','re_','refund','refund_review'],
 ['refund.failed','re_','refund','refund_review'],
 ['credit_note.created','cn_','credit_note','credit_note_review'],
 ['credit_note.updated','cn_','credit_note','credit_note_review'],
 ['credit_note.voided','cn_','credit_note','credit_note_review'],
 ['invoice.voided','in_','invoice','invoice_void_review']
];
const event=(type,prefix,object,n=1)=>({
 id:'evt_live_reversal'+n+'1234',livemode:true,type,created:stamp,
 data:{object:{
  object,id:prefix+'live_reversal12345',livemode:true,
  customer:'cus_live_private12345',metadata:{email:'private@example.test'},
  disputed:true,refunds:{data:[{email:'customer@example.test'}]}
 }}
});
function signed(data){
 const rawBody=Buffer.from(JSON.stringify(data));
 const mac=createHmac('sha256',secret).update(stamp+'.')
  .update(rawBody).digest('hex');
 return {rawBody,signature:'t='+stamp+',v1='+mac};
}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-stripe-reversal-'));
 const databasePath=join(dir,'secure','organizations.sqlite');
 let store;
 const reopen=()=>{
  store?.close();
  store=createOrganizationStore({databasePath,clock:()=>NOW});
 };
 reopen();
 t.after(()=>{store?.close();rmSync(dir,{force:true,recursive:true});});
 store.setupOrganization({organizationId:'org1',name:'Lab One',owner:{
  accountId:'owner',name:'Owner',nickname:'O',
  email:'owner@example.test'
 }});
 const seats=()=>store.overview('org1','owner').apps
  .map(app=>app.purchased);
 return {get store(){return store;},reopen,seats};
}
test('documented LIVE reversal/refund/dispute/credit-note types have exact signed object bindings',()=>{
 for(const [type,prefix,object,category] of reviewTypes){
  assert.equal(STRIPE_LIVE_EVENT_PREFIXES[type],prefix);
  assert.equal(stripeLiveReviewCategory(type),category);
  const result=verifier.verify(signed(event(type,prefix,object)));
  assert.equal(result.type,type);
  assert.equal(result.objectId,prefix+'live_reversal12345');
  assert.equal(result.financialReviewRequired,true);
  assert.equal(result.licensesGranted,false);
  assert.equal(result.authorizesSeatChanges,false);
  assert.equal(Object.hasOwn(result,'customer'),false);
  assert.equal(Object.hasOwn(result,'data'),false);
  assert.equal(Object.isFrozen(result),true);
  assert(!JSON.stringify(result).includes('private@example.test'));
 }
});
test('reversal webhook object family, prefix, signature, mode and account all fail closed',()=>{
 for(const [type,prefix,object] of reviewTypes){
  for(const mutate of [
   x=>x.data.object.object='other_type',
   x=>x.data.object.id='sub_live_wrong_id1234',
   x=>x.data.object.livemode=false,
   x=>x.livemode=false,
   x=>x.account='acct_other_account1234',
   x=>x.id='evt invalid'
  ]){
   const e=event(type,prefix,object);
   mutate(e);
   assert.throws(()=>verifier.verify(signed(e)),
    /Unsupported Stripe LIVE webhook event/);
  }
  const valid=signed(event(type,prefix,object));
  const tampered=Buffer.from(valid.rawBody.toString()
   .replace('private@example.test','other@example.test'));
  assert.throws(()=>verifier.verify({...valid,rawBody:tampered}),
   /Unverified Stripe LIVE webhook signature/);
 }
});
test('reversal type cannot be forged by swapping a signed invoice or subscriber ID',()=>{
 const e=event('charge.refunded','ch_','charge');
 e.type='refund.created';
 assert.throws(()=>verifier.verify(signed(e)),
  /Unsupported Stripe LIVE webhook event/);
 const bad=event('charge.dispute.created','dp_','charge');
 assert.throws(()=>verifier.verify(signed(bad)),
  /Unsupported Stripe LIVE webhook event/);
 for(const type of ['refund.not_real','charge.dispute.fake',
  'invoice.finalized_unknown']){
  const q=event(type,'ch_','charge');
  assert.throws(()=>verifier.verify(signed(q)),
   /Unsupported Stripe LIVE webhook event/);
 }
});
test('signed reversal signals persist with private review markers and never grant seats',t=>{
 const f=fixture(t);
 let i=0;
 for(const [type,prefix,object] of reviewTypes){
  const source=event(type,prefix,object,++i);
  const verified=verifier.verify(signed(source));
  assert.deepEqual(f.store.recordVerifiedStripeLiveEvent(verified),{
   recorded:true,duplicate:false,licensesGranted:false
  });
  assert.deepEqual(f.store.recordVerifiedStripeLiveEvent(verified),{
   recorded:false,duplicate:true,licensesGranted:false
  });
 }
 let snap=f.store.ownerSnapshot();
 assert.equal(snap.totals.liveWebhookEvents,reviewTypes.length);
 assert.equal(snap.totals.activeVerifiedSubscriptions,0);
 assert(f.seats().every(x=>x===0));
 assert(snap.liveWebhookEvents.every(x=>x.financialReviewRequired===true&&
  typeof x.reviewCategory==='string'&&x.linkage==='unassigned'&&
  x.licensesGranted===false));
 const serialized=JSON.stringify(snap.liveWebhookEvents);
 for(const privateValue of ['cus_live_private12345','private@example.test',
  'customer@example.test','ch_live_reversal12345','dp_live_reversal12345',
  're_live_reversal12345','cn_live_reversal12345']){
  assert(!serialized.includes(privateValue),privateValue);
 }
 f.reopen();
 snap=f.store.ownerSnapshot();
 assert.equal(snap.totals.liveWebhookEvents,reviewTypes.length);
 assert(snap.liveWebhookEvents.every(x=>x.financialReviewRequired===true));
 assert(f.seats().every(x=>x===0));
});
