import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';
import {createStripeLiveSettlementTraceReview} from '../stripe-live-settlement-trace-review.mjs';

const NOW=1800000000000;
const org='org-alpha',sub='sub_live_TEST1234',customer='cus_live_TEST1234';
const price='price_live_TEST1234',inv='in_live_TEST1234';
const intentId='pi_live_TEST1234',chargeId='ch_live_TEST1234';
const input={organizationId:org,subscriptionId:sub};
function records(){
 return {
  ['subscriptions/'+sub]:{
   id:sub,object:'subscription',livemode:true,customer,
   metadata:{organization_id:org},status:'active',
   latest_invoice:inv,items:{has_more:false,data:[{quantity:2,price:{
    id:price,livemode:true,recurring:{usage_type:'licensed'}
   }}]}
  },
  ['invoices/'+inv]:{
   id:inv,object:'invoice',livemode:true,customer,
   parent:{subscription_details:{subscription:sub}},status:'paid',
   paid:true,paid_out_of_band:false,amount_paid:2000,amount_remaining:0,
   pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,
   currency:'eur'
  },
  ['invoices/'+inv+'/payments?limit=100']:{
   object:'list',has_more:false,data:[{
    id:'inpay_live_TEST1234',object:'invoice_payment',livemode:true,
    invoice:inv,status:'paid',currency:'eur',amount_paid:2000,
    payment:{type:'payment_intent',payment_intent:intentId}
   }]
  },
  ['payment_intents/'+intentId]:{
   id:intentId,object:'payment_intent',livemode:true,customer,
   status:'succeeded',currency:'eur',amount_received:2000,
   latest_charge:chargeId
  },
  ['charges/'+chargeId]:{
   id:chargeId,object:'charge',livemode:true,customer,
   payment_intent:intentId,currency:'eur',
   status:'succeeded',paid:true,captured:true,disputed:false,
   refunded:false,amount_refunded:0,amount:2000,
   refunds:{has_more:false,data:[]}
  }
 };
}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-live-trace-'));
 const db=join(dir,'org.sqlite'),opaque=Symbol('verified evidence');
 let event=1;
 const store=createOrganizationStore({
  databasePath:db,clock:()=>NOW,
  verifyLiveBillingBindingEvidence:proof=>{
   if(proof!==opaque)throw Error('untrusted_binding');
   return {
    source:'stripe_live',eventKey:'trace_event_'+event,
    organizationId:org,subscriptionId:sub,customerId:customer,
    priceId:price,plan:'Single',apps:['eel'],seats:2,revision:event
   };
  }
 });
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 store.setupOrganization({organizationId:org,name:'Lab',owner:{
  accountId:'owner',name:'Owner',nickname:'O',email:'owner@example.test'
 }});
 store.pinVerifiedStripeLiveBinding(opaque);
 const responseByPath=records(),calls=[];
 let billingResult={state:'candidate_for_manual_review',
  licensesGranted:false,authorizesSeatChanges:false};
 let hook=null;
 const review=createStripeLiveSettlementTraceReview({
  organizationStore:store,clock:()=>NOW,
  billingReader:{inspect:async()=>billingResult},
  secretKey:'sk_live_synthetic_private_review_key_123456789',
  fetchImpl:async(url,init)=>{
   const prefix='https://api.stripe.com/v1/';
   assert(url.startsWith(prefix));
   calls.push({url,init});
   const path=url.slice(prefix.length);
   if(hook)await hook(path);
   const payload=responseByPath[path];
   if(payload===undefined)throw Error('unregistered Stripe fixture path '+path);
   return payload instanceof Response?payload:new Response(JSON.stringify(payload),{
    headers:{'content-type':'application/json'}
   });
  }
 });
 return {store,review,records:responseByPath,calls,
  setBilling:value=>{billingResult=value},
  hook:fn=>{hook=fn},
  revise:()=>{event++;return store.pinVerifiedStripeLiveBinding(opaque)},
  purchased:()=>store.overview(org,'owner').apps.find(x=>x.id==='eel').purchased};
}
const isDenied=x=>['manual_review','unavailable'].includes(x.state)&&
 x.reason!=='payment_chain_traced_at_check'&&x.licensesGranted===false&&
 x.authorizesSeatChanges===false;
test('private pinned LIVE payment chain can only be traced for manual review, never licensing',async t=>{
 const f=fixture(t);
 const result=await f.review.inspect(input);
 assert.deepEqual(result,{
  state:'manual_review',reason:'payment_chain_traced_at_check',
  bindingRevision:1,checkedAt:NOW,
  licensesGranted:false,authorizesSeatChanges:false,
  paymentEvidenceAuthoritative:false
 });
 assert.equal(f.calls.length,5);
 for(const call of f.calls){
  assert.equal(call.init.method,'GET');
  assert.equal(call.init.redirect,'error');
  assert.equal(call.init.cache,'no-store');
  assert.equal(call.init.credentials,'omit');
  assert.match(call.init.headers.Authorization,/^Bearer sk_live_/);
 }
 assert(!JSON.stringify(result).includes('cus_live_'));
 assert(!JSON.stringify(result).includes('in_live_'));
 assert.equal(f.purchased(),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
});
test('absent, foreign or unverified pin denies before external Stripe fetch',async t=>{
 const f=fixture(t);
 for(const query of [
  {organizationId:'org-beta',subscriptionId:sub},
  {organizationId:org,subscriptionId:'sub_live_UNKNOWN1234'},
  {organizationId:org,subscriptionId:'sub_live_bad!'}
 ]){
  const r=await f.review.inspect(query);
  assert.equal(r.state,'unavailable');
  assert.equal(r.licensesGranted,false);
 }
 assert.equal(f.calls.length,0);
 f.setBilling({state:'manual_review',licensesGranted:false,
  authorizesSeatChanges:false});
 assert.equal(isDenied(await f.review.inspect(input)),true);
 f.setBilling({state:'candidate_for_manual_review',licensesGranted:true,
  authorizesSeatChanges:false});
 assert.equal(isDenied(await f.review.inspect(input)),true);
 assert.equal(f.calls.length,0);
});
test('out-of-band, credit-note or unlinked invoice cannot qualify for even clean trace',async t=>{
 const f=fixture(t),invoice=f.records['invoices/'+inv];
 for(const [key,value] of [
  ['paid_out_of_band',true],['paid',false],['amount_paid',0],
  ['amount_remaining',100],['post_payment_credit_notes_amount',1],
  ['pre_payment_credit_notes_amount',100],
  ['customer','cus_live_FOREIGN1234']
 ]){
  const prev=invoice[key];invoice[key]=value;
  const result=await f.review.inspect(input);
  assert(isDenied(result),key);
  invoice[key]=prev;
 }
 assert.equal(f.purchased(),0);
});

test('split, paginated, unpaid or non-Stripe invoice payment allocations require review',async t=>{
 const f=fixture(t),pay=f.records['invoices/'+inv+'/payments?limit=100'];
 for(const edit of [
  p=>p.data.push({...p.data[0]}),
  p=>p.has_more=true,
  p=>p.data[0].status='open',
  p=>p.data[0].invoice='in_live_OTHER1234',
  p=>p.data[0].amount_paid=100,
  p=>p.data[0].payment.type='out_of_band',
  p=>p.data[0].payment.payment_intent='pi_live_WRONG1234'
 ]){
  const before=structuredClone(pay);edit(pay);
  assert(isDenied(await f.review.inspect(input)));
  Object.assign(pay,before);
 }
 assert.equal(f.purchased(),0);
});
test('PaymentIntent must prove correct customer and succeeded charge source',async t=>{
 const f=fixture(t),intent=f.records['payment_intents/'+intentId];
 for(const [key,value] of [
  ['customer','cus_live_WRONG1234'],['status','requires_payment_method'],
  ['amount_received',1000],['latest_charge',null],['currency','usd'],
  ['livemode',false]
 ]){
  const prev=intent[key];intent[key]=value;
  assert(isDenied(await f.review.inspect(input)),key);
  intent[key]=prev;
 }
});
test('refunded, disputed, uncaptured or failed charge always demands manual review',async t=>{
 const f=fixture(t),charge=f.records['charges/'+chargeId];
 for(const [key,value] of [
  ['refunded',true],['disputed',true],['amount_refunded',500],
  ['paid',false],['captured',false],['status','failed'],
  ['amount',1500],['customer','cus_live_OTHER1234'],
  ['payment_intent','pi_live_OTHER1234'],['livemode',false]
 ]){
  const prev=charge[key];charge[key]=value;
  assert(isDenied(await f.review.inspect(input)),key);
  charge[key]=prev;
 }
 const original=charge.refunds;
 for(const refunds of [undefined,{has_more:true,data:[]},
   {has_more:false,data:[{id:'re_live_TEST1234'}]}]){
  charge.refunds=refunds;
  assert(isDenied(await f.review.inspect(input)));
 }
 charge.refunds=original;
 assert.equal(f.purchased(),0);
});
test('a binding revision change while Stripe responds invalidates the complete trace',async t=>{
 const f=fixture(t);
 let changed=false;
 f.hook:path=>{
  if(path==='charges/'+chargeId&&!changed){changed=true;f.revise();}
 });
 const result=await f.review.inspect(input);
 assert.equal(result.state,'unavailable');
 assert.equal(result.reason,'pin_changed_during_settlement_lookup');
 assert.equal(result.licensesGranted,false);
 assert.equal(f.purchased(),0);
});

test('malformed, oversized or failing private Stripe responses never become entitlement evidence',async t=>{
 const f=fixture(t);
 const id='payment_intents/'+intentId,prior=f.records[id];
 for(const reply of [
  new Response('<html>error</html>',{headers:{'content-type':'text/html'}}),
  new Response(JSON.stringify({livemode:true,padding:'x'.repeat(150000)}),{
   headers:{'content-type':'application/json'}
  }),
  new Response('not json',{headers:{'content-type':'application/json'}}),
  new Response(new Uint8Array([123,34,120,34,58,34,195,40,34,125]),{
   headers:{'content-type':'application/json'}
  }),
  new Response('{"error":"unavailable"}',{status:503,
   headers:{'content-type':'application/json'}})
 ]){
  f.records[id]=reply;
  const result=await f.review.inspect(input);
  assert.equal(result.state,'unavailable');
  assert.equal(result.licensesGranted,false);
  assert.equal(result.paymentEvidenceAuthoritative,false);
  assert.equal(f.purchased(),0);
 }
 f.records[id]=prior;
});
