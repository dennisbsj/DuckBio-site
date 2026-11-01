import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync,chmodSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const policy=JSON.parse(readFileSync(fileURLToPath(new URL('../suite-permissions.json',import.meta.url)),'utf8'));
export const APPLICATIONS=Object.freeze([['limsman','LabDuck','LIMSMan'],['goflo','CytoDuck','GoFlo'],['methpipe','DuckPipe','MethPipe'],['eel','DuckNote','EEL'],['duckman','DuckMan','DuckMan'],['mantrain','DuckTrain','ManTrain']].map(([id,name,key])=>Object.freeze({id,name,roles:Object.freeze(Object.keys(policy.apps[key].roles)),rolePermissions:Object.freeze(policy.apps[key].roles),permissions:Object.freeze([...new Set(Object.values(policy.apps[key].roles).flat().filter(p=>p!=='*'))].sort())})));
const byId=new Map(APPLICATIONS.map(x=>[x.id,x]));
const inviteHash=x=>createHash('sha256').update(x).digest('hex');
const safeToken=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const safeId=x=>typeof x==='string'&&/^[\w.:-]{1,128}$/.test(x);
const safeText=(x,max=120)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
const safeEmail=x=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
export class OrganizationError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new OrganizationError(code);};
function privatePath(file){
  if(!path.isAbsolute(file))fail('private_path_required');
  const invalid=segments=>segments.split(path.sep).some(s=>['docs','public_html','site-preview','.github'].includes(s.toLowerCase()));
  if(invalid(file))fail('private_path_required');
  let ancestor=path.dirname(file);
  while(!existsSync(ancestor)&&path.dirname(ancestor)!==ancestor)ancestor=path.dirname(ancestor);
  if(invalid(realpathSync(ancestor)))fail('private_path_required');
}
function validRoles(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_roles');
  for(const [app,role] of Object.entries(value))if(!byId.get(app)?.roles.includes(role))fail('invalid_roles');
  return value;
}
export function createOrganizationStore({databasePath,clock=Date.now}){
  privatePath(databasePath);
  mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});
  const db=new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  db.exec([
    'CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS members(org TEXT NOT NULL REFERENCES organizations(id),account TEXT NOT NULL,name TEXT NOT NULL,nickname TEXT NOT NULL,email TEXT NOT NULL,admin INTEGER NOT NULL CHECK(admin IN (0,1)),PRIMARY KEY(org,account),UNIQUE(org,email))',
    'CREATE TABLE IF NOT EXISTS seats(org TEXT NOT NULL REFERENCES organizations(id),app TEXT NOT NULL,purchased INTEGER NOT NULL DEFAULT 0 CHECK(purchased>=0),PRIMARY KEY(org,app))',
    'CREATE TABLE IF NOT EXISTS assignments(org TEXT NOT NULL,account TEXT NOT NULL,app TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(org,account,app),FOREIGN KEY(org,account) REFERENCES members(org,account) ON DELETE CASCADE)',
    'CREATE TABLE IF NOT EXISTS receipts(reference TEXT PRIMARY KEY,org TEXT NOT NULL,digest TEXT NOT NULL,recorded_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS session_organizations(session_id TEXT PRIMARY KEY,account TEXT NOT NULL,org TEXT NOT NULL,selected_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS permission_overrides(org TEXT NOT NULL,account TEXT NOT NULL,app TEXT NOT NULL,permission TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),PRIMARY KEY(org,account,app,permission),FOREIGN KEY(org,account,app) REFERENCES assignments(org,account,app) ON DELETE CASCADE)',
    'CREATE TABLE IF NOT EXISTS organization_invites(token_hash TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),issued_by TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,nickname TEXT NOT NULL,admin INTEGER NOT NULL CHECK(admin IN (0,1)),expires_at INTEGER NOT NULL,UNIQUE(org,email))',
    'CREATE TABLE IF NOT EXISTS subscription_drafts(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),plan TEXT NOT NULL,apps TEXT NOT NULL CHECK(json_valid(apps)),seats INTEGER NOT NULL CHECK(seats>0),status TEXT NOT NULL CHECK(status IN (\'draft\',\'canceled\')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)'
  ].join(';')+';');
  if(!db.prepare('PRAGMA table_info(organization_invites)').all().some(row=>row.name==='roles')) db.exec("ALTER TABLE organization_invites ADD COLUMN roles TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(roles))");
  for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))chmodSync(databasePath+suffix,0o600);
  const tx=work=>{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function requireAdmin(org,actor){
    if(!safeId(org)||!safeId(actor)||!db.prepare('SELECT 1 FROM members WHERE org=? AND account=? AND admin=1').get(org,actor))fail('access_denied');
  }
  const pendingSeats=(org,app)=>db.prepare("SELECT count(*) AS n FROM organization_invites WHERE org=? AND expires_at>? AND json_type(roles, '$.' || ?) IS NOT NULL").get(org,clock(),app).n;
  const roles=(org,account)=>Object.fromEntries(db.prepare('SELECT app,role FROM assignments WHERE org=? AND account=?').all(org,account).map(x=>[x.app,x.role]));
  const view=(org,row)=>({accountId:row.account,name:row.name,nickname:row.nickname,email:row.email,admin:Boolean(row.admin),roles:roles(org,row.account)});
  return Object.freeze({
    setupOrganization({organizationId,name,owner}){
      if(!safeId(organizationId)||!safeText(name,200)||!owner||!safeId(owner.accountId)||!safeText(owner.name)||!safeText(owner.nickname)||!safeEmail(owner.email))fail('invalid_organization');
      return tx(()=>{
        if(db.prepare('SELECT 1 FROM organizations WHERE id=?').get(organizationId))fail('organization_exists');
        db.prepare('INSERT INTO organizations VALUES(?,?)').run(organizationId,name.trim());
        db.prepare('INSERT INTO members VALUES(?,?,?,?,?,1)').run(organizationId,owner.accountId,owner.name.trim(),owner.nickname.trim(),owner.email.trim().toLowerCase());
        for(const app of APPLICATIONS)db.prepare('INSERT INTO seats VALUES(?,?,0)').run(organizationId,app.id);
        return {id:organizationId,name:name.trim()};
      });
    },
    organizationsFor(account){
      if(!safeId(account))return [];
      return db.prepare('SELECT o.id,o.name,m.admin FROM members m JOIN organizations o ON o.id=m.org WHERE m.account=? ORDER BY o.name').all(account).map(x=>({id:x.id,name:x.name,admin:Boolean(x.admin)}));
    },
    selectSessionOrganization({sessionId,accountId,organizationId}){
      if(!safeId(sessionId)||!safeId(accountId)||!safeId(organizationId))fail('access_denied');
      return tx(()=>{
        const member=db.prepare('SELECT 1 FROM members WHERE org=? AND account=?').get(organizationId,accountId);
        if(!member)fail('access_denied');
        const selected=db.prepare('SELECT account,org FROM session_organizations WHERE session_id=?').get(sessionId);
        if(selected){
          if(selected.account!==accountId||selected.org!==organizationId)fail('organization_locked');
          return {organizationId,alreadySelected:true};
        }
        db.prepare('INSERT INTO session_organizations(session_id,account,org,selected_at) VALUES(?,?,?,?)').run(sessionId,accountId,organizationId,clock());
        return {organizationId,alreadySelected:false};
      });
    },
    currentSessionOrganization({sessionId,accountId}){
      if(!safeId(sessionId)||!safeId(accountId))return null;
      const row=db.prepare('SELECT o.id,o.name,m.admin FROM session_organizations s JOIN organizations o ON o.id=s.org JOIN members m ON m.org=s.org AND m.account=s.account WHERE s.session_id=? AND s.account=?').get(sessionId,accountId);
      return row?{id:row.id,name:row.name,admin:Boolean(row.admin)}:null;
    },
    clearSessionOrganization(sessionId){
      if(safeId(sessionId))db.prepare('DELETE FROM session_organizations WHERE session_id=?').run(sessionId);
    },
    overview(org,actor){
      requireAdmin(org,actor);
      return {organization:db.prepare('SELECT id,name FROM organizations WHERE id=?').get(org),
        apps:APPLICATIONS.map(app=>({...app,purchased:db.prepare('SELECT purchased FROM seats WHERE org=? AND app=?').get(org,app.id)?.purchased??0,assigned:db.prepare('SELECT count(*) AS n FROM assignments WHERE org=? AND app=?').get(org,app.id).n,reserved:pendingSeats(org,app.id)})),
        users:db.prepare('SELECT * FROM members WHERE org=? ORDER BY name,account').all(org).map(row=>view(org,row))};
    },
    // Only call from a separate VERIFIED billing adapter. No browser purchase endpoint exists.
    applyVerifiedSeatPurchase({reference,organizationId,plan,apps,seats}){
      if(!safeId(reference)||!safeId(organizationId)||!['Single','Mixed','Bundle'].includes(plan)||!Array.isArray(apps)||!Number.isSafeInteger(seats)||seats<1||seats>10000||new Set(apps).size!==apps.length||apps.some(x=>!byId.has(x)))fail('invalid_purchase');
      if((plan==='Single'&&apps.length!==1)||(plan==='Mixed'&&(apps.length<2||apps.length>5))||(plan==='Bundle'&&apps.length!==6))fail('invalid_purchase');
      const selection=[...apps].sort();
      const digest=createHash('sha256').update(JSON.stringify([organizationId,plan,selection,seats])).digest('hex');
      return tx(()=>{
        if(!db.prepare('SELECT 1 FROM organizations WHERE id=?').get(organizationId))fail('organization_not_found');
        const old=db.prepare('SELECT digest FROM receipts WHERE reference=?').get(reference);
        if(old){if(old.digest!==digest)fail('purchase_reference_conflict');return {applied:false};}
        db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(reference,organizationId,digest,clock());
        for(const app of selection)db.prepare('UPDATE seats SET purchased=purchased+? WHERE org=? AND app=?').run(seats,organizationId,app);
        return {applied:true,apps:selection,seats};
      });
    },
    saveMember({organizationId,actorId,member}){
      if(!member||!safeId(member.accountId)||!safeText(member.name)||!safeText(member.nickname)||!safeEmail(member.email)||typeof member.admin!=='boolean')fail('invalid_member');
      const requested=validRoles(member.roles),email=member.email.trim().toLowerCase();
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const prior=db.prepare('SELECT * FROM members WHERE org=? AND account=?').get(organizationId,member.accountId);
        const previousRoles=prior?roles(organizationId,member.accountId):{};
        if(prior?.admin&&!member.admin&&db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1').get(organizationId).n===1)fail('last_organization_admin');
        const collision=db.prepare('SELECT account FROM members WHERE org=? AND email=?').get(organizationId,email);
        if(collision&&collision.account!==member.accountId)fail('duplicate_organization_email');
        for(const app of Object.keys(requested)){
          if(db.prepare('SELECT 1 FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,member.accountId,app))continue;
          const count=db.prepare('SELECT count(*) AS n FROM assignments WHERE org=? AND app=?').get(organizationId,app).n;
          const limit=db.prepare('SELECT purchased FROM seats WHERE org=? AND app=?').get(organizationId,app)?.purchased??0;
          if(count+pendingSeats(organizationId,app)>=limit)fail('app_seats_exhausted');
        }
        db.prepare('INSERT INTO members(org,account,name,nickname,email,admin) VALUES(?,?,?,?,?,?) ON CONFLICT(org,account) DO UPDATE SET name=excluded.name,nickname=excluded.nickname,email=excluded.email,admin=excluded.admin').run(organizationId,member.accountId,member.name.trim(),member.nickname.trim(),email,member.admin?1:0);
        for(const app of APPLICATIONS){
          if(previousRoles[app.id] && requested[app.id] && previousRoles[app.id]!==requested[app.id])
            db.prepare('DELETE FROM permission_overrides WHERE org=? AND account=? AND app=?').run(organizationId,member.accountId,app.id);
          if(requested[app.id])db.prepare('INSERT INTO assignments(org,account,app,role) VALUES(?,?,?,?) ON CONFLICT(org,account,app) DO UPDATE SET role=excluded.role').run(organizationId,member.accountId,app.id,requested[app.id]);
          else db.prepare('DELETE FROM assignments WHERE org=? AND account=? AND app=?').run(organizationId,member.accountId,app.id);
        }
        return view(organizationId,db.prepare('SELECT * FROM members WHERE org=? AND account=?').get(organizationId,member.accountId));
      });
    },
    listSubscriptionDrafts(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      return db.prepare('SELECT * FROM subscription_drafts WHERE org=? ORDER BY created_at DESC,id').all(organizationId)
        .map(x=>({id:x.id,plan:x.plan,apps:JSON.parse(x.apps),seats:x.seats,status:x.status,createdAt:x.created_at,updatedAt:x.updated_at}));
    },
    createSubscriptionDraft({organizationId,actorId,plan,apps,seats}){
      if(!['Single','Mixed','Bundle'].includes(plan)||!Array.isArray(apps)||!Number.isSafeInteger(seats)||seats<1||seats>10000||new Set(apps).size!==apps.length||apps.some(id=>!byId.has(id)))fail('invalid_subscription');
      if((plan==='Single'&&apps.length!==1)||(plan==='Mixed'&&(apps.length<2||apps.length>5))||(plan==='Bundle'&&apps.length!==APPLICATIONS.length))fail('invalid_subscription');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const id=randomUUID(),now=clock(),selected=[...apps].sort();
        db.prepare('INSERT INTO subscription_drafts VALUES(?,?,?,?,?,?,?,?)').run(id,organizationId,plan,JSON.stringify(selected),seats,'draft',now,now);
        return {id,plan,apps:selected,seats,status:'draft',createdAt:now,updatedAt:now};
      });
    },
    cancelSubscriptionDraft({organizationId,actorId,draftId}){
      if(!safeId(draftId))fail('invalid_subscription');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const existing=db.prepare('SELECT status FROM subscription_drafts WHERE id=? AND org=?').get(draftId,organizationId);
        if(!existing)fail('subscription_not_found');
        if(existing.status!=='canceled')db.prepare('UPDATE subscription_drafts SET status=\'canceled\',updated_at=? WHERE id=? AND org=?').run(clock(),draftId,organizationId);
        return {id:draftId,status:'canceled'};
      });
    },
    removeMember({organizationId,actorId,accountId}){
      if(!safeId(accountId))fail('invalid_member');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const row=db.prepare('SELECT admin FROM members WHERE org=? AND account=?').get(organizationId,accountId);
        if(!row)fail('member_not_found');
        if(row.admin && db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1').get(organizationId).n===1)fail('last_organization_admin');
        db.prepare('DELETE FROM members WHERE org=? AND account=?').run(organizationId,accountId);
        return {removed:true,accountId};
      });
    },
    issueInvitation({organizationId,actorId,email,name,nickname,admin=false,roles={}}){
      if(!safeEmail(email)||!safeText(name)||!safeText(nickname)||typeof admin!=='boolean')fail('invalid_invitation');
      const normalized=email.trim().toLowerCase(),requested=validRoles(roles);
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        if(db.prepare('SELECT 1 FROM members WHERE org=? AND email=?').get(organizationId,normalized))fail('member_exists');
        db.prepare('DELETE FROM organization_invites WHERE expires_at<=?').run(clock());
        if(db.prepare('SELECT 1 FROM organization_invites WHERE org=? AND email=?').get(organizationId,normalized))fail('invitation_exists');
        for(const app of Object.keys(requested)){
          const count=db.prepare('SELECT count(*) AS n FROM assignments WHERE org=? AND app=?').get(organizationId,app).n;
          const limit=db.prepare('SELECT purchased FROM seats WHERE org=? AND app=?').get(organizationId,app)?.purchased??0;
          if(count+pendingSeats(organizationId,app)>=limit)fail('app_seats_exhausted');
        }
        const token=randomBytes(32).toString('base64url'),expiresAt=clock()+7*24*60*60*1000;
        db.prepare('INSERT INTO organization_invites(token_hash,org,issued_by,email,name,nickname,admin,expires_at,roles) VALUES(?,?,?,?,?,?,?,?,?)').run(inviteHash(token),organizationId,actorId,normalized,name.trim(),nickname.trim(),admin?1:0,expiresAt,JSON.stringify(requested));
        return {token,expiresAt};
      });
    },
    listPendingInvitations(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      return db.prepare('SELECT email,name,nickname,admin,expires_at,roles FROM organization_invites WHERE org=? AND expires_at>? ORDER BY email').all(organizationId,clock())
        .map(row=>({email:row.email,name:row.name,nickname:row.nickname,admin:Boolean(row.admin),expiresAt:row.expires_at,roles:JSON.parse(row.roles)}));
    },
    revokeInvitation({organizationId,actorId,email}){
      if(!safeEmail(email))fail('invalid_invitation');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const result=db.prepare('DELETE FROM organization_invites WHERE org=? AND email=? AND expires_at>?').run(organizationId,email.trim().toLowerCase(),clock());
        return {revoked:result.changes===1};
      });
    },
    previewInvitation(token){
      if(!safeToken(token))return null;
      const row=db.prepare('SELECT i.*,o.name AS organization_name FROM organization_invites i JOIN organizations o ON o.id=i.org JOIN members m ON m.org=i.org AND m.account=i.issued_by AND m.admin=1 WHERE i.token_hash=? AND i.expires_at>?').get(inviteHash(token),clock());
      return row?{organizationId:row.org,organizationName:row.organization_name,email:row.email,name:row.name,nickname:row.nickname,admin:Boolean(row.admin),expiresAt:row.expires_at,roles:JSON.parse(row.roles)}:null;
    },
    acceptInvitation({token,accountId,email}){
      if(!safeToken(token)||!safeId(accountId)||!safeEmail(email))fail('invalid_invitation');
      return tx(()=>{
        const invitation=this.previewInvitation(token);
        if(!invitation||invitation.email!==email.trim().toLowerCase())fail('invalid_invitation');
        if(db.prepare('SELECT 1 FROM members WHERE org=? AND account=?').get(invitation.organizationId,accountId))fail('member_exists');
        if(db.prepare('SELECT 1 FROM members WHERE org=? AND email=?').get(invitation.organizationId,invitation.email))fail('member_exists');
        const removed=db.prepare('DELETE FROM organization_invites WHERE token_hash=? AND expires_at>? RETURNING token_hash').get(inviteHash(token),clock());
        if(!removed)fail('invalid_invitation');
        const assignedRoles=validRoles(invitation.roles);
        db.prepare('INSERT INTO members(org,account,name,nickname,email,admin) VALUES(?,?,?,?,?,?)').run(invitation.organizationId,accountId,invitation.name,invitation.nickname,invitation.email,invitation.admin?1:0);
        for(const [app,role] of Object.entries(assignedRoles))
          db.prepare('INSERT INTO assignments(org,account,app,role) VALUES(?,?,?,?)').run(invitation.organizationId,accountId,app,role);
        return {organizationId:invitation.organizationId,accountId,admin:invitation.admin,roles:assignedRoles};
      });
    },
    matrix(organizationId,actorId){
      const result=this.overview(organizationId,actorId);
      result.users=result.users.map(user=>({
        ...user,
        overrides:Object.fromEntries(APPLICATIONS.map(app=>[app.id,
          Object.fromEntries(db.prepare('SELECT permission,enabled FROM permission_overrides WHERE org=? AND account=? AND app=? ORDER BY permission').all(organizationId,user.accountId,app.id).map(x=>[x.permission,Boolean(x.enabled)]))
        ]))
      }));
      return result;
    },
    setPermission({organizationId,actorId,accountId,appId,permission,enabled}){
      if(!safeId(accountId)||!byId.has(appId)||!byId.get(appId).permissions.includes(permission)||typeof enabled!=='boolean')fail('invalid_permission');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const assigned=db.prepare('SELECT role FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,accountId,appId);
        if(!assigned)fail('app_access_required');
        const allowed=byId.get(appId).rolePermissions[assigned.role]||[];
        const baseline=allowed.includes('*')||allowed.includes(permission);
        if(enabled===baseline)db.prepare('DELETE FROM permission_overrides WHERE org=? AND account=? AND app=? AND permission=?').run(organizationId,accountId,appId,permission);
        else db.prepare('INSERT INTO permission_overrides(org,account,app,permission,enabled) VALUES(?,?,?,?,?) ON CONFLICT(org,account,app,permission) DO UPDATE SET enabled=excluded.enabled').run(organizationId,accountId,appId,permission,enabled?1:0);
        return {organizationId,accountId,appId,permission,enabled};
      });
    },
    effectivePermissions({organizationId,accountId,appId}){
      if(!safeId(organizationId)||!safeId(accountId)||!byId.has(appId))return [];
      const assigned=db.prepare('SELECT role FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,accountId,appId);
      if(!assigned)return [];
      const app=byId.get(appId),base=app.rolePermissions[assigned.role]||[];
      const allowed=new Set(base.includes('*')?app.permissions:base);
      for(const row of db.prepare('SELECT permission,enabled FROM permission_overrides WHERE org=? AND account=? AND app=?').all(organizationId,accountId,appId)) {
        if(row.enabled)allowed.add(row.permission);else allowed.delete(row.permission);
      }
      return [...allowed].sort();
    },
    accessFor({organizationId,accountId,appId}){
      if(!safeId(organizationId)||!safeId(accountId)||!byId.has(appId))return null;
      const grant=db.prepare('SELECT role FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,accountId,appId);
      return grant?{organizationId,accountId,appId,role:grant.role}:null;
    },
    close(){db.close();}
  });
}
