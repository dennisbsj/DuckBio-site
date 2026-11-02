import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizationStore} from '../organization-store.mjs';

// This is intentionally a SYNTHETIC PRIVATE verifier, not an actual Stripe adapter.
// Only the injected verifier can issue live-mode billing assertions to the store.
const claim=(overrides={})=>({
 source:'stripe_live',eventKey:'evt_live_internal1234',
 organizationId:'one',subscriptionId:'sub_live_fixture1234',
 revision:1,plan:'Single',apps:['eel'],seats:3,status:'active',
 paidThrough:1900000000,...overrides
});
const sealed=(payload=claim())=>({fixtureProof:'SYNTHETIC_PRIVATE_ATTESTATION',payload});
function fixture(t,{withVerifier=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-verified-subscription-'));
 const path=join(dir,'private','organizations.sqlite');
 const verifyLiveSubscriptionEvidence=withVerifier
  ?e=>{if(e?.fixtureProof!=='SYNTHETIC_PRIVATE_ATTESTATION')
        throw Error('No private billing proof');
       return e.payload;}
  :null;
 let store=createOrganizationStore({databasePath:path,clock:()=>1783090000000,
  verifyLiveSubscriptionEvidence});
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 for(const [org,account] of [['one','admin1'],['two','admin2']])
  store.setupOrganization({organizationId:org,name:org,owner:{
   accountId:account,name:'Owner',nickname:'Admin',email:account+'@example.test'}});
 return {path,get store(){return store;},
  reopen(){store.close();store=createOrganizationStore({databasePath:path,
    clock:()=>1783090000000,verifyLiveSubscriptionEvidence});}};
}
const seat=(f,org='one',actor='admin1',app='eel')=>
 f.store.overview(org,actor).apps.find(x=>x.id===app).purchased;

test('private verified adapter is required; TEST evidence cannot mint seats',t=>{
 const none=fixture(t,{withVerifier:false});
 assert.throws(()=>none.store.applyVerifiedSubscriptionTransition(sealed()),/verified_billing_unavailable/);
 const f=fixture(t);
 assert.throws(()=>f.store.applyVerifiedSubscriptionTransition(claim()),/verified_billing_rejected/);
 assert.throws(()=>f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  source:'stripe_test'}))),/verified_billing_rejected/);
 assert.equal(seat(f),0);
});
test('initial verified allocation and two idempotent renewals never add seats twice',t=>{
 const f=fixture(t);
 const first=claim();
 assert.deepEqual(f.store.applyVerifiedSubscriptionTransition(sealed(first)),{
  applied:true,subscriptionId:first.subscriptionId,revision:1,licensesChanged:true,
  deltas:[{appId:'eel',delta:3,targetPurchased:3}]
 });
 assert.equal(seat(f),3);
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(first)).applied,false);
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  eventKey:'evt_live_second123',revision:1}))).applied,false,
  'a different event key with identical revision and payload is still idempotent');
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  eventKey:'evt_live_renewal123',revision:2,paidThrough:1910000000}))).licensesChanged,false);
 assert.equal(seat(f),3);
 const db=new DatabaseSync(f.path);
 try{
  assert.deepEqual(db.prepare('SELECT revision,state FROM verified_subscription_allocations').get(),
   {revision:2,state:'active'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM verified_subscription_revisions').get().n,2);
 }finally{db.close();}
 f.reopen();
 assert.equal(seat(f),3);
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  eventKey:'evt_live_renewal123',revision:2,paidThrough:1910000000}))).applied,false);
 assert.equal(f.store.auditLog('one','admin1').filter(x=>x.action==='subscription.entitlement.transition').length,2);
});
test('paid Mixed plan upgrade or app switch adjusts only the appropriate app seats',t=>{
 const f=fixture(t);
 f.store.applyVerifiedSubscriptionTransition(sealed(claim()));
 const change=f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  eventKey:'evt_live_upgrade123',revision:2,plan:'Mixed',apps:['eel','goflo'],seats:2})));
 assert.equal(change.applied,true);
 assert.deepEqual(change.deltas,[{appId:'goflo',delta:2,targetPurchased:2},
  {appId:'eel',delta:-1,targetPurchased:2}]);
 assert.equal(seat(f),2);
 assert.equal(seat(f,'one','admin1','goflo'),2);
 assert.equal(seat(f,'two','admin2','eel'),0);
});
test('downgrades are fully rolled back when assignments or invitations need seats',t=>{
 const f=fixture(t);
 f.store.applyVerifiedSubscriptionTransition(sealed(claim()));
 f.store.saveMember({organizationId:'one',actorId:'admin1',member:{
  accountId:'member1',name:'Member One',nickname:'M',email:'member1@example.test',
  admin:false,roles:{eel:'scientist'}}});
 f.store.saveMember({organizationId:'one',actorId:'admin1',member:{
  accountId:'member2',name:'Member Two',nickname:'M',email:'member2@example.test',
  admin:false,roles:{eel:'scientist'}}});
 f.store.issueInvitation({organizationId:'one',actorId:'admin1',
  email:'invited@example.test',name:'Invited Person',nickname:'I',
  roles:{eel:'scientist'}});
 assert.throws(()=>f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  revision:2,eventKey:'evt_live_down123',seats:2}))),/verified_subscription_manual_review/);
 assert.equal(seat(f),3);
 const db=new DatabaseSync(f.path);
 try{assert.equal(db.prepare('SELECT revision FROM verified_subscription_allocations').get().revision,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM verified_subscription_revisions').get().n,1);
 }finally{db.close();}
 f.store.revokeInvitation({organizationId:'one',actorId:'admin1',email:'invited@example.test'});
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  revision:2,eventKey:'evt_live_down123',seats:2}))).applied,true);
 assert.equal(seat(f),2);
 const canceled=claim({revision:3,eventKey:'evt_live_cancel123',status:'canceled',paidThrough:null,seats:2});
 assert.throws(()=>f.store.applyVerifiedSubscriptionTransition(sealed(canceled)),/verified_subscription_manual_review/);
 assert.equal(seat(f),2);
 for(const id of ['member1','member2'])f.store.removeMember({organizationId:'one',actorId:'admin1',accountId:id});
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(canceled)).applied,true);
 assert.equal(seat(f),0);
});
test('legacy/manual seats are preserved when subscription is canceled',t=>{
 const f=fixture(t);
 f.store.applyVerifiedSeatPurchase({reference:'preexisting_verified_legacy',organizationId:'one',
  plan:'Single',apps:['eel'],seats:5});
 f.store.applyVerifiedSubscriptionTransition(sealed(claim()));
 assert.equal(seat(f),8);
 assert.equal(f.store.applyVerifiedSubscriptionTransition(sealed(claim({
  revision:2,eventKey:'evt_live_cancel123',status:'canceled',paidThrough:null}))).applied,true);
 assert.equal(seat(f),5);
 const db=new DatabaseSync(f.path);
 try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,1);
  assert.equal(db.prepare('SELECT state FROM verified_subscription_allocations').get().state,'canceled');
 }finally{db.close();}
});
test('event key reuse, conflicting same-revision payload, stale event and wrong tenant fail closed',t=>{
 const f=fixture(t);
 f.store.applyVerifiedSubscriptionTransition(sealed(claim()));
 for(const assertion of [
  claim({eventKey:'evt_live_internal1234',revision:2}),
  claim({eventKey:'evt_live_diff1234',revision:1,seats:4}),
  claim({eventKey:'evt_live_stale1234',revision:0}),
  claim({eventKey:'evt_live_org1234',revision:2,organizationId:'two'})
 ]){
  assert.throws(()=>f.store.applyVerifiedSubscriptionTransition(sealed(assertion)),
   /verified_billing_event_conflict|verified_subscription_revision_conflict|verified_subscription_stale|verified_subscription_tenant_conflict|verified_billing_rejected/);
 }
 assert.equal(seat(f),3);
 assert.equal(seat(f,'two','admin2'),0);
});
