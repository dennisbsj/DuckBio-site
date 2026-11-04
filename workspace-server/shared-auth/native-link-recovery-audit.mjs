/**
 * PRIVATE, OFFLINE, READ-ONLY dual-SQLite native identity recovery auditor.
 *
 * Opens two separately created, quiescent *.snapshot.sqlite copies; never
 * opens a production store, mounts a route, grants a session, or edits data.
 * A result with zero structural findings is NOT a restore/SSO approval:
 * native identity ownership, paid LIVE evidence, tenant permissions and
 * native resource authorization must all be revalidated independently.
 */
import {createHash} from 'node:crypto';
import {lstatSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const SIX=new Set(['limsman','eel','methpipe','mantrain','duckman','goflo']);
const MAX_LINKS=5000;
const REQUIRED_IDENTITY=[
 'suite_identity_users','suite_identity_org_native_links',
 'suite_identity_org_native_audit'
];
const REQUIRED_ORG=[
 'organizations','members','assignments','seats',
 'organization_invites','verified_subscription_allocations',
 'organization_audit','native_provisioning_session_epochs'
];
const stamp=fields=>createHash('sha256').update(JSON.stringify(fields))
 .digest('hex').slice(0,20);

function privateSnapshotFile(input){
 if(typeof input!=='string'||!path.isAbsolute(input)||
    !input.endsWith('.snapshot.sqlite'))throw Error('offline_snapshot_file_required');
 let info,canonical;
 try{
  info=lstatSync(input);
  if(!info.isFile()||info.isSymbolicLink()||
     (info.mode & 0o077)!==0)
   throw Error('private_snapshot_file_required');
  canonical=realpathSync(input);
  if(canonical!==path.resolve(input)||
     !statSync(canonical).isFile())
   throw Error('private_snapshot_file_required');
 }catch{throw Error('private_snapshot_file_required');}
 return canonical;
}
function verifySchema(db,names){
 const found=new Set(db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table'"
 ).all().map(row=>row.name));
 if(names.some(name=>!found.has(name)))throw Error('snapshot_schema_incomplete');
 if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||
    db.prepare('PRAGMA foreign_key_check').all().length)
  throw Error('snapshot_integrity_invalid');
}
function maxAudit(db,table){
 const result=db.prepare('SELECT MAX(id) AS id FROM '+table).get()?.id;
 return result===null?0:Number.isSafeInteger(result)&&result>=0?result:null;
}

/**
 * Input paths MUST reference already independently produced SQLite VACUUM INTO
 * snapshots, chmod 0600, with no active writers. The audit does not snapshot,
 * copy, repair, delete or trust external native/Stripe services.
 *
 * @returns a private, non-authorizing inventory report. No names or emails.
 */
export function auditNativeScopedRecoverySnapshots({
 identitySnapshotPath,organizationSnapshotPath,now=Date.now()
}={}){
 if(!Number.isSafeInteger(now)||now<=0)
  throw Error('valid_audit_clock_required');
 const identityPath=privateSnapshotFile(identitySnapshotPath);
 const organizationPath=privateSnapshotFile(organizationSnapshotPath);
 if(identityPath===organizationPath)
  throw Error('distinct_snapshot_files_required');
 let identity,organization;
 try{
  identity=new DatabaseSync(identityPath,{readOnly:true});
  organization=new DatabaseSync(organizationPath,{readOnly:true});
  identity.exec('PRAGMA query_only=ON');
  organization.exec('PRAGMA query_only=ON');
  verifySchema(identity,REQUIRED_IDENTITY);
  verifySchema(organization,REQUIRED_ORG);
  const total=identity.prepare(
   'SELECT COUNT(*) AS n FROM suite_identity_org_native_links'
  ).get().n;
  if(!Number.isSafeInteger(total)||total<0||total>MAX_LINKS)
   throw Error('snapshot_inventory_limit_exceeded');
  const cursor={
   identityAudit:maxAudit(identity,'suite_identity_org_native_audit'),
   organizationAudit:maxAudit(organization,'organization_audit'),
   sessionEpoch:maxAudit(organization,'native_provisioning_session_epochs')
  };
  if(Object.values(cursor).some(id=>id===null))
   throw Error('snapshot_audit_cursor_invalid');

  const links=identity.prepare(`
   SELECT l.user_id,l.app_id,l.workspace_org_id,l.native_user_id,
    l.native_org_id,l.verified_at,u.state,
    (SELECT a.id FROM suite_identity_org_native_audit a
     WHERE a.user_id=l.user_id AND a.app_id=l.app_id
       AND a.workspace_org_id=l.workspace_org_id
     ORDER BY a.id DESC LIMIT 1) last_audit_id,
    (SELECT a.action FROM suite_identity_org_native_audit a
     WHERE a.user_id=l.user_id AND a.app_id=l.app_id
       AND a.workspace_org_id=l.workspace_org_id
     ORDER BY a.id DESC LIMIT 1) last_action
   FROM suite_identity_org_native_links l
   LEFT JOIN suite_identity_users u ON u.id=l.user_id
   ORDER BY l.app_id,l.workspace_org_id,l.user_id
  `).all();
  const inspectMember=organization.prepare(`
   SELECT m.active,a.role FROM members m
   LEFT JOIN assignments a ON a.org=m.org AND a.account=m.account
     AND a.app=?
   WHERE m.org=? AND m.account=?
  `);
  const inspectOrg=organization.prepare(
   'SELECT 1 FROM organizations WHERE id=?'
  );
  const inspectSeat=organization.prepare(
   'SELECT purchased FROM seats WHERE org=? AND app=?'
  );
  const countAssigned=organization.prepare(
   'SELECT COUNT(*) AS n FROM assignments WHERE org=? AND app=?'
  );
  const pending=organization.prepare(`
   SELECT COUNT(*) AS n FROM organization_invites
   WHERE org=? AND expires_at>? AND json_type(roles, '$.' || ?) IS NOT NULL
  `);
  const paid=organization.prepare(`
   SELECT seats FROM verified_subscription_allocations
   WHERE org=? AND source='stripe_live' AND state='active'
     AND paid_through>? AND EXISTS (
       SELECT 1 FROM json_each(apps) WHERE value=?
     )
  `);
  const findings=links.map(row=>{
   const reasons=[];
   if(!SIX.has(row.app_id))reasons.push('unknown_or_unreleased_app');
   if(row.state!=='active')reasons.push('identity_missing_or_disabled');
   if(!Number.isSafeInteger(row.last_audit_id)||
      row.last_audit_id<=0||
      !['link.bound','link.migrated'].includes(row.last_action))
    reasons.push('canonical_link_audit_missing_or_revoked');
   if(!inspectOrg.get(row.workspace_org_id))
    reasons.push('workspace_organization_missing');
   const member=inspectMember.get(
    row.app_id,row.workspace_org_id,row.user_id
   );
   if(!member||member.active!==1)
    reasons.push('workspace_membership_missing_or_disabled');
   if(!member?.role)reasons.push('workspace_app_assignment_missing');
   if(member?.role){
    const requested=inspectSeat.get(row.workspace_org_id,row.app_id)?.purchased??0;
    const assigned=countAssigned.get(row.workspace_org_id,row.app_id).n;
    const reserved=pending.get(
     row.workspace_org_id,now,row.app_id
    ).n;
    const covered=paid.all(
     row.workspace_org_id,Math.floor(now/1000),row.app_id
    ).reduce((sum,value)=>sum+value.seats,0);
    if(!Number.isSafeInteger(assigned+reserved)||
       requested<assigned+reserved)
     reasons.push('allocated_seats_insufficient');
    if(!Number.isSafeInteger(covered)||
       covered<assigned+reserved)
     reasons.push('snapshot_verified_paid_term_insufficient');
   }
   return Object.freeze({
    linkFingerprint:stamp([
     row.user_id,row.app_id,row.workspace_org_id
    ]),appId:row.app_id,
    reasons:Object.freeze(reasons)
   });
  });
  const broken=findings.filter(link=>link.reasons.length>0);
  return Object.freeze({
   mode:'offline_read_only_snapshot_diagnostic',
   structurallyConsistent:broken.length===0,
   snapshotIntegrityVerified:true,
   scopedLinksExamined:total,
   structuralFindings:broken.length,
   legacyUnscopedGrantsIgnored:identity.prepare(
    'SELECT COUNT(*) AS n FROM suite_identity_grants'
   ).get()?.n??0,
   auditCursors:Object.freeze(cursor),
   findings:Object.freeze(broken),
   // No offline snapshot can prove live native ownership, verified LIVE
   // billing, resource ACL or a coherent crash recovery across databases.
   accessGranted:false,licensesGranted:false,
   loginEnabled:false,recoveryApproved:false,
   requiresNativeOwnershipReverification:true,
   requiresFreshLiveBillingReconciliation:true,
   requiresCoordinatedRestoreReview:true
  });
 }finally{
  try{identity?.close();}finally{organization?.close();}
 }
}
