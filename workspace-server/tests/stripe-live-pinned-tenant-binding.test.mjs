import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';
import {createPinnedStripeLiveObserver} from '../stripe-live-pinned-observer.mjs';
import {createStripeLiveBillingReader} from '../stripe-live-readonly.mjs';

const NOW=1800000000000;
const base=()=>({
 source:'stripe_live',eventKey:'evt_live_bind0001',
 organizationId:'org-alpha',subscriptionId:'sub_live_TESTABCD1234',
 customerId:'cus_live_TESTABCD1234',priceId:'price_live_TESTABCD1234',
 plan:'Single',apps:['eel'],seats:2,revision:1
});
function fixture(t,{enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-pin-live-'));
 const databasePath=join(dir,'organization.sqlite');
 const tokens=new Map();
 const verify=evidence=>{
  if(!tokens.has(evidence))throw Error('untrusted_synthetic_evidence');
  return structuredClone(tokens.get(evidence));
 };
 let store;
 const reopen=()=>{
  store?.close();
  store=createOrganizationStore({
   databasePath,clock:()=>NOW,
   verifyLiveBillingBindingEvidence:enabled?verify:null
  });
 };
 reopen();
 t.after(()=>{store?.close();rmSync(dir,{force:true,recursive:true});});
 const owner=(id,actor)=>store.setupOrganization({
  organizationId:id,name:'Lab '+id,
  owner:{accountId:actor,name:'Owner',nickname:'O',
   email:actor+'@example.test'}
 });
 owner('org-alpha','owner-alpha');
 owner('org-beta','owner-beta');
 const pin=(record,forcedToken=null)=>{
  const token=forcedToken??Symbol('private-verification');
  tokens.set(token,record);
  return store.pinVerifiedStripeLiveBinding(token);
 };
 const purchased=id=>store.overview('org-alpha','owner-alpha')
  .apps.find(x=>x.id===id).purchased;
 return {get store(){return store;},reopen,pin,purchased};
}
test('without injected trusted LIVE verifier no binding may be created',t=>{
 const f=fixture(t,{enabled:false});
 assert.throws(()=>f.pin(base()),/stripe_live_binding_verifier_unavailable/);
 assert.equal(f.store.readPinnedStripeLiveBinding({
  organizationId:'org-alpha',subscriptionId:base().subscriptionId
 }),null);
 assert.equal(f.purchased('eel'),0);
});
test('trusted tenant/customer/subscription pin is durable and never purchases seats',t=>{
 const f=fixture(t);
 assert.deepEqual(f.pin(base()),{
  pinned:true,revision:1,licensesGranted:false,authorizesSeatChanges:false
 });
 const input={organizationId:'org-alpha',subscriptionId:base().subscriptionId};
 const before=f.store.readPinnedStripeLiveBinding(input);
 assert.equal(before.customerId,base().customerId);
 assert.equal(before.priceId,base().priceId);
 assert.equal(before.source,'pinned_stripe_live');
 assert.equal(before.licensesGranted,false);
 assert.equal(before.authorizesSeatChanges,false);
 assert.deepEqual(before.apps,['eel']);
 assert(Object.isFrozen(before)&&Object.isFrozen(before.apps));
 assert.equal(f.store.readPinnedStripeLiveBinding({
  ...input,organizationId:'org-beta'
 }),null);
 assert.equal(f.purchased('eel'),0);
 f.reopen();
 assert.deepEqual(f.store.readPinnedStripeLiveBinding(input),before);
 assert.equal(f.purchased('eel'),0);
});
test('event replay is idempotent and does not mutate paid seats',t=>{
 const f=fixture(t),record=base(),token=Symbol('trusted-replayed-record');
 assert.equal(f.pin(record,token).pinned,true);
 assert.deepEqual(f.pin(record,token),{
  pinned:false,idempotent:true,licensesGranted:false
 });
 assert.equal(f.purchased('eel'),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
});
test('customer, subscription and event ID cannot migrate across tenants',t=>{
 const f=fixture(t);
 f.pin(base());
 for(const change of [
  {organizationId:'org-beta',subscriptionId:'sub_live_NEWSUB0001',
   eventKey:'evt_live_second0001'},
  {organizationId:'org-beta',customerId:'cus_live_OTHER1234',
   eventKey:'evt_live_second0002'},
  {organizationId:'org-beta',eventKey:'evt_live_second0003'},
  {organizationId:'org-beta',subscriptionId:'sub_live_NEWSUB0002',
   eventKey:base().eventKey}
 ]){
  assert.throws(()=>f.pin({...base(),...change}),
   /stripe_live_customer_tenant_conflict|stripe_live_subscription_tenant_conflict|stripe_live_binding_event_conflict/);
 }
 assert.equal(f.purchased('eel'),0);
});
test('stale versions and same-revision mutations are rejected after newer binding',t=>{
 const f=fixture(t);
 f.pin(base());
 const next={...base(),eventKey:'evt_live_bind0002',
  priceId:'price_live_UPDATED1234',plan:'Mixed',apps:['eel','goflo'],
  seats:3,revision:2};
 assert.equal(f.pin(next).pinned,true);
 const pinned=f.store.readPinnedStripeLiveBinding({
  organizationId:'org-alpha',subscriptionId:next.subscriptionId
 });
 assert.deepEqual(pinned.apps,['eel','goflo']);
 assert.equal(pinned.priceId,next.priceId);
 for(const change of [
  {...base(),eventKey:'evt_live_bind0003'},
  {...next,eventKey:'evt_live_bind0004',seats:8},
  {...next,eventKey:'evt_live_bind0005'}
 ]){
  assert.throws(()=>f.pin(change),
   /stripe_live_binding_stale|stripe_live_binding_revision_conflict/);
 }
 assert.equal(f.purchased('eel'),0);
 assert.equal(f.purchased('goflo'),0);
});

test('rejects TEST evidence, invalid plans, DataDuck and untrusted JSON claims',t=>{
 const f=fixture(t);
 const invalid=[
  {...base(),source:'stripe_test'},
  {...base(),eventKey:'bad event'},
  {...base(),organizationId:'nonexistent'},
  {...base(),subscriptionId:'cs_live_checkout1234'},
  {...base(),customerId:'cus_test-insecure'},
  {...base(),priceId:'bad-price'},
  {...base(),plan:'Bundle',apps:['eel']},
  {...base(),plan:'Mixed',apps:['eel']},
  {...base(),apps:['dataduck']},
  {...base(),apps:['eel','eel']},
  {...base(),seats:0},
  {...base(),revision:0},
  {...base(),licensesGranted:true}
 ];
 for(const record of invalid){
  assert.throws(()=>f.pin(record),
   /stripe_live_binding_rejected|organization_not_found/);
 }
 assert.equal(f.purchased('eel'),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
});
test('private reader can inspect only an existing tenant-pinned subscription',async t=>{
 const f=fixture(t);
 f.pin(base());
 let requests=0;
 const sub={
  object:'subscription',id:base().subscriptionId,livemode:true,
  customer:base().customerId,
  metadata:{organization_id:base().organizationId},
  status:'active',cancel_at_period_end:false,cancel_at:null,
  pause_collection:null,pending_update:null,latest_invoice:null,
  items:{has_more:false,data:[{
   quantity:base().seats,current_period_end:1900000000,
   price:{id:base().priceId,livemode:true,recurring:{usage_type:'licensed'}}
  }]}
 };
 const liveReader=createStripeLiveBillingReader({
  secretKey:'sk_live_private_synthetic_fixture_123456789',
  clock:()=>NOW,
  fetchImpl:async(url,init)=>{
   requests++;
   assert.equal(url,'https://api.stripe.com/v1/subscriptions/'+base().subscriptionId);
   assert.equal(init.method,'GET');
   return new Response(JSON.stringify(sub),{
    headers:{'content-type':'application/json'}
   });
  }
 });
 const observer=createPinnedStripeLiveObserver({
  organizationStore:f.store,liveReader
 });
 for(const query of [
  {organizationId:'org-beta',subscriptionId:base().subscriptionId},
  {organizationId:'org-alpha',subscriptionId:'sub_live_NOTPINNED'},
  {organizationId:'org-alpha',subscriptionId:'sub_test-injection'}
 ]){
  const denied=await observer.inspect(query);
  assert.equal(denied.state,'unavailable');
  assert.equal(denied.licensesGranted,false);
 }
 assert.equal(requests,0);
 const result=await observer.inspect({
  organizationId:'org-alpha',subscriptionId:base().subscriptionId
 });
 assert.equal(requests,1);
 assert.equal(result.reason,'invoice_unavailable');
 assert.equal(result.state,'manual_review');
 assert.equal(result.bindingRevision,1);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.authorizesSeatChanges,false);
 assert.equal(f.purchased('eel'),0);
});
test('private Stripe lookup cannot reuse observation after pinned price revision changed midflight',async t=>{
 const f=fixture(t);
 f.pin(base());
 let resume;
 const gate=new Promise(resolve=>{resume=resolve;});
 const observer=createPinnedStripeLiveObserver({
  organizationStore:f.store,
  liveReader:{inspect:async()=>{
   await gate;
   return {state:'candidate_for_manual_review',
    licensesGranted:false,authorizesSeatChanges:false};
  }}
 });
 const pending=observer.inspect({
  organizationId:'org-alpha',subscriptionId:base().subscriptionId
 });
 f.pin({...base(),revision:2,eventKey:'evt_live_change0002',
  priceId:'price_live_NEWPRICE12345'});
 resume();
 const result=await pending;
 assert.equal(result.state,'unavailable');
 assert.equal(result.reason,'pinned_live_binding_changed_during_lookup');
 assert.equal(result.licensesGranted,false);
 assert.equal(f.purchased('eel'),0);
});
test('source failures or forged LIVE reader grants deny without creating licenses',async t=>{
 const f=fixture(t);
 f.pin(base());
 const query={organizationId:'org-alpha',subscriptionId:base().subscriptionId};
 for(const reader of [
  {inspect:async()=>{throw Error('Stripe unavailable');}},
  {inspect:async()=>({state:'candidate_for_manual_review',
   licensesGranted:true,authorizesSeatChanges:false})},
  {inspect:async()=>({state:'active',
   licensesGranted:false,authorizesSeatChanges:false})}
 ]){
  const observer=createPinnedStripeLiveObserver({
   organizationStore:f.store,liveReader:reader
  });
  const result=await observer.inspect(query);
  assert.equal(result.state,'unavailable');
  assert.equal(result.licensesGranted,false);
  assert.equal(result.authorizesSeatChanges,false);
 }
 assert.equal(f.purchased('eel'),0);
});
