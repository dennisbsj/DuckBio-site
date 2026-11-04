import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createOrganizationStore} from '../organization-store.mjs';
import {createStripeLiveBillingReader} from '../stripe-live-readonly.mjs';
import {createStripeLiveCustomerReader} from '../stripe-live-customer-readonly.mjs';
import {
 createStripeLiveApprovalGate,canonicalStripeLiveBindingApprovalBytes
} from '../stripe-live-approval-gate.mjs';

const NOW=1800000000000;
const keyPair=generateKeyPairSync('ed25519');
const publicKeyPem=keyPair.publicKey.export({type:'spki',format:'pem'});
const base=()=>({
 version:'duckbio.stripe-live-binding-approval.v1',keyId:'duckbio-operator-v1',
 eventKey:'evt_private_approval_1234',organizationId:'org-alpha',
 subscriptionId:'sub_live_ABCD1234',customerId:'cus_live_ABCD1234',
 priceId:'price_live_ABCD1234',plan:'Single',apps:['eel'],
 seats:2,revision:1,issuedAt:NOW,expiresAt:NOW+180000
});
const signature=p=>sign(null,canonicalStripeLiveBindingApprovalBytes(p),
 keyPair.privateKey).toString('base64url');
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-stripe-authority-'));
 const dbPath=join(dir,'organizations.sqlite');
 let now=NOW,called=[];
 const state={customer:{
  object:'customer',livemode:true,id:base().customerId,
  metadata:{organization_id:'org-alpha'}
 },subscription:{
  object:'subscription',livemode:true,id:base().subscriptionId,
  customer:base().customerId,metadata:{organization_id:'org-alpha'},
  status:'active',cancel_at_period_end:false,cancel_at:null,
  pause_collection:null,pending_update:null,latest_invoice:null,
  items:{has_more:false,data:[{
   quantity:2,current_period_end:1900000000,
   price:{id:base().priceId,livemode:true,recurring:{usage_type:'licensed'}}
  }]}
 }};
 const fetchImpl=async(url,init)=>{
  called.push({url,init});
  if(state.advanceOnFetch){now+=state.advanceOnFetch;state.advanceOnFetch=0;}
  if(url==='https://api.stripe.com/v1/customers/'+base().customerId)
   return new Response(JSON.stringify(state.customer),{
    headers:{'content-type':'application/json'}
   });
  if(url==='https://api.stripe.com/v1/subscriptions/'+base().subscriptionId)
   return new Response(JSON.stringify(state.subscription),{
    headers:{'content-type':'application/json'}
   });
  throw Error('unexpected Stripe LIVE API endpoint');
 };
 const key='sk_live_synthetic_private_reader_123456789';
 const customerReader=createStripeLiveCustomerReader({
  secretKey:key,fetchImpl
 });
 const subscriptionReader=createStripeLiveBillingReader({
  secretKey:key,fetchImpl,clock:()=>now
 });
 const gate=createStripeLiveApprovalGate({
  approvalKeyId:'duckbio-operator-v1',approvalPublicKeyPem:publicKeyPem,
  customerReader,subscriptionReader,clock:()=>now
 });
 const store=createOrganizationStore({
  databasePath:dbPath,clock:()=>now,
  verifyLiveBillingBindingEvidence:gate.verifyLiveBillingBindingEvidence
 });
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 for(const [organizationId,accountId] of [
  ['org-alpha','owner-alpha'],['org-beta','owner-beta']])
  store.setupOrganization({organizationId,name:organizationId,owner:{
   accountId,name:'Owner',nickname:'O',email:accountId+'@example.test'
  }});
 const purchased=()=>store.overview('org-alpha','owner-alpha')
  .apps.find(x=>x.id==='eel').purchased;
 return {state,store,gate,purchased,calls:()=>called,
  setNow:value=>{now=value;},clear:()=>{called=[]},
  async approve(p=base(),sig=signature(p)){
   return gate.verifyAndPin({organizationStore:store,approval:p,signature:sig});
  }
 };
}
test('private signed tenant approval plus two actual read-only Stripe source checks creates no licenses',async t=>{
 const f=fixture(t);
 assert.deepEqual(await f.approve(),{
  pinned:true,revision:1,licensesGranted:false,authorizesSeatChanges:false
 });
 assert.deepEqual(f.calls().map(x=>x.url),[
  'https://api.stripe.com/v1/customers/'+base().customerId,
  'https://api.stripe.com/v1/subscriptions/'+base().subscriptionId
 ]);
 assert(f.calls().every(x=>x.init.method==='GET'&&
  x.init.redirect==='error'&&x.init.cache==='no-store'));
 const pinned=f.store.readPinnedStripeLiveBinding({
  organizationId:'org-alpha',subscriptionId:base().subscriptionId
 });
 assert.equal(pinned.customerId,base().customerId);
 assert.equal(pinned.revision,1);
 assert.equal(pinned.licensesGranted,false);
 assert.equal(f.purchased(),0);
});
test('replaying a valid approval does not add seats, mutate the pin or issue a new grant',async t=>{
 const f=fixture(t);
 assert.equal((await f.approve()).pinned,true);
 assert.deepEqual(await f.approve(),{
  pinned:false,idempotent:true,licensesGranted:false,
  authorizesSeatChanges:false
 });
 assert.equal(f.purchased(),0);
 assert.equal(f.store.ownerSnapshot().totals.activeVerifiedSubscriptions,0);
});
test('forged browser token or unsigned JSON cannot reach the canonical store pin',async t=>{
 const f=fixture(t);
 for(const fake of [{},null,base(),'untrusted-token']){
  assert.throws(()=>f.store.pinVerifiedStripeLiveBinding(fake),
   /stripe_live_binding_rejected/);
 }
 assert.equal(f.purchased(),0);
 assert.equal(f.calls().length,0);
});
test('tampered or expired approval and wrong operator key are denied before Stripe fetch',async t=>{
 const f=fixture(t);
 const invalid=[
  [base(),'A'.repeat(86)],
  [{...base(),organizationId:'org-beta'},signature(base())],
  [{...base(),customerId:'cus_live_DIFFERENT'},signature(base())],
  [{...base(),apps:['dataduck']},null],
  [{...base(),issuedAt:NOW+7000},null],
  [{...base(),expiresAt:NOW+400000},null],
  [{...base(),keyId:'untrusted'},null],
  [{...base(),unverified:true},null],
  [{...base(),plan:'Bundle'},null]
 ];
 for(const [p,s] of invalid){
  assert.equal(await f.approve(p,s??signature(p)),false);
 }
 assert.equal(f.calls().length,0);
 assert.equal(f.purchased(),0);
 f.setNow(NOW+200000);
 assert.equal(await f.approve(),false);
 assert.equal(f.calls().length,0);
});
test('Stripe customer must be LIVE, nondeleted and independently tied to exact tenant',async t=>{
 const f=fixture(t);
 for(const patch of [
  {livemode:false},{deleted:true},{id:'cus_live_OTHER1234'},
  {metadata:{organization_id:'org-beta'}},{metadata:{}}
 ]){
  Object.assign(f.state.customer,patch);
  assert.equal(await f.approve(),false);
  assert.equal(f.calls().length>0,true);
  assert.equal(f.purchased(),0);
  f.state.customer={
   object:'customer',livemode:true,id:base().customerId,
   metadata:{organization_id:'org-alpha'}
  };
  f.clear();
 }
});
test('Stripe subscription must corroborate exact customer, tenant, price, and seats',async t=>{
 const f=fixture(t);
 for(const modify of [
  s=>s.customer='cus_live_WRONG1234',
  s=>s.metadata.organization_id='org-beta',
  s=>s.items.data[0].price.id='price_live_WRONG1234',
  s=>s.items.data[0].quantity=999,
  s=>s.livemode=false
 ]){
  const current=structuredClone(f.state.subscription);
  modify(f.state.subscription);
  assert.equal(await f.approve(),false);
  assert.equal(f.purchased(),0);
  f.state.subscription=current;
 }
});
test('short-lived operator approval expiring during Stripe HTTPS lookup fails closed',async t=>{
 const f=fixture(t);
 f.state.advanceOnFetch=190000;
 assert.equal(await f.approve(),false);
 assert.equal(f.calls().length,2,'real customer and subscription readers both executed');
 assert.equal(f.purchased(),0);
 assert.equal(f.store.readPinnedStripeLiveBinding({
  organizationId:'org-alpha',subscriptionId:base().subscriptionId
 }),null);
});
