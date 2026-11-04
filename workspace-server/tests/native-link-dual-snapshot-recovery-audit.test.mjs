import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,readFileSync,
 symlinkSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {auditNativeScopedRecoverySnapshots}
 from '../shared-auth/native-link-recovery-audit.mjs';

const NOW=1800000000000;
const PASSWORD='private-test-only-native-snapshot-audit';
const fingerprint=file=>createHash('sha256').update(readFileSync(file))
 .digest('hex');

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-dual-native-recovery-'));
 const source=path.join(root,'source');
 const copies=path.join(root,'snapshots');
 mkdirSync(source,{recursive:true,mode:0o700});
 mkdirSync(copies,{recursive:true,mode:0o700});
 const identityPath=path.join(source,'identity.sqlite');
 const organizationPath=path.join(source,'organization.sqlite');
 const identity=createIdentityStore({
  databasePath:identityPath,clock:()=>NOW,
  // Synthetic-only operator and native verifiers, NOT real ownership evidence.
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 const organization=createOrganizationStore({
  databasePath:organizationPath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true,
  // Fake LIVE-shaped event verifier; never treated as real external billing.
  verifyLiveSubscriptionEvidence:value=>value
 });
 t.after(()=>{
  identity.close();organization.close();
  rmSync(root,{recursive:true,force:true});
 });
 const admin=await identity.createUser({
  id:randomUUID(),email:'admin@example.test',
  displayName:'Synthetic Admin',password:PASSWORD
 });
 const user=await identity.createUser({
  id:randomUUID(),email:'member@example.test',
  displayName:'Synthetic Member',password:PASSWORD
 });
 organization.setupOrganization({
  organizationId:'lab-a',name:'Synthetic Lab A',
  owner:{accountId:admin.id,name:'Admin',nickname:'Admin',
   email:'admin@example.test'}
 });
 organization.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'test-event-1',
  organizationId:'lab-a',subscriptionId:'synthetic-subscription-1',
  revision:1,plan:'Single',apps:['goflo'],seats:2,
  status:'active',paidThrough:1800000600
 });
 organization.saveMember({
  organizationId:'lab-a',actorId:admin.id,
  member:{accountId:user.id,name:'Member',nickname:'Member',
   email:'member@example.test',admin:false,roles:{goflo:'Analyst'}}
 });
 const session=identity.createSession(user.id).parent;
 organization.selectSessionOrganization({
  sessionId:session.id,accountId:user.id,organizationId:'lab-a'
 });
 const input={actorId:admin.id,userId:user.id,
  appId:'goflo',workspaceOrganizationId:'lab-a',
  nativeUserId:'synthetic-native-member',
  nativeOrganizationId:'synthetic-native-lab-a'};
 await identity.bindVerifiedOrganizationNativeLink(input);
 identity.grantAppAccess({userId:user.id,appId:'goflo',
  localUserId:'historical-unscoped',organizationId:'old-tenant'});
 let index=0;
 function snapshot(){
  index++;
  const identitySnapshotPath=path.join(copies,'identity-'+index+'.snapshot.sqlite');
  const organizationSnapshotPath=path.join(copies,'organization-'+index+'.snapshot.sqlite');
  function copy(src,dest){
   const db=new DatabaseSync(src);
   try{db.prepare('VACUUM INTO ?').run(dest);}
   finally{db.close();}
   chmodSync(dest,0o600);
  }
  copy(identityPath,identitySnapshotPath);
  copy(organizationPath,organizationSnapshotPath);
  return {identitySnapshotPath,organizationSnapshotPath,now:NOW};
 }
 return {identity,organization,admin,user,input,root,source,copies,snapshot};
}

test('healthy dual snapshot has no structural findings, but never restores access',async t=>{
 const f=await fixture(t),files=f.snapshot();
 const before=[fingerprint(files.identitySnapshotPath),
  fingerprint(files.organizationSnapshotPath)];
 const result=auditNativeScopedRecoverySnapshots(files);
 assert.equal(result.mode,'offline_read_only_snapshot_diagnostic');
 assert.equal(result.scopedLinksExamined,1);
 assert.equal(result.structurallyConsistent,true);
 assert.equal(result.structuralFindings,0);
 assert.equal(result.legacyUnscopedGrantsIgnored,1);
 assert.equal(result.snapshotIntegrityVerified,true);
 assert(result.auditCursors.identityAudit>0);
 assert(result.auditCursors.organizationAudit>0);
 assert(result.auditCursors.sessionEpoch>0);
 assert.equal(result.recoveryApproved,false);
 assert.equal(result.accessGranted,false);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.loginEnabled,false);
 assert.equal(result.requiresNativeOwnershipReverification,true);
 assert.equal(result.requiresFreshLiveBillingReconciliation,true);
 assert.equal(result.requiresCoordinatedRestoreReview,true);
 assert.deepEqual(before,[fingerprint(files.identitySnapshotPath),
  fingerprint(files.organizationSnapshotPath)]);
});

test('mismatched post-suspension organization snapshot flags stale active native link',async t=>{
 const f=await fixture(t),old=f.snapshot();
 f.organization.setMemberActive({
  organizationId:'lab-a',actorId:f.admin.id,
  accountId:f.user.id,active:false
 });
 const newer=f.snapshot();
 const mixed=auditNativeScopedRecoverySnapshots({
  identitySnapshotPath:old.identitySnapshotPath,
  organizationSnapshotPath:newer.organizationSnapshotPath,now:NOW
 });
 assert.equal(mixed.structurallyConsistent,false);
 assert.equal(mixed.structuralFindings,1);
 assert(mixed.findings[0].reasons.includes(
  'workspace_membership_missing_or_disabled'));
 assert.equal(mixed.recoveryApproved,false);
 assert(!JSON.stringify(mixed).includes('member@example.test'));
 assert(!JSON.stringify(mixed).includes(f.user.id));
});

test('snapshot after app unassignment reports missing native app assignment',async t=>{
 const f=await fixture(t);
 f.organization.saveMember({
  organizationId:'lab-a',actorId:f.admin.id,
  member:{accountId:f.user.id,name:'Member',nickname:'Member',
   email:'member@example.test',admin:false,roles:{}}
 });
 const result=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert(result.findings[0].reasons.includes('workspace_app_assignment_missing'));
 assert.equal(result.loginEnabled,false);
});

test('paid term expiry or inadequate paid-seat coverage is never treated as ready',async t=>{
 const f=await fixture(t);
 const files=f.snapshot();
 const expired=auditNativeScopedRecoverySnapshots({
  ...files,now:1800000601*1000
 });
 assert(expired.findings[0].reasons.includes(
  'snapshot_verified_paid_term_insufficient'));
 const fresh=auditNativeScopedRecoverySnapshots(files);
 assert.equal(fresh.structurallyConsistent,true);
 assert.equal(fresh.recoveryApproved,false);
});

test('revoked native link is absent from inventory but retains historical audit cursor',async t=>{
 const f=await fixture(t);
 await f.identity.revokeVerifiedOrganizationNativeLink({
  actorId:f.admin.id,userId:f.user.id,
  appId:'goflo',workspaceOrganizationId:'lab-a'
 });
 const result=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(result.scopedLinksExamined,0);
 assert.equal(result.auditCursors.identityAudit,2);
 assert.equal(result.recoveryApproved,false);
});

test('missing and symlinked snapshots and incomplete schema fail closed',async t=>{
 const f=await fixture(t),files=f.snapshot();
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,identitySnapshotPath:path.join(f.copies,'absent.snapshot.sqlite')
 }),/private_snapshot_file_required/);
 const link=path.join(f.copies,'linked.snapshot.sqlite');
 symlinkSync(files.identitySnapshotPath,link);
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,identitySnapshotPath:link
 }),/private_snapshot_file_required/);
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,organizationSnapshotPath:files.identitySnapshotPath
 }),/distinct_snapshot_files_required/);
 const fake=path.join(f.copies,'fake.snapshot.sqlite');
 const tiny=new DatabaseSync(fake);
 tiny.exec('CREATE TABLE irrelevant(x)');
 tiny.close();chmodSync(fake,0o600);
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,organizationSnapshotPath:fake
 }),/snapshot_schema_incomplete/);
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,now:0
 }),/valid_audit_clock_required/);
});

test('recovery auditor never creates or repairs a missing database',async t=>{
 const f=await fixture(t),files=f.snapshot();
 const invalid=path.join(f.copies,'not-created.snapshot.sqlite');
 assert.throws(()=>auditNativeScopedRecoverySnapshots({
  ...files,organizationSnapshotPath:invalid
 }),/private_snapshot_file_required/);
 assert.equal(fingerprint(files.identitySnapshotPath).length,64);
});
