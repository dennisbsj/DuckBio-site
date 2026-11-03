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
  databasePath:path.join(root,'private','identity.sqlite'),clock:()=>now
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
 assert.equal((await inspect.inspect(f.betaRequest)).reason,'native_mapping_unverified');
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
  f.identity.revokeAppAccess(f.user.id,'goflo');
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
  'native_mapping_unverified');
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
