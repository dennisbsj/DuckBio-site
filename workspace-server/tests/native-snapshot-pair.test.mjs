import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
 mkdtempSync,mkdirSync,rmSync,chmodSync,readFileSync,writeFileSync,
 copyFileSync,readdirSync,symlinkSync
} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {
 createPrivateNativeSnapshotPair,verifyPrivateNativeSnapshotPair
} from '../shared-auth/native-snapshot-pair.mjs';
import {auditNativeScopedRecoverySnapshots}
 from '../shared-auth/native-link-recovery-audit.mjs';

const NOW=1800000000000;
const PASSWORD='private-only-pair-rehearsal-credential';
async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-pair-'));
 const sources=path.join(root,'sources');
 const output=path.join(root,'published');
 mkdirSync(sources,{mode:0o700});
 mkdirSync(output,{mode:0o700});
 const identityDatabasePath=path.join(sources,'identity.sqlite');
 const organizationDatabasePath=path.join(sources,'organization.sqlite');
 const identity=createIdentityStore({
  databasePath:identityDatabasePath,clock:()=>NOW,
  orgNativeLinks:{
   // SYNTHETIC operator and native identity verifiers only.
   authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true
  }
 });
 const org=createOrganizationStore({
  databasePath:organizationDatabasePath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true,
  // Accepts synthetic LIVE-shaped rows only, not any real billing proof.
  verifyLiveSubscriptionEvidence:x=>x
 });
 t.after(()=>{identity.close();org.close();
  rmSync(root,{recursive:true,force:true})});
 const admin=await identity.createUser({
  id:randomUUID(),email:'pair-admin@example.test',
  displayName:'Synthetic admin',password:PASSWORD
 });
 const member=await identity.createUser({
  id:randomUUID(),email:'pair-member@example.test',
  displayName:'Synthetic member',password:PASSWORD
 });
 org.setupOrganization({
  organizationId:'alpha',name:'Synthetic Lab',
  owner:{accountId:admin.id,name:'Admin',nickname:'Admin',
   email:'pair-admin@example.test'}
 });
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'fake-pair-event',
  organizationId:'alpha',subscriptionId:'synthetic-pair-subscription',
  revision:1,plan:'Single',apps:['goflo'],seats:3,
  status:'active',paidThrough:1800000600
 });
 org.saveMember({
  organizationId:'alpha',actorId:admin.id,
  member:{accountId:member.id,name:'Member',nickname:'Member',
   email:'pair-member@example.test',admin:false,
   roles:{goflo:'Analyst'}}
 });
 const session=identity.createSession(admin.id).parent;
 org.selectSessionOrganization({
  sessionId:session.id,accountId:admin.id,organizationId:'alpha'
 });
 await identity.bindVerifiedOrganizationNativeLink({
  actorId:admin.id,userId:member.id,appId:'goflo',
  workspaceOrganizationId:'alpha',
  nativeUserId:'native-member-alpha',
  nativeOrganizationId:'native-lab-alpha'
 });
 identity.grantAppAccess({
  userId:member.id,appId:'goflo',
  localUserId:'old-global-grant',
  organizationId:'old-global-tenant'
 });
 const args={
  identityDatabasePath,organizationDatabasePath,
  outputDirectory:output,clock:()=>NOW
 };
 return {root,sources,output,identity,org,admin,member,session,args,
  backup:()=>createPrivateNativeSnapshotPair(args),
  verify:bundle=>verifyPrivateNativeSnapshotPair({
   batchDirectory:bundle.batchDirectory,now:NOW
  })};
}

test('two write-reserved WAL databases publish exactly one private snapshot pair, never activate SSO',async t=>{
 const f=await fixture(t);
 const bundle=f.backup();
 assert.match(path.basename(bundle.batchDirectory),/^batch-/);
 assert.equal(bundle.restoreApproved,false);
 assert.equal(bundle.loginEnabled,false);
 const manifest=JSON.parse(readFileSync(
  path.join(bundle.batchDirectory,'manifest.json'),'utf8'
 ));
 assert.equal(manifest.batchId,bundle.batchId);
 assert.equal(manifest.restoreApproved,false);
 assert.deepEqual(
  readdirSync(bundle.batchDirectory).sort(),
  ['identity.snapshot.sqlite','manifest.json',
   'organization.snapshot.sqlite']
 );
 const checked=f.verify(bundle);
 assert.equal(checked.integrityVerified,true);
 assert.equal(checked.structurallyConsistent,true);
 assert.equal(checked.scopedLinksExamined,1);
 assert.equal(checked.restoreApproved,false);
 assert.equal(checked.accessGranted,false);
 assert.equal(checked.licensesGranted,false);
 assert.equal(checked.loginEnabled,false);
 assert.equal(checked.requiresNativeOwnershipReverification,true);
 assert.equal(checked.requiresFreshLiveBillingReconciliation,true);
 const audit=auditNativeScopedRecoverySnapshots({
  identitySnapshotPath:path.join(bundle.batchDirectory,'identity.snapshot.sqlite'),
  organizationSnapshotPath:path.join(bundle.batchDirectory,'organization.snapshot.sqlite'),
  now:NOW
 });
 assert.equal(audit.scopedLinksExamined,1);
 assert.equal(audit.legacyUnscopedGrantsIgnored,1);
 assert.deepEqual(readdirSync(f.output),['batch-'+bundle.batchId]);
});

test('pre-existing organization write reservation blocks full pair, leaves no partial bundle and releases first reservation',async t=>{
 const f=await fixture(t);
 const writer=new DatabaseSync(f.args.organizationDatabasePath);
 try{
  writer.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  assert.throws(()=>f.backup(),/SQLITE_BUSY|database is locked/);
  assert.deepEqual(readdirSync(f.output),[]);
  const probe=new DatabaseSync(f.args.identityDatabasePath);
  try{probe.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
   probe.exec('ROLLBACK');
  }finally{probe.close();}
 }finally{
  writer.exec('ROLLBACK');writer.close();
 }
 assert.equal(f.verify(f.backup()).restoreApproved,false);
});

test('pre-existing identity write reservation blocks pair without publishing even first snapshot',async t=>{
 const f=await fixture(t);
 const writer=new DatabaseSync(f.args.identityDatabasePath);
 try{
  writer.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
  assert.throws(()=>f.backup(),/SQLITE_BUSY|database is locked/);
  assert.deepEqual(readdirSync(f.output),[]);
 }finally{writer.exec('ROLLBACK');writer.close();}
 assert.equal(f.verify(f.backup()).integrityVerified,true);
});

test('split-store member suspension aborts publish and cleans the entire staging bundle',async t=>{
 const f=await fixture(t);
 f.org.setMemberActive({
  organizationId:'alpha',actorId:f.admin.id,
  accountId:f.member.id,active:false
 });
 assert.throws(()=>f.backup(),/snapshot_cross_store_inconsistent/);
 assert.deepEqual(readdirSync(f.output),[]);
 const source=f.org.currentSessionOrganization({
  sessionId:f.session.id,accountId:f.admin.id
 });
 assert.equal(source.id,'alpha');
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:'goflo',workspaceOrganizationId:'alpha'
 }).nativeUserId,'native-member-alpha');
});

test('hash manifest refuses swapped or corrupted SQLite member of a complete pair',async t=>{
 const f=await fixture(t);
 const one=f.backup();
 // A harmless audited organization mutation creates a distinct, still
 // structurally consistent backup pair.
 f.org.saveMember({
  organizationId:'alpha',actorId:f.admin.id,
  member:{accountId:f.member.id,name:'Member II',
   nickname:'Member',email:'pair-member@example.test',
   admin:false,roles:{goflo:'Analyst'}}
 });
 const two=f.backup();
 const original=path.join(one.batchDirectory,'organization.snapshot.sqlite');
 const swapped=path.join(two.batchDirectory,'organization.snapshot.sqlite');
 copyFileSync(swapped,original);
 chmodSync(original,0o600);
 assert.throws(()=>f.verify(one),/snapshot_pair_digest_mismatch/);
 assert.equal(f.verify(two).restoreApproved,false);
});

test('tampered manifest or altered pair-directory generation is rejected',async t=>{
 const f=await fixture(t);
 const first=f.backup();
 const manifestPath=path.join(first.batchDirectory,'manifest.json');
 const original=JSON.parse(readFileSync(manifestPath,'utf8'));
 original.restoreApproved=true;
 writeFileSync(manifestPath,JSON.stringify(original));
 chmodSync(manifestPath,0o600);
 assert.throws(()=>f.verify(first),/snapshot_manifest_invalid/);
 const another=f.backup();
 const otherManifest=path.join(another.batchDirectory,'manifest.json');
 const changed=JSON.parse(readFileSync(otherManifest,'utf8'));
 changed.batchId=randomUUID();
 writeFileSync(otherManifest,JSON.stringify(changed));
 chmodSync(otherManifest,0o600);
 assert.throws(()=>f.verify(another),/snapshot_generation_mismatch/);
});

test('expired stored term after capture refuses subsequent recovery verification',async t=>{
 const f=await fixture(t);
 const bundle=f.backup();
 assert.throws(()=>verifyPrivateNativeSnapshotPair({
  batchDirectory:bundle.batchDirectory,now:1800000601*1000
 }),/snapshot_pair_reconciliation_required/);
 assert.equal(f.verify(bundle).restoreApproved,false);
});

test('untrusted symlink source, alias DB, weak mode and output directory are rejected',async t=>{
 const f=await fixture(t);
 const alias=path.join(f.sources,'alias.sqlite');
 symlinkSync(f.args.identityDatabasePath,alias);
 assert.throws(()=>createPrivateNativeSnapshotPair({
  ...f.args,identityDatabasePath:alias
 }),/private_path_security_required/);
 assert.throws(()=>createPrivateNativeSnapshotPair({
  ...f.args,organizationDatabasePath:f.args.identityDatabasePath
 }),/distinct_authoritative_sqlite_files_required/);
 chmodSync(f.args.organizationDatabasePath,0o644);
 try{assert.throws(()=>f.backup(),/private_path_security_required/);}
 finally{chmodSync(f.args.organizationDatabasePath,0o600);}
 chmodSync(f.output,0o755);
 try{assert.throws(()=>f.backup(),/private_path_security_required/);}
 finally{chmodSync(f.output,0o700);}
 assert.deepEqual(readdirSync(f.output),[]);
});
