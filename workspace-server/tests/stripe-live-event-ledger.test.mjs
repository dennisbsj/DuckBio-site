import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {createOrganizationStore} from '../organization-store.mjs';
import {createStripeLiveWebhookVerifier} from '../stripe-live-webhook.mjs';
const now=1800000000000,secret='whsec_private_synthetic_live_12345678';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-live-events-'));
 const databasePath=join(dir,'secure','organizations.sqlite');
 let store=createOrganizationStore({databasePath,clock:()=>now});
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();
  store=createOrganizationStore({databasePath,clock:()=>now});}};
}
function signed(event){
 const rawBody=Buffer.from(JSON.stringify(event));
 const stamp=Math.floor(now/1000);
 const mac=createHmac('sha256',secret).update(stamp+'.').update(rawBody).digest('hex');
 return {rawBody,signature:'t='+stamp+',v1='+mac};
}
const invoice=()=>({id:'evt_live_invoice1234',type:'invoice.paid',
 created:Math.floor(now/1000),livemode:true,data:{object:{
  id:'in_live_invoice1234',livemode:true,customer:'cus_sensitive_ABC12345',
  metadata:{email:'private@example.test'}}}});
const verifier=createStripeLiveWebhookVerifier({webhookSecret:secret,clock:()=>now});

test('verified LIVE webhook metadata is persisted exactly once, with no payment or customer leakage',t=>{
 const f=fixture(t);
 f.store.setupOrganization({organizationId:'one',name:'Lab One',owner:{
  accountId:'admin1',name:'Owner',nickname:'O',email:'owner@example.test'}});
 const validated=verifier.verify(signed(invoice()));
 assert.deepEqual(f.store.recordVerifiedStripeLiveEvent(validated),
  {recorded:true,duplicate:false,licensesGranted:false});
 assert.deepEqual(f.store.recordVerifiedStripeLiveEvent(validated),
  {recorded:false,duplicate:true,licensesGranted:false});
 let snapshot=f.store.ownerSnapshot();
 assert.equal(snapshot.totals.liveWebhookEvents,1);
 assert.equal(snapshot.liveWebhookEvents.length,1);
 assert.equal(snapshot.liveWebhookEvents[0].type,'invoice.paid');
 assert.equal(snapshot.liveWebhookEvents[0].linkage,'unassigned');
 assert.equal(snapshot.liveWebhookEvents[0].licensesGranted,false);
 assert.equal(snapshot.totals.activeVerifiedSubscriptions,0);
 assert(f.store.overview('one','admin1').apps.every(x=>x.purchased===0));
 assert(!JSON.stringify(snapshot.liveWebhookEvents).includes('cus_sensitive_ABC12345'));
 assert(!JSON.stringify(snapshot.liveWebhookEvents).includes('private@example.test'));
 assert(!JSON.stringify(snapshot.liveWebhookEvents).includes('in_live_invoice1234'));
 f.reopen();
 snapshot=f.store.ownerSnapshot();
 assert.equal(snapshot.liveWebhookEvents.length,1);
 assert.equal(f.store.recordVerifiedStripeLiveEvent(validated).recorded,false);
});
test('conflicting replayed event IDs and forged unverified metadata are rejected',t=>{
 const f=fixture(t);
 const valid=verifier.verify(signed(invoice()));
 f.store.recordVerifiedStripeLiveEvent(valid);
 const different={...valid,digest:'a'.repeat(64)};
 assert.throws(()=>f.store.recordVerifiedStripeLiveEvent(different),/stripe_live_event_conflict/);
 for(const invalid of [
  {...valid,mode:'test'},
  {...valid,licensesGranted:true},
  {...valid,authorizesSeatChanges:true},
  {...valid,eventId:'unexpected',id:'evt invalid'},
  {...valid,type:'invoice.false'},
  {...valid,type:'checkout.session.completed',objectId:'in_live_invoice1234'},
  {...valid,digest:'not sha'},
  {...valid,created:0}
 ])assert.throws(()=>f.store.recordVerifiedStripeLiveEvent(invalid),/invalid_stripe_live_event/);
 const forged=invoice();
 forged.livemode=false;
 assert.throws(()=>verifier.verify(signed(forged)),/Unsupported Stripe LIVE/);
 assert.equal(f.store.ownerSnapshot().totals.liveWebhookEvents,1);
});
test('LIVE invoice events, subscription events and Checkout events cannot grant licenses',t=>{
 const f=fixture(t);
 for(const [type,id,index] of [
  ['invoice.payment_failed','in_live_failed1234',1],
  ['customer.subscription.updated','sub_live_updated1234',2],
  ['checkout.session.completed','cs_live_complete1234',3]
 ]){
  const event={id:'evt_live_other'+index+'1234',type,created:Math.floor(now/1000),
   livemode:true,data:{object:{id,livemode:true}}};
  const result=f.store.recordVerifiedStripeLiveEvent(verifier.verify(signed(event)));
  assert.equal(result.licensesGranted,false);
 }
 const snap=f.store.ownerSnapshot();
 assert.equal(snap.totals.liveWebhookEvents,3);
 assert.equal(snap.subscriptions.length,0);
 assert.equal(snap.alerts.optedIn,false);
});
