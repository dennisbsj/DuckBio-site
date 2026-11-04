import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {createOrganizationStore} from '../organization-store.mjs';
import {createStripeLiveWebhookVerifier} from '../stripe-live-webhook.mjs';
import {createStripeLiveFinancialEventCorrelator}
 from '../stripe-live-financial-event-correlation.mjs';

const NOW=1800000000000;
const ids={
 org:'lab-one',sub:'sub_live_ABCD1234',customer:'cus_live_ABCD1234',
 price:'price_live_ABCD1234',invoice:'in_live_OLD1234',
 charge:'ch_live_ABCD1234',intent:'pi_live_ABCD1234',
 refund:'re_live_ABCD1234',dispute:'du_live_ABCD1234',
 credit:'cn_live_ABCD1234'
};
const HMAC='whsec_synthetic_review_private_12345';
const webhooks=createStripeLiveWebhookVerifier({webhookSecret:HMAC,clock:()=>NOW});
const eventTypes={
 refund:['refund.updated',ids.refund,'refund'],
 dispute:['charge.dispute.created',ids.dispute,'dispute'],
 legacyDispute:['charge.dispute.closed','dp_live_ABCD1234','dispute'],
 charge:['charge.refunded',ids.charge,'charge'],
 credit:['credit_note.created',ids.credit,'credit_note'],
 void:['invoice.voided',ids.invoice,'invoice']
};
function signed(type,id,object,eventId,created=Math.floor(NOW/1000)){
 const source={id:eventId,type,created,livemode:true,
  data:{object:{id,object,livemode:true}}};
 const rawBody=Buffer.from(JSON.stringify(source));
 const stamp=String(Math.floor(NOW/1000));
 const mac=createHmac('sha256',HMAC).update(stamp+'.').update(rawBody).digest('hex');
 return webhooks.verify({rawBody,signature:'t='+stamp+',v1='+mac});
}
function sources(){
 return {
  ['subscriptions/'+ids.sub]:{
   object:'subscription',id:ids.sub,livemode:true,customer:ids.customer,
   metadata:{organization_id:ids.org},status:'canceled',
   latest_invoice:'in_live_CURRENT9999'
  },
  ['invoices/'+ids.invoice]:{
   object:'invoice',livemode:true,id:ids.invoice,customer:ids.customer,
   parent:{subscription_details:{subscription:ids.sub}},status:'paid'
  },
  ['credit_notes/'+ids.credit]:{
   object:'credit_note',id:ids.credit,livemode:true,
   customer:ids.customer,invoice:ids.invoice
  },
  ['refunds/'+ids.refund]:{
   object:'refund',id:ids.refund,livemode:true,charge:ids.charge
  },
  ['disputes/'+ids.dispute]:{
   object:'dispute',id:ids.dispute,livemode:true,charge:ids.charge
  },
  ['disputes/dp_live_ABCD1234']:{
   object:'dispute',id:'dp_live_ABCD1234',livemode:true,charge:ids.charge
  },
  ['charges/'+ids.charge]:{
   object:'charge',id:ids.charge,livemode:true,customer:ids.customer,
   payment_intent:ids.intent
  },
  ['payment_intents/'+ids.intent]:{
   object:'payment_intent',id:ids.intent,livemode:true,
   customer:ids.customer,latest_charge:ids.charge
  },
  ['invoices/'+ids.invoice+'/payments?limit=100']:{
   object:'list',has_more:false,data:[{
    object:'invoice_payment',livemode:true,invoice:ids.invoice,
    payment:{type:'payment_intent',payment_intent:ids.intent}
   }]
  }
 };
}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-event-linkage-'));
 const store=createOrganizationStore({
  databasePath:join(dir,'organizations.sqlite'),clock:()=>NOW
 });
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 store.setupOrganization({organizationId:ids.org,name:'Lab',owner:{
  accountId:'owner',name:'Owner',nickname:'O',email:'owner@example.test'
 }});
 const snap=sources(),requests=[];
 const pinned={
  organizationId:ids.org,subscriptionId:ids.sub,customerId:ids.customer,
  priceId:ids.price,plan:'Single',apps:['eel'],seats:2,revision:1,
  source:'pinned_stripe_live',licensesGranted:false,
  authorizesSeatChanges:false
 };
 let currentPin=structuredClone(pinned),hook=null;
 const correlate=createStripeLiveFinancialEventCorrelator({
  organizationStore:store,
  readPinnedSubscription:({organizationId,subscriptionId})=>
   organizationId===ids.org&&subscriptionId===ids.sub
    ?structuredClone(currentPin):null,
  secretKey:'sk_live_synthetic_readonly_key_123456789',
  fetchImpl:async(url,init)=>{
   const prefix='https://api.stripe.com/v1/';
   assert(url.startsWith(prefix));
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   requests.push(url.slice(prefix.length));
   const key=url.slice(prefix.length);
   if(hook)await hook(key);
   const value=snap[key];
   if(!value)throw Error('Unexpected Stripe fixture path '+key);
   return value instanceof Response?value:new Response(JSON.stringify(value),{
    status:200,headers:{'content-type':'application/json'}
   });
  }
 });
 const put=(kind,eventId='evt_live_'+kind+'12345',created=Math.floor(NOW/1000))=>{
  const [type,id,object]=eventTypes[kind];
  store.recordVerifiedStripeLiveEvent(signed(type,id,object,eventId,created));
  return eventId;
 };
 const purchased=()=>store.overview(ids.org,'owner').apps
  .reduce((n,x)=>n+x.purchased,0);
 return {store,correlate,put,requests,snap,purchased,
  changePin:fn=>{currentPin=fn(currentPin)},
  hook:fn=>{hook=fn}
 };
}
const inspect=(f,kind,eventId)=>f.correlate.inspect({
 organizationId:ids.org,subscriptionId:ids.sub,
 eventId,invoiceId:kind==='credit'||kind==='void'?null:ids.invoice
});
test('signed refund, charge and current/legacy dispute link to historical invoice without any seat mutation',async t=>{
 const f=fixture(t);
 for(const kind of ['refund','charge','dispute','legacyDispute']){
  const id=f.put(kind);
  const result=await inspect(f,kind,id);
  assert.equal(result.state,'manual_review',kind);
  assert.equal(result.reason,'event_source_linked_to_pinned_subscription',kind);
  assert.equal(result.linksVerifiedForReview,true,kind);
  assert.equal(result.licensesGranted,false);
  assert.equal(result.authorizesSeatChanges,false);
  assert.equal(result.paymentEvidenceAuthoritative,false);
  assert.equal(result.bindingRevision,1);
  assert(!JSON.stringify(result).includes(ids.invoice));
  assert(!JSON.stringify(result).includes(ids.customer));
 }
 assert(f.requests.includes('invoices/'+ids.invoice+'/payments?limit=100'));
 assert.equal(f.purchased(),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
});
test('signed credit note and voided invoice link without charge and without caller invoice hint',async t=>{
 const f=fixture(t);
 for(const kind of ['credit','void']){
  const eventId=f.put(kind);
  const result=await inspect(f,kind,eventId);
  assert.equal(result.linksVerifiedForReview,true);
  assert.equal(result.state,'manual_review');
  assert.equal(result.licensesGranted,false);
 }
 assert(!f.requests.some(x=>x.startsWith('charges/')));
 assert.equal(f.purchased(),0);
});
test('untrusted event and wrong organization cannot trigger Stripe requests',async t=>{
 const f=fixture(t);
 const noEvent=await f.correlate.inspect({
  organizationId:ids.org,subscriptionId:ids.sub,
  eventId:'evt_live_NOTRECORDED1234',invoiceId:ids.invoice
 });
 assert.equal(noEvent.state,'unavailable');
 const wrong=await f.correlate.inspect({
  organizationId:'other-org',subscriptionId:ids.sub,
  eventId:f.put('refund'),invoiceId:ids.invoice
 });
 assert.equal(wrong.state,'unavailable');
 assert.equal(f.requests.length,0);
 assert.equal(f.purchased(),0);
});

test('wrong subscription, customer, invoice hint or Stripe PaymentIntent lineage denies correlation',async t=>{
 const f=fixture(t);
 const eventId=f.put('refund');
 const invoice=f.snap['invoices/'+ids.invoice];
 const originalSubscription=invoice.parent.subscription_details.subscription;
 invoice.parent.subscription_details.subscription='sub_live_FOREIGN1234';
 let out=await inspect(f,'refund',eventId);
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(out.reason,'historical_invoice_subscription_mismatch');
 invoice.parent.subscription_details.subscription=originalSubscription;

 const charge=f.snap['charges/'+ids.charge];
 charge.customer='cus_live_OTHER1234';
 out=await inspect(f,'refund',eventId);
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(out.reason,'charge_customer_or_intent_mismatch');
 charge.customer=ids.customer;

 const listing=f.snap['invoices/'+ids.invoice+'/payments?limit=100'];
 listing.data[0].payment.payment_intent='pi_live_OTHER1234';
 out=await inspect(f,'refund',eventId);
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(out.reason,'invoice_payment_lineage_mismatch');
 listing.data[0].payment.payment_intent=ids.intent;

 const wrong=await f.correlate.inspect({
  organizationId:ids.org,subscriptionId:ids.sub,
  eventId,invoiceId:'in_live_UNVERIFIED1234'
 });
 assert.equal(wrong.linksVerifiedForReview,false);
 assert.equal(wrong.state,'unavailable');
 assert.equal(f.purchased(),0);
});
test('credit note and invoice void cannot be reassigned through a caller-provided invoice',async t=>{
 const f=fixture(t);
 for(const kind of ['credit','void']){
  const eventId=f.put(kind);
  const wrong=await f.correlate.inspect({
   organizationId:ids.org,subscriptionId:ids.sub,
   eventId,invoiceId:'in_live_WRONG1234'
  });
  assert.equal(wrong.linksVerifiedForReview,false);
  assert.equal(wrong.licensesGranted,false);
 }
 const note=f.snap['credit_notes/'+ids.credit];
 note.customer='cus_live_WRONG1234';
 assert.equal((await inspect(f,'credit',f.put('credit','evt_live_credit2'))).linksVerifiedForReview,false);
 assert.equal(f.purchased(),0);
});
test('late and out-of-order signed events remain reviewable without granting access',async t=>{
 const f=fixture(t);
 const future=f.put('dispute','evt_live_late_newer',Math.floor(NOW/1000));
 const historic=f.put('refund','evt_live_historic_old',Math.floor(NOW/1000)-100000);
 for(const id of [historic,future,historic]){
  const kind=id===historic?'refund':'dispute';
  const out=await inspect(f,kind,id);
  assert.equal(out.linksVerifiedForReview,true);
  assert.equal(out.licensesGranted,false);
 }
 assert.equal(f.store.ownerSnapshot().totals.liveWebhookEvents,2);
 assert.equal(f.purchased(),0);
});
test('pin revision changes during a Stripe await invalidate the entire correlation',async t=>{
 const f=fixture(t),eventId=f.put('refund');
 let changed=false;
 f.hook(async path=>{
  if(path==='invoices/'+ids.invoice&&!changed){
   changed=true;
   f.changePin(pin=>({...pin,revision:2}));
  }
 });
 const out=await inspect(f,'refund',eventId);
 assert.equal(out.state,'unavailable');
 assert.equal(out.reason,'correlation_source_changed');
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(f.purchased(),0);
});
