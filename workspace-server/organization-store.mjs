import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync,chmodSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildShadowEntitlementPlan} from './subscription-entitlement-planner.mjs';

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
    'CREATE TABLE IF NOT EXISTS organization_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,org TEXT NOT NULL REFERENCES organizations(id),actor TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,details TEXT NOT NULL CHECK(json_valid(details)),recorded_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS subscription_drafts(id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),plan TEXT NOT NULL,apps TEXT NOT NULL CHECK(json_valid(apps)),seats INTEGER NOT NULL CHECK(seats>0),status TEXT NOT NULL CHECK(status IN (\'draft\',\'canceled\')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stripe_test_checkouts(draft TEXT PRIMARY KEY REFERENCES subscription_drafts(id),org TEXT NOT NULL REFERENCES organizations(id),price TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (\'pending\',\'ready\')),session_id TEXT UNIQUE,url TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stripe_test_webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,object_id TEXT NOT NULL,created INTEGER NOT NULL,digest TEXT NOT NULL,org TEXT,draft TEXT,recorded_at INTEGER NOT NULL,CHECK((org IS NULL AND draft IS NULL) OR (org IS NOT NULL AND draft IS NOT NULL)))',
    "CREATE TABLE IF NOT EXISTS stripe_test_reconciliation_checks(draft TEXT NOT NULL REFERENCES subscription_drafts(id),org TEXT NOT NULL REFERENCES organizations(id),attempt INTEGER NOT NULL CHECK(attempt>=1),session_id TEXT NOT NULL,price TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('checking','pending','paid_test_verified','unavailable','superseded')),reason TEXT,subscription_id TEXT,invoice_id TEXT,started_at INTEGER NOT NULL,completed_at INTEGER,PRIMARY KEY(draft,attempt))",
    "CREATE TABLE IF NOT EXISTS stripe_test_subscription_bindings(subscription_id TEXT PRIMARY KEY,org TEXT NOT NULL REFERENCES organizations(id),draft TEXT NOT NULL UNIQUE REFERENCES subscription_drafts(id),created_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS stripe_test_invoice_refs(invoice_id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES stripe_test_subscription_bindings(subscription_id),org TEXT NOT NULL REFERENCES organizations(id),draft TEXT NOT NULL REFERENCES subscription_drafts(id),recorded_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS stripe_test_seat_projections(draft TEXT PRIMARY KEY REFERENCES subscription_drafts(id),org TEXT NOT NULL REFERENCES organizations(id),attempt INTEGER NOT NULL CHECK(attempt>=1),decision TEXT NOT NULL CHECK(decision IN ('candidate_paid','payment_review','cancellation_review','awaiting_payment','unavailable')),apps TEXT NOT NULL CHECK(json_valid(apps)),seats INTEGER NOT NULL CHECK(seats>0),period_end INTEGER,updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS subscription_entitlement_shadow(subscription_id TEXT PRIMARY KEY,source TEXT NOT NULL CHECK(source='stripe_test'),org TEXT NOT NULL REFERENCES organizations(id),draft TEXT NOT NULL UNIQUE REFERENCES subscription_drafts(id),revision INTEGER NOT NULL CHECK(revision>0),decision TEXT NOT NULL CHECK(decision IN ('candidate_paid','payment_review','cancellation_review','awaiting_payment','unavailable')),plan TEXT NOT NULL,apps TEXT NOT NULL CHECK(json_valid(apps)),seats INTEGER NOT NULL CHECK(seats>0),period_end INTEGER,last_paid_invoice TEXT,updated_at INTEGER NOT NULL)"
  ].join(';')+';');
  if(!db.prepare('PRAGMA table_info(members)').all().some(row=>row.name==='active')) db.exec('ALTER TABLE members ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
  if(!db.prepare('PRAGMA table_info(organization_invites)').all().some(row=>row.name==='roles')) db.exec("ALTER TABLE organization_invites ADD COLUMN roles TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(roles))");
  // Older private SQLite databases created before lifecycle diagnostics have no column.
  if(!db.prepare('PRAGMA table_info(stripe_test_reconciliation_checks)').all().some(row=>row.name==='lifecycle'))
    db.exec("ALTER TABLE stripe_test_reconciliation_checks ADD COLUMN lifecycle TEXT CHECK(lifecycle IS NULL OR json_valid(lifecycle))");

  for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))chmodSync(databasePath+suffix,0o600);
  const tx=work=>{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function requireAdmin(org,actor){
    if(!safeId(org)||!safeId(actor)||!db.prepare('SELECT 1 FROM members WHERE org=? AND account=? AND admin=1 AND active=1').get(org,actor))fail('access_denied');
  }
  // Append inside the same write transaction so rolled-back changes leave no audit event.
  const audit=(org,actor,action,subject,details={})=>db.prepare('INSERT INTO organization_audit(org,actor,action,subject,details,recorded_at) VALUES(?,?,?,?,?,?)').run(org,actor,action,subject,JSON.stringify(details),clock());
  // Test-only diagnostic freshness; Stripe's last snapshot is never a durable license.
  // A later in-flight check immediately invalidates older positive diagnostics.
  const TEST_CHECK_MAX_AGE_MS=24*60*60*1000;
  function currentPaidTestObservation(row,now){
    return row?.decision==='candidate_paid'&&row.check_state==='paid_test_verified'&&
      Number.isSafeInteger(row.attempt)&&row.attempt===row.check_attempt&&
      Number.isSafeInteger(row.check_completed_at)&&row.check_completed_at<=now&&
      now-row.check_completed_at<=TEST_CHECK_MAX_AGE_MS&&
      Number.isSafeInteger(row.period_end)&&row.period_end>Math.floor(now/1000);
  }
  const pendingSeats=(org,app)=>db.prepare("SELECT count(*) AS n FROM organization_invites WHERE org=? AND expires_at>? AND json_type(roles, '$.' || ?) IS NOT NULL").get(org,clock(),app).n;
  const roles=(org,account)=>Object.fromEntries(db.prepare('SELECT app,role FROM assignments WHERE org=? AND account=?').all(org,account).map(x=>[x.app,x.role]));
  const view=(org,row)=>({accountId:row.account,name:row.name,nickname:row.nickname,email:row.email,admin:Boolean(row.admin),active:Boolean(row.active),roles:roles(org,row.account)});
  return Object.freeze({
    setupOrganization({organizationId,name,owner}){
      if(!safeId(organizationId)||!safeText(name,200)||!owner||!safeId(owner.accountId)||!safeText(owner.name)||!safeText(owner.nickname)||!safeEmail(owner.email))fail('invalid_organization');
      return tx(()=>{
        if(db.prepare('SELECT 1 FROM organizations WHERE id=?').get(organizationId))fail('organization_exists');
        db.prepare('INSERT INTO organizations VALUES(?,?)').run(organizationId,name.trim());
        db.prepare('INSERT INTO members(org,account,name,nickname,email,admin) VALUES(?,?,?,?,?,1)').run(organizationId,owner.accountId,owner.name.trim(),owner.nickname.trim(),owner.email.trim().toLowerCase());
        for(const app of APPLICATIONS)db.prepare('INSERT INTO seats VALUES(?,?,0)').run(organizationId,app.id);
        audit(organizationId,owner.accountId,'organization.created',organizationId,{name:name.trim()});
        return {id:organizationId,name:name.trim()};
      });
    },
    auditLog(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      return db.prepare('SELECT id,actor,action,subject,details,recorded_at FROM organization_audit WHERE org=? ORDER BY id DESC LIMIT 50').all(organizationId)
        .map(row=>({id:row.id,actorId:row.actor,action:row.action,subject:row.subject,details:JSON.parse(row.details),at:row.recorded_at}));
    },
    organizationsFor(account){
      if(!safeId(account))return [];
      return db.prepare('SELECT o.id,o.name,m.admin FROM members m JOIN organizations o ON o.id=m.org WHERE m.account=? AND m.active=1 ORDER BY o.name').all(account).map(x=>({id:x.id,name:x.name,admin:Boolean(x.admin)}));
    },
    selectSessionOrganization({sessionId,accountId,organizationId}){
      if(!safeId(sessionId)||!safeId(accountId)||!safeId(organizationId))fail('access_denied');
      return tx(()=>{
        const member=db.prepare('SELECT 1 FROM members WHERE org=? AND account=? AND active=1').get(organizationId,accountId);
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
      const row=db.prepare('SELECT o.id,o.name,m.admin FROM session_organizations s JOIN organizations o ON o.id=s.org JOIN members m ON m.org=s.org AND m.account=s.account AND m.active=1 WHERE s.session_id=? AND s.account=?').get(sessionId,accountId);
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
        if(prior?.admin&&prior.active&&!member.admin&&db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1 AND active=1').get(organizationId).n===1)fail('last_organization_admin');
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
        audit(organizationId,actorId,prior?'member.updated':'member.added',member.accountId,{before:prior?{roles:previousRoles,admin:Boolean(prior.admin)}:null,after:{roles:requested,admin:member.admin}});
        return view(organizationId,db.prepare('SELECT * FROM members WHERE org=? AND account=?').get(organizationId,member.accountId));
      });
    },
    prepareTestCheckout({organizationId,actorId,draftId,price}){
      if(!safeId(draftId)||typeof price!=='string'||!/^price_[A-Za-z0-9_]{5,}$/.test(price))fail('invalid_checkout');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const draft=db.prepare("SELECT * FROM subscription_drafts WHERE id=? AND org=? AND status='draft'").get(draftId,organizationId);
        if(!draft)fail('subscription_not_found');
        const existing=db.prepare('SELECT * FROM stripe_test_checkouts WHERE draft=? AND org=?').get(draftId,organizationId);
        if(existing&&existing.price!==price)fail('checkout_price_changed');
        if(!existing){
          const now=clock();
          db.prepare("INSERT INTO stripe_test_checkouts(draft,org,price,state,created_at,updated_at) VALUES(?,?,?,'pending',?,?)").run(draftId,organizationId,price,now,now);
          audit(organizationId,actorId,'checkout.test.started',draftId,{price});
        }
        const row=existing||db.prepare('SELECT * FROM stripe_test_checkouts WHERE draft=? AND org=?').get(draftId,organizationId);
        return {draft:{id:draft.id,organizationId,plan:draft.plan,apps:JSON.parse(draft.apps),seats:draft.seats},
          price:row.price,idempotencyKey:'duckbio-test-'+draft.id,
          ...(row.state==='ready'?{checkout:{id:row.session_id,url:row.url}}:{})};
      });
    },
    completeTestCheckout({organizationId,actorId,draftId,session}){
      if(!safeId(draftId)||!session||typeof session.id!=='string'||!/^cs_test_[A-Za-z0-9_]+$/.test(session.id))fail('invalid_checkout');
      let url;try{url=new URL(session.url);}catch{fail('invalid_checkout');}
      if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)fail('invalid_checkout');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const row=db.prepare('SELECT * FROM stripe_test_checkouts WHERE draft=? AND org=?').get(draftId,organizationId);
        if(!row)fail('checkout_not_found');
        if(row.state==='ready'){
          if(row.session_id!==session.id||row.url!==url.href)fail('checkout_conflict');
          return {id:row.session_id,url:row.url,alreadySaved:true};
        }
        db.prepare("UPDATE stripe_test_checkouts SET state='ready',session_id=?,url=?,updated_at=? WHERE draft=? AND org=?").run(session.id,url.href,clock(),draftId,organizationId);
        // Signed test events can arrive before the Checkout session is saved locally.
        // Match only the exact newly persisted test session, never infer a paid invoice.
        const linked=db.prepare("UPDATE stripe_test_webhook_events SET org=?,draft=? WHERE type='checkout.session.completed' AND object_id=? AND org IS NULL AND draft IS NULL")
          .run(organizationId,draftId,session.id).changes;
        if(linked)audit(organizationId,actorId,'checkout.test.webhook.matched',draftId,{events:linked});
        audit(organizationId,actorId,'checkout.test.prepared',draftId,{sessionId:session.id});
        return {id:session.id,url:url.href,alreadySaved:false};
      });
    },
    // This internal ledger accepts ONLY metadata returned by the signature verifier.
    // The HTTP caller must verify the original raw Stripe payload before calling.
    // Recording a test event never calls applyVerifiedSeatPurchase.
    recordVerifiedStripeTestEvent(event){
      if(!event||typeof event!=='object'||Array.isArray(event)||
        typeof event.id!=='string'||!/^evt_[A-Za-z0-9_]{4,128}$/.test(event.id)||
        typeof event.type!=='string'||!/^[a-z_.]{3,120}$/.test(event.type)||
        typeof event.objectId!=='string'||event.objectId.length<1||event.objectId.length>255||
        !Number.isSafeInteger(event.created)||event.created<1||
        typeof event.digest!=='string'||!/^[a-f0-9]{64}$/.test(event.digest))fail('invalid_stripe_event');
      return tx(()=>{
        const previous=db.prepare('SELECT * FROM stripe_test_webhook_events WHERE id=?').get(event.id);
        if(previous){
          if(previous.digest!==event.digest||previous.type!==event.type||
            previous.object_id!==event.objectId||previous.created!==event.created)fail('stripe_event_conflict');
          return {recorded:false,matched:Boolean(previous.org),draftId:previous.draft??null};
        }
        // A completed Checkout session is not proof of a paid invoice; matching is observational only.
        const checkout=event.type==='checkout.session.completed'&&/^cs_test_[A-Za-z0-9_]+$/.test(event.objectId)
          ?db.prepare("SELECT org,draft FROM stripe_test_checkouts WHERE state='ready' AND session_id=?").get(event.objectId)
          :null;
        db.prepare('INSERT INTO stripe_test_webhook_events(id,type,object_id,created,digest,org,draft,recorded_at) VALUES(?,?,?,?,?,?,?,?)')
          .run(event.id,event.type,event.objectId,event.created,event.digest,checkout?.org??null,checkout?.draft??null,clock());
        return {recorded:true,matched:Boolean(checkout),draftId:checkout?.draft??null};
      });
    },
    // Return only the locally pinned test session for this organization's active admin.
    // No caller-supplied Stripe session/price may influence a reconciliation lookup.
    testReconciliationSnapshot({organizationId,actorId,draftId}){
      if(!safeId(draftId))fail('invalid_checkout');
      requireAdmin(organizationId,actorId);
      const row=db.prepare("SELECT d.id,d.plan,d.apps,d.seats,c.session_id,c.price FROM subscription_drafts d JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org WHERE d.org=? AND d.id=? AND d.status='draft' AND c.state='ready'")
        .get(organizationId,draftId);
      if(!row||!row.session_id)fail('checkout_not_found');
      return {draft:{id:row.id,organizationId,plan:row.plan,apps:JSON.parse(row.apps),seats:row.seats},
        checkout:{sessionId:row.session_id,price:row.price}};
    },
    // Persistent test-only observations: never a purchased entitlement.
    // Starting another attempt makes earlier in-flight results ineligible to overwrite the latest state.
    beginTestReconciliation({organizationId,actorId,draftId}){
      if(!safeId(draftId))fail('invalid_checkout');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const row=db.prepare("SELECT d.id,d.plan,d.apps,d.seats,c.session_id,c.price FROM subscription_drafts d JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org WHERE d.org=? AND d.id=? AND d.status='draft' AND c.state='ready'")
          .get(organizationId,draftId);
        if(!row||!row.session_id)fail('checkout_not_found');
        const last=db.prepare('SELECT MAX(attempt) AS n FROM stripe_test_reconciliation_checks WHERE draft=? AND org=?')
          .get(draftId,organizationId).n??0;
        if(last>=2147483647)fail('reconciliation_limit');
        const now=clock();
        db.prepare("UPDATE stripe_test_reconciliation_checks SET state='superseded',completed_at=? WHERE draft=? AND org=? AND state='checking'")
          .run(now,draftId,organizationId);
        const attempt=last+1;
        db.prepare("INSERT INTO stripe_test_reconciliation_checks(draft,org,attempt,session_id,price,state,started_at) VALUES(?,?,?,?,?,'checking',?)")
          .run(draftId,organizationId,attempt,row.session_id,row.price,now);
        return {attempt,snapshot:{draft:{id:row.id,organizationId,plan:row.plan,
          apps:JSON.parse(row.apps),seats:row.seats},
          checkout:{sessionId:row.session_id,price:row.price}}};
      });
    },
    finishTestReconciliation({organizationId,actorId,draftId,attempt,result}){
      if(!safeId(draftId)||!Number.isSafeInteger(attempt)||attempt<1||
        !result||typeof result!=='object'||Array.isArray(result)||
        result.licensesGranted!==false||!['pending','paid_test_verified','unavailable'].includes(result.state))
        fail('invalid_reconciliation');
      const reasons=['checkout_not_completed','payment_unpaid','subscription_not_active',
        'invoice_unavailable','invoice_not_paid'];
      if(result.state==='pending' && !reasons.includes(result.reason))fail('invalid_reconciliation');
      if(result.state==='unavailable' && (result.reason!==undefined || result.invoiceId!==undefined))
        fail('invalid_reconciliation');
      // These fields are diagnostics from the private Stripe TEST reader, never grants.
      // Store a small, schema-checked lifecycle object rather than whole remote payloads.
      let lifecycle=null;
      if(result.lifecycle!==undefined){
        const x=result.lifecycle;
        if(result.state==='unavailable'||!x||typeof x!=='object'||Array.isArray(x)||
           !['incomplete','incomplete_expired','trialing','active','past_due',
             'canceled','unpaid','paused'].includes(x.subscriptionStatus)||
           typeof x.cancelAtPeriodEnd!=='boolean'||
           (x.cancelAt!==null&&(!Number.isSafeInteger(x.cancelAt)||x.cancelAt<1))||
           (x.periodEnd!==null&&(!Number.isSafeInteger(x.periodEnd)||x.periodEnd<1))||
           (x.invoiceStatus!==null&&!['draft','open','paid','uncollectible','void'].includes(x.invoiceStatus))||
           (x.billingReason!==null&&!['subscription','subscription_create','subscription_cycle',
             'subscription_threshold','subscription_update'].includes(x.billingReason))||
           Object.keys(x).sort().join(',')!==
             ['billingReason','cancelAt','cancelAtPeriodEnd','invoiceStatus','periodEnd','subscriptionStatus'].join(','))
          fail('invalid_reconciliation');
        if(result.state==='paid_test_verified'&&(x.subscriptionStatus!=='active'||x.invoiceStatus!=='paid'))
          fail('invalid_reconciliation');
        if(result.state==='pending'&&x.subscriptionStatus!=='active'&&result.reason!=='subscription_not_active')
          fail('invalid_reconciliation');
        lifecycle=JSON.stringify(x);
      }
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const current=db.prepare('SELECT * FROM stripe_test_reconciliation_checks WHERE draft=? AND org=? ORDER BY attempt DESC LIMIT 1')
          .get(draftId,organizationId);
        if(!current||current.attempt!==attempt||current.state!=='checking')fail('reconciliation_superseded');
        const local=db.prepare("SELECT d.plan,d.apps,d.seats,c.session_id,c.price FROM subscription_drafts d JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org WHERE d.id=? AND d.org=? AND d.status='draft' AND c.state='ready'")
          .get(draftId,organizationId);
        if(!local||local.session_id!==current.session_id||local.price!==current.price)
          fail('checkout_conflict');
        let reason=null,subscriptionId=null,invoiceId=null;
        if(result.state==='pending')reason=result.reason;
        if(result.state==='paid_test_verified'){
          if(result.organizationId!==organizationId||result.draftId!==draftId||
            result.sessionId!==local.session_id||result.price!==local.price||
            result.seats!==local.seats||
            typeof result.subscriptionId!=='string'||!/^sub_[A-Za-z0-9_]{4,128}$/.test(result.subscriptionId)||
            typeof result.invoiceId!=='string'||!/^in_[A-Za-z0-9_]{4,128}$/.test(result.invoiceId))
            fail('invalid_reconciliation');
          subscriptionId=result.subscriptionId;invoiceId=result.invoiceId;
        }
        const now=clock();
        if(result.state==='paid_test_verified'){
          // One Stripe test subscription belongs to exactly one local draft and tenant.
          // Renewals may have new paid invoice IDs but must NOT add seats to a running total.
          const previousSubscription=db.prepare('SELECT org,draft FROM stripe_test_subscription_bindings WHERE subscription_id=?')
            .get(subscriptionId);
          const previousDraft=db.prepare('SELECT subscription_id FROM stripe_test_subscription_bindings WHERE draft=?')
            .get(draftId);
          if((previousSubscription&&(previousSubscription.org!==organizationId||previousSubscription.draft!==draftId))||
             (previousDraft&&previousDraft.subscription_id!==subscriptionId))
            fail('stripe_test_subscription_conflict');
          if(!previousSubscription)db.prepare('INSERT INTO stripe_test_subscription_bindings(subscription_id,org,draft,created_at) VALUES(?,?,?,?)')
            .run(subscriptionId,organizationId,draftId,now);
          const invoice=db.prepare('SELECT org,draft,subscription_id FROM stripe_test_invoice_refs WHERE invoice_id=?')
            .get(invoiceId);
          if(invoice&&(invoice.org!==organizationId||invoice.draft!==draftId||invoice.subscription_id!==subscriptionId))
            fail('stripe_test_invoice_conflict');
          if(!invoice)db.prepare('INSERT INTO stripe_test_invoice_refs(invoice_id,subscription_id,org,draft,recorded_at) VALUES(?,?,?,?,?)')
            .run(invoiceId,subscriptionId,organizationId,draftId,now);
        }
        // Projection is test-only, isolated from seats, receipts and assignments.
        // A period-expired or incomplete test payment must not become a candidate.
        const end=result.lifecycle?.periodEnd??null;
        const future=Number.isSafeInteger(end)&&end*1000>now;
        const decision=result.state==='paid_test_verified'
          ?(result.lifecycle?.subscriptionStatus==='active'&&result.lifecycle.invoiceStatus==='paid'&&future
            ?'candidate_paid':'payment_review')
          :result.state==='unavailable'?'unavailable'
          :result.lifecycle?.subscriptionStatus==='canceled'?'cancellation_review'
          :result.reason==='checkout_not_completed'||result.reason==='payment_unpaid'
             ?'awaiting_payment':'payment_review';
        db.prepare("INSERT INTO stripe_test_seat_projections(draft,org,attempt,decision,apps,seats,period_end,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(draft) DO UPDATE SET org=excluded.org,attempt=excluded.attempt,decision=excluded.decision,apps=excluded.apps,seats=excluded.seats,period_end=excluded.period_end,updated_at=excluded.updated_at")
          .run(draftId,organizationId,attempt,decision,local.apps,local.seats,end,now);
        // Separate durable subscription identity ledger, never a grant source.
        // Only a previously VERIFIED paid Stripe TEST subscription is admitted;
        // later unpaid/canceled/unavailable observations replace its state, not seats.
        const bound=db.prepare('SELECT subscription_id FROM stripe_test_subscription_bindings WHERE org=? AND draft=?')
          .get(organizationId,draftId);
        if(bound){
          const previous=db.prepare('SELECT revision FROM subscription_entitlement_shadow WHERE subscription_id=? AND org=? AND draft=?')
            .get(bound.subscription_id,organizationId,draftId);
          if(previous&&previous.revision>=attempt)fail('reconciliation_superseded');
          db.prepare("INSERT INTO subscription_entitlement_shadow(subscription_id,source,org,draft,revision,decision,plan,apps,seats,period_end,last_paid_invoice,updated_at) VALUES(?,'stripe_test',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET revision=excluded.revision,decision=excluded.decision,plan=excluded.plan,apps=excluded.apps,seats=excluded.seats,period_end=excluded.period_end,last_paid_invoice=COALESCE(excluded.last_paid_invoice,subscription_entitlement_shadow.last_paid_invoice),updated_at=excluded.updated_at")
            .run(bound.subscription_id,organizationId,draftId,attempt,decision,local.plan,local.apps,local.seats,end,invoiceId,now);
        }
        db.prepare("UPDATE stripe_test_reconciliation_checks SET state=?,reason=?,subscription_id=?,invoice_id=?,lifecycle=?,completed_at=? WHERE draft=? AND org=? AND attempt=? AND state='checking'")
          .run(result.state,reason,subscriptionId,invoiceId,lifecycle,now,draftId,organizationId,attempt);
        audit(organizationId,actorId,'checkout.test.reconciliation.observed',draftId,
          {attempt,state:result.state,...(reason?{reason}:{}),
           ...(lifecycle?{subscriptionStatus:result.lifecycle.subscriptionStatus}:{} )});
        return {state:result.state,...(reason?{reason}:{}),attempt,
          checkedAt:now,licensesGranted:false,testSeatDecision:decision,
          ...(lifecycle?{lifecycle:JSON.parse(lifecycle)}:{})};
      });
    },
    // Admin-scoped, bounded diagnostic history. Never expose internal Stripe IDs
    // or raw event payloads, and never treat prior checks as current entitlements.
    testReconciliationHistory({organizationId,actorId,draftId}){
      if(!safeId(draftId))fail('invalid_checkout');
      requireAdmin(organizationId,actorId);
      const draft=db.prepare("SELECT 1 FROM subscription_drafts d JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org WHERE d.id=? AND d.org=? AND c.state='ready'")
        .get(draftId,organizationId);
      if(!draft)fail('checkout_not_found');
      return db.prepare('SELECT attempt,state,reason,started_at,completed_at,lifecycle FROM stripe_test_reconciliation_checks WHERE draft=? AND org=? ORDER BY attempt DESC LIMIT 10')
        .all(draftId,organizationId)
        .map(x=>({attempt:x.attempt,state:x.state,reason:x.reason??null,
          startedAt:x.started_at,checkedAt:x.completed_at??null,
          lifecycle:x.lifecycle?JSON.parse(x.lifecycle):null,licensesGranted:false}));
    },
    // Aggregate hypothetical test-only capacity, never blended into live purchased seats.
    testSeatCapacity(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      const projections=db.prepare("SELECT p.decision,p.apps,p.seats,p.period_end,p.attempt,r.attempt AS check_attempt,r.state AS check_state,r.completed_at AS check_completed_at FROM stripe_test_seat_projections p JOIN subscription_drafts d ON d.id=p.draft AND d.org=p.org LEFT JOIN stripe_test_reconciliation_checks r ON r.draft=p.draft AND r.org=p.org AND r.attempt=(SELECT MAX(z.attempt) FROM stripe_test_reconciliation_checks z WHERE z.draft=p.draft AND z.org=p.org) WHERE p.org=? AND d.status='draft'")
        .all(organizationId);
      const counts=Object.fromEntries(APPLICATIONS.map(app=>[app.id,0]));
      for(const row of projections){
        if(!currentPaidTestObservation(row,clock()))continue;
        for(const app of JSON.parse(row.apps))counts[app]+=row.seats;
      }
      return {apps:APPLICATIONS.map(app=>({appId:app.id,
        candidateTestSeats:counts[app.id],licensesGranted:false})),
        testOnly:true,licensesGranted:false};
    },
    // Diagnostic only: forecast whether hypothetical TEST seats could cover current
    // assignments and pending invitations. Never modify real purchased seats.
    // Shadow plans are read-only and strictly separated from additive legacy receipts.
    // No browser method can turn these TEST candidates into purchased seats.
    testSubscriptionEntitlementPlan(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      const current=this.overview(organizationId,actorId);
      const entries=db.prepare("SELECT s.subscription_id,s.org,s.decision,s.apps,s.seats,s.revision AS attempt,s.period_end,r.attempt AS check_attempt,r.state AS check_state,r.completed_at AS check_completed_at FROM subscription_entitlement_shadow s JOIN subscription_drafts d ON d.id=s.draft AND d.org=s.org LEFT JOIN stripe_test_reconciliation_checks r ON r.draft=s.draft AND r.org=s.org AND r.attempt=(SELECT MAX(z.attempt) FROM stripe_test_reconciliation_checks z WHERE z.draft=s.draft AND z.org=s.org) WHERE s.source='stripe_test' AND s.org=? AND d.status='draft'")
        .all(organizationId)
        .map(row=>({subscriptionId:row.subscription_id,org:row.org,
          decision:row.decision==='candidate_paid'&&!currentPaidTestObservation(row,clock())
            ?'unavailable':row.decision,
          apps:JSON.parse(row.apps),seats:row.seats,attempt:row.attempt,
          periodEnd:row.period_end??null}));
      return buildShadowEntitlementPlan({organizationId,apps:current.apps.map(app=>({
        id:app.id,name:app.name,purchased:app.purchased,assigned:app.assigned,reserved:app.reserved
      })),subscriptions:entries,now:clock()});
    },
    // Block any interpretation of a partial TEST shadow plan as a complete
    // subscription inventory. Unbound ready checkouts have no proven subscription.
    testEntitlementReadiness(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      const sources=db.prepare("SELECT d.id,d.apps,c.state,s.subscription_id,s.decision,s.period_end,s.revision AS attempt,r.attempt AS check_attempt,r.state AS check_state,r.completed_at AS check_completed_at FROM subscription_drafts d JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org LEFT JOIN subscription_entitlement_shadow s ON s.draft=d.id AND s.org=d.org LEFT JOIN stripe_test_reconciliation_checks r ON r.draft=d.id AND r.org=d.org AND r.attempt=(SELECT MAX(z.attempt) FROM stripe_test_reconciliation_checks z WHERE z.draft=d.id AND z.org=d.org) WHERE d.org=? AND d.status='draft' AND c.state='ready'")
        .all(organizationId);
      const byApp=Object.fromEntries(APPLICATIONS.map(app=>[app.id,{
        appId:app.id,appName:app.name,unboundCheckouts:0,reviewRequired:0,verifiedCandidates:0}]));
      const now=Math.floor(clock()/1000);
      for(const source of sources){
        const unbound=!source.subscription_id;
        const review=!unbound&&!currentPaidTestObservation(source,clock());
        for(const app of JSON.parse(source.apps)){
          if(!byApp[app])fail('invalid_subscription');
          if(unbound)byApp[app].unboundCheckouts++;
          else if(review)byApp[app].reviewRequired++;
          else byApp[app].verifiedCandidates++;
        }
      }
      const apps=Object.values(byApp).map(row=>({...row,
        readyForManualPlanning:row.unboundCheckouts===0&&row.reviewRequired===0&&row.verifiedCandidates>0,
        licensesGranted:false}));
      return {apps,readyForManualPlanning:apps.some(row=>row.verifiedCandidates>0)&&
        apps.every(row=>row.unboundCheckouts===0&&row.reviewRequired===0),
        testOnly:true,realSeatChanges:false,licensesGranted:false};
    },
    testSeatImpact(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      const current=this.overview(organizationId,actorId);
      const capacity=this.testSeatCapacity(organizationId,actorId);
      const projected=new Map(capacity.apps.map(x=>[x.appId,x.candidateTestSeats]));
      const entries=db.prepare("SELECT p.decision,p.apps,p.period_end,p.attempt,r.attempt AS check_attempt,r.state AS check_state,r.completed_at AS check_completed_at FROM stripe_test_seat_projections p JOIN subscription_drafts d ON d.id=p.draft AND d.org=p.org LEFT JOIN stripe_test_reconciliation_checks r ON r.draft=p.draft AND r.org=p.org AND r.attempt=(SELECT MAX(z.attempt) FROM stripe_test_reconciliation_checks z WHERE z.draft=p.draft AND z.org=p.org) WHERE p.org=? AND d.status='draft'")
        .all(organizationId);
      const covered=new Set(),unknown=new Set();
      for(const entry of entries){
        for(const appId of JSON.parse(entry.apps)){
          covered.add(appId);
          if(!currentPaidTestObservation(entry,clock()))unknown.add(appId);
        }
      }
      return {apps:current.apps.map(app=>{
        const candidateTestSeats=projected.get(app.id)??0;
        const committed=app.assigned+app.reserved;
        const status=!covered.has(app.id)?'not_evaluated':
          unknown.has(app.id)?'manual_review':
          committed>candidateTestSeats?'assignment_conflict':'test_only_candidate';
        return {appId:app.id,appName:app.name,livePurchased:app.purchased,
          assigned:app.assigned,reserved:app.reserved,candidateTestSeats,status,
          hypotheticalShortfall:status==='assignment_conflict'?committed-candidateTestSeats:0,
          licensesGranted:false};
      }),testOnly:true,licensesGranted:false,realSeatChanges:false};
    },
    listSubscriptionDrafts(organizationId,actorId){
      requireAdmin(organizationId,actorId);
      return db.prepare("SELECT d.*,c.state AS checkout_state,c.url AS checkout_url,r.state AS reconciliation_state,r.reason AS reconciliation_reason,r.attempt AS reconciliation_attempt,r.completed_at AS reconciliation_checked_at,r.lifecycle AS reconciliation_lifecycle,p.attempt AS projection_attempt,p.decision AS projection_decision,p.period_end AS projection_period_end FROM subscription_drafts d LEFT JOIN stripe_test_checkouts c ON c.draft=d.id AND c.org=d.org LEFT JOIN stripe_test_reconciliation_checks r ON r.draft=d.id AND r.org=d.org AND r.attempt=(SELECT MAX(z.attempt) FROM stripe_test_reconciliation_checks z WHERE z.draft=d.id AND z.org=d.org) LEFT JOIN stripe_test_seat_projections p ON p.draft=d.id AND p.org=d.org WHERE d.org=? ORDER BY d.created_at DESC,d.id").all(organizationId)
        .map(x=>({id:x.id,plan:x.plan,apps:JSON.parse(x.apps),seats:x.seats,status:x.status,createdAt:x.created_at,updatedAt:x.updated_at,
          checkoutState:x.checkout_state??null,checkoutUrl:x.checkout_state==='ready'?x.checkout_url:null,
          testReconciliation:x.reconciliation_state?{state:x.reconciliation_state,
            reason:x.reconciliation_reason??null,attempt:x.reconciliation_attempt,
            checkedAt:x.reconciliation_checked_at??null,licensesGranted:false,
            lifecycle:x.reconciliation_lifecycle?JSON.parse(x.reconciliation_lifecycle):null}:null,
          testSeatProjection:x.projection_decision?{decision:x.projection_decision==='candidate_paid'&&!currentPaidTestObservation({
              decision:x.projection_decision,attempt:x.projection_attempt,
              period_end:x.projection_period_end,check_attempt:x.reconciliation_attempt,
              check_state:x.reconciliation_state,check_completed_at:x.reconciliation_checked_at
            },clock())?'payment_review':x.projection_decision,attempt:x.projection_attempt,
            seatsPerApp:currentPaidTestObservation({decision:x.projection_decision,
              attempt:x.projection_attempt,period_end:x.projection_period_end,
              check_attempt:x.reconciliation_attempt,check_state:x.reconciliation_state,
              check_completed_at:x.reconciliation_checked_at},clock())?x.seats:0,
            periodEnd:x.projection_period_end??null,licensesGranted:false}:null}));
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
        if(db.prepare('SELECT 1 FROM stripe_test_checkouts WHERE draft=? AND org=?').get(draftId,organizationId))fail('checkout_started');
        if(existing.status!=='canceled')db.prepare('UPDATE subscription_drafts SET status=\'canceled\',updated_at=? WHERE id=? AND org=?').run(clock(),draftId,organizationId);
        return {id:draftId,status:'canceled'};
      });
    },
    setMemberActive({organizationId,actorId,accountId,active}){
      if(!safeId(accountId)||typeof active!=='boolean')fail('invalid_member');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const row=db.prepare('SELECT admin,active FROM members WHERE org=? AND account=?').get(organizationId,accountId);
        if(!row)fail('member_not_found');
        if(Boolean(row.active)===active)return {accountId,active,changed:false};
        if(!active && row.admin && db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1 AND active=1').get(organizationId).n===1)fail('last_organization_admin');
        db.prepare('UPDATE members SET active=? WHERE org=? AND account=?').run(active?1:0,organizationId,accountId);
        audit(organizationId,actorId,active?'member.reactivated':'member.deactivated',accountId);
        // A suspended user retains the licensed seat to prevent over-allocation on reactivation.
        return {accountId,active,changed:true};
      });
    },
    removeMember({organizationId,actorId,accountId}){
      if(!safeId(accountId))fail('invalid_member');
      return tx(()=>{
        requireAdmin(organizationId,actorId);
        const row=db.prepare('SELECT admin,active FROM members WHERE org=? AND account=?').get(organizationId,accountId);
        if(!row)fail('member_not_found');
        if(row.admin && row.active && db.prepare('SELECT count(*) AS n FROM members WHERE org=? AND admin=1 AND active=1').get(organizationId).n===1)fail('last_organization_admin');
        const removedRoles=roles(organizationId,accountId);
        db.prepare('DELETE FROM members WHERE org=? AND account=?').run(organizationId,accountId);
        audit(organizationId,actorId,'member.removed',accountId,{roles:removedRoles});
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
        audit(organizationId,actorId,'invitation.issued',normalized,{roles:requested,admin,expiresAt});
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
        const normalized=email.trim().toLowerCase();
        const result=db.prepare('DELETE FROM organization_invites WHERE org=? AND email=? AND expires_at>?').run(organizationId,normalized,clock());
        if(result.changes===1)audit(organizationId,actorId,'invitation.revoked',normalized);
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
        audit(invitation.organizationId,accountId,'invitation.accepted',accountId,{roles:assignedRoles,admin:invitation.admin});
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
        audit(organizationId,actorId,'permission.updated',accountId,{appId,permission,enabled});
        return {organizationId,accountId,appId,permission,enabled};
      });
    },
    effectivePermissions({organizationId,accountId,appId}){
      if(!safeId(organizationId)||!safeId(accountId)||!byId.has(appId))return [];
      const assigned=db.prepare('SELECT a.role FROM assignments a JOIN members m ON m.org=a.org AND m.account=a.account WHERE a.org=? AND a.account=? AND a.app=? AND m.active=1').get(organizationId,accountId,appId);
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
      const grant=db.prepare('SELECT a.role FROM assignments a JOIN members m ON m.org=a.org AND m.account=a.account WHERE a.org=? AND a.account=? AND a.app=? AND m.active=1').get(organizationId,accountId,appId);
      return grant?{organizationId,accountId,appId,role:grant.role}:null;
    },
    close(){db.close();}
  });
}
