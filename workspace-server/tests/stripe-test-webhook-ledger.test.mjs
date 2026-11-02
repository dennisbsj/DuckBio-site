import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizationStore} from '../organization-store.mjs';

const event=(id,objectId,type='checkout.session.completed',digest='a'.repeat(64))=>({
 id,type,objectId,created:1783090000,digest
});

test('verified Stripe test-event ledger is durable, replay-safe, and grants no seats',t=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-stripe-event-'));
 const path=join(dir,'private','organization.sqlite');
 let store=createOrganizationStore({databasePath:path,clock:()=>1783090000000});
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 store.setupOrganization({organizationId:'lab-a',name:'Lab A',owner:{
  accountId:'owner-a',name:'Owner A',nickname:'Owner',email:'owner-a@example.test'
 }});
 store.setupOrganization({organizationId:'lab-b',name:'Lab B',owner:{
  accountId:'owner-b',name:'Owner B',nickname:'Owner',email:'owner-b@example.test'
 }});
 const draft=store.createSubscriptionDraft({organizationId:'lab-a',actorId:'owner-a',plan:'Single',apps:['eel'],seats:3});
 store.prepareTestCheckout({organizationId:'lab-a',actorId:'owner-a',draftId:draft.id,price:'price_test_12345'});
 store.completeTestCheckout({organizationId:'lab-a',actorId:'owner-a',draftId:draft.id,
  session:{id:'cs_test_laba_123',url:'https://checkout.stripe.com/c/pay/synthetic'}});
 const known=event('evt_matching1234','cs_test_laba_123');
 assert.deepEqual(store.recordVerifiedStripeTestEvent(known),{recorded:true,matched:true,draftId:draft.id});
 assert.deepEqual(store.recordVerifiedStripeTestEvent(known),{recorded:false,matched:true,draftId:draft.id});
 assert.throws(()=>store.recordVerifiedStripeTestEvent({...known,digest:'b'.repeat(64)}),/stripe_event_conflict/);
 const unrelated=event('evt_other12345','cs_test_outside_987');
 assert.deepEqual(store.recordVerifiedStripeTestEvent(unrelated),{recorded:true,matched:false,draftId:null});
 assert.deepEqual(store.recordVerifiedStripeTestEvent(event('evt_other12346','cs_test_laba_123','invoice.paid')),
  {recorded:true,matched:false,draftId:null});
 for(const [org,admin] of [['lab-a','owner-a'],['lab-b','owner-b']])
  assert(store.overview(org,admin).apps.every(row=>row.purchased===0 && row.assigned===0));
 const db=new DatabaseSync(path);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_test_webhook_events').get().n,3);
 assert.equal(db.prepare('SELECT org FROM stripe_test_webhook_events WHERE id=?').get(known.id).org,'lab-a');
 assert.equal(db.prepare('SELECT org FROM stripe_test_webhook_events WHERE id=?').get(unrelated.id).org,null);
 db.close();
 store.close();store=null;
 store=createOrganizationStore({databasePath:path,clock:()=>1783090000000});
 assert.deepEqual(store.recordVerifiedStripeTestEvent(known),{recorded:false,matched:true,draftId:draft.id});
 assert(store.overview('lab-a','owner-a').apps.every(row=>row.purchased===0));
});

test('test webhook ledger refuses malformed input and conflicting event identifiers',t=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-stripe-malformed-'));
 const store=createOrganizationStore({databasePath:join(dir,'org.sqlite')});
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 assert.throws(()=>store.recordVerifiedStripeTestEvent(null),/invalid_stripe_event/);
 assert.throws(()=>store.recordVerifiedStripeTestEvent(event('bad-id','cs_test_123')),/invalid_stripe_event/);
 assert.throws(()=>store.recordVerifiedStripeTestEvent({...event('evt_okay1234','cs_test_123'),digest:'not-sha256'}),/invalid_stripe_event/);
 assert.deepEqual(store.recordVerifiedStripeTestEvent(event('evt_okay1234','cs_test_123')),{recorded:true,matched:false,draftId:null});
 assert.throws(()=>store.recordVerifiedStripeTestEvent(event('evt_okay1234','cs_test_different')),/stripe_event_conflict/);
});
