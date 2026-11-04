/**
 * Private, dormant Workspace registry for DataDuck's explicit native identities.
 *
 * A mapping is not a user invitation, SSO proof, native role, paid seat or
 * authorization grant. This module has no HTTP routes and is NOT imported by
 * the running broker. DataDuck's own native database remains authoritative.
 *
 * Callers must provide independent, private checks for the organization
 * administrator, current active Workspace assignment, and native ownership.
 * Never verify identity by matching email addresses or browser role claims.
 */
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,realpathSync,chmodSync} from 'node:fs';
import path from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const fail=code=>{throw Error(code);};
const validIdentity=x=>typeof x==='string'&&UUID.test(x);
function privateDatabase(file){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('private_path_required');
 const blocked=parts=>parts.split(path.sep).some(part=>
  ['docs','public_html','site-preview','.github'].includes(part.toLowerCase()));
 if(blocked(file))fail('private_path_required');
 let ancestor=path.dirname(file);
 while(!existsSync(ancestor)&&path.dirname(ancestor)!==ancestor)ancestor=path.dirname(ancestor);
 if(blocked(realpathSync(ancestor)))fail('private_path_required');
}

/**
 * Opt-in trusted back-office storage only. Nothing here activates DataDuck.
 *
 * authorizeMutation({actorId,workspaceOrganizationId,action}) must check a
 * current trusted administrator/operator, not a claimed browser admin flag.
 * currentAssignment({workspaceOrganizationId,workspaceAccountId,appId}) must
 * check the current active central membership and assigned DataDuck app seat.
 * verifyNativeOwnership({workspaceOrganizationId,workspaceAccountId,
 * nativeOrganizationId,nativeUserId,evidence}) must independently consult
 * the native authoritative source and validate exact UUID ownership.
 *
 * All three adapters default to DENY by being required at construction.
 */
export function createDataDuckNativeLinkStore({databasePath,authorizeMutation,
 currentAssignment,verifyNativeOwnership,clock=Date.now}={}){
 if(typeof authorizeMutation!=='function'||typeof currentAssignment!=='function'||
    typeof verifyNativeOwnership!=='function'||typeof clock!=='function')
   fail('trusted_link_adapters_required');
 privateDatabase(databasePath);
 mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL');
 db.exec(`CREATE TABLE IF NOT EXISTS dataduck_native_organizations (
  workspace_org TEXT PRIMARY KEY, native_org TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS dataduck_native_users (
  workspace_org TEXT NOT NULL REFERENCES dataduck_native_organizations(workspace_org),
  workspace_account TEXT NOT NULL,
  native_org TEXT NOT NULL,
  native_user TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','revoked')),
  verified_at INTEGER NOT NULL,
  PRIMARY KEY(workspace_org,workspace_account),
  UNIQUE(native_org,native_user),
  FOREIGN KEY(native_org) REFERENCES dataduck_native_organizations(native_org));
 CREATE TABLE IF NOT EXISTS dataduck_native_link_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_org TEXT NOT NULL, workspace_account TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('bound','reverified','revoked')),
  at INTEGER NOT NULL);
 `);
 for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))chmodSync(databasePath+suffix,0o600);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const context=(workspaceOrganizationId,workspaceAccountId)=>
  ID.test(workspaceOrganizationId)&&ID.test(workspaceAccountId);
 const assigned=async (workspaceOrganizationId,workspaceAccountId)=>{
  try{return (await currentAssignment({workspaceOrganizationId,workspaceAccountId,appId:'dataduck'}))===true;}
  catch{return false;}
 };
 const admin=async (actorId,workspaceOrganizationId,action)=>{
  if(!ID.test(actorId)||!ID.test(workspaceOrganizationId))return false;
  try{return (await authorizeMutation({actorId,workspaceOrganizationId,action}))===true;}
  catch{return false;}
 };
 const audit=(org,account,actor,action)=>db.prepare(
  'INSERT INTO dataduck_native_link_audit(workspace_org,workspace_account,actor,action,at) VALUES(?,?,?,?,?)'
 ).run(org,account,actor,action,clock());
 return Object.freeze({
  /** Native evidence is provided ONLY to the trusted verifier, not persisted. */
  async bindVerified({actorId,workspaceOrganizationId,workspaceAccountId,
    nativeOrganizationId,nativeUserId,evidence}={}){
   if(!context(workspaceOrganizationId,workspaceAccountId)||
      !validIdentity(nativeOrganizationId)||!validIdentity(nativeUserId))fail('invalid_native_identity');
   if(!await admin(actorId,workspaceOrganizationId,'bind')||
      !await assigned(workspaceOrganizationId,workspaceAccountId))fail('access_denied');
   let verified=false;
   try{verified=(await verifyNativeOwnership({workspaceOrganizationId,
     workspaceAccountId,nativeOrganizationId,nativeUserId,evidence}))===true;}
   catch{verified=false;}
   if(!verified)fail('native_identity_unverified');
   // Authorization and native evidence are checked before the write, and
   // uniqueness constraints guard against simultaneous conflicting bindings.
   return tx(()=>{
    const owner=db.prepare('SELECT workspace_org FROM dataduck_native_organizations WHERE native_org=?').get(nativeOrganizationId);
    const target=db.prepare('SELECT native_org FROM dataduck_native_organizations WHERE workspace_org=?').get(workspaceOrganizationId);
    if((owner&&owner.workspace_org!==workspaceOrganizationId)||
       (target&&target.native_org!==nativeOrganizationId))fail('native_organization_conflict');
    const prior=db.prepare('SELECT native_org,native_user,state FROM dataduck_native_users WHERE workspace_org=? AND workspace_account=?')
     .get(workspaceOrganizationId,workspaceAccountId);
    if(prior&&(prior.native_org!==nativeOrganizationId||prior.native_user!==nativeUserId))
     fail('native_user_conflict');
    const other=db.prepare('SELECT workspace_org,workspace_account FROM dataduck_native_users WHERE native_org=? AND native_user=?').get(nativeOrganizationId,nativeUserId);
    if(other&&(other.workspace_org!==workspaceOrganizationId||other.workspace_account!==workspaceAccountId))
     fail('native_user_conflict');
    if(!target)db.prepare('INSERT INTO dataduck_native_organizations VALUES(?,?)').run(workspaceOrganizationId,nativeOrganizationId);
    const now=clock();
    if(prior)db.prepare("UPDATE dataduck_native_users SET state='active',verified_at=? WHERE workspace_org=? AND workspace_account=?")
      .run(now,workspaceOrganizationId,workspaceAccountId);
    else db.prepare("INSERT INTO dataduck_native_users VALUES(?,?,?,?,'active',?)")
      .run(workspaceOrganizationId,workspaceAccountId,nativeOrganizationId,nativeUserId,now);
    audit(workspaceOrganizationId,workspaceAccountId,actorId,prior?'reverified':'bound');
    return Object.freeze({recorded:true,reverified:Boolean(prior),licenseGranted:false,loginEnabled:false});
   });
  },
  async findCurrent({workspaceOrganizationId,workspaceAccountId}={}){
   if(!context(workspaceOrganizationId,workspaceAccountId)||
      !await assigned(workspaceOrganizationId,workspaceAccountId))return null;
   const link=db.prepare("SELECT native_org,native_user FROM dataduck_native_users WHERE workspace_org=? AND workspace_account=? AND state='active'")
    .get(workspaceOrganizationId,workspaceAccountId);
   if(!link)return null;
   return Object.freeze({appId:'dataduck',workspaceOrganizationId,workspaceAccountId,
    nativeOrganizationId:link.native_org,nativeUserId:link.native_user,
    source:'explicit_verified_native_link',licenseGranted:false,loginEnabled:false});
  },
  async revoke({actorId,workspaceOrganizationId,workspaceAccountId}={}){
   if(!context(workspaceOrganizationId,workspaceAccountId)||
      !await admin(actorId,workspaceOrganizationId,'revoke'))fail('access_denied');
   return tx(()=>{
    const result=db.prepare("UPDATE dataduck_native_users SET state='revoked' WHERE workspace_org=? AND workspace_account=? AND state='active'")
      .run(workspaceOrganizationId,workspaceAccountId);
    if(result.changes)audit(workspaceOrganizationId,workspaceAccountId,actorId,'revoked');
    return Object.freeze({revoked:Boolean(result.changes),licenseGranted:false,loginEnabled:false});
   });
  },
  close(){db.close();}
 });
}
