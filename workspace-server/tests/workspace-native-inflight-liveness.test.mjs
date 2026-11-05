/**
 * Strict, disposable real-SQLite regression probes for read-only native
 * access inspection while central entitlements/sessions change mid-flight.
 * Does not import the active broker or activate any native authorizations.
 *
 * Stacked on draft #145 (canonical, six-app only). All provider/native
 * verifier callbacks are synthetic and must never reach production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeAccessInspector} from '../workspace-native-access-inspector.mjs';

const NOW=1_899_999_970_000;
const PAID_THROUGH=1_900_000_000; // 30 s after NOW
const USER='94563aad-b650-47e3-991f-41b3266bc011';
const OWNER='94563aad-b650-47e3-991f-41b3266bc012';
const NATIVE_USER='native-alpha-analyst';
const NATIVE_ORG='native-tenant-alpha';

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-inflight-gates-'));
 let now=NOW;
 const identity=createIdentityStore({
  databasePath:path.join(root,'private','identity.sqlite'),
  clock:()=>now,
  orgNativeLinks:{
   authorizeMutation:async()=>true,
   verifyNativeOwnership:async()=>true
  }
 });
 const org=createOrganizationStore({
  databasePath:path.join(root,'private','org.sqlite'),
  clock:()=>now,
  // Only fake provider evidence is passed in this isolated disposable test.
  verifyLiveSubscriptionEvidence:evidence=>evidence
 });
 t.after(()=>{identity.close();org.close();
  rmSync(root,{recursive:true,force:true})});
 const owner=await identity.createUser({
  id:OWNER,email:'owner@example.test',displayName:'Owner',
  password:'synthetic-owner-password-only'
 });
 const alice=await identity.createUser({
  id:USER,email:'alice@example.test',displayName:'Analyst',
  password:'synthetic-alice-password-only'
 });
 for(const name of ['alpha','beta']){
  org.setupOrganization({
   organizationId:name,name:'Lab '+name,
   owner:{accountId:owner.id,name:'Owner',nickname:'Owner',
    email:'owner@example.test'}
  });
  org.saveMember({organizationId:name,actorId:owner.id,
   member:{accountId:alice.id,name:'Analyst',nickname:'Analyst',
    email:'alice@example.test',admin:false,roles:{}}});
 }
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-live-event-1',
  organizationId:'alpha',subscriptionId:'synthetic-sub-alpha',
  revision:1,plan:'Single',apps:['goflo'],seats:1,
  status:'active',paidThrough:PAID_THROUGH
 });
 org.saveMember({organizationId:'alpha',actorId:owner.id,
  member:{accountId:alice.id,name:'Analyst',nickname:'Analyst',
   email:'alice@example.test',admin:false,roles:{goflo:'Analyst'}}});
 const parent=identity.createSession(alice.id).parent;
 org.selectSessionOrganization({
  sessionId:parent.id,accountId:alice.id,organizationId:'alpha'
 });
 await identity.bindVerifiedOrganizationNativeLink({
  actorId:owner.id,userId:alice.id,appId:'goflo',
  workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
 });
 const request=Object.freeze({
  sessionId:parent.id,organizationId:'alpha',
  appId:'goflo',permission:'workspace.view'
 });
 const expected=x=>x.appId==='goflo'&&x.workspaceAccountId===alice.id&&
  x.workspaceOrganizationId==='alpha'&&x.nativeUserId===NATIVE_USER&&
  x.nativeOrganizationId===NATIVE_ORG;
 const inspector=(native=async x=>expected(x))=>
  createWorkspaceNativeAccessInspector({
   identityStore:identity,organizationStore:org,
   verifyNativeMapping:native,clock:()=>now
  });
 const assertNoGrant=x=>{
  assert.equal(x.accessGranted,false);
  assert.equal(x.licensesGranted,false);
  assert.equal(x.loginEnabled,false);
 };
 return {identity,org,owner,alice,parent,request,inspector,expected,
  assertNoGrant,setNow:value=>{now=value},now:()=>now};
}

test('live paid term expiring DURING native verification denies; parent session still valid',async t=>{
 const f=await fixture(t);
 const initial=await f.inspector().inspect(f.request);
 assert.equal(initial.candidateReady,true);
 f.assertNoGrant(initial);
 const inFlight=f.inspector(async x=>{
  assert.equal(f.expected(x),true);
  f.setNow(NOW+60_000);
  assert(f.identity.getParentSession(f.parent.id),'parent session is still valid');
  return true;
 });
 const result=await inFlight.inspect(f.request);
 assert.equal(result.reason,'access_changed_during_verification');
 assert.equal(result.candidateReady,false);
 f.assertNoGrant(result);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,false);
});

test('legacy/manual extra seats do NOT pay for a pending invitation during native verification',async t=>{
 const f=await fixture(t);
 f.org.applyVerifiedSeatPurchase({
  reference:'synthetic-unverified-seat',
  organizationId:'alpha',plan:'Single',apps:['goflo'],seats:1
 });
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,true);
 const inFlight=f.inspector(async x=>{
  assert.equal(f.expected(x),true);
  f.org.issueInvitation({
   organizationId:'alpha',actorId:f.owner.id,
   email:'newperson@example.test',name:'New Person',nickname:'New',
   roles:{goflo:'Analyst'}
  });
  return true;
 });
 const decision=await inFlight.inspect(f.request);
 assert.equal(decision.reason,'access_changed_during_verification');
 f.assertNoGrant(decision);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,false);
 assert.equal(f.org.revokeInvitation({
  organizationId:'alpha',actorId:f.owner.id,email:'newperson@example.test'
 }).revoked,true);
 const after=await f.inspector().inspect(f.request);
 assert.equal(after.candidateReady,true);
 f.assertNoGrant(after);
});

test('logout and fresh login cannot resurrect old parent session after an awaited native call',async t=>{
 const f=await fixture(t);
 let newParent=null;
 const inFlight=f.inspector(async x=>{
  assert.equal(f.expected(x),true);
  f.identity.revokeSession(f.parent.id);
  newParent=f.identity.createSession(f.alice.id).parent;
  f.org.selectSessionOrganization({
   sessionId:newParent.id,accountId:f.alice.id,organizationId:'alpha'
  });
  return true;
 });
 const original=await inFlight.inspect(f.request);
 assert.equal(original.reason,'access_changed_during_verification');
 f.assertNoGrant(original);
 assert.equal(f.identity.getParentSession(f.parent.id),null);
 assert.notEqual(newParent.id,f.parent.id);
 const replacement=await f.inspector().inspect({...f.request,
  sessionId:newParent.id});
 assert.equal(replacement.candidateReady,true);
 f.assertNoGrant(replacement);
});

test('tenant switch during native verification cannot reuse native alpha identity in beta',async t=>{
 const f=await fixture(t);
 const inFlight=f.inspector(async x=>{
  assert.equal(f.expected(x),true);
  f.org.clearSessionOrganization(f.parent.id);
  f.org.selectSessionOrganization({
   sessionId:f.parent.id,accountId:f.alice.id,organizationId:'beta'
  });
  return true;
 });
 const original=await inFlight.inspect(f.request);
 assert.equal(original.reason,'access_changed_during_verification');
 f.assertNoGrant(original);
 const selected=f.org.currentSessionOrganization({
  sessionId:f.parent.id,accountId:f.alice.id
 });
 assert.equal(selected.id,'beta');
 const beta=await f.inspector().inspect({...f.request,
  organizationId:'beta'});
 assert.equal(beta.candidateReady,false);
 f.assertNoGrant(beta);
});

test('revocation of membership during native verification denies with valid paid seat and parent session',async t=>{
 const f=await fixture(t);
 const inFlight=f.inspector(async x=>{
  assert.equal(f.expected(x),true);
  f.org.setMemberActive({
   organizationId:'alpha',actorId:f.owner.id,accountId:f.alice.id,active:false
  });
  return true;
 });
 const result=await inFlight.inspect(f.request);
 assert.equal(result.reason,'access_changed_during_verification');
 f.assertNoGrant(result);
 assert(f.identity.getParentSession(f.parent.id));
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,false);
});

test('only literal true from trusted native verifier qualifies; objects, strings and network errors deny',async t=>{
 const f=await fixture(t);
 for(const returned of [{ok:true},'true',1,null,undefined]){
  const denied=await f.inspector(async x=>{
   assert.equal(f.expected(x),true);
   return returned;
  }).inspect(f.request);
  assert.equal(denied.reason,'native_mapping_unverified');
  f.assertNoGrant(denied);
 }
 const outage=await f.inspector(async()=>{throw Error('native off-line')})
  .inspect(f.request);
 assert.equal(outage.reason,'native_mapping_unavailable');
 f.assertNoGrant(outage);
});
