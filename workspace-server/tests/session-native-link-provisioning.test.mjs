import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeLinkProvisioner} from '../shared-auth/session-native-link-provisioning.mjs';
import {createSignedNativeOwnershipVerifier,
 canonicalNativeOwnershipProofBytes} from '../shared-auth/signed-native-ownership-verifier.mjs';

const START=1800000000000;
const PAID_THROUGH=1800000060; // verified term ends 60 seconds after START
const PASSWORD='only-private-isolated-synthetic-provisioning-password';
const appId='goflo';
async function fixture(t,{historicalOnly=false,fenceProbe=null}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'workspace-operator-provision-'));
 let now=START, duringNative=null,nativeVerified=true,nativeRequests=0;
 const userIds=Object.freeze({ownerA:randomUUID(),ownerB:randomUUID(),
  member:randomUUID()});
 const keys=generateKeyPairSync('ed25519');
 const publicKeyPem=keys.publicKey.export({format:'pem',type:'spki'});
 const signed=createSignedNativeOwnershipVerifier({
  clients:{goflo:{
   endpoint:'https://native.example.test/private/ownership',
   keyId:'native-signer-1',publicKeyPem,
   token:'synthetic-private-provisioning-credential-12345'
  }},clock:()=>now,
  fetchImpl:async(_url,request)=>{
   nativeRequests++;
   const challenge=JSON.parse(request.body);
   if(duringNative)await duringNative(challenge);
   const payload={...challenge,keyId:'native-signer-1',
    issuedAt:now,expiresAt:now+15000,active:true,
    ownershipVerified:nativeVerified};
   const signature=sign(null,canonicalNativeOwnershipProofBytes(payload),
    keys.privateKey).toString('base64url');
   return new Response(JSON.stringify({payload,signature}),{
    status:200,headers:{'content-type':'application/json'}
   });
  }
 });
 const organizationDatabasePath=path.join(root,'private','org.sqlite');
 const org=createOrganizationStore({
  databasePath:organizationDatabasePath,
  clock:()=>now,verifyLiveSubscriptionEvidence:value=>value,
  nativeProvisioningSessionEpochs:true
 });
 let identity;
 // Synthetic test observer only. The actual organization store still owns
 // and acquires the real SQLite write lock on its private DB path.
 const fencedOrg=fenceProbe?Object.freeze({
  ...org,
  nativeProvisioningAcquireCommitFence(args){
   const lease=org.nativeProvisioningAcquireCommitFence(args);
   if(lease)fenceProbe({lease,organizationDatabasePath,args});
   return lease;
  }
 }):org;
 const controller=createWorkspaceNativeLinkProvisioner({
  getIdentityStore:()=>identity,organizationStore:fencedOrg,
  verifyNativeOwnership:signed.verifyNativeOwnership,clock:()=>now
 });
 identity=createIdentityStore({
  databasePath:path.join(root,'private','identities.sqlite'),
  clock:()=>now,orgNativeLinks:controller.adapters
 });
 t.after(()=>{identity.close();org.close();
  rmSync(root,{force:true,recursive:true})});
 for(const [name,id] of Object.entries(userIds)){
  await identity.createUser({id,email:name+'@example.test',
   displayName:name,password:PASSWORD});
 }
 for(const [orgId,ownerKey] of [['alpha','ownerA'],['beta','ownerB']]){
  const ownerId=userIds[ownerKey];
  org.setupOrganization({organizationId:orgId,name:orgId,
   owner:{accountId:ownerId,name:ownerKey,nickname:ownerKey,
    email:ownerKey+'@example.test'}});
  if(historicalOnly){
   org.applyVerifiedSeatPurchase({reference:'legacy-'+orgId,
    organizationId:orgId,plan:'Single',apps:[appId],seats:3});
  }else{
   org.applyVerifiedSubscriptionTransition({
    source:'stripe_live',eventKey:'synthetic-live-event-'+orgId,
    organizationId:orgId,subscriptionId:'synthetic-sub-'+orgId,
    revision:1,plan:'Single',apps:[appId],seats:3,
    status:'active',paidThrough:PAID_THROUGH
   });
  }
  org.saveMember({organizationId:orgId,actorId:ownerId,
   member:{accountId:userIds.member,name:'Member',nickname:'Member',
    email:'member@example.test',admin:false,roles:{goflo:'Analyst'}}});
 }
 const adminSessionA=identity.createSession(userIds.ownerA).parent;
 const adminSessionB=identity.createSession(userIds.ownerB).parent;
 const memberSession=identity.createSession(userIds.member).parent;
 org.selectSessionOrganization({sessionId:adminSessionA.id,
  accountId:userIds.ownerA,organizationId:'alpha'});
 org.selectSessionOrganization({sessionId:adminSessionB.id,
  accountId:userIds.ownerB,organizationId:'beta'});
 org.selectSessionOrganization({sessionId:memberSession.id,
  accountId:userIds.member,organizationId:'alpha'});
 const input=(organizationId='alpha')=>({
  sessionId:(organizationId==='alpha'?adminSessionA:adminSessionB).id,
  userId:userIds.member,appId,
  workspaceOrganizationId:organizationId,
  nativeUserId:'native-user-'+organizationId,
  nativeOrganizationId:'native-tenant-'+organizationId
 });
 return {identity,org,controller,organizationDatabasePath,userIds,adminSessionA,adminSessionB,
  memberSession,input,now:()=>now,setNow:x=>{now=x},
  duringNative:fn=>{duringNative=fn},
  setNativeVerified:x=>{nativeVerified=x},
  nativeRequests:()=>nativeRequests};
}

test('real authenticated org admin + paid app assignment + signed native proof binds metadata without SSO',async t=>{
 const f=await fixture(t);
 const result=await f.controller.bind(f.input());
 assert.equal(result.applied,true);
 assert.equal(result.link.nativeUserId,'native-user-alpha');
 assert.equal(result.link.linkOnly,true);
 assert.equal(result.link.accessGranted,false);
 assert.equal(result.link.licensesGranted,false);
 assert.equal(result.link.loginEnabled,false);
 assert.equal(f.identity.getAccess(f.userIds.member,appId),null);
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'}).length,1);
});

test('no outside caller can reuse the private identity store adapters or forge actorId',async t=>{
 const f=await fixture(t);
 const tuple={actorId:f.userIds.ownerA,userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha',
  nativeUserId:'native-user-alpha',
  nativeOrganizationId:'native-tenant-alpha',operation:'bind'};
 assert.equal(await f.controller.adapters.authorizeMutation(tuple),false);
 assert.equal(await f.controller.adapters.verifyNativeOwnership(tuple),false);
 await assert.rejects(f.identity.bindVerifiedOrganizationNativeLink(tuple),
  /org_native_link_not_authorized/);
 await assert.rejects(f.controller.bind({...f.input(),
  actorId:f.userIds.ownerA}),/native_operator_access_denied/);
 assert.equal(f.nativeRequests(),0);
 assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'}),null);
});

test('target member session is not an admin; wrong organization lock or missing session deny without native fetch',async t=>{
 const f=await fixture(t);
 for(const invalid of [
  {...f.input(),sessionId:f.memberSession.id},
  {...f.input('alpha'),sessionId:f.adminSessionB.id},
  {...f.input('beta'),sessionId:f.adminSessionA.id},
  {...f.input(),sessionId:randomUUID()},
  {...f.input(),nativeOrganizationId:'native-tenant-beta',role:'Admin'},
  {...f.input(),appId:'dataduck'}
 ]){
  await assert.rejects(f.controller.bind(invalid),
   /native_operator_access_denied/);
 }
 assert.equal(f.nativeRequests(),0);
});

test('historical paid receipt cannot be silently promoted to verified current LIVE seat',async t=>{
 const f=await fixture(t,{historicalOnly:true});
 await assert.rejects(f.controller.bind(f.input()),
  /native_operator_access_denied/);
 assert.equal(f.nativeRequests(),0);
 assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'}),null);
});

test('revoked operator session during native signed await denies and leaves audit empty',async t=>{
 const f=await fixture(t);
 f.duringNative(()=>f.identity.revokeSession(f.adminSessionA.id));
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'}),null);
 assert.equal(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'}).length,0);
});

test('admin suspension during native signed await denies exact link',async t=>{
 const f=await fixture(t);
 // The owner cannot be deactivated as last org admin, so verify disabling
 // the central identity while a valid native signature is being prepared.
 f.duringNative(()=>f.identity.setUserState(f.userIds.ownerA,'disabled'));
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'}),null);
});

test('member suspension or verified paid period expiry during native verification denies safely',async t=>{
 for(const mode of ['suspend','expire']){
  const f=await fixture(t);
  f.duringNative(()=>{
   if(mode==='suspend')f.org.setMemberActive({
    organizationId:'alpha',actorId:f.userIds.ownerA,
    accountId:f.userIds.member,active:false
   });
   else f.setNow(START+70_000);
  });
  await assert.rejects(f.controller.bind(f.input()),
   /native_ownership_unverified/);
  assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
   appId,workspaceOrganizationId:'alpha'}),null);
 }
});

test('signed native ownership refusal blocks private account mapping',async t=>{
 const f=await fixture(t);
 f.setNativeVerified(false);
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.nativeRequests(),1);
});

test('explicit legacy migration is session-scoped and retains original global grant unchanged',async t=>{
 const f=await fixture(t);
 f.identity.grantAppAccess({userId:f.userIds.member,appId,
  localUserId:'native-user-alpha',
  organizationId:'native-tenant-alpha'});
 const migrated=await f.controller.migrate({
  sessionId:f.adminSessionA.id,userId:f.userIds.member,appId,
  workspaceOrganizationId:'alpha',
  nativeOrganizationId:'native-tenant-alpha'
 });
 assert.equal(migrated.applied,true);
 assert.equal(migrated.link.nativeUserId,'native-user-alpha');
 assert.equal(f.identity.getAccess(f.userIds.member,appId).localIdentity.userId,
  'native-user-alpha');
 const actions=f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'}).map(r=>r.action);
 assert.deepEqual(actions,['link.migrated']);
 await assert.rejects(f.controller.migrate({
  sessionId:f.adminSessionB.id,userId:f.userIds.member,appId,
  workspaceOrganizationId:'beta',nativeOrganizationId:'native-tenant-beta'
 }),/legacy_native_link_mismatch/);
});

test('revoke permits secure cleanup after user suspension and expiry, but only from active locked org admin',async t=>{
 const f=await fixture(t);
 assert.equal((await f.controller.bind(f.input())).applied,true);
 f.org.setMemberActive({organizationId:'alpha',actorId:f.userIds.ownerA,
  accountId:f.userIds.member,active:false});
 f.setNow(START+70_000);
 assert.equal((await f.controller.revoke({
  sessionId:f.adminSessionA.id,userId:f.userIds.member,appId,
  workspaceOrganizationId:'alpha'
 })).applied,true);
 assert.equal(f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'}),null);
 assert.equal(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'}).map(x=>x.action).join(','),
  'link.revoked,link.bound');
 await assert.rejects(f.controller.revoke({
  sessionId:f.adminSessionB.id,userId:f.userIds.member,appId,
  workspaceOrganizationId:'alpha'
 }),/native_operator_access_denied/);
});

test('two concurrent real administrators stay isolated between Workspace organizations',async t=>{
 const f=await fixture(t);
 let releaseAlpha,alphaEntered;
 const alphaStarted=new Promise(resolve=>{alphaEntered=resolve;});
 const alphaResume=new Promise(resolve=>{releaseAlpha=resolve;});
 f.duringNative(async request=>{
  if(request.workspaceOrganizationId==='alpha'){
   alphaEntered();
   await alphaResume;
  }
 });
 const alpha=f.controller.bind(f.input('alpha'));
 await alphaStarted;
 const beta=await f.controller.bind(f.input('beta'));
 assert.equal(beta.link.workspaceOrganizationId,'beta');
 assert.equal(beta.link.nativeUserId,'native-user-beta');
 releaseAlpha();
 const a=await alpha;
 assert.equal(a.link.workspaceOrganizationId,'alpha');
 assert.equal(a.link.nativeUserId,'native-user-alpha');
 const aLink=f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha'});
 const bLink=f.identity.getOrganizationNativeLink({userId:f.userIds.member,
  appId,workspaceOrganizationId:'beta'});
 assert.notEqual(aLink.nativeUserId,bLink.nativeUserId);
 assert.equal(f.identity.getAccess(f.userIds.member,appId),null);
});


test('organization admin demotion WHILE a valid native signature is prepared denies link and audit',async t=>{
 const f=await fixture(t);
 // Make a second real active alpha admin so removal of the original
 // admin does not violate the last-admin safety invariant.
 f.org.saveMember({organizationId:'alpha',actorId:f.userIds.ownerA,
  member:{accountId:f.userIds.ownerB,name:'ownerB',nickname:'ownerB',
   email:'ownerB@example.test',admin:true,roles:{}}});
 f.duringNative(request=>{
  assert.equal(request.workspaceOrganizationId,'alpha');
  f.org.saveMember({organizationId:'alpha',actorId:f.userIds.ownerB,
   member:{accountId:f.userIds.ownerA,name:'ownerA',nickname:'ownerA',
    email:'ownerA@example.test',admin:false,roles:{}}});
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
 assert.deepEqual(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'
 }),[]);
});

test('target workspace.view permission revoked DURING signed ownership verification denies bind',async t=>{
 const f=await fixture(t);
 f.duringNative(request=>{
  assert.equal(request.workspaceOrganizationId,'alpha');
  f.org.setPermission({organizationId:'alpha',
   actorId:f.userIds.ownerA,accountId:f.userIds.member,
   appId,permission:'workspace.view',enabled:false});
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
 assert.deepEqual(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'
 }),[]);
});


test('ABA: organization admin demotion and restoration DURING a signed proof denies even when final admin is true',async t=>{
 const f=await fixture(t);
 f.org.saveMember({organizationId:'alpha',actorId:f.userIds.ownerA,
  member:{accountId:f.userIds.ownerB,name:'ownerB',nickname:'ownerB',
   email:'ownerB@example.test',admin:true,roles:{}}});
 f.duringNative(request=>{
  assert.equal(request.purpose,'bind');
  f.org.saveMember({organizationId:'alpha',actorId:f.userIds.ownerB,
   member:{accountId:f.userIds.ownerA,name:'ownerA',nickname:'ownerA',
    email:'ownerA@example.test',admin:false,roles:{}}});
  f.org.saveMember({organizationId:'alpha',actorId:f.userIds.ownerB,
   member:{accountId:f.userIds.ownerA,name:'ownerA',nickname:'ownerA',
    email:'ownerA@example.test',admin:true,roles:{}}});
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.org.currentSessionOrganization({
  sessionId:f.adminSessionA.id,accountId:f.userIds.ownerA
 }).admin,true,'end state restored deliberately');
 assert.equal(f.nativeRequests(),1,'the signed response was awaited');
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
 assert.deepEqual(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'
 }),[]);
});

test('ABA: revoke and restore the SAME target workspace.view permission before signature cannot create native mapping',async t=>{
 const f=await fixture(t);
 f.duringNative(()=>{
  const params={organizationId:'alpha',actorId:f.userIds.ownerA,
   accountId:f.userIds.member,appId,permission:'workspace.view'};
  f.org.setPermission({...params,enabled:false});
  f.org.setPermission({...params,enabled:true});
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert(f.org.effectivePermissions({organizationId:'alpha',
  accountId:f.userIds.member,appId}).includes('workspace.view'),
  'effective permission was intentionally restored');
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
 assert.deepEqual(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'
 }),[]);
});

test('ABA: issue then revoke a pending app-seat invitation during proof is denied even when paid coverage recovers',async t=>{
 const f=await fixture(t);
 f.duringNative(()=>{
  const request={organizationId:'alpha',actorId:f.userIds.ownerA,
   email:'synthetic-aba-invited@example.test'};
  f.org.issueInvitation({...request,name:'New User',nickname:'New',
   roles:{goflo:'Analyst'}});
  f.org.revokeInvitation(request);
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 assert.equal(f.org.listPendingInvitations('alpha',f.userIds.ownerA).length,0);
 assert(f.org.verifiedNativePermissionCandidate({
  organizationId:'alpha',accountId:f.userIds.member,
  appId,permission:'workspace.view'
 }),'paid entitlement is valid again, but history changed');
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
});

test('audit generation advances at identical clock ticks',async t=>{
 const f=await fixture(t);
 const args={organizationId:'alpha',accountId:f.userIds.ownerA,
  sessionId:f.adminSessionA.id};
 const original=f.org.nativeProvisioningAuditRevision(args);
 assert(Number.isSafeInteger(original.organizationAuditRevision));
 assert(Number.isSafeInteger(original.sessionLockEpoch));
 const roleArgs={organizationId:'alpha',actorId:f.userIds.ownerA,
  accountId:f.userIds.member,appId,permission:'workspace.view'};
 f.org.setPermission({...roleArgs,enabled:false});
 const revoked=f.org.nativeProvisioningAuditRevision(args);
 f.org.setPermission({...roleArgs,enabled:true});
 const restored=f.org.nativeProvisioningAuditRevision(args);
 assert(revoked.organizationAuditRevision>original.organizationAuditRevision);
 assert(restored.organizationAuditRevision>revoked.organizationAuditRevision);
 assert.equal(original.sessionLockEpoch,revoked.sessionLockEpoch);
 assert.equal(revoked.sessionLockEpoch,restored.sessionLockEpoch);
 assert.equal(f.now(),START,
  'all revisions must differ even when mocked timestamp is identical');
 assert.equal(f.org.nativeProvisioningAuditRevision({
  ...args,organizationId:'beta'
 }),null,'foreign session-tenant mismatch cannot read a revision');
 assert.equal(f.org.nativeProvisioningAuditRevision({
  ...args,sessionId:randomUUID()
 }),null);
});


test('ABA: clear/reselect same organization during signed proof invalidates exact session',async t=>{
 const f=await fixture(t);
 const selection={sessionId:f.adminSessionA.id,
  accountId:f.userIds.ownerA,organizationId:'alpha'};
 const before=f.org.nativeProvisioningAuditRevision(selection);
 assert(before);
 f.duringNative(()=>{
  f.org.clearSessionOrganization(selection.sessionId);
  f.org.selectSessionOrganization(selection);
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 const after=f.org.nativeProvisioningAuditRevision(selection);
 assert.equal(after.organizationAuditRevision,before.organizationAuditRevision);
 assert(after.sessionLockEpoch>before.sessionLockEpoch);
 assert.equal(f.org.currentSessionOrganization({
  sessionId:selection.sessionId,accountId:selection.accountId
 }).id,'alpha');
 assert.equal(f.now(),START);
 assert.equal(f.nativeRequests(),1);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
});

test('re-selecting an already locked organization is idempotent and does not advance epoch',async t=>{
 const f=await fixture(t);
 const selection={sessionId:f.adminSessionA.id,
  accountId:f.userIds.ownerA,organizationId:'alpha'};
 const before=f.org.nativeProvisioningAuditRevision(selection);
 f.duringNative(()=>{
  assert.deepEqual(f.org.selectSessionOrganization(selection),
   {organizationId:'alpha',alreadySelected:true});
 });
 const result=await f.controller.bind(f.input());
 const after=f.org.nativeProvisioningAuditRevision(selection);
 assert.equal(after.organizationAuditRevision,before.organizationAuditRevision);
 assert.equal(after.sessionLockEpoch,before.sessionLockEpoch);
 assert.equal(result.applied,true);
 assert.equal(result.link.accessGranted,false);
 assert.equal(result.link.loginEnabled,false);
});

test('ABA: switch tenant A to B and back during native proof always denies original selection',async t=>{
 const f=await fixture(t);
 f.org.saveMember({organizationId:'beta',actorId:f.userIds.ownerB,
  member:{accountId:f.userIds.ownerA,name:'ownerA',nickname:'ownerA',
   email:'ownerA@example.test',admin:true,roles:{}}});
 const alpha={sessionId:f.adminSessionA.id,accountId:f.userIds.ownerA,
  organizationId:'alpha'};
 const beta={...alpha,organizationId:'beta'};
 const before=f.org.nativeProvisioningAuditRevision(alpha);
 f.duringNative(()=>{
  f.org.clearSessionOrganization(alpha.sessionId);
  f.org.selectSessionOrganization(beta);
  f.org.clearSessionOrganization(alpha.sessionId);
  f.org.selectSessionOrganization(alpha);
 });
 await assert.rejects(f.controller.bind(f.input()),
  /native_ownership_unverified/);
 const after=f.org.nativeProvisioningAuditRevision(alpha);
 assert(after.sessionLockEpoch>before.sessionLockEpoch);
 assert.equal(after.organizationAuditRevision,before.organizationAuditRevision);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
});


test('real SQLite write fence denies a competing organization writer DURING native identity commit',async t=>{
 let probed=0;
 const f=await fixture(t,{fenceProbe:({organizationDatabasePath})=>{
  probed++;
  const other=new DatabaseSync(organizationDatabasePath);
  try{
   other.exec('PRAGMA busy_timeout=0');
   assert.throws(()=>other.exec('BEGIN IMMEDIATE'),
    /database is locked/,
    'other processes must not be able to change paid seats while the identity commit is fenced');
  }finally{other.close();}
 }});
 const linked=await f.controller.bind(f.input());
 assert.equal(linked.applied,true);
 assert.equal(probed,1,'lock starts only after a successful native signature');
 assert.equal(f.nativeRequests(),1);
 assert.equal(linked.link.accessGranted,false);
 const external=new DatabaseSync(f.organizationDatabasePath);
 try{
  external.exec('PRAGMA busy_timeout=0');
  external.exec('BEGIN IMMEDIATE');
  external.exec('ROLLBACK');
 }finally{external.close();}
 assert.equal(f.identity.orgNativeLinkAudit({
  appId,workspaceOrganizationId:'alpha'
 }).length,1);
});

test('a currently busy independent organization writer fails native binding closed; fresh signed retry succeeds',async t=>{
 const f=await fixture(t);
 const concurrent=new DatabaseSync(f.organizationDatabasePath);
 concurrent.exec('PRAGMA busy_timeout=0');
 concurrent.exec('BEGIN IMMEDIATE');
 try{
  await assert.rejects(f.controller.bind(f.input()),
   /native_ownership_unverified/);
  assert.equal(f.nativeRequests(),1);
  assert.equal(f.identity.getOrganizationNativeLink({
   userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
  }),null);
  assert.deepEqual(f.identity.orgNativeLinkAudit({
   appId,workspaceOrganizationId:'alpha'
  }),[]);
 }finally{
  concurrent.exec('ROLLBACK');
  concurrent.close();
 }
 const retried=await f.controller.bind(f.input());
 assert.equal(retried.applied,true,'new proof and fresh organization fence');
 assert.equal(f.nativeRequests(),2);
});

test('SQLite identity conflict cannot leak the organization write lock',async t=>{
 let entered=0;
 const f=await fixture(t,{fenceProbe:({organizationDatabasePath})=>{
  entered++;
  const competing=new DatabaseSync(organizationDatabasePath);
  try{
   competing.exec('PRAGMA busy_timeout=0');
   assert.throws(()=>competing.exec('BEGIN IMMEDIATE'),/database is locked/);
  }finally{competing.close();}
 }});
 assert.equal((await f.controller.bind(f.input('alpha'))).applied,true);
 // Second organization must not claim an identical native account ID.
 await assert.rejects(f.controller.bind({
  ...f.input('beta'),nativeUserId:'native-user-alpha'
 }),/org_native_link_conflict/);
 assert.equal(entered,2,'failed second commit was also fenced');
 const independent=new DatabaseSync(f.organizationDatabasePath);
 try{
  independent.exec('PRAGMA busy_timeout=0');
  independent.exec('BEGIN IMMEDIATE');
  independent.exec('ROLLBACK');
 }finally{independent.close();}
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'beta'
 }),null);
});

test('native deprovisioning is fenced even after paid-seat expiry and has no native network await',async t=>{
 let probes=0;
 const f=await fixture(t,{fenceProbe:({organizationDatabasePath})=>{
  probes++;
  const competing=new DatabaseSync(organizationDatabasePath);
  try{
   competing.exec('PRAGMA busy_timeout=0');
   assert.throws(()=>competing.exec('BEGIN IMMEDIATE'),/database is locked/);
  }finally{competing.close();}
 }});
 assert.equal((await f.controller.bind(f.input())).applied,true);
 f.setNow(START+70_000);
 f.org.setMemberActive({organizationId:'alpha',actorId:f.userIds.ownerA,
  accountId:f.userIds.member,active:false});
 const before=f.nativeRequests();
 const removed=await f.controller.revoke({
  sessionId:f.adminSessionA.id,userId:f.userIds.member,appId,
  workspaceOrganizationId:'alpha'
 });
 assert.equal(removed.applied,true);
 assert.equal(probes,2,'both bind and revoke held a real SQLite write fence');
 assert.equal(f.nativeRequests(),before,'revoke must not depend on an available native endpoint');
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.userIds.member,appId,workspaceOrganizationId:'alpha'
 }),null);
});


test('detached child tasks cannot reuse AsyncLocalStorage operator authority AFTER the final fenced commit',async t=>{
 const f=await fixture(t);
 const tuple={actorId:f.userIds.ownerA,userId:f.userIds.member,
  appId,workspaceOrganizationId:'alpha',
  nativeUserId:'native-user-alpha',
  nativeOrganizationId:'native-tenant-alpha',operation:'bind'};
 let releaseChild,childPromise;
 const afterCommit=new Promise(resolve=>{releaseChild=resolve;});
 f.duringNative(()=>{
  // The .then callback is ATTACHED from inside native verification and
  // inherits the real private async operator context. It is deliberately
  // resumed only after the outer bind has committed and released the fence.
  childPromise=afterCommit.then(async()=>({
   authorized:await f.controller.adapters.authorizeMutation(tuple),
   signed:await f.controller.adapters.verifyNativeOwnership(tuple)
  }));
 });
 const linked=await f.controller.bind(f.input());
 assert.equal(linked.applied,true);
 assert.equal(linked.link.accessGranted,false);
 releaseChild();
 assert.deepEqual(await childPromise,{authorized:false,signed:false});
 assert.equal(f.nativeRequests(),1,
  'a detached post-commit callback must not request another signed proof');
});
