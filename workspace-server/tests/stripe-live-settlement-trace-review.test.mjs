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
const isDenied=x=>x.state==='manual_review'&&
 x.reason!=='payment_chain_traced_at_check'&&x.licensesGranted===false;
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
