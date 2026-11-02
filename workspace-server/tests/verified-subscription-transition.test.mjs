import test from 'node:test';
import assert from 'node:assert/strict';
import {planVerifiedSubscriptionTransition as plan} from '../verified-subscription-transition.mjs';
const now=1800000000000;
const inventory=()=>['limsman','goflo','methpipe','eel','duckman','mantrain']
 .map(appId=>({appId,purchased:0,assigned:0,reserved:0}));
const next=(overrides={})=>({plan:'Single',apps:['eel'],seats:3,
 status:'active',paidThrough:1900000000,revision:1,...overrides});
const input=(overrides={})=>({organizationId:'lab-one',subscriptionId:'sub_12345',
 knownApps:inventory(),next:next(),now,...overrides});
const app=(result,id)=>result.changes.find(x=>x.appId===id);
test('new verified Single subscription proposes exact app-only seat delta without applying it',()=>{
 const x=plan(input());
 assert.equal(x.allowed,true);
 assert.equal(app(x,'eel').delta,3);
 assert.equal(app(x,'eel').targetPurchased,3);
 assert(x.changes.filter(x=>x.appId!=='eel').every(x=>x.delta===0));
 assert.equal(x.realSeatChanges,false);
 assert.equal(x.licensesGranted,false);
});
test('Mixed and Bundle plans target only the selected app seats',()=>{
 let x=plan(input({next:next({plan:'Mixed',apps:['goflo','eel'],seats:2})}));
 assert.equal(app(x,'eel').delta,2);
 assert.equal(app(x,'goflo').delta,2);
 assert.equal(app(x,'duckman').delta,0);
 x=plan(input({next:next({plan:'Bundle',apps:inventory().map(x=>x.appId),seats:4})}));
 assert(x.changes.every(x=>x.delta===4));
});
test('renewal is replace-not-add, and plan or quantity change computes signed deltas',()=>{
 const existing={...next(),organizationId:'lab-one',subscriptionId:'sub_12345'};
 const knownApps=inventory().map(a=>({...a,purchased:a.appId==='eel'?3:0}));
 const renewal=plan(input({existing,knownApps,next:next({revision:2})}));
 assert.equal(app(renewal,'eel').delta,0);
 assert.equal(app(renewal,'eel').targetPurchased,3);
 const switched=plan(input({existing,knownApps,next:next({
  revision:2,plan:'Mixed',apps:['eel','goflo'],seats:2})}));
 assert.equal(app(switched,'eel').delta,-1);
 assert.equal(app(switched,'goflo').delta,2);
 assert.equal(app(switched,'eel').targetPurchased,2);
});
test('downgrades that cannot hold assignments or pending invitations require manual review',()=>{
 const existing={...next(),organizationId:'lab-one',subscriptionId:'sub_12345'};
 const knownApps=inventory().map(a=>a.appId==='eel'?{
  ...a,purchased:3,assigned:2,reserved:1}:a);
 let p=plan(input({existing,knownApps,next:next({revision:2,seats:2})}));
 assert.equal(p.allowed,false);
 assert.equal(p.requiresManualReview,true);
 assert.equal(app(p,'eel').shortfall,1);
 assert.equal(app(p,'eel').targetPurchased,2);
 assert.equal(app(p,'eel').blocked,true);
 assert.equal(p.realSeatChanges,false);
 p=plan(input({existing,knownApps,next:next({revision:2,seats:3})}));
 assert.equal(p.allowed,true);
});
test('cancellation of expired paid term is proposed, not executed; absence of conflicts permits it',()=>{
 const existing={...next({paidThrough:1700000000}),organizationId:'lab-one',subscriptionId:'sub_12345'};
 const knownApps=inventory().map(a=>a.appId==='eel'?{...a,purchased:3}:a);
 const proposal=plan(input({existing,knownApps,next:next({
  revision:2,status:'canceled',paidThrough:null})}));
 assert.equal(proposal.allowed,true);
 assert.equal(app(proposal,'eel').delta,-3);
 assert.equal(app(proposal,'eel').targetPurchased,0);
 assert.equal(proposal.licensesGranted,false);
});
test('legacy seats remain intact when removing the subscription part',()=>{
 const existing={...next(),organizationId:'lab-one',subscriptionId:'sub_12345'};
 const knownApps=inventory().map(a=>a.appId==='eel'?{...a,purchased:8,assigned:4,reserved:1}:a);
 const p=plan(input({existing,knownApps,next:next({
  revision:2,status:'canceled',paidThrough:null})}));
 assert.equal(app(p,'eel').targetPurchased,5);
 assert.equal(p.allowed,true);
});
test('rejects replayed versions, wrong tenant, invalid plan and incomplete billing evidence',()=>{
 const existing={...next(),organizationId:'lab-one',subscriptionId:'sub_12345'};
 const standard=input({existing});
 for(const change of [
  {next:next({revision:1})},
  {next:next({revision:0})},
  {existing:{...existing,organizationId:'lab-other'}},
  {existing:{...existing,subscriptionId:'sub_other'}},
 ])assert.throws(()=>plan({...standard,...change}),/stale_subscription_transition|invalid_subscription_transition/);
 for(const invalid of [
  next({paidThrough:1799999999}),next({paidThrough:null}),
  next({plan:'Single',apps:['eel','goflo']}),
  next({plan:'Mixed',apps:['eel']}),
  next({plan:'Bundle',apps:['eel']}),
  next({apps:['eel','eel']}),
  next({apps:['wrong']}),
  next({seats:0}),
  next({status:'trialing'}),
  next({status:'canceled',paidThrough:null}),
 ])assert.throws(()=>plan(input({next:invalid})),/invalid_subscription_transition/);
 assert.throws(()=>plan(input({existing,next:next({
  revision:2,status:'canceled',seats:2,paidThrough:null})})),/invalid_subscription_transition/);
});
test('enforces purchased-seat underflow and safe integer checks without changing anything',()=>{
 const existing={...next(),organizationId:'lab-one',subscriptionId:'sub_12345'};
 assert.throws(()=>plan(input({existing,next:next({
  revision:2,status:'canceled',paidThrough:null})})),/subscription_transition_invariant/);
 const bad=inventory();
 bad[0].purchased=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>plan(input({knownApps:bad,next:next({
  plan:'Bundle',apps:inventory().map(a=>a.appId),seats:2})})),/subscription_transition_invariant/);
});
