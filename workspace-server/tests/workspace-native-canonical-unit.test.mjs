import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeAccessInspector as createInspector} from '../workspace-native-access-inspector.mjs';

function fixture(t,{live=true}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-access-'));
 let now=1800000000000,centralActive=true,nativeVerified=true,
  nativeUserId='native-user-one';
 const store=createOrganizationStore({databasePath:path.join(root,'private','org.sqlite'),
  clock:()=>now,verifyLiveSubscriptionEvidence:value=>value});
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true})});
 for(const org of ['alpha','beta'])store.setupOrganization({
  organizationId:org,name:org,owner:{accountId:'admin-'+org,
   name:'Admin '+org,nickname:'Admin',email:org+'-admin@example.test'}});
 if(live)store.applyVerifiedSubscriptionTransition({
  eventKey:'evt-live-one',source:'stripe_live',organizationId:'alpha',
  subscriptionId:'sub-alpha',revision:1,plan:'Single',apps:['goflo'],
  seats:3,status:'active',paidThrough:1900000000
 });
 else store.applyVerifiedSeatPurchase({reference:'legacy-seat',organizationId:'alpha',
  plan:'Single',apps:['goflo'],seats:3});
 store.saveMember({organizationId:'alpha',actorId:'admin-alpha',
  member:{accountId:'alice',name:'Alice',nickname:'Alice',
   email:'alice@example.test',admin:false,roles:{goflo:'Analyst'}}});
 store.selectSessionOrganization({sessionId:'session-alpha',accountId:'alice',organizationId:'alpha'});
 const identity={
  getParentSession:id=>id==='session-alpha'?{id,subject:'alice',expiresAt:2200000000000}:null,
  getUser:id=>id==='alice'?{id,state:centralActive?'active':'disabled'}:null,
  getOrganizationNativeLink:({userId,appId,workspaceOrganizationId})=>
   userId==='alice'&&appId==='goflo'&&workspaceOrganizationId==='alpha'
   ?{userId,appId,workspaceOrganizationId,nativeUserId,
      nativeOrganizationId:'native-org-one',linkRevision:1,
      linkOnly:true,accessGranted:false,licensesGranted:false,
      loginEnabled:false}:null
 };
 let verifyNativeMapping=async x=>nativeVerified&&x.appId==='goflo'&&
   x.workspaceAccountId==='alice'&&x.workspaceOrganizationId==='alpha'&&
   x.nativeUserId===nativeUserId&&x.nativeOrganizationId==='native-org-one';
 const create=(verifier=verifyNativeMapping)=>createInspector({
  identityStore:identity,organizationStore:store,
  verifyNativeMapping:verifier,clock:()=>now
 });
 const input={sessionId:'session-alpha',organizationId:'alpha',
  appId:'goflo',permission:'workspace.view'};
 return {store,identity,input,create,
  setNow:x=>{now=x},setCentralActive:x=>{centralActive=x},
  setNativeVerified:x=>{nativeVerified=x},
  setNativeUserId:x=>{nativeUserId=x}};
}
test('active central session + locked tenant + live seats + native verified mapping yields only a candidate',async t=>{
 const f=fixture(t),result=await f.create().inspect(f.input);
 assert.equal(result.candidateReady,true);
 assert.equal(result.accessGranted,false);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.loginEnabled,false);
 assert.equal(result.nativeEnforcementRequired,true);
 assert.equal(result.role,'Analyst');
 assert.equal(result.nativeUserId,'native-user-one');
 assert.equal(result.nativeOrganizationId,'native-org-one');
 assert.equal(result.verifiedPaidThroughMs,1900000000000);
});
test('historical receipts with assignments are not independently verified live entitlements',async t=>{
 const f=fixture(t,{live:false});
 const result=await f.create().inspect(f.input);
 assert.equal(result.candidateReady,false);
 assert.equal(result.accessGranted,false);
 assert.equal(result.reason,'central_session_role_seat_or_link_missing');
});
test('DataDuck never becomes an authorized seventh client through a preflight',async t=>{
 const f=fixture(t);
 const r=await f.create().inspect({...f.input,appId:'dataduck'});
 assert.deepEqual(r,{candidateReady:false,accessGranted:false,
  licensesGranted:false,loginEnabled:false,reason:'dataduck_not_released'});
});
test('foreign organization, wrong session and unknown permissions are all denied',async t=>{
 const f=fixture(t),p=f.create();
 for(const change of [
  {organizationId:'beta'},{sessionId:'no-session'},
  {permission:'some.other_permission'},{appId:'unknown'},
  {permission:'*'}, {appId:'eel'}
 ])assert.equal((await p.inspect({...f.input,...change})).accessGranted,false);
 assert.equal((await p.inspect({...f.input,organizationId:'beta'})).candidateReady,false);
});
test('organization role edits and per-user permission overrides take effect on next evaluation',async t=>{
 const f=fixture(t),p=f.create();
 assert.equal((await p.inspect(f.input)).candidateReady,true);
 const baseline=f.store.listRoles({organizationId:'alpha',actorId:'admin-alpha',appId:'goflo'});
 const analyst=baseline.roles.find(x=>x.name==='Analyst');
 f.store.saveRole({organizationId:'alpha',actorId:'admin-alpha',appId:'goflo',
  role:'Analyst',permissions:analyst.permissions.filter(x=>x!=='workspace.view')});
 assert.equal((await p.inspect(f.input)).candidateReady,false);
 f.store.setPermission({organizationId:'alpha',actorId:'admin-alpha',
  accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:true});
 assert.equal((await p.inspect(f.input)).candidateReady,true);
 f.store.setPermission({organizationId:'alpha',actorId:'admin-alpha',
  accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:false});
 assert.equal((await p.inspect(f.input)).candidateReady,false);
});
test('tenant-defined custom role permissions are consulted afresh for the exact app',async t=>{
 const f=fixture(t),p=f.create();
 f.store.saveRole({organizationId:'alpha',actorId:'admin-alpha',appId:'goflo',
  role:'Custom Scientist',permissions:['workspace.view']});
 f.store.saveMember({organizationId:'alpha',actorId:'admin-alpha',
  member:{accountId:'alice',name:'Alice',nickname:'Alice',
   email:'alice@example.test',admin:false,roles:{goflo:'Custom Scientist'}}});
 assert.equal((await p.inspect(f.input)).candidateReady,true);
 assert.equal((await p.inspect(f.input)).role,'Custom Scientist');
 f.store.saveRole({organizationId:'alpha',actorId:'admin-alpha',appId:'goflo',
  role:'Custom Scientist',permissions:[]});
 assert.equal((await p.inspect(f.input)).candidateReady,false);
 f.store.saveRole({organizationId:'beta',actorId:'admin-beta',appId:'goflo',
  role:'Custom Scientist',permissions:['workspace.view']});
 assert.equal((await p.inspect(f.input)).candidateReady,false);
});
test('deactivating a member, disabling central account or expiring the paid term denies the next check',async t=>{
 const f=fixture(t),p=f.create();
 f.setCentralActive(false);
 assert.equal((await p.inspect(f.input)).candidateReady,false);
 f.setCentralActive(true);
 f.setNow(1950000000000);
 assert.equal((await p.inspect(f.input)).candidateReady,false);
 f.setNow(1800000000000);
 f.store.setMemberActive({organizationId:'alpha',actorId:'admin-alpha',
  accountId:'alice',active:false});
 assert.equal((await p.inspect(f.input)).candidateReady,false);
});
test('native verifier outage and mismatched native mapping always deny',async t=>{
 const f=fixture(t);
 f.setNativeVerified(false);
 assert.equal((await f.create().inspect(f.input)).reason,'native_mapping_unverified');
 assert.equal((await f.create(async()=>{throw Error('down')}).inspect(f.input)).reason,'native_mapping_unavailable');
 f.setNativeVerified(true);
 f.setNativeUserId('hijacked');
 assert.equal((await f.create(async x=>x.nativeUserId==='native-user-one').inspect(f.input)).candidateReady,false);
 assert.equal((await f.create(async()=>false).inspect(f.input)).candidateReady,false);
});
test('permission revocation or identity remapping DURING native verification invalidates the result',async t=>{
 const f=fixture(t);
 let invoked=false;
 const roleChanging=f.create(async()=>{
  if(!invoked){
   invoked=true;
   f.store.setPermission({organizationId:'alpha',actorId:'admin-alpha',
    accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:false});
  }
  return true;
 });
 assert.equal((await roleChanging.inspect(f.input)).candidateReady,false);
 const baseline=f.store.listRoles({organizationId:'alpha',actorId:'admin-alpha',appId:'goflo'});
 assert(baseline.availablePermissions.includes('workspace.view'));
 f.store.setPermission({organizationId:'alpha',actorId:'admin-alpha',
  accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:true});
 const replacing=f.create(async()=>{f.setNativeUserId('native-user-other');return true});
 assert.equal((await replacing.inspect(f.input)).reason,'access_changed_during_verification');
});
test('missing private trust adapters cannot accidentally yield usable access',async()=>{
 assert.throws(()=>createInspector(),/private_access_stores_required/);
 assert.throws(()=>createInspector({identityStore:{getParentSession(){},getUser(){},getOrganizationNativeLink(){}},
  organizationStore:{currentSessionOrganization(){},verifiedNativePermissionCandidate(){}}}),
 /trusted_native_mapping_verifier_required/);
});
