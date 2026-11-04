/**
 * UNMOUNTED, PRIVATE two-SQLite snapshot-pair rehearsal.
 *
 * Locks BOTH authoritative local WAL databases against writers before the
 * first VACUUM INTO. Publishes both snapshots + SHA-256 manifest with ONE
 * same-filesystem directory rename, or publishes nothing.
 *
 * NOT a production backup/restore service: locking local SQLite files is not
 * a distributed lock, a two-DB transaction, a power-loss atomic commit, an
 * attestation of Stripe/native ownership, or permission to enable SSO.
 */
import {createHash,randomUUID} from 'node:crypto';
import {
 chmodSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,closeSync,
 readFileSync,readdirSync,realpathSync,renameSync,rmSync,statSync,writeFileSync
} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {auditNativeScopedRecoverySnapshots} from './native-link-recovery-audit.mjs';

const VERSION='duckbio.offline-native-snapshot-pair.v1';
const BUNDLE=/^batch-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const NAMES=Object.freeze({
 identity:'identity.snapshot.sqlite',
 organization:'organization.snapshot.sqlite'
});
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&
 !Array.isArray(obj)&&Object.keys(obj).length===keys.length&&
 keys.every(key=>own(obj,key));
const bad=code=>{throw Error(code);};

function absolutePrivatePath(input,kind){
 if(typeof input!=='string'||!path.isAbsolute(input))
  bad('private_absolute_path_required');
 let info,real;
 try{
  info=lstatSync(input);
  real=realpathSync(input);
 }catch{bad('private_existing_path_required');}
 if(real!==path.resolve(input)||info.isSymbolicLink()||
    (info.mode&0o077)!==0||
    (kind==='file'&&(!info.isFile()||info.nlink!==1))||
    (kind==='directory'&&!info.isDirectory()))
  bad('private_path_security_required');
 return {path:real,info};
}
function newDatabaseRead(pathname){
 return new DatabaseSync(pathname,{readOnly:true});
}
function checksum(pathname){
 const data=readFileSync(pathname);
 return createHash('sha256').update(data).digest('hex');
}
function syncFile(pathname){
 const fd=openSync(pathname,'r');
 try{fsyncSync(fd);}finally{closeSync(fd);}
}
function syncDirectory(pathname){
 // POSIX/local-staging rehearsal: directory fsync is best-effort only.
 // It does NOT establish power-loss safety for two independent WAL DBs.
 let fd;
 try{
  fd=openSync(pathname,'r');
  fsyncSync(fd);
 }catch{/* OS/filesystem might not permit directory fsync. */}
 finally{if(fd!==undefined)closeSync(fd);}
}
function validateDistinct(a,b){
 if(a.path===b.path||
    (a.info.dev===b.info.dev&&a.info.ino===b.info.ino))
  bad('distinct_authoritative_sqlite_files_required');
}
function parsedManifest(bundleDir){
 const names=readdirSync(bundleDir).sort();
 const expected=[...Object.values(NAMES),'manifest.json'].sort();
 if(JSON.stringify(names)!==JSON.stringify(expected))
  bad('snapshot_bundle_members_invalid');
 const manifestPath=path.join(bundleDir,'manifest.json');
 absolutePrivatePath(manifestPath,'file');
 const bytes=readFileSync(manifestPath);
 if(bytes.length>16*1024||bytes.length===0)bad('snapshot_manifest_invalid');
 let manifest;
 try{manifest=JSON.parse(bytes.toString('utf8'));}
 catch{bad('snapshot_manifest_invalid');}
 if(!exact(manifest,['version','batchId','createdAtMs','sources',
   'sha256','auditCursors','scopedLinksExamined','restoreApproved'])||
   manifest.version!==VERSION||
   manifest.restoreApproved!==false||
   !BUNDLE.test('batch-'+manifest.batchId)||
   !Number.isSafeInteger(manifest.createdAtMs)||
   manifest.createdAtMs<=0||
   !exact(manifest.sources,['identity','organization'])||
   Object.values(manifest.sources).some(x=>x!=='local_sqlite_wal')||
   !exact(manifest.sha256,['identity','organization'])||
   Object.values(manifest.sha256).some(x=>
     typeof x!=='string'||!/^[0-9a-f]{64}$/.test(x))||
   !exact(manifest.auditCursors,['identityAudit','organizationAudit','sessionEpoch'])||
   Object.values(manifest.auditCursors).some(x=>!Number.isSafeInteger(x)||x<0)||
   !Number.isSafeInteger(manifest.scopedLinksExamined)||
   manifest.scopedLinksExamined<0)
  bad('snapshot_manifest_invalid');
 return manifest;
}

/**
 * Capture only existing 0600 authoritative SQLite WAL files and an existing
 * 0700 private output directory on the SAME local filesystem.
 *
 * The caller must independently quiesce ALL application writes and native
 * linking before entry. Holding both SQLite BEGIN IMMEDIATE locks prevents
 * ordinary SQLite writers for the duration of both snapshots, but cannot
 * reconcile a pre-existing split-store commit, remote replica, or native DB.
 */
export function createPrivateNativeSnapshotPair({
 identityDatabasePath,organizationDatabasePath,outputDirectory,
 clock=Date.now
}={}){
 if(typeof clock!=='function')bad('private_clock_required');
 const now=clock();
 if(!Number.isSafeInteger(now)||now<=0)bad('private_clock_required');
 const identityFile=absolutePrivatePath(identityDatabasePath,'file');
 const organizationFile=absolutePrivatePath(organizationDatabasePath,'file');
 const parent=absolutePrivatePath(outputDirectory,'directory');
 validateDistinct(identityFile,organizationFile);
 // Two source DBs and the pair directory must all occupy the same local
 // device, otherwise the envelope cannot claim a single-filesystem rename.
 if(identityFile.info.dev!==organizationFile.info.dev||
    identityFile.info.dev!==parent.info.dev)
  bad('local_single_filesystem_required');
 const batchId=randomUUID();
 const staging=path.join(parent.path,'.pending-'+batchId);
 const finished=path.join(parent.path,'batch-'+batchId);
 const sources=[
  {name:'identity',path:identityFile.path},
  {name:'organization',path:organizationFile.path}
 ].sort((a,b)=>a.path.localeCompare(b.path));
 const locks=[];
 let stageCreated=false;
 try{
  // Deterministic path ordering avoids deadlocks when two operators
  // accidentally initiate a paired snapshot at the same time.
  for(const item of sources){
   const lock=new DatabaseSync(item.path);
   locks.push(lock);
   lock.exec('PRAGMA busy_timeout=0');
   lock.exec('BEGIN IMMEDIATE');
  }
  mkdirSync(staging,{mode:0o700});
  stageCreated=true;
  for(const kind of ['identity','organization']){
   const source=kind==='identity'?identityFile:organizationFile;
   const dest=path.join(staging,NAMES[kind]);
   const reader=newDatabaseRead(source.path);
   try{reader.prepare('VACUUM INTO ?').run(dest);}
   finally{reader.close();}
   chmodSync(dest,0o600);
  }
  const snapshotPair={
   identitySnapshotPath:path.join(staging,NAMES.identity),
   organizationSnapshotPath:path.join(staging,NAMES.organization),now
  };
  const diagnostic=auditNativeScopedRecoverySnapshots(snapshotPair);
  // Do not publish a misleadingly 'coordinated' bundle if the two
  // databases already disagreed BEFORE both locks were acquired.
  if(!diagnostic.structurallyConsistent)
   bad('snapshot_cross_store_inconsistent');
  const manifest=Object.freeze({
   version:VERSION,batchId,createdAtMs:now,
   sources:{identity:'local_sqlite_wal',organization:'local_sqlite_wal'},
   sha256:{
    identity:checksum(snapshotPair.identitySnapshotPath),
    organization:checksum(snapshotPair.organizationSnapshotPath)
   },
   auditCursors:diagnostic.auditCursors,
   scopedLinksExamined:diagnostic.scopedLinksExamined,
   restoreApproved:false
  });
  const manifestPath=path.join(staging,'manifest.json');
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{
   encoding:'utf8',mode:0o600,flag:'wx'
  });
  chmodSync(manifestPath,0o600);
  for(const name of [...Object.values(NAMES),'manifest.json'])
   syncFile(path.join(staging,name));
  syncDirectory(staging);
  if(existsSync(finished))bad('snapshot_bundle_already_exists');
  renameSync(staging,finished);
  stageCreated=false;
  syncDirectory(parent.path);
  return Object.freeze({
   batchDirectory:finished,batchId,
   scopedLinksExamined:diagnostic.scopedLinksExamined,
   restoreApproved:false,accessGranted:false,
   loginEnabled:false,licensesGranted:false
  });
 }finally{
  for(const lock of locks.reverse()){
   try{lock.exec('ROLLBACK');}catch{}
   try{lock.close();}catch{}
  }
  if(stageCreated)rmSync(staging,{recursive:true,force:true});
 }
}

/**
 * Verify one published pair. Hashes detect accidental damage or accidental
 * mixing of independently captured bundles; an untrusted manifest CAN be
 * forged, so this is not a signed backup provenance or authorization.
 */
export function verifyPrivateNativeSnapshotPair({
 batchDirectory,now=Date.now()
}={}){
 if(!Number.isSafeInteger(now)||now<=0)
  bad('valid_recovery_clock_required');
 const directory=absolutePrivatePath(batchDirectory,'directory');
 if(!BUNDLE.test(path.basename(directory.path)))
  bad('published_snapshot_bundle_required');
 const manifest=parsedManifest(directory.path);
 if(path.basename(directory.path)!=='batch-'+manifest.batchId)
  bad('snapshot_generation_mismatch');
 const paths={
  identity:path.join(directory.path,NAMES.identity),
  organization:path.join(directory.path,NAMES.organization)
 };
 for(const [kind,pathname] of Object.entries(paths)){
  absolutePrivatePath(pathname,'file');
  if(checksum(pathname)!==manifest.sha256[kind])
   bad('snapshot_pair_digest_mismatch');
 }
 const diagnostic=auditNativeScopedRecoverySnapshots({
  identitySnapshotPath:paths.identity,
  organizationSnapshotPath:paths.organization,
  now
 });
 if(!diagnostic.structurallyConsistent||
    diagnostic.scopedLinksExamined!==manifest.scopedLinksExamined||
    JSON.stringify(diagnostic.auditCursors)!==
      JSON.stringify(manifest.auditCursors))
  bad('snapshot_pair_reconciliation_required');
 return Object.freeze({
  version:manifest.version,batchId:manifest.batchId,
  createdAtMs:manifest.createdAtMs,integrityVerified:true,
  structurallyConsistent:true,
  scopedLinksExamined:diagnostic.scopedLinksExamined,
  auditCursors:diagnostic.auditCursors,
  restoreApproved:false,accessGranted:false,
  loginEnabled:false,licensesGranted:false,
  requiresNativeOwnershipReverification:true,
  requiresFreshLiveBillingReconciliation:true,
  requiresCoordinatedRestoreReview:true
 });
}
