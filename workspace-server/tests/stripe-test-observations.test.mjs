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
 let store=createOrganizationStore({databasePath:dbPath,clock:()=>1783090000000});
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
   reopen(){store.close();store=createOrganizationStore({databasePath:dbPath,clock:()=>1783090000000});}};
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
  {state:'pending',reason:'payment_unpaid',attempt:1,checkedAt:1783090000000,licensesGranted:false});
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
