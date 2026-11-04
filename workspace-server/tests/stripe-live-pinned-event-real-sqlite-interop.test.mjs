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

const NOW=1800000000000,stamp=Math.floor(NOW/1000);
const webhookSecret='whsec_private_synthetic_123456789';
const ids=Object.freeze({
 org:'org-alpha',sub:'sub_live_PRIVATE1234',cus:'cus_live_PRIVATE1234',
 price:'price_live_PRIVATE1234',inv:'in_live_HISTORIC1234',
 refund:'re_live_PRIVATE1234',charge:'ch_live_PRIVATE1234',
 intent:'pi_live_PRIVATE1234'
});
const signer=createStripeLiveWebhookVerifier({webhookSecret,clock:()=>NOW});
const approval=Object.freeze({
 source:'stripe_live',eventKey:'approval_event_0001',
 organizationId:ids.org,subscriptionId:ids.sub,customerId:ids.cus,
 priceId:ids.price,plan:'Single',apps:['eel'],seats:2,revision:1
});
const financialEvent=(id='evt_live_review0001',created=stamp)=>({
 id,type:'refund.updated',livemode:true,created,
 data:{object:{id:ids.refund,object:'refund',livemode:true,
  metadata:{customer:'private@example.test'}}}
});
const signed=event=>{
 const rawBody=Buffer.from(JSON.stringify(event));
 const mac=createHmac('sha256',webhookSecret).update(stamp+'.')
  .update(rawBody).digest('hex');
 return signer.verify({rawBody,signature:'t='+stamp+',v1='+mac});
};
const provider=()=>({
 ['refunds/'+ids.refund]:{object:'refund',id:ids.refund,livemode:true,
  charge:ids.charge},
 ['invoices/'+ids.inv]:{object:'invoice',id:ids.inv,livemode:true,
  customer:ids.cus,parent:{subscription_details:{subscription:ids.sub}}},
 ['charges/'+ids.charge]:{object:'charge',id:ids.charge,livemode:true,
  customer:ids.cus,payment_intent:ids.intent},
 ['payment_intents/'+ids.intent]:{object:'payment_intent',id:ids.intent,
  livemode:true,customer:ids.cus,latest_charge:ids.charge},
 ['invoices/'+ids.inv+'/payments?limit=100']:{
  object:'list',has_more:false,data:[{object:'invoice_payment',livemode:true,
   invoice:ids.inv,payment:{type:'payment_intent',payment_intent:ids.intent}}]
 },
 ['subscriptions/'+ids.sub]:{object:'subscription',id:ids.sub,
  livemode:true,customer:ids.cus,status:'canceled',
  metadata:{organization_id:ids.org},
  latest_invoice:'in_live_NEWEST9999'}
});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-canonical-live-interop-'));
 const dbPath=join(dir,'organizations.sqlite'),token=Symbol('opaque_test_approval');
 let approved={...approval},store;
 const open=()=>{
  store?.close();
  store=createOrganizationStore({
   databasePath:dbPath,clock:()=>NOW,
   verifyLiveBillingBindingEvidence:proof=>{
    if(proof!==token)throw Error('untrusted_binding');
    return structuredClone(approved);
   }
  });
 };
 open();
 t.after(()=>{store?.close();rmSync(dir,{force:true,recursive:true});});
 store.setupOrganization({organizationId:ids.org,name:'Alpha Lab',owner:{
  accountId:'alpha-admin',name:'Admin Alpha',nickname:'Alpha',
  email:'alpha@example.test'
 }});
 store.setupOrganization({organizationId:'org-beta',name:'Beta Lab',owner:{
  accountId:'beta-admin',name:'Admin Beta',nickname:'Beta',
  email:'beta@example.test'
 }});
 const responses=provider(),requests=[];
 let hook=null;
 const makeObserver=()=>createStripeLiveFinancialEventCorrelator({
  organizationStore:store,
  secretKey:'sk_live_synthetic_interop_private_123456789',
  fetchImpl:async(url,init)=>{
   assert.equal(init.method,'GET');
   assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');
   assert(url.startsWith('https://api.stripe.com/v1/'));
   const relative=url.slice('https://api.stripe.com/v1/'.length);
   requests.push(relative);
   if(hook)await hook(relative);
   const resource=responses[relative];
   if(!resource)throw Error('Unexpected synthetic Stripe endpoint');
   return new Response(JSON.stringify(resource),{
    status:200,headers:{'content-type':'application/json'}
   });
  }
 });
 const pin=(change={})=>{
  approved={...approved,...change};
  return store.pinVerifiedStripeLiveBinding(token);
 };
 const record=(id='evt_live_review0001',created=stamp)=>
  store.recordVerifiedStripeLiveEvent(signed(financialEvent(id,created)));
 const inspect=(id='evt_live_review0001',org=ids.org)=>
  makeObserver().inspect({organizationId:org,subscriptionId:ids.sub,
   eventId:id,invoiceId:ids.inv});
 const count=()=>store.overview(ids.org,'alpha-admin').apps
  .reduce((sum,app)=>sum+app.purchased,0);
 return {get store(){return store;},open,pin,record,inspect,count,
  responses,requests,hook:fn=>{hook=fn;}};
}
test('without any trusted customer/subscription pin, signed real-SQLite events cannot trigger provider fetch',async t=>{
 const f=fixture(t);
 f.record();
 const result=await f.inspect();
 assert.equal(result.state,'unavailable');
 assert.equal(result.reason,'private_subscription_pin_missing');
 assert.equal(result.linksVerifiedForReview,false);
 assert.equal(f.requests.length,0);
 assert.equal(f.count(),0);
});
test('same canonical SQLite store pins independently verified customer and persists signed LIVE reversal',async t=>{
 const f=fixture(t);
 assert.deepEqual(f.pin(),{
  pinned:true,revision:1,licensesGranted:false,authorizesSeatChanges:false
 });
 assert.equal(f.record().recorded,true);
 const event=f.store.readVerifiedStripeLiveEventPrivate('evt_live_review0001');
 assert.equal(event.objectId,ids.refund);
 assert.equal(event.reviewCategory,'refund_review');
 const pin=f.store.readPinnedStripeLiveBinding({
  organizationId:ids.org,subscriptionId:ids.sub
 });
 assert.equal(pin.customerId,ids.cus);
 assert.equal(pin.revision,1);
 const result=await f.inspect();
 assert.equal(result.state,'manual_review');
 assert.equal(result.reason,'event_source_linked_to_pinned_subscription');
 assert.equal(result.linksVerifiedForReview,true);
 assert.equal(result.bindingRevision,1);
 assert.equal(result.paymentEvidenceAuthoritative,false);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.authorizesSeatChanges,false);
 assert(f.requests.includes('invoices/'+ids.inv+'/payments?limit=100'));
 assert.equal(f.count(),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
 const publicOwner=JSON.stringify(f.store.ownerSnapshot());
 assert(!publicOwner.includes(ids.refund));
 assert(!publicOwner.includes(ids.cus));
 assert(!publicOwner.includes(ids.inv));
 assert(!JSON.stringify(result).includes(ids.cus));
});
test('wrong tenant, unpinned customer and direct foreign approval all deny before Stripe calls',async t=>{
 const f=fixture(t);
 f.pin();f.record();
 assert.equal(f.store.readPinnedStripeLiveBinding({
  organizationId:'org-beta',subscriptionId:ids.sub}),null);
 let out=await f.inspect('evt_live_review0001','org-beta');
 assert.equal(out.state,'unavailable');
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(f.requests.length,0);
 assert.throws(()=>f.pin({organizationId:'org-beta',revision:2,
  eventKey:'approval_event_0002',subscriptionId:'sub_live_DIFFERENT1234'}),
  /stripe_live_customer_tenant_conflict/);
 assert.equal(f.count(),0);
});
test('same real organization SQLite preserves pin and signed event across process reopen',async t=>{
 const f=fixture(t);
 f.pin();f.record();
 f.open();
 const pinned=f.store.readPinnedStripeLiveBinding({
  organizationId:ids.org,subscriptionId:ids.sub
 });
 assert.equal(pinned.revision,1);
 const event=f.store.readVerifiedStripeLiveEventPrivate('evt_live_review0001');
 assert.equal(event.rawDigest.length,64);
 assert.equal(f.store.recordVerifiedStripeLiveEvent(signed(financialEvent()))
  .duplicate,true);
 assert.deepEqual(f.pin(),{pinned:false,idempotent:true,licensesGranted:false});
 const out=await f.inspect();
 assert.equal(out.linksVerifiedForReview,true);
 assert.equal(f.count(),0);
});
test('live pinned revision changes while refund API is awaited reject source attribution',async t=>{
 const f=fixture(t);
 f.pin();f.record();
 let updated=false;
 f.hook(async relative=>{
  if(relative==='invoices/'+ids.inv&&!updated){
   updated=true;
   const result=f.pin({revision:2,eventKey:'approval_event_0002',
    plan:'Mixed',apps:['eel','goflo'],seats:3,
    priceId:'price_live_UPDATED1234'});
   assert.equal(result.pinned,true);
  }
 });
 const out=await f.inspect();
 assert.equal(out.state,'unavailable');
 assert.equal(out.reason,'correlation_source_changed');
 assert.equal(out.linksVerifiedForReview,false);
 assert.equal(f.store.readPinnedStripeLiveBinding({
  organizationId:ids.org,subscriptionId:ids.sub}).revision,2);
 assert.equal(f.count(),0);
});
