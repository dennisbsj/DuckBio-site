/**
 * PRIVATE, SYNTHETIC source-level native-content navigation integration.
 * Exercises REAL Workspace organization and identity SQLite databases.
 * No network, native app API, real Stripe key, customer, or deployment.
 * This suite is intentionally not evidence of native-app authorization.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {authorizedContentDestination} from '../private-content-launch.mjs';

const START=1783090000000;
const CONTENT='cd000001';
const ORG='lab-one';
const APP='goflo';
const NATIVE_USER='native-cyto-user';
const NATIVE_ORG='native-cyto-tenant';
const DESTINATION='https://cytoduck.duckbio.net/content/'+CONTENT;
const client={appId:APP,nativeOrigin:'https://cytoduck.duckbio.net'};
const sealed=payload=>({proof:'INTERNAL_SYNTHETIC_ONLY',payload});

async function fixture(t,{live=true}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-content-sqlite-'));
 let now=START;
 const organization=createOrganizationStore({
  databasePath:path.join(root,'organization.sqlite'),clock:()=>now,
  verifyLiveSubscriptionEvidence:assertion=>{
   if(assertion?.proof!=='INTERNAL_SYNTHETIC_ONLY')
    throw Error('Unverified billing source');
   return assertion.payload;
  }
 });
 let owner,member;
 const identity=createIdentityStore({
  databasePath:path.join(root,'identity.sqlite'),clock:()=>now,
  orgNativeLinks:{
   authorizeMutation:async input=>{
    const authorized=organization.organizationsFor(input.actorId).some(
     o=>o.id===ORG&&o.admin===true);
    if(!authorized||input.workspaceOrganizationId!==ORG)return false;
    if(input.operation==='revoke')return true;
    return Boolean(organization.accessFor({
     organizationId:ORG,accountId:input.userId,appId:input.appId
    }))&&organization.effectivePermissions({
     organizationId:ORG,accountId:input.userId,appId:input.appId
    }).includes('workspace.view');
   },
   verifyNativeOwnership:async input=>
    input.userId===member?.id&&input.appId===APP&&
    input.workspaceOrganizationId===ORG&&
    input.nativeUserId===NATIVE_USER&&
    input.nativeOrganizationId===NATIVE_ORG
  }
 });
 t.after(()=>{
  identity.close();organization.close();
  rmSync(root,{recursive:true,force:true});
 });
 owner=await identity.createUser({
  email:'native-content-owner@example.test',
  displayName:'Fixture Owner',password:'Private owner test password 123'
 });
 member=await identity.createUser({
  email:'native-content-member@example.test',
  displayName:'Fixture Member',password:'Private member test password 123'
 });
 organization.setupOrganization({
  organizationId:ORG,name:'Synthetic laboratory',
  owner:{accountId:owner.id,name:'Owner',nickname:'O',email:owner.email}
 });
 if(live)organization.applyVerifiedSubscriptionTransition(sealed({
  source:'stripe_live',
  eventKey:'evt_content_synthetic_1',
  organizationId:ORG,subscriptionId:'sub_content_synthetic_1',
  revision:1,plan:'Single',apps:[APP],seats:2,status:'active',
  paidThrough:Math.floor(START/1000)+2*3600
 }));
 else organization.applyVerifiedSeatPurchase({
  reference:'untrusted-legacy-seat',organizationId:ORG,
  plan:'Single',apps:[APP],seats:2
 });
 const memberFields=roles=>({
  accountId:member.id,name:'Member',nickname:'M',
  email:member.email,admin:false,roles
 });
 organization.saveMember({
  organizationId:ORG,actorId:owner.id,
  member:memberFields({[APP]:'Analyst'})
 });
 const linkInput={
  actorId:owner.id,userId:member.id,appId:APP,
  workspaceOrganizationId:ORG,
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
 };
 const link=await identity.bindVerifiedOrganizationNativeLink(linkInput);
 assert.equal(link.applied,true);
 assert.equal(link.link.loginEnabled,false);
 const {parent}=identity.createSession(member.id);
 organization.selectSessionOrganization({
  sessionId:parent.id,accountId:member.id,organizationId:ORG
 });
 const resolved=async input=>({
  authorized:true,appId:APP,organizationId:input.organizationId,
  nativeUserId:input.nativeUserId,
  nativeOrganizationId:input.nativeOrganizationId,
  url:DESTINATION
 });
 const args=()=>({
  contentId:CONTENT,viewerId:member.id,sessionId:parent.id,
  identityStore:identity,organizationStore:organization,
  clients:[client],resolveResource:resolved
 });
 return {root,identity,organization,owner,member,parent,linkInput,
  args,resolved,memberFields,setTime:value=>{now=value}};
}

test('real SQLite paid LIVE authority, session selection and verified native tenant permit only navigation',async t=>{
 const f=await fixture(t);
 const selected=f.organization.currentSessionOrganization({
  sessionId:f.parent.id,accountId:f.member.id
 });
 assert(selected.sessionSelectionRevision>0);
 const proof=f.organization.verifiedNativePermissionCandidate({
  organizationId:ORG,accountId:f.member.id,appId:APP,
  permission:'workspace.view'
 });
 assert.equal(proof?.source,'verified_live_subscription_ledger');
 assert.equal(proof?.accessGranted,false);
 assert.equal(proof?.licensesGranted,false);
 const link=f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:APP,workspaceOrganizationId:ORG
 });
 assert.equal(link?.linkOnly,true);
 assert.equal(link?.nativeOrganizationId,NATIVE_ORG);
 let calls=0;
 const redirected=await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{
   calls++;
   assert.deepEqual(input,{
    contentId:CONTENT,viewerId:f.member.id,appId:APP,
    organizationId:ORG,nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
   });
   return f.resolved(input);
  }
 });
 assert.equal(redirected,DESTINATION);
 assert.equal(calls,1);
 assert.equal(f.identity.getAccess(f.member.id,APP),null,
  'a separately VERIFIED native link is never also a global app grant');
});

test('legacy/test seat without a verified LIVE allocation cannot authorize navigation',async t=>{
 const f=await fixture(t,{live:false});
 let lookups=0;
 assert.equal(await authorizedContentDestination({
  ...f.args(),resolveResource:async args=>{lookups++;return f.resolved(args);}
 }),null);
 assert.equal(lookups,0,'deny BEFORE contacting native resolver');
 assert.equal(f.organization.verifiedNativePermissionCandidate({
  organizationId:ORG,accountId:f.member.id,appId:APP,
  permission:'workspace.view'
 }),null);
});

test('live app seat expiry alone invalidates navigation while parent session remains valid',async t=>{
 const f=await fixture(t);
 assert.equal(await authorizedContentDestination(f.args()),DESTINATION);
 f.setTime(START+3*3600*1000);
 assert(f.identity.getParentSession(f.parent.id),
  'unexpired parent must not override expired paid app subscription');
 assert.equal(await authorizedContentDestination(f.args()),null);
});

test('real SQLite role revoke/reassign to identical permissions still invalidates in-flight native lookup',async t=>{
 const f=await fixture(t);
 let calls=0;
 const result=await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{
   calls++;
   f.organization.saveMember({
    organizationId:ORG,actorId:f.owner.id,
    member:f.memberFields({})
   });
   f.organization.saveMember({
    organizationId:ORG,actorId:f.owner.id,
    member:f.memberFields({[APP]:'Analyst'})
   });
   assert(f.organization.verifiedNativePermissionCandidate({
    organizationId:ORG,accountId:f.member.id,appId:APP,
    permission:'workspace.view'
   }));
   return f.resolved(input);
  }
 });
 assert.equal(result,null,'policy must fail closed after same-value ABA');
 assert.equal(calls,1);
 assert.equal(await authorizedContentDestination(f.args()),DESTINATION,
  'a fresh lookup may use the new verified authorization generation');
});

test('real SQLite session-org clear/reselect of the SAME organization denies stale lookup',async t=>{
 const f=await fixture(t);
 const result=await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{
   f.organization.clearSessionOrganization(f.parent.id);
   f.organization.selectSessionOrganization({
    sessionId:f.parent.id,accountId:f.member.id,organizationId:ORG
   });
   return f.resolved(input);
  }
 });
 assert.equal(result,null);
 assert.equal(await authorizedContentDestination(f.args()),DESTINATION);
});

test('real SQLite native link revoke/rebind of identical user and tenant denies stale navigation',async t=>{
 const f=await fixture(t);
 const initial=f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:APP,workspaceOrganizationId:ORG
 }).linkRevision;
 const result=await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{
   await f.identity.revokeVerifiedOrganizationNativeLink({
    actorId:f.owner.id,userId:f.member.id,appId:APP,
    workspaceOrganizationId:ORG
   });
   const rebound=await f.identity.bindVerifiedOrganizationNativeLink(f.linkInput);
   assert.equal(rebound.applied,true);
   return f.resolved(input);
  }
 });
 assert.equal(result,null);
 const revision=f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:APP,workspaceOrganizationId:ORG
 }).linkRevision;
 assert(revision>initial,'audit AUTOINCREMENT protects same-tuple native link ABA');
 assert.equal(await authorizedContentDestination(f.args()),DESTINATION);
});

test('missing signed native ownership or malicious resolver response never produces a redirect',async t=>{
 const f=await fixture(t);
 const bad=[
  {authorized:false,appId:APP,organizationId:ORG,
   nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG,url:DESTINATION},
  {authorized:true,appId:APP,organizationId:ORG,
   nativeUserId:'different',nativeOrganizationId:NATIVE_ORG,url:DESTINATION},
  {authorized:true,appId:APP,organizationId:ORG,
   nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG,
   url:'https://cytoduck.duckbio.net/content/'+CONTENT+'?secret=true'}
 ];
 for(const response of bad){
  assert.equal(await authorizedContentDestination({
   ...f.args(),resolveResource:async()=>response
  }),null);
 }
 f.identity.revokeSession(f.parent.id);
 assert.equal(await authorizedContentDestination(f.args()),null);
});


test('paid subscription expires DURING awaited native resolver even when all epochs remain stable',async t=>{
 const f=await fixture(t);
 let calls=0;
 const result=await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{
   calls++;
   // No role edit, no audit mutation, no session-org selection change.
   // The re-check must evaluate the LIVE paid period against current time.
   f.setTime(START+3*3600*1000);
   assert(f.identity.getParentSession(f.parent.id),
    'parent is still live and must not substitute for paid entitlement');
   return f.resolved(input);
  }
 });
 assert.equal(calls,1);
 assert.equal(result,null,'expired seat must deny even with unchanged audit generations');
});


test('a second LIVE-paid organization cannot reuse the first organization\'s native identity',async t=>{
 const f=await fixture(t);
 const secondOrg='lab-two';
 f.organization.setupOrganization({organizationId:secondOrg,name:'Second lab',
  owner:{accountId:f.owner.id,name:'Owner',nickname:'O',email:f.owner.email}
 });
 f.organization.applyVerifiedSubscriptionTransition(sealed({
  source:'stripe_live',eventKey:'evt_second_lab_synthetic_1',
  organizationId:secondOrg,subscriptionId:'sub_second_lab_synthetic_1',
  revision:1,plan:'Single',apps:[APP],seats:2,status:'active',
  paidThrough:Math.floor(START/1000)+2*3600
 }));
 f.organization.saveMember({organizationId:secondOrg,actorId:f.owner.id,
  member:f.memberFields({[APP]:'Analyst'})});
 assert(f.organization.verifiedNativePermissionCandidate({
  organizationId:secondOrg,accountId:f.member.id,appId:APP,
  permission:'workspace.view'
 }), 'second tenant itself has a synthetic verified paid seat and valid role');
 f.organization.clearSessionOrganization(f.parent.id);
 f.organization.selectSessionOrganization({
  sessionId:f.parent.id,accountId:f.member.id,organizationId:secondOrg
 });
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:APP,workspaceOrganizationId:secondOrg
 }),null, 'the original native user/organization link cannot cross tenants');
 let lookups=0;
 assert.equal(await authorizedContentDestination({
  ...f.args(),resolveResource:async input=>{lookups++;return f.resolved(input);}
 }),null);
 assert.equal(lookups,0,'deny BEFORE native lookup even with second-tenant seat and role');
 f.organization.clearSessionOrganization(f.parent.id);
 f.organization.selectSessionOrganization({
  sessionId:f.parent.id,accountId:f.member.id,organizationId:ORG
 });
 assert.equal(await authorizedContentDestination(f.args()),DESTINATION,
  'restoring the explicitly linked first tenant allows a fresh navigation');
});

test('separate identity SQLite connection revokes a parent during native resource lookup',async t=>{
 const f=await fixture(t);
 const peer=createIdentityStore({databasePath:path.join(f.root,'identity.sqlite'),clock:()=>START});
 try{
  const destination=await authorizedContentDestination({
   ...f.args(),resolveResource:async input=>{
    peer.revokeSession(f.parent.id);
    return f.resolved(input);
   }
  });
  assert.equal(destination,null,'different connection logout invalidates in-flight redirect');
 }finally{peer.close();}
});

test('separate organization SQLite connection revokes and reassigns the same app role during native lookup',async t=>{
 const f=await fixture(t);
 const peer=createOrganizationStore({databasePath:path.join(f.root,'organization.sqlite'),clock:()=>START});
 try{
  const destination=await authorizedContentDestination({
   ...f.args(),resolveResource:async input=>{
    peer.saveMember({organizationId:ORG,actorId:f.owner.id,
     member:f.memberFields({})});
    peer.saveMember({organizationId:ORG,actorId:f.owner.id,
     member:f.memberFields({[APP]:'Analyst'})});
    return f.resolved(input);
   }
  });
  assert.equal(destination,null,'cross-connection role ABA must invalidate in-flight redirect');
  assert.equal(await authorizedContentDestination(f.args()),DESTINATION,
   'fresh lookup after the cross-connection change is allowed');
 }finally{peer.close();}
});
