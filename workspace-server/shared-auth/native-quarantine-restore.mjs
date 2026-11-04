/**
 * UNMOUNTED, PRIVATE, FAIL-CLOSED native recovery candidate rehearsal.
 *
 * Copies an already verified two-SQLite snapshot bundle into a NEW, private
 * disposable location; strips login/access authority from the COPIES while
 * preserving original snapshot files and canonical identity/audit history.
 *
 * Not an automatic production restore, signed provenance verifier, native
 * ownership proof, LIVE billing authority, SSO feature, or migration API.
 */
import {createHash,randomUUID} from 'node:crypto';
import {
 chmodSync,closeSync,constants,copyFileSync,existsSync,fsyncSync,
 lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,
 renameSync,rmSync,statSync,writeFileSync
} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {verifyPrivateNativeSnapshotPair} from './native-snapshot-pair.mjs';

const VERSION='duckbio.native-recovery-quarantine.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENTS=['identity.sqlite','organization.sqlite','quarantine.json'];
const isPlain=(obj,keys)=>obj!==null&&typeof obj==='object'&&
 !Array.isArray(obj)&&Object.keys(obj).length===keys.length&&
 keys.every(k=>Object.prototype.hasOwnProperty.call(obj,k));
const fail=code=>{throw Error(code);};

function privatePath(value,isDirectory){
 if(typeof value!=='string'||!path.isAbsolute(value))
  fail('private_absolute_path_required');
 let entry,real;
 try{entry=lstatSync(value);real=realpathSync(value)}
 catch{fail('private_existing_path_required')}
 if(real!==path.resolve(value)||entry.isSymbolicLink()||
    (entry.mode&0o077)!==0||
    (isDirectory?!entry.isDirectory():!entry.isFile()||entry.nlink!==1))
  fail('private_path_security_required');
 return real;
}
function childOf(child,ancestor){
 const rel=path.relative(ancestor,child);
 return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
}
function digest(file){
 return createHash('sha256').update(readFileSync(file)).digest('hex');
}
function fsync(file){
 const fd=openSync(file,'r');
 try{fsyncSync(fd)}finally{closeSync(fd)}
}
function dirsync(directory){
 let fd;
 try{fd=openSync(directory,'r');fsyncSync(fd)}
 catch{/* Not portable; no power-loss durability claim */}
 finally{if(fd!==undefined)closeSync(fd)}
}
function readCandidate(idFile,orgFile){
 let identity,organization;
 try{
  identity=new DatabaseSync(idFile,{readOnly:true});
  organization=new DatabaseSync(orgFile,{readOnly:true});
  for(const db of [identity,organization]){
   db.exec('PRAGMA query_only=ON');
   if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||
      db.prepare('PRAGMA foreign_key_check').all().length)
    fail('quarantine_sqlite_integrity_invalid');
  }
  const counts=Object.freeze({
   activeIdentities:identity.prepare(
    "SELECT COUNT(*) n FROM suite_identity_users WHERE state='active'"
   ).get().n,
   parentSessions:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_sessions'
   ).get().n,
   legacyAppGrants:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_grants'
   ).get().n,
   accountInvitations:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_invitations'
   ).get().n,
   bootstrapTokens:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_bootstrap'
   ).get().n,
   activeOrganizationMembers:organization.prepare(
    'SELECT COUNT(*) n FROM members WHERE active=1'
   ).get().n,
   sessionOrganizationLocks:organization.prepare(
    'SELECT COUNT(*) n FROM session_organizations'
   ).get().n,
   pendingOrganizationInvites:organization.prepare(
    'SELECT COUNT(*) n FROM organization_invites'
   ).get().n,
   purchasedAppSeats:organization.prepare(
    'SELECT COALESCE(SUM(purchased),0) n FROM seats'
   ).get().n,
   activeLiveShapedTerms:organization.prepare(
    "SELECT COUNT(*) n FROM verified_subscription_allocations WHERE state='active'"
   ).get().n,
   preservedNativeLinks:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_org_native_links'
   ).get().n,
   preservedNativeLinkAudit:identity.prepare(
    'SELECT COUNT(*) n FROM suite_identity_org_native_audit'
   ).get().n,
   preservedSessionEpochs:organization.prepare(
    'SELECT COUNT(*) n FROM native_provisioning_session_epochs'
   ).get().n
  });
  if(Object.entries(counts).some(([key,value])=>
   !Number.isSafeInteger(value)||value<0||
   (!key.startsWith('preserved')&&value!==0)))
   fail('quarantine_authentication_not_disabled');
  return counts;
 }finally{
  try{identity?.close()}finally{organization?.close()}
 }
}
function scrub(file,kind,now){
 const db=new DatabaseSync(file);
 try{
  db.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE');
  db.exec('BEGIN IMMEDIATE');
  let committed=false;
  try{
   if(kind==='identity'){
    db.exec('DELETE FROM suite_identity_sessions;');
    db.exec('DELETE FROM suite_identity_grants;');
    db.exec('DELETE FROM suite_identity_invitations;');
    db.exec('DELETE FROM suite_identity_bootstrap;');
    db.prepare("UPDATE suite_identity_users SET state='disabled',auth_version=auth_version+1,updated_at=?")
     .run(now);
    // NEVER erase canonical native identity links or append-only audit.
   }else{
    db.exec('DELETE FROM session_organizations;');
    db.exec('DELETE FROM organization_invites;');
    db.exec('UPDATE members SET active=0;');
    db.exec('UPDATE seats SET purchased=0;');
    db.exec("UPDATE verified_subscription_allocations SET state='canceled' WHERE state='active';");
    // Keep assignment/role history, durable session epochs and billing
    // revision/event history for manual investigation. Restored data is
    // deliberately NOT a valid live entitlement.
   }
   db.exec('COMMIT');committed=true;
  }finally{if(!committed)try{db.exec('ROLLBACK')}catch{}}
 }finally{db.close()}
}

/**
 * Stage a candidate from a VERIFIED, complete #163 bundle. Refuses to run on
 * any existing destination; creates one new private quarantine-* directory.
 *
 * The caller must not serve the staged DB from production/HTTP; by design all
 * central users are disabled, sessions and legacy grants removed, organization
 * membership deactivated, paid terms canceled, and purchased seats set to 0.
 */
export function createPrivateNativeQuarantineCandidate({
 batchDirectory,outputDirectory,now=Date.now()
}={}){
 if(!Number.isSafeInteger(now)||now<=0)fail('valid_recovery_clock_required');
 const batch=privatePath(batchDirectory,true);
 const output=privatePath(outputDirectory,true);
 if(childOf(output,batch)||childOf(batch,output))
  fail('snapshot_and_quarantine_directory_overlap');
 const validated=verifyPrivateNativeSnapshotPair({batchDirectory:batch,now});
 if(validated.integrityVerified!==true||
    validated.restoreApproved!==false)fail('snapshot_recovery_unverified');
 const id=randomUUID(),staging=path.join(output,'.pending-'+id),
  finished=path.join(output,'quarantine-'+id);
 let created=false;
 try{
  mkdirSync(staging,{mode:0o700});
  created=true;
  const mapping=[
   ['identity.snapshot.sqlite','identity.sqlite'],
   ['organization.snapshot.sqlite','organization.sqlite']
  ];
  const copied=[];
  for(const [source,destination] of mapping){
   const src=path.join(batch,source),dest=path.join(staging,destination);
   copyFileSync(src,dest,constants.COPYFILE_EXCL);
   chmodSync(dest,0o600);
   copied.push([src,dest]);
  }
  // Recheck original source digests for accidental source replacement
  // during copy (not cryptographic authority over hostile file writers).
  for(const [src,dest] of copied)
   if(digest(src)!==digest(dest))
    fail('quarantine_copy_source_changed');
  scrub(copied[0][1],'identity',now);
  scrub(copied[1][1],'organization',now);
  const counts=readCandidate(copied[0][1],copied[1][1]);
  const manifest=Object.freeze({
   version:VERSION,id,sourceBatchId:validated.batchId,
   createdAtMs:now,
   sourceSnapshotGeneration:validated.createdAtMs,
   sha256:{
    identity:digest(copied[0][1]),organization:digest(copied[1][1])
   },
   counts,
   restoreApproved:false,accessGranted:false,
   licensesGranted:false,loginEnabled:false
  });
  const marker=path.join(staging,'quarantine.json');
  writeFileSync(marker,JSON.stringify(manifest,null,2)+'\n',{
   encoding:'utf8',mode:0o600,flag:'wx'
  });
  chmodSync(marker,0o600);
  for(const name of CONTENTS)fsync(path.join(staging,name));
  dirsync(staging);
  if(existsSync(finished))fail('quarantine_candidate_already_exists');
  renameSync(staging,finished);created=false;
  dirsync(output);
  return Object.freeze({
   candidateDirectory:finished,sourceBatchId:validated.batchId,
   preservedNativeLinks:counts.preservedNativeLinks,
   restoreApproved:false,accessGranted:false,
   licensesGranted:false,loginEnabled:false
  });
 }finally{
  if(created)rmSync(staging,{recursive:true,force:true})
 }
}

/**
 * Read-only independent examination of a candidate — never returns
 * permission to place the staged files behind a live service.
 */
export function verifyPrivateNativeQuarantineCandidate({
 candidateDirectory
}={}){
 const directory=privatePath(candidateDirectory,true);
 const match=/^quarantine-([0-9a-f-]+)$/.exec(path.basename(directory));
 if(!match||!UUID.test(match[1]))
  fail('published_quarantine_candidate_required');
 if(JSON.stringify(readdirSync(directory).sort())!==
    JSON.stringify([...CONTENTS].sort()))
  fail('quarantine_members_invalid');
 const marker=path.join(directory,'quarantine.json');
 privatePath(marker,false);
 const source=readFileSync(marker);
 if(source.length===0||source.length>16384)
  fail('quarantine_manifest_invalid');
 let manifest;
 try{manifest=JSON.parse(source.toString('utf8'))}
 catch{fail('quarantine_manifest_invalid')}
 if(!isPlain(manifest,['version','id','sourceBatchId','createdAtMs',
    'sourceSnapshotGeneration','sha256','counts','restoreApproved',
    'accessGranted','licensesGranted','loginEnabled'])||
   manifest.version!==VERSION||manifest.id!==match[1]||
   !UUID.test(manifest.sourceBatchId)||
   !Number.isSafeInteger(manifest.createdAtMs)||manifest.createdAtMs<=0||
   !Number.isSafeInteger(manifest.sourceSnapshotGeneration)||
   manifest.sourceSnapshotGeneration<=0||
   !isPlain(manifest.sha256,['identity','organization'])||
   Object.values(manifest.sha256).some(x=>
    typeof x!=='string'||!/^[0-9a-f]{64}$/.test(x))||
   ['restoreApproved','accessGranted','licensesGranted','loginEnabled']
    .some(key=>manifest[key]!==false))
  fail('quarantine_manifest_invalid');
 const idFile=path.join(directory,'identity.sqlite'),
  orgFile=path.join(directory,'organization.sqlite');
 privatePath(idFile,false);
 privatePath(orgFile,false);
 if(digest(idFile)!==manifest.sha256.identity||
    digest(orgFile)!==manifest.sha256.organization)
  fail('quarantine_candidate_digest_mismatch');
 const counts=readCandidate(idFile,orgFile);
 if(!isPlain(manifest.counts,Object.keys(counts))||
    Object.entries(counts).some(([key,value])=>
     manifest.counts[key]!==value))
  fail('quarantine_candidate_counts_mismatch');
 return Object.freeze({
  candidateDirectory:directory,
  sourceBatchId:manifest.sourceBatchId,
  quarantined:true,authenticationDisabled:true,
  preservedNativeLinks:counts.preservedNativeLinks,
  preservedNativeLinkAudit:counts.preservedNativeLinkAudit,
  preservedSessionEpochs:counts.preservedSessionEpochs,
  restoreApproved:false,accessGranted:false,
  licensesGranted:false,loginEnabled:false,
  requiresIndependentOperatorApproval:true,
  requiresNativeOwnershipReverification:true,
  requiresFreshLiveBillingReconciliation:true
 });
}
