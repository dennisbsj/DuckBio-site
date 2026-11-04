/**
 * Cross-store synthetic integration with REAL Workspace identity and
 * organization SQLite stores. No customer, Stripe or native network access.
 * This suite depends on the dormant inspector proposed in PR #136.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeAccessInspector} from '../workspace-native-access-inspector.mjs';

const ACCOUNT='2f8164be-4529-48ac-a2cb-a9094019ba01';
const NATIVE_USER='2f8164be-4529-48ac-a2cb-a9094019ba02';
const NATIVE_ORG='2f8164be-4529-48ac-a2cb-a9094019ba03';
const OTHER_NATIVE='2f8164be-4529-48ac-a2cb-a9094019ba04';
const OTHER_ORG='2f8164be-4529-48ac-a2cb-a9094019ba05';
const PAID_THROUGH=1900000000;
const milliseconds=PAID_THROUGH*1000;

async function fixture(t,{onlyHistoricalSeats=false}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-cross-store-'));
 let now=1800000000000;
 const identity=createIdentityStore({
  databasePath:path.join(root,'private','identity.sqlite'),clock:()=>now,
  // Synthetic-only private operator/native verifiers (not production).
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 const organization=createOrganizationStore({
  databasePath:path.join(root,'private','organization.sqlite'),clock:()=>now,
  // Synthetic, PRIVATE, deterministic substitute for the separately required
  // real signed LIVE evidence verifier. Not a production billing configuration.
  verifyLiveSubscriptionEvidence: evidence=>evidence
 });
 t.after(()=>{identity.close();organization.close();
  rmSync(root,{force:true,recursive:true})});
 const user=await identity.createUser({id:ACCOUNT,email:'alice@example.test',
  displayName:'Alice',password:'synthetic-offline-password-only'});
 for(const id of ['alpha','beta']){
  organization.setupOrganization({organizationId:id,name:'Lab '+id,
   owner:{accountId:user.id,name:'Alice',nickname:'Alice',
    email:'alice@example.test'}});
  if(onlyHistoricalSeats){
   organization.applyVerifiedSeatPurchase({reference:'old-'+id,
    organizationId:id,plan:'Single',apps:['goflo'],seats:2});
  }else{
   organization.applyVerifiedSubscriptionTransition({
    source:'stripe_live',eventKey:'event-'+id,
    organizationId:id,subscriptionId:'sub-'+id,revision:1,
    plan:'Single',apps:['goflo'],seats:2,status:'active',
    paidThrough:PAID_THROUGH
   });
  }
  organization.saveMember({organizationId:id,actorId:user.id,
   member:{accountId:user.id,name:'Alice',nickname:'Alice',
    email:'alice@example.test',admin:true,roles:{goflo:'Analyst'}}});
 }
 const alpha=identity.createSession(user.id).parent;
 const beta=identity.createSession(user.id).parent;
 organization.selectSessionOrganization({sessionId:alpha.id,
  accountId:user.id,organizationId:'alpha'});
 organization.selectSessionOrganization({sessionId:beta.id,
  accountId:user.id,organizationId:'beta'});
 identity.grantAppAccess({userId:user.id,appId:'goflo',
  localUserId:NATIVE_USER,organizationId:NATIVE_ORG});
 // Legacy (account,app) grants remain untouched, but never qualify.
 await identity.bindVerifiedOrganizationNativeLink({actorId:user.id,
  userId:user.id,appId:'goflo',workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG});
 const expected={
  appId:'goflo',workspaceAccountId:user.id,
  workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
 };
 const verified=x=>Object.keys(expected).every(k=>x[k]===expected[k]);
 const inspector=(check=async x=>verified(x))=>
  createWorkspaceNativeAccessInspector({
   identityStore:identity,organizationStore:organization,
   verifyNativeMapping:check,clock:()=>now
  });
 const alphaRequest=Object.freeze({sessionId:alpha.id,
  organizationId:'alpha',appId:'goflo',permission:'workspace.view'});
 const betaRequest=Object.freeze({...alphaRequest,
  sessionId:beta.id,organizationId:'beta'});
 return {identity,organization,user,alpha,beta,
  alphaRequest,betaRequest,inspector,verified,
  setNow:x=>{now=x}};
}

test('real identity sessions + organization roles + verified LIVE SQLite allocations yield candidate only',async t=>{
 const f=await fixture(t);
 const decision=await f.inspector().inspect(f.alphaRequest);
 assert.equal(decision.candidateReady,true);
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.licensesGranted,false);
 assert.equal(decision.loginEnabled,false);
 assert.equal(decision.workspaceAccountId,f.user.id);
 assert.equal(decision.workspaceOrganizationId,'alpha');
 assert.equal(decision.nativeUserId,NATIVE_USER);
 assert.equal(decision.nativeOrganizationId,NATIVE_ORG);
 assert.equal(decision.verifiedPaidThroughMs,milliseconds);
});

test('multi-organization membership cannot reuse an exact native tenant binding',async t=>{
 const f=await fixture(t),inspect=f.inspector();
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,true);
 assert.equal((await inspect.inspect(f.betaRequest)).reason,'central_session_role_seat_or_link_missing');
 assert.equal((await inspect.inspect({...f.alphaRequest,organizationId:'beta'}))
  .candidateReady,false);
 assert.equal((await inspect.inspect({...f.betaRequest,organizationId:'alpha'}))
  .candidateReady,false);
 // A different user's native tenant must not be inferred from email matches.
 assert.equal((await f.inspector(async x=>x.nativeOrganizationId===OTHER_ORG)
  .inspect(f.alphaRequest)).candidateReady,false);
});

test('unverified historical capacity cannot be mistaken for a current paid seat',async t=>{
 const f=await fixture(t,{onlyHistoricalSeats:true});
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,false);
});

test('central logout and account suspension immediately invalidate the authentic parent session',async t=>{
 const f=await fixture(t),inspect=f.inspector();
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,true);
 f.identity.revokeSession(f.alpha.id);
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
 assert.equal((await inspect.inspect(f.betaRequest)).candidateReady,false);
 f.identity.setUserState(f.user.id,'disabled');
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
});

test('removing a native link during verification denies even with an otherwise valid central session',async t=>{
 const f=await fixture(t);
 const inspect=f.inspector(async x=>{
  if(!f.verified(x))return false;
  await f.identity.revokeVerifiedOrganizationNativeLink({actorId:f.user.id,
   userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
  return true;
 });
 assert.equal((await inspect.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
});

test('editing an organization role during native verification cannot keep a stale permission',async t=>{
 const f=await fixture(t);
 const inspect=f.inspector(async x=>{
  if(!f.verified(x))return false;
  const policy=f.organization.listRoles({organizationId:'alpha',
   actorId:f.user.id,appId:'goflo'});
  const analyst=policy.roles.find(r=>r.name==='Analyst');
  f.organization.saveRole({organizationId:'alpha',actorId:f.user.id,
   appId:'goflo',role:'Analyst',
   permissions:analyst.permissions.filter(p=>p!=='workspace.view')});
  return true;
 });
 assert.equal((await inspect.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,false);
 assert.equal((await f.inspector().inspect(f.betaRequest)).reason,
  'central_session_role_seat_or_link_missing');
});

test('DataDuck still has no registered production app grant or usable candidate',async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.identity.grantAppAccess({userId:f.user.id,
  appId:'dataduck',localUserId:OTHER_NATIVE,
  organizationId:OTHER_ORG}),/invalid_grant/);
 const decision=await f.inspector().inspect({...f.alphaRequest,appId:'dataduck'});
 assert.equal(decision.reason,'dataduck_not_released');
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.licensesGranted,false);
});

test('same person may map to two distinct native tenants without legacy fallback',async t=>{
 const f=await fixture(t);
 const beta=await f.identity.bindVerifiedOrganizationNativeLink({
  actorId:f.user.id,userId:f.user.id,appId:'goflo',
  workspaceOrganizationId:'beta',nativeUserId:OTHER_NATIVE,
  nativeOrganizationId:OTHER_ORG});
 assert.equal(beta.link.accessGranted,false);
 assert(Number.isSafeInteger(beta.link.linkRevision));
 const check=async x=>x.workspaceAccountId===f.user.id&&x.appId==='goflo'&&(
  (x.workspaceOrganizationId==='alpha'&&x.nativeUserId===NATIVE_USER&&
   x.nativeOrganizationId===NATIVE_ORG)||
  (x.workspaceOrganizationId==='beta'&&x.nativeUserId===OTHER_NATIVE&&
   x.nativeOrganizationId===OTHER_ORG));
 const inspector=f.inspector(check);
 const a=await inspector.inspect(f.alphaRequest);
 const b=await inspector.inspect(f.betaRequest);
 assert.equal(a.candidateReady,true);
 assert.equal(b.candidateReady,true);
 assert.notEqual(a.nativeUserId,b.nativeUserId);
 assert.notEqual(a.nativeOrganizationId,b.nativeOrganizationId);
 assert.equal(a.loginEnabled,false);
 assert.equal(b.licensesGranted,false);
 // Removing an unscoped legacy grant cannot change the canonical link.
 f.identity.revokeAppAccess(f.user.id,'goflo');
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,true);
 assert.equal((await inspector.inspect(f.betaRequest)).candidateReady,true);
 await f.identity.revokeVerifiedOrganizationNativeLink({
  actorId:f.user.id,userId:f.user.id,appId:'goflo',workspaceOrganizationId:'beta'});
 assert.equal((await inspector.inspect(f.betaRequest)).candidateReady,false);
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,true);
});

test('revocation and rebind of same native tuple during await denies via generation (ABA)',async t=>{
 const f=await fixture(t);
 const get=()=>f.identity.getOrganizationNativeLink({
  userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
 const before=get();
 const inspector=f.inspector(async x=>{
  assert.equal(f.verified(x),true);
  await f.identity.revokeVerifiedOrganizationNativeLink({
   actorId:f.user.id,userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
  await f.identity.bindVerifiedOrganizationNativeLink({
   actorId:f.user.id,userId:f.user.id,appId:'goflo',
   workspaceOrganizationId:'alpha',nativeUserId:NATIVE_USER,
   nativeOrganizationId:NATIVE_ORG});
  return true;
 });
 assert.equal((await inspector.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 const after=get();
 assert.equal(before.nativeUserId,after.nativeUserId);
 assert.equal(before.verifiedAt,after.verifiedAt);
 assert(after.linkRevision>before.linkRevision);
 assert.equal(after.loginEnabled,false);
});

test('missing scoped generation cannot produce even an inspection candidate',async t=>{
 const f=await fixture(t),source=f.identity;
 const identityStore={
  getParentSession:id=>source.getParentSession(id),
  getUser:id=>source.getUser(id),
  getOrganizationNativeLink:input=>{
   const link=source.getOrganizationNativeLink(input);
   return link?{...link,linkRevision:null}:null;
  }
 };
 const failClosed=createWorkspaceNativeAccessInspector({
  identityStore,organizationStore:f.organization,
  verifyNativeMapping:async()=>true,clock:()=>1800000000000
 });
 const decision=await failClosed.inspect(f.alphaRequest);
 assert.equal(decision.candidateReady,false);
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.reason,'central_session_role_seat_or_link_missing');
});

test('native preflight revision is private, scoped, and stable for unchanged authority',async t=>{
 const f=await fixture(t),inspector=f.inspector();
 const first=await inspector.inspect(f.alphaRequest);
 const second=await inspector.inspect(f.alphaRequest);
 assert.equal(first.candidateReady,true);
 assert.match(first.preflightBindingRevision,/^[a-f0-9]{64}$/);
 assert.equal(first.preflightBindingRevision,second.preflightBindingRevision);
 assert.equal(first.accessGranted,false);
 assert.equal(first.loginEnabled,false);
 // An unrelated organization member and an unrelated app role do not
 // invalidate this account's GoFlo authorization generation.
 f.organization.saveMember({organizationId:'alpha',actorId:f.user.id,
  member:{accountId:'unrelated',name:'Unrelated',
   nickname:'Other',email:'other@example.test',admin:false,roles:{}}});
 const eel=f.organization.listRoles({organizationId:'alpha',
  actorId:f.user.id,appId:'eel'});
 const nativeRole=eel.roles[0];
 f.organization.saveRole({organizationId:'alpha',actorId:f.user.id,
  appId:'eel',role:nativeRole.name,permissions:nativeRole.permissions});
 const unchanged=await inspector.inspect(f.alphaRequest);
 assert.equal(unchanged.preflightBindingRevision,first.preflightBindingRevision);
});

test('permission revoke/regrant with identical final effective permissions changes revision',async t=>{
 const f=await fixture(t),inspector=f.inspector();
 const before=await inspector.inspect(f.alphaRequest);
 assert.equal(before.candidateReady,true);
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',
  enabled:false});
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,false);
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',
  enabled:true});
 const after=await inspector.inspect(f.alphaRequest);
 assert.equal(after.candidateReady,true);
 assert.equal(after.role,before.role);
 assert.equal(after.nativeUserId,before.nativeUserId);
 assert.equal(after.verifiedPaidThroughMs,before.verifiedPaidThroughMs);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
});

test('app assignment removal/regrant of identical role changes native preflight generation',async t=>{
 const f=await fixture(t),inspector=f.inspector();
 const before=await inspector.inspect(f.alphaRequest);
 const member=roles=>({accountId:f.user.id,name:'Alice',nickname:'Alice',
  email:'alice@example.test',admin:true,roles});
 f.organization.saveMember({organizationId:'alpha',actorId:f.user.id,
  member:member({})});
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,false);
 f.organization.saveMember({organizationId:'alpha',actorId:f.user.id,
  member:member({goflo:'Analyst'})});
 const after=await inspector.inspect(f.alphaRequest);
 assert.equal(after.candidateReady,true);
 assert.equal(after.role,before.role);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
});

test('native tuple revoke/rebind of identical user and tenant changes preflight generation',async t=>{
 const f=await fixture(t),inspector=f.inspector();
 const before=await inspector.inspect(f.alphaRequest);
 assert.equal(before.candidateReady,true);
 await f.identity.revokeVerifiedOrganizationNativeLink({actorId:f.user.id,
  userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,false);
 await f.identity.bindVerifiedOrganizationNativeLink({actorId:f.user.id,
  userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG});
 const after=await inspector.inspect(f.alphaRequest);
 assert.equal(after.candidateReady,true);
 assert.equal(after.nativeUserId,before.nativeUserId);
 assert.equal(after.nativeOrganizationId,before.nativeOrganizationId);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
});

test('role ABA during asynchronous native verification is denied even with same wall clock',async t=>{
 const f=await fixture(t);
 const baseline=f.organization.listRoles({organizationId:'alpha',
  actorId:f.user.id,appId:'goflo'}).roles.find(x=>x.name==='Analyst');
 assert(baseline.permissions.includes('workspace.view'));
 const inspector=f.inspector(async x=>{
  assert.equal(f.verified(x),true);
  f.organization.saveRole({organizationId:'alpha',actorId:f.user.id,
   appId:'goflo',role:'Analyst',
   permissions:baseline.permissions.filter(p=>p!=='workspace.view')});
  f.organization.saveRole({organizationId:'alpha',actorId:f.user.id,
   appId:'goflo',role:'Analyst',permissions:baseline.permissions});
  return true;
 });
 assert.equal((await inspector.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,true);
});

test('LIVE subscription renewals generate a new native preflight binding',async t=>{
 const f=await fixture(t),inspector=f.inspector();
 const before=await inspector.inspect(f.alphaRequest);
 f.organization.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'alpha-renewal-second',
  organizationId:'alpha',subscriptionId:'sub-alpha',revision:2,
  plan:'Single',apps:['goflo'],seats:2,status:'active',
  paidThrough:PAID_THROUGH+50000
 });
 const after=await inspector.inspect(f.alphaRequest);
 assert.equal(after.candidateReady,true);
 assert(after.verifiedPaidThroughMs>before.verifiedPaidThroughMs);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
});

test('preflight rejects incomplete monotonic organization audit generation',async t=>{
 const f=await fixture(t);
 const organizationStore={
  currentSessionOrganization:input=>f.organization.currentSessionOrganization(input),
  verifiedNativePermissionCandidate:input=>{
   const candidate=f.organization.verifiedNativePermissionCandidate(input);
   return candidate?{...candidate,authorityAuditRevision:null}:null;
  }
 };
 const result=await createWorkspaceNativeAccessInspector({
  identityStore:f.identity,organizationStore,
  verifyNativeMapping:async()=>true,clock:()=>1800000000000
 }).inspect(f.alphaRequest);
 assert.equal(result.candidateReady,false);
 assert.equal(result.accessGranted,false);
});

test('permission ABA inside trusted native lookup cannot pass the final preflight',async t=>{
 const f=await fixture(t);
 const inspector=f.inspector(async x=>{
  assert.equal(f.verified(x),true);
  f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
   accountId:f.user.id,appId:'goflo',permission:'workspace.view',
   enabled:false});
  f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
   accountId:f.user.id,appId:'goflo',permission:'workspace.view',
   enabled:true});
  return true;
 });
 const answer=await inspector.inspect(f.alphaRequest);
 assert.equal(answer.candidateReady,false);
 assert.equal(answer.reason,'access_changed_during_verification');
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,true);
});
