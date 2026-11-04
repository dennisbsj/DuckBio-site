/**
 * Actual Linux process SIGKILL of disposable SQLite WAL writers.
 * These negative safety tests do not claim two-database power-loss
 * atomicity; they document recoverable rollback and asymmetric commits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {auditNativeScopedRecoverySnapshots}
 from '../shared-auth/native-link-recovery-audit.mjs';

const NOW=1800000000000;
const PASSWORD='test-only-disposable-crash-workspace-password';
const childPath=fileURLToPath(
 new URL('./helpers/native-recovery-crash-child.mjs',import.meta.url)
);
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-crash-'));
 const base=path.join(root,'sources');
 const snapshots=path.join(root,'snapshots');
 mkdirSync(base,{recursive:true,mode:0o700});
 mkdirSync(snapshots,{recursive:true,mode:0o700});
 const identityPath=path.join(base,'identity.sqlite');
 const organizationPath=path.join(base,'organization.sqlite');
 const identity=createIdentityStore({
  databasePath:identityPath,clock:()=>NOW,
  // ONLY synthetic trust callbacks, never native service attestation.
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 const org=createOrganizationStore({
  databasePath:organizationPath,clock:()=>NOW,
  nativeProvisioningSessionEpochs:true,
  verifyLiveSubscriptionEvidence:x=>x // fake LIVE-shaped test ledger
 });
 t.after(()=>{
  identity.close();org.close();rmSync(root,{recursive:true,force:true});
 });
 const admin=await identity.createUser({
  id:randomUUID(),email:'crash-admin@example.test',
  displayName:'Crash Test Admin',password:PASSWORD
 });
 const member=await identity.createUser({
  id:randomUUID(),email:'crash-user@example.test',
  displayName:'Crash Test User',password:PASSWORD
 });
 org.setupOrganization({
  organizationId:'lab-a',name:'Synthetic WAL Crash Lab',
  owner:{accountId:admin.id,name:'Admin',nickname:'Admin',
   email:'crash-admin@example.test'}
 });
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-crash-event',
  organizationId:'lab-a',subscriptionId:'synthetic-crash-subscription',
  revision:1,plan:'Single',apps:['goflo'],seats:2,
  status:'active',paidThrough:1800000600
 });
 org.saveMember({
  organizationId:'lab-a',actorId:admin.id,
  member:{accountId:member.id,name:'Member',nickname:'Member',
   email:'crash-user@example.test',admin:false,
   roles:{goflo:'Analyst'}}
 });
 const operator=identity.createSession(admin.id).parent;
 org.selectSessionOrganization({
  sessionId:operator.id,accountId:admin.id,organizationId:'lab-a'
 });
 await identity.bindVerifiedOrganizationNativeLink({
  actorId:admin.id,userId:member.id,appId:'goflo',
  workspaceOrganizationId:'lab-a',nativeUserId:'synthetic-crash-native-user',
  nativeOrganizationId:'synthetic-crash-native-tenant'
 });
 let sequence=0;
 function snapshot(){
  sequence++;
  const identitySnapshotPath=path.join(
   snapshots,'identity-'+sequence+'.snapshot.sqlite'
  );
  const organizationSnapshotPath=path.join(
   snapshots,'organization-'+sequence+'.snapshot.sqlite'
  );
  for(const [source,dest] of [
   [identityPath,identitySnapshotPath],
   [organizationPath,organizationSnapshotPath]
  ]){
   const reader=new DatabaseSync(source);
   try{reader.prepare('VACUUM INTO ?').run(dest);}
   finally{reader.close();}
   chmodSync(dest,0o600);
  }
  return {identitySnapshotPath,organizationSnapshotPath,now:NOW};
 }
 return {identity,org,admin,member,operator,
  identityPath,organizationPath,snapshot};
}

async function sigkillWorker(t,mode,file,memberId,operatorId){
 const child=spawn(process.execPath,[
  '--experimental-sqlite',childPath,file,mode,memberId,operatorId
 ],{stdio:['ignore','pipe','pipe'],env:{...process.env}});
 let stderr='';
 child.stderr.setEncoding('utf8');
 child.stderr.on('data',x=>{stderr=(stderr+x).slice(-2000)});
 let stopped=false;
 const closed=new Promise((resolve,reject)=>{
  child.once('error',reject);
  child.once('close',(code,signal)=>{
   stopped=true;
   resolve({code,signal});
  });
 });
 t.after(()=>{
  if(!stopped)child.kill('SIGKILL');
 });
 const ready=new Promise((resolve,reject)=>{
  let output='';
  const timeout=setTimeout(()=>{
   child.kill('SIGKILL');
   reject(Error('synthetic_worker_ready_timeout: '+stderr));
  },10000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',data=>{
   output+=data;
   if(output.includes('READY\n')){
    clearTimeout(timeout);resolve();
   }else if(output.length>1024){
    clearTimeout(timeout);reject(Error('unexpected_worker_output'));
   }
  });
  child.once('close',(code,signal)=>{
   clearTimeout(timeout);
   if(!output.includes('READY\n'))
    reject(Error('synthetic_worker_failed: '+code+'/'+signal+' '+stderr));
  });
  child.once('error',error=>{
   clearTimeout(timeout);reject(error);
  });
 });
 await ready;
 assert.equal(child.kill('SIGKILL'),true,'only the disposable test child is killed');
 const ended=await closed;
 assert.equal(ended.signal,'SIGKILL');
 return ended;
}

test('SIGKILL during uncommitted organization write rolls back and frees opt-in commit fence',async t=>{
 const f=await fixture(t);
 const args={
  organizationId:'lab-a',accountId:f.admin.id,sessionId:f.operator.id
 };
 const revision=f.org.nativeProvisioningAuditRevision(args);
 assert(revision.sessionLockEpoch>0);
 const fenceInput={...args,...revision};
 // Kill child only AFTER it confirms an open BEGIN IMMEDIATE transaction.
 // This demonstrates WAL rollback and releases the file-level write lock.
 const child=spawn(process.execPath,[
  '--experimental-sqlite',childPath,f.organizationPath,
  'org_uncommitted',f.member.id,f.admin.id
 ],{stdio:['ignore','pipe','pipe']});
 let ready=false,stopped=false,stderr='';
 child.stderr.setEncoding('utf8');
 child.stderr.on('data',data=>{stderr+=data});
 const closed=new Promise(resolve=>{
  child.once('close',(code,signal)=>{stopped=true;resolve({code,signal})});
 });
 t.after(()=>{if(!stopped)child.kill('SIGKILL')});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('worker timed out '+stderr))},10000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',data=>{
   if(data.includes('READY\n')){ready=true;clearTimeout(timer);resolve()}
  });
  child.once('close',(code,signal)=>{
   clearTimeout(timer);
   if(!ready)reject(Error('worker died before READY '+code+'/'+signal+' '+stderr));
  });
 });
 assert.equal(f.org.nativeProvisioningAcquireCommitFence(fenceInput),null);
 child.kill('SIGKILL');
 assert.equal((await closed).signal,'SIGKILL');
 const fence=f.org.nativeProvisioningAcquireCommitFence(fenceInput);
 assert(fence,'SQLite writer lock must be released by SIGKILL');
 fence.release();
 assert.equal(f.org.currentSessionOrganization({
  sessionId:f.operator.id,accountId:f.admin.id
 }).id,'lab-a');
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.structurallyConsistent,true);
 assert.equal(report.scopedLinksExamined,1);
 assert.equal(report.recoveryApproved,false);
 assert.equal(report.loginEnabled,false);
});

test('SIGKILL before identity native link COMMIT preserves canonical link and its audit',async t=>{
 const f=await fixture(t);
 await sigkillWorker(t,'identity_uncommitted',
  f.identityPath,f.member.id,f.admin.id);
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.scopedLinksExamined,1);
 assert.equal(report.auditCursors.identityAudit,1);
 assert.equal(report.structurallyConsistent,true);
 assert.equal(report.recoveryApproved,false);
});

test('SIGKILL after organization COMMIT but before identity reconciliation finds split-store drift',async t=>{
 const f=await fixture(t),before=f.snapshot();
 const hashBefore=[sha(before.identitySnapshotPath),
  sha(before.organizationSnapshotPath)];
 await sigkillWorker(t,'org_committed',
  f.organizationPath,f.member.id,f.admin.id);
 const after=f.snapshot();
 const report=auditNativeScopedRecoverySnapshots(after);
 assert.equal(report.scopedLinksExamined,1);
 assert.equal(report.structurallyConsistent,false);
 assert(report.findings[0].reasons.includes(
  'workspace_membership_missing_or_disabled'
 ));
 assert.equal(report.accessGranted,false);
 assert.equal(report.loginEnabled,false);
 assert.equal(report.recoveryApproved,false);
 // An older identity snapshot combined with newer organization snapshot
 // cannot silently authorize an active link.
 const mixed=auditNativeScopedRecoverySnapshots({
  identitySnapshotPath:before.identitySnapshotPath,
  organizationSnapshotPath:after.organizationSnapshotPath,now:NOW
 });
 assert(mixed.findings[0].reasons.includes(
  'workspace_membership_missing_or_disabled'
 ));
 assert.deepEqual(hashBefore,[sha(before.identitySnapshotPath),
  sha(before.organizationSnapshotPath)]);
});

test('SIGKILL after identity revoke COMMIT leaves durable audit and never approves recovery',async t=>{
 const f=await fixture(t);
 await sigkillWorker(t,'identity_committed',
  f.identityPath,f.member.id,f.admin.id);
 const report=auditNativeScopedRecoverySnapshots(f.snapshot());
 assert.equal(report.scopedLinksExamined,0);
 assert.equal(report.auditCursors.identityAudit,2);
 // A zero-finding report does NOT verify native ownership or recovery
 // completeness; committed one-sided changes need operator reconciliation.
 assert.equal(report.structurallyConsistent,true);
 assert.equal(report.recoveryApproved,false);
 assert.equal(report.requiresCoordinatedRestoreReview,true);
 assert.equal(report.loginEnabled,false);
});
