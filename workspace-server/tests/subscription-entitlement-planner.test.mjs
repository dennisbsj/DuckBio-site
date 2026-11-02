import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShadowEntitlementPlan} from '../subscription-entitlement-planner.mjs';

const baseline=()=>({organizationId:'lab-a',now:1783090000000,
 apps:[{id:'eel',name:'DuckNote',purchased:4,assigned:2,reserved:1},
  {id:'goflo',name:'CytoDuck',purchased:1,assigned:1,reserved:0},
  {id:'duckman',name:'DuckMan',purchased:0,assigned:0,reserved:0}],
 subscriptions:[]});
const subscription=(overrides={})=>({
 subscriptionId:'sub_test_A',org:'lab-a',apps:['eel'],seats:4,
 decision:'candidate_paid',periodEnd:1900000000,attempt:1,...overrides
});
const plan=x=>buildShadowEntitlementPlan(x);
const app=(x,id)=>x.apps.find(a=>a.appId===id);

test('one subscription is counted by its seats, not by renewals or invoices',()=>{
 const x=baseline();x.subscriptions=[subscription()];
 const p=plan(x);
 assert.equal(app(p,'eel').candidateTestSeats,4);
 assert.equal(app(p,'eel').status,'unchanged');
 assert.equal(app(p,'goflo').status,'not_evaluated');
 assert.equal(app(p,'duckman').status,'not_evaluated');
 assert.equal(p.realSeatChanges,false);assert.equal(p.licensesGranted,false);
});
test('multiple real subscription identities aggregate per selected app only',()=>{
 const x=baseline();
 x.subscriptions=[subscription({apps:['eel','goflo'],seats:3}),
  subscription({subscriptionId:'sub_test_B',apps:['eel'],seats:2})];
 const p=plan(x);
 assert.equal(app(p,'eel').candidateTestSeats,5);
 assert.equal(app(p,'eel').status,'increase_candidate');
 assert.equal(app(p,'goflo').candidateTestSeats,3);
 assert.equal(app(p,'goflo').status,'increase_candidate');
 assert.equal(app(p,'duckman').candidateTestSeats,0);
});
test('downgrade cannot automatically revoke assigned seats or reservations',()=>{
 const x=baseline();x.subscriptions=[subscription({seats:2})];
 const p=plan(x);
 assert.equal(app(p,'eel').status,'assignment_conflict');
 assert.equal(app(p,'eel').hypotheticalShortfall,1);
 assert.equal(app(p,'eel').livePurchased,4);
 assert.equal(app(p,'eel').realSeatChanges,false);
 x.subscriptions[0].seats=3;
 assert.equal(app(plan(x),'eel').status,'decrease_requires_review');
});
test('unpaid cancellation outage or expired term blocks automatic candidates',()=>{
 for(const decision of ['payment_review','cancellation_review','awaiting_payment','unavailable']){
  const x=baseline();x.subscriptions=[subscription({decision})];
  const row=app(plan(x),'eel');
  assert.equal(row.status,'manual_review');
  assert.equal(row.candidateTestSeats,0);
  assert.equal(row.realSeatChanges,false);
 }
 const x=baseline();x.subscriptions=[subscription({periodEnd:1783089999})];
 assert.equal(app(plan(x),'eel').status,'manual_review');
 x.subscriptions[0].periodEnd=null;
 assert.equal(app(plan(x),'eel').status,'manual_review');
});
test('mixed valid + uncertain source must never treat partial coverage as permission',()=>{
 const x=baseline();
 x.subscriptions=[subscription({seats:3}),
  subscription({subscriptionId:'sub_test_B',seats:2,decision:'unavailable'})];
 const row=app(plan(x),'eel');
 assert.equal(row.candidateTestSeats,3);
 assert.equal(row.subscriptionCount,2);
 assert.equal(row.status,'manual_review');
});
test('rejects tenant mixing, duplicate source, unknown app, invalid quantities or overflow',()=>{
 const x=baseline();
 for(const item of [
  [subscription(),subscription()],
  [subscription({org:'lab-b'})],
  [subscription({apps:['wrong']})],
  [subscription({apps:['eel','eel']})],
  [subscription({seats:0})],
  [subscription({decision:'grant_access'})],
  [subscription({periodEnd:NaN})],
  [subscription({attempt:0})]
 ]){
  x.subscriptions=item;
  assert.throws(()=>plan(x),/invalid_entitlement_plan/);
 }
 x.subscriptions=[subscription({seats:Number.MAX_SAFE_INTEGER}),
  subscription({subscriptionId:'sub_test_B',seats:20})];
 assert.throws(()=>plan(x),/entitlement_overflow/);
});
