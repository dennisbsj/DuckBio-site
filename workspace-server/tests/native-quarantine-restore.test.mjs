import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {
 mkdtempSync,mkdirSync,rmSync,chmodSync,copyFileSync,
 readFileSync,readdirSync,writeFileSync,symlinkSync
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createPrivateNativeSnapshotPair,verifyPrivateNativeSnapshotPair}
 from '../shared-auth/native-snapshot-pair.mjs';
import {
 createPrivateNativeQuarantineCandidate,verifyPrivateNativeQuarantineCandidate
} from '../shared-auth/native-quarantine-restore.mjs';

const NOW=1800000000000;
const PASSWORD='private-only-disabled-after-recovery-password';
const sha=file=>createHash('sha256').update(readFileSync(file))
 .digest('hex');

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-quarantine-'));
 const sources=path.join(root,'source'),batches=path.join(root,'bundles'),
  candidates=path.join(root,'quarantines');
 for(const dir of [sources,batches,candidates])
  mkdirSync(dir,{mode:0o700});
 const identityDatabasePath=path.join(sources,'identity.sqlite');
 const organizationDatabasePath=path.join(sources,'organization.sqlite');
 const identity=createIdentityStore({
  databasePath:identityDatabasePath,clock:()=>NOW,
  orgNativeLinks:{
   // Fake authorization and ownership are used ONLY for disposable tests.
   authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true
  }
 });
 const org=createOrganizationStore({
  databasePath:organizationDatabasePath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true,
  verifyLiveSubscriptionEvidence:x=>x // synthetic LIVE-shaped event ONLY
 });
 t.after(()=>{
  identity.close();org.close();
  rmSync(root,{recursive:true,force:true});
 });
 const admin=await identity.createUser({
  id:randomUUID(),email:'operator@example.test',
  displayName:'Operator',password:PASSWORD
 });
 const scientist=await identity.createUser({
  id:randomUUID(),email:'scientist@example.test',
  displayName:'Scientist',password:PASSWORD
 });
 org.setupOrganization({
  organizationId:'lab-a',name:'Synthetic Research Lab',
  owner:{accountId:admin.id,name:'Operator',nickname:'Operator',
   email:'operator@example.test'}
 });
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-quarantine-event',
  organizationId:'lab-a',subscriptionId:'synthetic-subscription',
  revision:1,plan:'Single',apps:['goflo'],seats:2,
  status:'active',paidThrough:1800000600
 });
 org.saveMember({
  organizationId:'lab-a',actorId:admin.id,
  member:{accountId:scientist.id,name:'Scientist',nickname:'Scientist',
   email:'scientist@example.test',admin:false,
   roles:{goflo:'Analyst'}}
 });
 const session=identity.createSession(scientist.id);
 org.selectSessionOrganization({
  sessionId:session.parent.id,accountId:scientist.id,
  organizationId:'lab-a'
 });
 const adminSession=identity.createSession(admin.id);
 org.selectSessionOrganization({
  sessionId:adminSession.parent.id,accountId:admin.id,
  organizationId:'lab-a'
 });
 await identity.bindVerifiedOrganizationNativeLink({
  actorId:admin.id,userId:scientist.id,appId:'goflo',
  workspaceOrganizationId:'lab-a',
  nativeUserId:'signed-native-scientist',
  nativeOrganizationId:'signed-native-lab'
 });
 identity.grantAppAccess({
  userId:scientist.id,appId:'goflo',
  localUserId:'unsafe-old-global-native-id',
  organizationId:'unsafe-old-global-tenant'
 });
 const bundle=createPrivateNativeSnapshotPair({
  identityDatabasePath,organizationDatabasePath,
  outputDirectory:batches,clock:()=>NOW
 });
 const input={
  batchDirectory:bundle.batchDirectory,
  outputDirectory:candidates,now:NOW
 };
 return {root,identity,org,admin,scientist,session,adminSession,
  identityDatabasePath,organizationDatabasePath,
  bundle,batches,candidates,input,
  stage:()=>createPrivateNativeQuarantineCandidate(input)};
}

test('verified bundle becomes isolated quarantine; every historical login and licence is disabled',async t=>{
 const f=await fixture(t);
 const idSnapshot=path.join(f.bundle.batchDirectory,'identity.snapshot.sqlite');
 const orgSnapshot=path.join(f.bundle.batchDirectory,'organization.snapshot.sqlite');
 const sourceDigests=[sha(idSnapshot),sha(orgSnapshot)];
 const candidate=f.stage();
 assert.equal(candidate.restoreApproved,false);
 assert.equal(candidate.accessGranted,false);
 assert.equal(candidate.licensesGranted,false);
 assert.equal(candidate.loginEnabled,false);
 assert.equal(candidate.preservedNativeLinks,1);
 const checked=verifyPrivateNativeQuarantineCandidate({
  candidateDirectory:candidate.candidateDirectory
 });
 assert.equal(checked.quarantined,true);
 assert.equal(checked.authenticationDisabled,true);
 assert.equal(checked.preservedNativeLinks,1);
 assert.equal(checked.preservedNativeLinkAudit,1);
 assert(checked.preservedSessionEpochs>=2);
 assert.equal(checked.requiresNativeOwnershipReverification,true);
 assert.equal(checked.requiresFreshLiveBillingReconciliation,true);
 assert.equal(checked.requiresIndependentOperatorApproval,true);
 assert.equal(checked.restoreApproved,false);
 assert.equal(checked.loginEnabled,false);
 assert.deepEqual(sourceDigests,[sha(idSnapshot),sha(orgSnapshot)]);
 assert.equal(verifyPrivateNativeSnapshotPair({
  batchDirectory:f.bundle.batchDirectory,now:NOW
 }).integrityVerified,true);
 assert.deepEqual(readdirSync(f.candidates),[
  path.basename(candidate.candidateDirectory)
 ]);
});

test('reopened copied central identity refuses existing parent session, legacy grant and password authentication',async t=>{
 const f=await fixture(t),candidate=f.stage();
 const restored=createIdentityStore({
  databasePath:path.join(candidate.candidateDirectory,'identity.sqlite'),
  clock:()=>NOW
 });
 try{
  assert.equal(restored.getParentSession(f.session.parent.id),null);
  assert.equal(restored.getParentSession(f.adminSession.parent.id),null);
  assert.equal(restored.getSessionByToken(f.session.token),null);
  assert.equal(restored.getAccess(f.scientist.id,'goflo'),null);
  assert.equal(await restored.authenticatePassword({
   email:'scientist@example.test',password:PASSWORD
  }),null);
  assert.throws(()=>restored.createSession(f.scientist.id),/invalid_credentials/);
  assert.equal(restored.getUser(f.scientist.id).state,'disabled');
  assert.equal(restored.getUser(f.admin.id).state,'disabled');
  assert.deepEqual(restored.listAppGrants(f.scientist.id),[]);
  // Recovery preserves provenance metadata, not login authority.
  const linkDb=new DatabaseSync(
   path.join(candidate.candidateDirectory,'identity.sqlite'),{readOnly:true}
  );
  try{
   assert.equal(linkDb.prepare(
    'SELECT COUNT(*) n FROM suite_identity_org_native_links'
   ).get().n,1);
   assert.equal(linkDb.prepare(
    'SELECT COUNT(*) n FROM suite_identity_org_native_audit'
   ).get().n,1);
  }finally{linkDb.close()}
 }finally{restored.close()}
});

test('reopened copied organization cannot resurrect session selection or live-shaped app entitlement',async t=>{
 const f=await fixture(t),candidate=f.stage();
 const restored=createOrganizationStore({
  databasePath:path.join(candidate.candidateDirectory,'organization.sqlite'),
  clock:()=>NOW,nativeProvisioningSessionEpochs:true
 });
 try{
  assert.equal(restored.currentSessionOrganization({
   sessionId:f.session.parent.id,accountId:f.scientist.id
  }),null);
  assert.equal(restored.verifiedNativePermissionCandidate({
   organizationId:'lab-a',accountId:f.scientist.id,
   appId:'goflo',permission:'workspace.view'
  }),null);
  const db=new DatabaseSync(
   path.join(candidate.candidateDirectory,'organization.sqlite'),
   {readOnly:true}
  );
  try{
   assert.equal(db.prepare('SELECT SUM(purchased) n FROM seats').get().n,0);
   assert.equal(db.prepare(
    "SELECT COUNT(*) n FROM verified_subscription_allocations WHERE state='active'"
   ).get().n,0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM organization_audit').get().n>0,true);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM native_provisioning_session_epochs').get().n>=2,true);
  }finally{db.close()}
 }finally{restored.close()}
});

test('tampered quarantine DB is rejected even if one account is re-enabled',async t=>{
 const f=await fixture(t),candidate=f.stage();
 const file=path.join(candidate.candidateDirectory,'identity.sqlite');
 const db=new DatabaseSync(file);
 try{
  db.prepare("UPDATE suite_identity_users SET state='active' WHERE id=?")
   .run(f.scientist.id);
 }finally{db.close()}
 assert.throws(()=>verifyPrivateNativeQuarantineCandidate({
  candidateDirectory:candidate.candidateDirectory
 }),/quarantine_candidate_digest_mismatch/);
});

test('even a forged new digest cannot turn a candidate with an active account into a safe quarantine',async t=>{
 const f=await fixture(t),candidate=f.stage();
 const file=path.join(candidate.candidateDirectory,'identity.sqlite'),
  marker=path.join(candidate.candidateDirectory,'quarantine.json');
 const db=new DatabaseSync(file);
 try{
  db.prepare("UPDATE suite_identity_users SET state='active' WHERE id=?")
   .run(f.scientist.id);
 }finally{db.close()}
 const manifest=JSON.parse(readFileSync(marker,'utf8'));
 manifest.sha256.identity=sha(file);
 writeFileSync(marker,JSON.stringify(manifest));
 chmodSync(marker,0o600);
 assert.throws(()=>verifyPrivateNativeQuarantineCandidate({
  candidateDirectory:candidate.candidateDirectory
 }),/quarantine_authentication_not_disabled/);
});

test('corrupted source pair or expired subscription never produces a partial quarantine candidate',async t=>{
 const f=await fixture(t);
 const file=path.join(f.bundle.batchDirectory,'organization.snapshot.sqlite');
 // Modify bytes without changing the checksum stored in original manifest.
 const bytes=readFileSync(file);
 bytes[100]=bytes[100]^1;
 writeFileSync(file,bytes);chmodSync(file,0o600);
 assert.throws(()=>f.stage(),/snapshot_pair_digest_mismatch/);
 assert.deepEqual(readdirSync(f.candidates),[]);
});

test('expired source pair cannot be published as quarantine candidate',async t=>{
 const f=await fixture(t);
 assert.throws(()=>createPrivateNativeQuarantineCandidate({
  ...f.input,now:1800000601*1000
 }),/snapshot_pair_reconciliation_required/);
 assert.deepEqual(readdirSync(f.candidates),[]);
});

test('source-output overlaps, unsafe directory permissions and symlink output fail closed',async t=>{
 const f=await fixture(t);
 assert.throws(()=>createPrivateNativeQuarantineCandidate({
  ...f.input,outputDirectory:f.bundle.batchDirectory
 }),/snapshot_and_quarantine_directory_overlap/);
 chmodSync(f.candidates,0o755);
 try{
  assert.throws(()=>f.stage(),/private_path_security_required/);
 }finally{chmodSync(f.candidates,0o700)}
 const link=path.join(f.root,'untrusted-quarantine-alias');
 symlinkSync(f.candidates,link);
 assert.throws(()=>createPrivateNativeQuarantineCandidate({
  ...f.input,outputDirectory:link
 }),/private_path_security_required/);
 assert.deepEqual(readdirSync(f.candidates),[]);
});

test('quarantine manifest and directory member tampering fail closed',async t=>{
 const f=await fixture(t),candidate=f.stage();
 const marker=path.join(candidate.candidateDirectory,'quarantine.json');
 const manifest=JSON.parse(readFileSync(marker,'utf8'));
 manifest.loginEnabled=true;
 writeFileSync(marker,JSON.stringify(manifest));chmodSync(marker,0o600);
 assert.throws(()=>verifyPrivateNativeQuarantineCandidate({
  candidateDirectory:candidate.candidateDirectory
 }),/quarantine_manifest_invalid/);
 const second=f.stage();
 const extra=path.join(second.candidateDirectory,'untrusted.txt');
 writeFileSync(extra,'untrusted', {mode:0o600});
 assert.throws(()=>verifyPrivateNativeQuarantineCandidate({
  candidateDirectory:second.candidateDirectory
 }),/quarantine_members_invalid/);
});
