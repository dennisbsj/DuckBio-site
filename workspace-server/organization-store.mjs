import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync,chmodSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const policy=JSON.parse(readFileSync(fileURLToPath(new URL('../suite-permissions.json',import.meta.url)),'utf8'));
export const APPLICATIONS=Object.freeze([['limsman','LabDuck','LIMSMan'],['goflo','CytoDuck','GoFlo'],['methpipe','DuckPipe','MethPipe'],['eel','DuckNote','EEL'],['duckman','DuckMan','DuckMan'],['mantrain','DuckTrain','ManTrain']].map(([id,name,key])=>Object.freeze({id,name,roles:Object.freeze(Object.keys(policy.apps[key].roles))})));
const byId=new Map(APPLICATIONS.map(x=>[x.id,x]));
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
    'CREATE TABLE IF NOT EXISTS receipts(reference TEXT PRIMARY KEY,org TEXT NOT NULL,digest TEXT NOT NULL,recorded_at INTEGER NOT NULL)'
  ].join(';')+';');
  for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))chmodSync(databasePath+suffix,0o600);
  const tx=work=>{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function requireAdmin(org,actor){
    if(!safeId(org)||!safeId(actor)||!db.prepare('SELECT 1 FROM members WHERE org=? AND account=? AND admin=1').get(org,actor))fail('access_denied');
  }
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
    overview(org,actor){
      requireAdmin(org,actor);
      return {organization:db.prepare('SELECT id,name FROM organizations WHERE id=?').get(org),
        apps:APPLICATIONS.map(app=>({...app,purchased:db.prepare('SELECT purchased FROM seats WHERE org=? AND app=?').get(org,app.id)?.purchased??0,assigned:db.prepare('SELECT count(*) AS n FROM assignments WHERE org=? AND app=?').get(org,app.id).n})),
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
        if(prior?.admin&&!member.admin&&db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1').get(organizationId).n===1)fail('last_organization_admin');
        const collision=db.prepare('SELECT account FROM members WHERE org=? AND email=?').get(organizationId,email);
        if(collision&&collision.account!==member.accountId)fail('duplicate_organization_email');
        for(const app of Object.keys(requested)){
          if(db.prepare('SELECT 1 FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,member.accountId,app))continue;
          const count=db.prepare('SELECT count(*) AS n FROM assignments WHERE org=? AND app=?').get(organizationId,app).n;
          const limit=db.prepare('SELECT purchased FROM seats WHERE org=? AND app=?').get(organizationId,app)?.purchased??0;
          if(count>=limit)fail('app_seats_exhausted');
        }
        db.prepare('INSERT INTO members(org,account,name,nickname,email,admin) VALUES(?,?,?,?,?,?) ON CONFLICT(org,account) DO UPDATE SET name=excluded.name,nickname=excluded.nickname,email=excluded.email,admin=excluded.admin').run(organizationId,member.accountId,member.name.trim(),member.nickname.trim(),email,member.admin?1:0);
        for(const app of APPLICATIONS){
          if(requested[app.id])db.prepare('INSERT INTO assignments(org,account,app,role) VALUES(?,?,?,?) ON CONFLICT(org,account,app) DO UPDATE SET role=excluded.role').run(organizationId,member.accountId,app.id,requested[app.id]);
          else db.prepare('DELETE FROM assignments WHERE org=? AND account=? AND app=?').run(organizationId,member.accountId,app.id);
        }
        return view(organizationId,db.prepare('SELECT * FROM members WHERE org=? AND account=?').get(organizationId,member.accountId));
      });
    },
    accessFor({organizationId,accountId,appId}){
      if(!safeId(organizationId)||!safeId(accountId)||!byId.has(appId))return null;
      const grant=db.prepare('SELECT role FROM assignments WHERE org=? AND account=? AND app=?').get(organizationId,accountId,appId);
      return grant?{organizationId,accountId,appId,role:grant.role}:null;
    },
    close(){db.close();}
  });
}
