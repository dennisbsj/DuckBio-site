import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,chmodSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {auditNativeScopedRecoverySnapshots} from '../shared-auth/native-link-recovery-audit.mjs';
const NOW=1800000000000,PWD='synthetic-crash-test-only-password';
const worker=fileURLToPath(new URL('./fixtures/native-two-store-crash-worker.mjs',import.meta.url));
async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-synthetic-process-crash-'));
 const privateDir=path.join(root,'private'),copies=path.join(root,'copies');
 mkdirSync(privateDir,{mode:0o700});mkdirSync(copies,{mode:0o700});
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const identityPath=path.join(privateDir,'identity.sqlite');
 const orgPath=path.join(privateDir,'organization.sqlite');
 const identity=createIdentityStore({databasePath:identityPath,clock:()=>NOW,
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}});
 const org=createOrganizationStore({databasePath:orgPath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true,verifyLiveSubscriptionEvidence:e=>e});
 const admin=await identity.createUser({id:randomUUID(),email:'admin@example.test',
  displayName:'Admin',password:PWD});
 const member=await identity.createUser({id:randomUUID(),email:'member@example.test',
  displayName:'Member',password:PWD});
 org.setupOrganization({organizationId:'alpha',name:'Alpha',owner:{
  accountId:admin.id,name:'Admin',nickname:'Admin',email:'admin@example.test'}});
 org.applyVerifiedSubscriptionTransition({source:'stripe_live',
  eventKey:'test-crash-event',organizationId:'alpha',
  subscriptionId:'synthetic-crash-subscription',revision:1,
  plan:'Single',apps:['goflo'],seats:2,status:'active',paidThrough:1800000600});
 org.saveMember({organizationId:'alpha',actorId:admin.id,member:{
  accountId:member.id,name:'Member',nickname:'Member',
  email:'member@example.test',admin:false,roles:{goflo:'Analyst'}}});
 const session=identity.createSession(admin.id).parent;
 org.selectSessionOrganization({sessionId:session.id,accountId:admin.id,organizationId:'alpha'});
 identity.close();org.close();
 const run=mode=>{
  const result=spawnSync(process.execPath,['--no-warnings',worker,
   mode,identityPath,orgPath,session.id,member.id],{
   encoding:'utf8',timeout:15000
  });
  assert.equal(result.error,undefined);
  return result;
 };
 const stats=()=>{
  const i=new DatabaseSync(identityPath,{readOnly:true});
  const o=new DatabaseSync(orgPath,{readOnly:true});
  try{
   assert.equal(i.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.equal(o.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.deepEqual(i.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.deepEqual(o.prepare('PRAGMA foreign_key_check').all(),[]);
   return {links:i.prepare('SELECT COUNT(*) AS n FROM suite_identity_org_native_links').get().n,
    audit:i.prepare('SELECT COUNT(*) AS n FROM suite_identity_org_native_audit').get().n};
  }finally{i.close();o.close();}
 };
 const released=()=>{
  for(const f of [identityPath,orgPath]){
   const db=new DatabaseSync(f);
   try{db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE; ROLLBACK');}
   finally{db.close();}
  }
 };
 let n=0;
 const snapshot=()=>{
  n++;
  const identitySnapshotPath=path.join(copies,'identity-'+n+'.snapshot.sqlite');
  const organizationSnapshotPath=path.join(copies,'organization-'+n+'.snapshot.sqlite');
  for(const [source,target] of [[identityPath,identitySnapshotPath],
   [orgPath,organizationSnapshotPath]]){
   const db=new DatabaseSync(source);
   try{db.prepare('VACUUM INTO ?').run(target);}
   finally{db.close();}
   chmodSync(target,0o600);
  }
  return {identitySnapshotPath,organizationSnapshotPath,now:NOW};
 };
 return {identityPath,orgPath,admin,member,run,stats,released,snapshot};
}
test('process exits under organization write lock BEFORE identity commit: zero links, zero audit, locks released',async t=>{
 const f=await fixture(t);
 assert.equal(f.run('pre').status,71);
 assert.deepEqual(f.stats(),{links:0,audit:0});
 f.released();
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.scopedLinksExamined,0);
 assert.equal(report.recoveryApproved,false);
 assert.equal(report.accessGranted,false);
 assert.equal(report.loginEnabled,false);
 const retry=f.run('normal');
 assert.equal(retry.status,0,retry.stderr);
 assert.deepEqual(JSON.parse(retry.stdout),{applied:true,fences:1});
 assert.deepEqual(f.stats(),{links:1,audit:1});
 f.released();
});
test('process exits AFTER identity commit BEFORE fence release: exactly one link, no automatic restore or duplicate',async t=>{
 const f=await fixture(t);
 assert.equal(f.run('post').status,72);
 assert.deepEqual(f.stats(),{links:1,audit:1});
 f.released();
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.structurallyConsistent,true);
 assert.equal(report.scopedLinksExamined,1);
 assert.equal(report.recoveryApproved,false);
 assert.equal(report.accessGranted,false);
 assert.equal(report.licensesGranted,false);
 assert.equal(report.loginEnabled,false);
 assert.equal(report.requiresNativeOwnershipReverification,true);
 const retry=f.run('normal');
 assert.equal(retry.status,0,retry.stderr);
 assert.deepEqual(JSON.parse(retry.stdout),{applied:false,fences:1});
 assert.deepEqual(f.stats(),{links:1,audit:1});
 f.released();
});
test('post-commit crash followed by suspended target member is flagged by offline auditor',async t=>{
 const f=await fixture(t);
 assert.equal(f.run('post').status,72);
 const org=createOrganizationStore({databasePath:f.orgPath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true});
 try{org.setMemberActive({organizationId:'alpha',actorId:f.admin.id,
  accountId:f.member.id,active:false});}
 finally{org.close();}
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.structurallyConsistent,false);
 assert(report.findings[0].reasons.includes('workspace_membership_missing_or_disabled'));
 assert.equal(report.recoveryApproved,false);
 assert.equal(report.accessGranted,false);
 assert.equal(JSON.stringify(report).includes(f.member.id),false);
 f.released();
});
