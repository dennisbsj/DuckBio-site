import test from 'node:test';
import assert from 'node:assert/strict';
import {FUTURE_DUCKBIO_APPS as ids,planFutureSevenAppTransition as plan} from '../seven-app-transition-planner.mjs';
const now=1800000000000;
const known=()=>ids.map(appId=>({appId,purchased:0,assigned:0,reserved:0}));
const next=(p={},revision=1)=>({plan:'Single',apps:['dataduck'],seats:2,
 status:'active',paidThrough:1900000000,revision,...p});
const request=(p={})=>({organizationId:'org1',subscriptionId:'sub_12345',
 knownApps:known(),next:next(),now,...p});
const row=(p,id)=>p.changes.find(r=>r.appId===id);
test('future Single, Mixed 2-6 and seven-app Bundle yield independent candidate seats only',()=>{
 for(const choice of [
  next(),
  next({plan:'Mixed',apps:['goflo','dataduck']}),
  next({plan:'Mixed',apps:ids.slice(0,6)}),
  next({plan:'Bundle',apps:[...ids]})
 ]){
  const p=plan(request({next:choice}));
  assert.equal(p.allowed,true);
  assert.equal(p.licensesGranted,false);
  assert.equal(p.orderable,false);
  assert.equal(p.realSeatChanges,false);
  for(const id of ids)assert.equal(row(p,id).delta,choice.apps.includes(id)?2:0);
 }
});
test('legacy six-app Bundle renewal never silently grants DataDuck',()=>{
 const six=ids.filter(x=>x!=='dataduck');
 const old={organizationId:'org1',subscriptionId:'sub_12345',
  ...next({plan:'Bundle',apps:six,seats:3})};
 const inventory=known().map(x=>({...x,purchased:six.includes(x.appId)?3:0}));
 const renewal=plan(request({knownApps:inventory,existing:old,
  next:{...old,revision:2}}));
 assert.equal(renewal.allowed,true);
 assert.equal(renewal.oldSixAppBundlePreserved,true);
 assert.equal(row(renewal,'dataduck').delta,0);
 assert.equal(row(renewal,'dataduck').targetPurchased,0);
 assert.throws(()=>plan(request({next:next({plan:'Bundle',apps:six})})),/invalid_seven_app_transition/);
 const upgrade=plan(request({knownApps:inventory,existing:old,
  next:{...old,revision:2,apps:[...ids]}}));
 assert.equal(upgrade.allowed,false);
 assert.equal(upgrade.catalogUpgradeRequiresApproval,true);
 assert.equal(row(upgrade,'dataduck').delta,3);
 const withApproval=plan(request({knownApps:inventory,existing:old,approvedCatalogUpgrade:true,
  next:{...old,revision:2,apps:[...ids]}}));
 assert.equal(withApproval.allowed,true);
 assert.equal(withApproval.licensesGranted,false);
});
test('adding DataDuck to any existing six-app plan requires explicit approved upgrade',()=>{
 const old={organizationId:'org1',subscriptionId:'sub_12345',
  ...next({plan:'Single',apps:['eel']})};
 const inventory=known().map(x=>({...x,purchased:x.appId==='eel'?2:0}));
 const p=plan(request({knownApps:inventory,existing:old,
  next:next({plan:'Mixed',apps:['eel','dataduck'],revision:2})}));
 assert.equal(p.allowed,false);
 assert.equal(p.catalogUpgradeRequiresApproval,true);
 assert.equal(row(p,'eel').delta,0);
});
test('downgrade cannot overcommit active app assignments and invitations',()=>{
 const old={organizationId:'org1',subscriptionId:'sub_12345',...next({seats:3})};
 const inventory=known().map(x=>({...x,purchased:x.appId==='dataduck'?3:0,
  assigned:x.appId==='dataduck'?2:0,reserved:x.appId==='dataduck'?1:0}));
 const p=plan(request({knownApps:inventory,existing:old,
  next:{...old,revision:2,seats:2}}));
 assert.equal(p.allowed,false);
 assert.equal(row(p,'dataduck').shortfall,1);
 assert.equal(row(p,'dataduck').targetPurchased,2);
});
test('valid cancellation is preview only; wrong identity and replay revisions fail',()=>{
 const old={organizationId:'org1',subscriptionId:'sub_12345',...next({seats:3})};
 const inventory=known().map(x=>({...x,purchased:x.appId==='dataduck'?3:0}));
 const p=plan(request({knownApps:inventory,existing:old,
  next:{...old,revision:2,status:'canceled',paidThrough:null}}));
 assert.equal(p.allowed,true);
 assert.equal(row(p,'dataduck').delta,-3);
 for(const change of [
  {existing:{...old,organizationId:'org2'}},
  {existing:{...old,subscriptionId:'sub_other'}},
  {next:{...old,revision:1}},
  {next:{...old,revision:2,status:'canceled',seats:2,paidThrough:null}},
  {next:{...old,revision:2,status:'active',paidThrough:1}}
 ])assert.throws(()=>plan(request({knownApps:inventory,existing:old,
  next:{...old,revision:2},...change})),/invalid_seven_app_transition/);
});
test('unknown app IDs, duplicate apps and malformed seat inventories fail closed',()=>{
 for(const invalid of [
  next({plan:'Mixed',apps:['dataduck']}),
  next({apps:['dataduck','dataduck']}),
  next({apps:['unknown']}),
  next({plan:'Bundle',apps:ids.slice(0,6)}),
  next({paidThrough:null}),
  next({seats:0})
 ])assert.throws(()=>plan(request({next:invalid})),/invalid_seven_app_transition/);
 assert.throws(()=>plan(request({knownApps:known().slice(0,6)})),/invalid_seven_app_transition/);
 assert.throws(()=>plan(request({knownApps:known().map((x,i)=>i===0?{...x,assigned:-1}:x)})),/invalid_seven_app_transition/);
});
