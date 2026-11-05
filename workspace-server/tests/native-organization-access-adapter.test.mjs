import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeOrganizationBrokerAccessAdapter} from '../shared-auth/native-organization-access-adapter.mjs';

const NOW=1800000000000;
const PAID=1900000000000;
const PARENT={id:'parent-1',subject:'subject-1',expiresAt:NOW+24*3600_000,passwordChangeRequired:false};
const NATIVE={nativeUserId:'native-user-1',nativeOrganizationId:'native-org-1'};
function fixture(){
 let now=NOW,hook=null,inspections=0;
 const state={session:{...PARENT},user:true,selected:'lab-alpha',selectionRevision:1,
   policy:true,role:'Analyst',auditRevision:9,paidThroughMs:PAID,
   link:true,linkRevision:3,...NATIVE};
 const identity={
  getSession:async()=>PARENT,authenticate:async()=>PARENT,
  getParentSession:async()=>state.session,logout:async()=>true
 };
 const identityStore={
  getParentSession:id=>state.session&&id===state.session.id?{...state.session}:null,
  getUser:id=>state.user&&id===PARENT.subject?{id,state:'active'}:null,
  // Legacy unscoped user/app mapping MUST NEVER authorize org mode.
  getAccessWithRevision:()=>({localIdentity:{userId:NATIVE.nativeUserId},bindingRevision:'legacy-global:999'}),
  getOrganizationNativeLink:({userId,appId,workspaceOrganizationId})=>
    state.link&&userId===PARENT.subject&&appId==='goflo'&&workspaceOrganizationId==='lab-alpha'
      ?{userId,appId,workspaceOrganizationId,linkOnly:true,accessGranted:false,
        licensesGranted:false,loginEnabled:false,linkRevision:state.linkRevision,
        nativeUserId:state.nativeUserId,nativeOrganizationId:state.nativeOrganizationId}
      :null
 };
 const organizationStore={
  currentSessionOrganization:({sessionId,accountId})=>
    state.selected&&sessionId===PARENT.id&&accountId===PARENT.subject
       ?{id:state.selected,sessionSelectionRevision:state.selectionRevision}:null,
  verifiedNativePermissionCandidate:({organizationId,accountId,appId,permission})=>
    state.policy&&organizationId==='lab-alpha'&&accountId===PARENT.subject&&
    appId==='goflo'&&permission==='workspace.view'
      ?{organizationId,accountId,appId,permission,source:'verified_live_subscription_ledger',
        accessGranted:false,licensesGranted:false,nativeEnforcementRequired:true,
        role:state.role,authorizationAuditRevision:state.auditRevision,
        verifiedPaidThroughMs:state.paidThroughMs}:null
 };
 const inspector={
  async inspect(request){
   inspections++;
   assert.deepEqual(request,{sessionId:PARENT.id,organizationId:'lab-alpha',
     appId:'goflo',permission:'workspace.view'});
   const evidence={candidateReady:true,accessGranted:false,licensesGranted:false,
     loginEnabled:false,nativeEnforcementRequired:true,
     workspaceAccountId:PARENT.subject,workspaceOrganizationId:'lab-alpha',
     appId:'goflo',permission:'workspace.view',role:state.role,
     authorizationAuditRevision:state.auditRevision,
     verifiedPaidThroughMs:state.paidThroughMs,
     nativeUserId:state.nativeUserId,nativeOrganizationId:state.nativeOrganizationId};
   if(hook)await hook();
   return evidence;
  }
 };
 const adapter=createNativeOrganizationBrokerAccessAdapter({
  identity,identityStore,organizationStore,inspector,clock:()=>now
 });
 return {state,adapter,identityStore,organizationStore,inspector,identity,
  inspections:()=>inspections,mutate:x=>{hook=x},setClock:x=>{now=x}};
}
const go=fixture=>fixture.adapter.inspectAccessCandidate(PARENT,'goflo');

test('trusted ownership preflight plus current tenant and verified LIVE seat yields revision-bound native ID',async()=>{
 const f=fixture();const a=await go(f);
 assert(a);
 assert.equal(a.candidateReady,true);
 assert.equal(a.accessGranted,false);
 assert.equal(a.licensesGranted,false);
 assert.equal(a.loginEnabled,false);
 assert.equal(a.nativeEnforcementRequired,true);
 assert.deepEqual(a.localIdentity,{userId:NATIVE.nativeUserId,organizationId:NATIVE.nativeOrganizationId});
 assert.match(a.bindingRevision,/^org-native-v1:[A-Za-z0-9_-]{43}$/);
 assert.equal((await go(f)).bindingRevision,a.bindingRevision,
  'the same current access generation must be stable for child proof introspection');
 assert.equal(f.inspections(),2);
});

test('legacy global grants cannot substitute for tenant scoped native identity link or live seats',async()=>{
 for(const prop of ['link','policy','user','selected']){
  const f=fixture();f.state[prop]=false;
  assert.equal(await go(f),null,prop);
  assert.equal(f.inspections(),0,prop);
 }
});

test('seventh unreleased DataDuck and unknown clients always deny without ownership lookup',async()=>{
 const f=fixture();
 assert.equal(await f.adapter.getAccess(PARENT,'dataduck'),null);
 assert.equal(await f.adapter.getAccess(PARENT,'stranger'),null);
 assert.equal(f.inspections(),0);
});

test('live period expiration, logged out session and selected different tenant deny before native lookup',async()=>{
 for(const change of [
  f=>{f.state.paidThroughMs=NOW-1;},
  f=>{f.state.session=null;},
  f=>{f.state.selected='lab-other';},
  f=>{f.setClock(PAID+1);},
  f=>{f.state.session={...PARENT,expiresAt:NOW};}
 ]){
  const f=fixture();change(f);
  assert.equal(await go(f),null);
  assert.equal(f.inspections(),0);
 }
});

test('same org clear/reselect ABA during await denies stale owner preflight',async()=>{
 const f=fixture();const initial=await go(f);
 f.mutate(()=>{f.state.selectionRevision+=2;});
 assert.equal(await go(f),null);
 f.mutate(null);const fresh=await go(f);
 assert(fresh);assert.notEqual(fresh.bindingRevision,initial.bindingRevision);
});

test('same policy role revoke/regrant ABA during await denies even if role is identical',async()=>{
 const f=fixture();const initial=await go(f);
 f.mutate(()=>{f.state.auditRevision+=2;});
 assert.equal(await go(f),null);
 f.mutate(null);
 const fresh=await go(f);
 assert(fresh);assert.notEqual(fresh.bindingRevision,initial.bindingRevision);
});

test('same native user and tenant unlink/rebind ABA denies older proof',async()=>{
 const f=fixture();const original=await go(f);
 f.mutate(()=>{f.state.linkRevision+=2;});
 assert.equal(await go(f),null);
 f.mutate(null);const fresh=await go(f);
 assert(fresh);assert.notEqual(fresh.bindingRevision,original.bindingRevision);
});

test('paid term expiry while native inspector awaits invalidates candidate even with unchanged epochs',async()=>{
 const f=fixture();f.mutate(()=>f.setClock(PAID+1));
 assert.equal(await go(f),null);
});

test('wrong tenant, altered native identity or malicious candidate flags deny without fallback',async()=>{
 for(const bad of [
  {workspaceOrganizationId:'lab-beta'},
  {workspaceAccountId:'other-user'},
  {nativeUserId:'imposter'},
  {authorizationAuditRevision:999},
  {role:'Admin'},
  {verifiedPaidThroughMs:NOW-1},
  {accessGranted:true},{licensesGranted:true},{loginEnabled:true},
  {nativeEnforcementRequired:false},
 ]){
  const f=fixture();const original=f.inspector.inspect;
  f.inspector.inspect=async r=>({...await original(r),...bad});
  assert.equal(await go(f),null,JSON.stringify(bad));
 }
});

test('parent logout, native user rebind and cross tenant selection during awaited verifier deny',async()=>{
 for(const mutate of [
  f=>{f.state.session=null;},
  f=>{f.state.nativeUserId='native-imposter';},
  f=>{f.state.selected='lab-other';}
 ]){
  const f=fixture();f.mutate(()=>mutate(f));
  assert.equal(await go(f),null);
 }
});

test('throws from native inspector or underlying private SQLite reads are denied',async()=>{
 const f=fixture();f.inspector.inspect=async()=>{throw Error('native offline');};
 assert.equal(await go(f),null);
 const g=fixture();g.organizationStore.currentSessionOrganization=()=>{throw Error('sqlite busy');};
 assert.equal(await go(g),null);
});

test('broker-facing identity methods keep their original signatures and do not synthesize sessions',async()=>{
 const f=fixture();assert.deepEqual(await f.adapter.getSession({}),PARENT);
 assert.deepEqual(await f.adapter.authenticate({}, {},{}),PARENT);
 assert.deepEqual(await f.adapter.getParentSession(PARENT.id),PARENT);
 assert.equal(await f.adapter.logout(PARENT.id),true);
});

test('no missing or malformed private authority adapters can construct the grant-capable object',()=>{
 const f=fixture();
 for(const error of [
  {identity:null}, {identityStore:null},{organizationStore:null},{inspector:null},
  {inspector:{}},{clock:'now'}
 ]){
  assert.throws(()=>createNativeOrganizationBrokerAccessAdapter({
   identity:f.identity,identityStore:f.identityStore,
   organizationStore:f.organizationStore,inspector:f.inspector,clock:()=>NOW,...error
  }),/required/);
 }
});

test('broker getAccess is unconditionally deny-only even after positive native diagnostics',async()=>{
 const f=fixture();
 const diagnostic=await go(f);
 assert(diagnostic?.candidateReady);
 assert.equal(diagnostic?.accessGranted,false);
 assert.equal(diagnostic?.licensesGranted,false);
 const before=f.inspections();
 assert.equal(await f.adapter.getAccess(PARENT,'goflo'),null,
  'preflight is never a broker/PKCE grant, even with a current LIVE seat');
 assert.equal(await f.adapter.getAccess(PARENT,'dataduck'),null);
 assert.equal(f.inspections(),before,'broker must not invoke grant-capable preflight');
 assert.equal(await f.adapter.getAccess(null,'goflo'),null);
});

test('a malformed central policy claiming licensesGranted true cannot produce even diagnostics',async()=>{
 const f=fixture();
 const original=f.organizationStore.verifiedNativePermissionCandidate;
 f.organizationStore.verifiedNativePermissionCandidate=request=>{
  const result=original(request);
  return result?{...result,licensesGranted:true}:null;
 };
 assert.equal(await go(f),null);
 assert.equal(await f.adapter.getAccess(PARENT,'goflo'),null);
 assert.equal(f.inspections(),0,'invalid central proof denied before native inspection');
});

test('diagnostic binding revision is never a reusable native token or proof',async()=>{
 const f=fixture();
 const candidate=await go(f);
 assert(candidate);
 assert.equal(candidate.accessGranted,false);
 assert.match(candidate.bindingRevision,/^org-native-v1:[A-Za-z0-9_-]{43}$/);
 const json=JSON.stringify(candidate);
 assert(!json.includes('sessionToken'));
 assert(!json.includes('authorizationCode'));
 assert(!json.includes('token:'));
 assert.equal(await f.adapter.getAccess(PARENT,'goflo'),null,
  'reusing a diagnostic binding revision cannot bypass broker denial');
});
