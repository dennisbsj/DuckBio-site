import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createOrganizationStore} from '../organization-store.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-test-observations-'));
 const dbPath=join(dir,'private','org.sqlite');
 let currentTime=1783090000000;
 let store=createOrganizationStore({databasePath:dbPath,clock:()=>currentTime});
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 for(const [org,account] of [['one','admin1'],['two','admin2']])
  store.setupOrganization({organizationId:org,name:'Lab '+org,owner:{
   accountId:account,name:account,nickname:'Owner',email:account+'@example.test'}});
 const draft=store.createSubscriptionDraft({organizationId:'one',actorId:'admin1',
  plan:'Single',apps:['eel'],seats:3});
 const params={organizationId:'one',actorId:'admin1',draftId:draft.id};
 store.prepareTestCheckout({...params,price:'price_test12345'});
 store.completeTestCheckout({...params,session:{
  id:'cs_test_session1234',url:'https://checkout.stripe.com/c/pay/synthetic'}});
 const start=()=>store.beginTestReconciliation(params);
 const finish=(started,result)=>store.finishTestReconciliation({...params,attempt:started.attempt,result});
 const paid={state:'paid_test_verified',sessionId:'cs_test_session1234',subscriptionId:'sub_test1234',
  invoiceId:'in_test1234',organizationId:'one',draftId:draft.id,price:'price_test12345',
  seats:3,licensesGranted:false};
 return {dbPath,params,draft,start,finish,paid,get store(){return store;},
   setClock(value){currentTime=value;},
   reopen(){store.close();store=createOrganizationStore({databasePath:dbPath,clock:()=>currentTime});}};
}
test('test reconciliation ledger records scoped, durable statuses without issuing seats',t=>{
 const f=fixture(t);
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation,null);
 assert.throws(()=>f.store.beginTestReconciliation({...f.params,actorId:'admin2'}),/access_denied/);
 assert.throws(()=>f.store.beginTestReconciliation({...f.params,organizationId:'two',actorId:'admin2'}),/checkout_not_found/);
 const a=f.start();
 assert.equal(a.attempt,1);
 assert.equal(a.snapshot.draft.seats,3);
 assert.equal(a.snapshot.checkout.price,'price_test12345');
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.state,'checking');
 assert.deepEqual(f.finish(a,{state:'pending',reason:'payment_unpaid',licensesGranted:false}),
  {state:'pending',reason:'payment_unpaid',attempt:1,checkedAt:1783090000000,licensesGranted:false,testSeatDecision:'awaiting_payment'});
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.reason,'payment_unpaid');
 const b=f.start();
 assert.equal(b.attempt,2);
 assert.equal(f.finish(b,f.paid).state,'paid_test_verified');
 let latest=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.deepEqual(latest.testReconciliation,{state:'paid_test_verified',reason:null,
  attempt:2,checkedAt:1783090000000,licensesGranted:false,lifecycle:null});
 assert(f.store.overview('one','admin1').apps.every(a=>a.purchased===0 && a.assigned===0));
 assert(f.store.overview('two','admin2').apps.every(a=>a.purchased===0 && a.assigned===0));
 assert.equal(f.store.auditLog('one','admin1').filter(e=>e.action==='checkout.test.reconciliation.observed').length,2);
 assert.equal(f.store.auditLog('two','admin2').filter(e=>e.action==='checkout.test.reconciliation.observed').length,0);
 f.reopen();
 latest=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.equal(latest.testReconciliation.state,'paid_test_verified');
 const db=new DatabaseSync(f.dbPath);
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_test_reconciliation_checks').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n,0);
 }finally{db.close();}
});
test('newer attempts supersede old in-flight results atomically and never restore stale paid status',t=>{
 const f=fixture(t);
 const early=f.start(),recent=f.start();
 assert.equal(recent.attempt,2);
 assert.throws(()=>f.finish(early,f.paid),/reconciliation_superseded/);
 assert.equal(f.finish(recent,f.paid).state,'paid_test_verified');
 const third=f.start();
 assert.equal(f.finish(third,{state:'pending',reason:'subscription_not_active',licensesGranted:false}).state,'pending');
 assert.throws(()=>f.finish(recent,f.paid),/reconciliation_superseded/);
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.state,'pending');
 const fourth=f.start();
 assert.equal(f.finish(fourth,{state:'unavailable',licensesGranted:false}).state,'unavailable');
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.state,'unavailable');
 const db=new DatabaseSync(f.dbPath);
 try{
  assert.deepEqual(db.prepare('SELECT state FROM stripe_test_reconciliation_checks ORDER BY attempt').all()
   .map(x=>x.state),['superseded','paid_test_verified','pending','unavailable']);
 }finally{db.close();}
});
test('untrusted or mismatched attestation results cannot be persisted as verified payment',t=>{
 const f=fixture(t),started=f.start();
 for(const input of [
  {...f.paid,organizationId:'two'},
  {...f.paid,price:'price_other'},
  {...f.paid,seats:10},
  {...f.paid,sessionId:'cs_test_other'},
  {...f.paid,invoiceId:'invoice_bad'},
  {...f.paid,licensesGranted:true},
  {state:'pending',reason:'anything',licensesGranted:false},
  {state:'unavailable',reason:'invented',licensesGranted:false}
 ])assert.throws(()=>f.finish(started,input),/invalid_reconciliation/);
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.state,'checking');
 assert.equal(f.finish(started,{state:'unavailable',licensesGranted:false}).state,'unavailable');
 assert(f.store.overview('one','admin1').apps.every(x=>x.purchased===0));
});

test('test-only renewal and cancellation diagnostics persist across restart without granting entitlements',t=>{
 const f=fixture(t);
 const active={subscriptionStatus:'active',cancelAtPeriodEnd:true,cancelAt:1790000000,
  periodEnd:1790000000,invoiceStatus:'paid',billingReason:'subscription_cycle'};
 const first=f.start();
 const observed=f.finish(first,{...f.paid,lifecycle:active});
 assert.equal(observed.lifecycle.billingReason,'subscription_cycle');
 assert.equal(observed.lifecycle.cancelAtPeriodEnd,true);
 let row=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.deepEqual(row.testReconciliation.lifecycle,active);
 const old=f.start();
 const canceled={subscriptionStatus:'canceled',cancelAtPeriodEnd:false,cancelAt:null,
  periodEnd:1790000000,invoiceStatus:'paid',billingReason:'subscription_cycle'};
 assert.equal(f.finish(old,{state:'pending',reason:'subscription_not_active',
  lifecycle:canceled,licensesGranted:false}).state,'pending');
 row=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.equal(row.testReconciliation.state,'pending');
 assert.equal(row.testReconciliation.lifecycle.subscriptionStatus,'canceled');
 f.reopen();
 row=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.equal(row.testReconciliation.lifecycle.subscriptionStatus,'canceled');
 assert(f.store.overview('one','admin1').apps.every(x=>x.purchased===0&&x.assigned===0));
 assert(f.store.overview('two','admin2').apps.every(x=>x.purchased===0));
});
test('lifecycle state must match payment attestation and include only known fields',t=>{
 const f=fixture(t),attempt=f.start();
 const base={subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
  periodEnd:1790000000,invoiceStatus:'paid',billingReason:'subscription_create'};
 for(const input of [
  {...f.paid,lifecycle:{...base,subscriptionStatus:'canceled'}},
  {...f.paid,lifecycle:{...base,invoiceStatus:'open'}},
  {...f.paid,lifecycle:{...base,extra:'untrusted payload'}},
  {...f.paid,lifecycle:{...base,cancelAtPeriodEnd:'false'}},
  {...f.paid,lifecycle:{...base,periodEnd:-1}},
  {state:'pending',reason:'invoice_not_paid',lifecycle:{...base,subscriptionStatus:'past_due'},licensesGranted:false}
 ]) assert.throws(()=>f.finish(attempt,input),/invalid_reconciliation/);
 assert.equal(f.finish(attempt,{...f.paid,lifecycle:base}).state,'paid_test_verified');
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testReconciliation.lifecycle.subscriptionStatus,'active');
});

test('test billing history is bounded, ordered, restart-safe and never crosses tenants',t=>{
 const f=fixture(t);
 assert.throws(()=>f.store.testReconciliationHistory({...f.params,actorId:'admin2'}),/access_denied/);
 assert.throws(()=>f.store.testReconciliationHistory({...f.params,organizationId:'two',actorId:'admin2'}),/checkout_not_found/);
 assert.deepEqual(f.store.testReconciliationHistory(f.params),[]);
 for(let n=0;n<13;n++){
  const started=f.start();
  const result=n%2?{state:'pending',reason:'invoice_not_paid',licensesGranted:false}:
    {state:'unavailable',licensesGranted:false};
  f.finish(started,result);
 }
 let history=f.store.testReconciliationHistory(f.params);
 assert.equal(history.length,10);
 assert.equal(history[0].attempt,13);
 assert.equal(history[9].attempt,4);
 assert(history.every(x=>x.licensesGranted===false&&!('invoiceId' in x)&&!('sessionId' in x)));
 f.reopen();
 history=f.store.testReconciliationHistory(f.params);
 assert.equal(history.length,10);
 assert.equal(history[0].attempt,13);
 assert.equal(f.store.overview('one','admin1').apps.find(x=>x.id==='eel').purchased,0);
});

test('Stripe TEST seat projection is per-app, replace-not-add on renewals, and never changes active seats',t=>{
 const f=fixture(t);
 const lifecycle={subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
  periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_create'};
 const initial=f.start();
 const observed=f.finish(initial,{...f.paid,lifecycle});
 assert.equal(observed.testSeatDecision,'candidate_paid');
 let projected=f.store.testSeatCapacity('one','admin1');
 assert.equal(projected.apps.find(x=>x.appId==='eel').candidateTestSeats,3);
 assert(projected.apps.filter(x=>x.appId!=='eel').every(x=>x.candidateTestSeats===0));
 assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testSeatProjection.seatsPerApp,3);
 assert.equal(f.store.overview('one','admin1').apps.find(x=>x.id==='eel').purchased,0);
 assert.throws(()=>f.store.testSeatCapacity('one','admin2'),/access_denied/);
 const duplicate=f.start();
 assert.equal(f.finish(duplicate,{...f.paid,lifecycle}).testSeatDecision,'candidate_paid');
 assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='eel').candidateTestSeats,3,
  'a replay of an invoice does not add another 3 seats');
 const renewal=f.start();
 const renewed={...f.paid,invoiceId:'in_test_renewal5678',
  lifecycle:{...lifecycle,billingReason:'subscription_cycle',periodEnd:1910000000}};
 assert.equal(f.finish(renewal,renewed).testSeatDecision,'candidate_paid');
 assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='eel').candidateTestSeats,3,
  'a new paid renewal invoice replaces the projection rather than adding seats');
 const db=new DatabaseSync(f.dbPath);
 try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_test_subscription_bindings').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_test_invoice_refs').get().n,2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_test_seat_projections').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,0);
 }finally{db.close();}
 f.reopen();
 projected=f.store.testSeatCapacity('one','admin1');
 assert.equal(projected.apps.find(x=>x.appId==='eel').candidateTestSeats,3);
 assert(f.store.overview('one','admin1').apps.every(x=>x.purchased===0 && x.assigned===0));
});
test('unpaid, cancellation, expired or unavailable Stripe TEST states never produce candidate seats',t=>{
 const f=fixture(t);
 const active={subscriptionStatus:'active',cancelAtPeriodEnd:true,cancelAt:1900000000,
  periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_cycle'};
 assert.equal(f.finish(f.start(),{...f.paid,lifecycle:active}).testSeatDecision,'candidate_paid',
  'scheduled cancellation stays potentially usable until term end');
 const rejected=[
  [{state:'pending',reason:'subscription_not_active',licensesGranted:false,
    lifecycle:{...active,subscriptionStatus:'canceled',cancelAtPeriodEnd:false,cancelAt:null}},'cancellation_review'],
  [{state:'pending',reason:'subscription_not_active',licensesGranted:false,
    lifecycle:{...active,subscriptionStatus:'past_due'}},'payment_review'],
  [{state:'pending',reason:'payment_unpaid',licensesGranted:false},'awaiting_payment'],
  [{state:'unavailable',licensesGranted:false},'unavailable'],
  [{...f.paid,invoiceId:'in_test_renewal9999',lifecycle:{...active,periodEnd:1783089999}},'payment_review']
 ];
 for(const [result,expectedDecision] of rejected){
  assert.equal(f.finish(f.start(),result).testSeatDecision,expectedDecision);
  assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='eel').candidateTestSeats,0);
  assert.equal(f.store.listSubscriptionDrafts('one','admin1')[0].testSeatProjection.seatsPerApp,0);
  assert.equal(f.store.overview('one','admin1').apps.find(x=>x.id==='eel').purchased,0);
 }
});
test('paid subscription and invoice identity are globally bound to one organization/draft',t=>{
 const f=fixture(t);
 const active={subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
  periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_create'};
 f.finish(f.start(),{...f.paid,lifecycle:active});
 const other=f.store.createSubscriptionDraft({organizationId:'two',actorId:'admin2',
  plan:'Mixed',apps:['eel','goflo'],seats:4});
 const params={organizationId:'two',actorId:'admin2',draftId:other.id};
 f.store.prepareTestCheckout({...params,price:'price_test_different123'});
 f.store.completeTestCheckout({...params,session:{
  id:'cs_test_other1234',url:'https://checkout.stripe.com/c/pay/other'}});
 const started=f.store.beginTestReconciliation(params);
 const base={state:'paid_test_verified',organizationId:'two',draftId:other.id,
  sessionId:'cs_test_other1234',price:'price_test_different123',seats:4,licensesGranted:false,
  lifecycle:active};
 assert.throws(()=>f.store.finishTestReconciliation({...params,attempt:started.attempt,
  result:{...base,subscriptionId:f.paid.subscriptionId,invoiceId:'in_test_other5678'}}),
  /stripe_test_subscription_conflict/);
 assert.throws(()=>f.store.finishTestReconciliation({...params,attempt:started.attempt,
  result:{...base,subscriptionId:'sub_test_other5678',invoiceId:f.paid.invoiceId}}),
  /stripe_test_invoice_conflict/);
 const good={...base,subscriptionId:'sub_test_other5678',invoiceId:'in_test_other5678'};
 assert.equal(f.store.finishTestReconciliation({...params,attempt:started.attempt,result:good}).testSeatDecision,
  'candidate_paid');
 assert.equal(f.store.testSeatCapacity('two','admin2').apps.find(x=>x.appId==='eel').candidateTestSeats,4);
 assert.equal(f.store.testSeatCapacity('two','admin2').apps.find(x=>x.appId==='goflo').candidateTestSeats,4);
 assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='goflo').candidateTestSeats,0);
 assert(f.store.overview('two','admin2').apps.every(x=>x.purchased===0));
});

test('expired TEST billing period stops counting as candidate even without another Stripe read',t=>{
 const f=fixture(t);
 const result={...f.paid,lifecycle:{
  subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
  periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_cycle'}};
 f.finish(f.start(),result);
 assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='eel').candidateTestSeats,3);
 f.setClock(1900000000000);
 assert.equal(f.store.testSeatCapacity('one','admin1').apps.find(x=>x.appId==='eel').candidateTestSeats,0);
 const snapshot=f.store.listSubscriptionDrafts('one','admin1')[0];
 assert.equal(snapshot.testSeatProjection.decision,'payment_review');
 assert.equal(snapshot.testSeatProjection.seatsPerApp,0);
 assert.equal(snapshot.testReconciliation.state,'paid_test_verified',
  'historical payment evidence remains traceable but has no simulated current seats');
 assert.equal(f.store.overview('one','admin1').apps.find(x=>x.id==='eel').purchased,0);
});
