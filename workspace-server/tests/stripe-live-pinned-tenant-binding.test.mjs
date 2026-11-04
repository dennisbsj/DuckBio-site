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
