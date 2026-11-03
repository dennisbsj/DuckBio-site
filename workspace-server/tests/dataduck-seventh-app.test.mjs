import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPLICATIONS, createOrganizationStore } from '../organization-store.mjs';
import { createIdentityStore } from '../shared-auth/identity-store.mjs';
import { planVerifiedSubscriptionTransition } from '../verified-subscription-transition.mjs';

const SIX=['limsman','goflo','methpipe','eel','duckman','mantrain'];
const ALL=[...SIX,'dataduck'];
const purchase=(store,reference,plan,apps,seats=1,org='lab-a')=>
 store.applyVerifiedSeatPurchase({reference,organizationId:org,plan,apps,seats});
const person=(accountId,role)=>({
 accountId,name:'Synthetic researcher',nickname:'Researcher',
 email:accountId+'@example.test',admin:false,
 roles:role?{dataduck:role}:{},
});
function fixture(t){
 const dir=mkdtempSync(path.join(os.tmpdir(),'duckbio-dataduck-seven-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const databasePath=path.join(dir,'private','org.sqlite');
 const store=createOrganizationStore({databasePath,clock:()=>1800000000000});
 t.after(()=>store.close());
 store.setupOrganization({organizationId:'lab-a',name:'Synthetic Lab A',
  owner:{accountId:'admin-a',name:'Admin A',nickname:'A',email:'a@example.test'}});
 store.setupOrganization({organizationId:'lab-b',name:'Synthetic Lab B',
  owner:{accountId:'admin-b',name:'Admin B',nickname:'B',email:'b@example.test'}});
 return {store,dir,databasePath};
}
const appsFor=(s,org='lab-a',admin='admin-a')=>s.overview(org,admin).apps;
const entitlements=apps=>apps.map(appId=>({appId,purchased:0,assigned:0,reserved:0}));
const future=()=>1900000000;

test('DataDuck is the seventh independent app with private, server-enforced native role permissions',()=>{
 assert.deepEqual(APPLICATIONS.map(app=>app.id),ALL);
 const duck=APPLICATIONS.at(-1);
 assert.equal(duck.name,'DataDuck');
 assert.deepEqual(duck.roles,['Analyst','Reviewer','ReadOnly','Admin']);
 assert.equal(duck.rolePermissions.Admin[0],'*');
 assert(duck.rolePermissions.Analyst.includes('dataset.derive'));
 assert(duck.rolePermissions.Analyst.includes('figure.create'));
 assert(!duck.rolePermissions.Reviewer.includes('project.delete'));
 assert(!duck.rolePermissions.ReadOnly.includes('dataset.import'));
 assert(!duck.permissions.includes('*'));
});

test('Single can license just DataDuck; a seat is scoped to one org and one account',t=>{
 const {store}=fixture(t);
 assert.equal(appsFor(store).length,7);
 assert.equal(appsFor(store).find(app=>app.id==='dataduck').purchased,0);
 assert.throws(()=>store.saveMember({organizationId:'lab-a',actorId:'admin-a',
  member:person('scientist','Analyst')}),/app_seats_exhausted/);
 assert.equal(purchase(store,'first-data-seat','Single',['dataduck'],1).applied,true);
 assert.equal(appsFor(store).find(app=>app.id==='dataduck').purchased,1);
 assert.equal(appsFor(store,'lab-b','admin-b').find(app=>app.id==='dataduck').purchased,0);
 const created=store.saveMember({organizationId:'lab-a',actorId:'admin-a',
  member:person('scientist','Analyst')});
 assert.equal(created.roles.dataduck,'Analyst');
 assert.equal(store.accessFor({organizationId:'lab-a',accountId:'scientist',appId:'dataduck'}).role,'Analyst');
 assert.equal(store.accessFor({organizationId:'lab-b',accountId:'scientist',appId:'dataduck'}),null);
 assert.throws(()=>store.saveMember({organizationId:'lab-a',actorId:'admin-a',
  member:person('other','Reviewer')}),/app_seats_exhausted/);
 assert.throws(()=>store.saveMember({organizationId:'lab-b',actorId:'admin-b',
  member:person('scientist','Analyst')}),/app_seats_exhausted/);
 assert.equal(store.accessFor({organizationId:'lab-a',accountId:'admin-a',appId:'dataduck'}),null,
  'Organization administrator is not implicitly a paid DataDuck user');
});

test('DataDuck roles and per-permission overrides can be edited without affecting other app access',t=>{
 const {store}=fixture(t);
 purchase(store,'seat','Single',['dataduck'],1);
 store.saveMember({organizationId:'lab-a',actorId:'admin-a',member:person('scientist','Analyst')});
 assert(store.effectivePermissions({organizationId:'lab-a',accountId:'scientist',appId:'dataduck'}).includes('dataset.import'));
 store.setPermission({organizationId:'lab-a',actorId:'admin-a',
  accountId:'scientist',appId:'dataduck',permission:'dataset.import',enabled:false});
 assert(!store.effectivePermissions({organizationId:'lab-a',accountId:'scientist',appId:'dataduck'}).includes('dataset.import'));
 assert.deepEqual(store.effectivePermissions({organizationId:'lab-a',accountId:'scientist',appId:'goflo'}),[]);
 store.saveMember({organizationId:'lab-a',actorId:'admin-a',member:person('scientist','ReadOnly')});
 assert(!store.effectivePermissions({organizationId:'lab-a',accountId:'scientist',appId:'dataduck'}).includes('dataset.import'));
 assert.equal(store.accessFor({organizationId:'lab-a',accountId:'scientist',appId:'dataduck'}).role,'ReadOnly');
 assert.throws(()=>store.saveMember({organizationId:'lab-a',actorId:'admin-a',
  member:person('scientist','imaginary-role')}),/invalid_roles/);
});

test('Mixed allows six selectable apps including DataDuck; Bundle requires all seven',t=>{
 const {store}=fixture(t);
 const mixed=[...SIX.slice(0,5),'dataduck'];
 const m=store.createSubscriptionDraft({organizationId:'lab-a',actorId:'admin-a',
  plan:'Mixed',apps:mixed,seats:4});
 assert.equal(m.apps.length,6);
 assert(m.apps.includes('dataduck'));
 assert.throws(()=>store.createSubscriptionDraft({organizationId:'lab-a',actorId:'admin-a',
  plan:'Mixed',apps:ALL,seats:1}),/invalid_subscription/);
 assert.throws(()=>store.createSubscriptionDraft({organizationId:'lab-a',actorId:'admin-a',
  plan:'Bundle',apps:SIX,seats:1}),/invalid_subscription/);
 const bundle=store.createSubscriptionDraft({organizationId:'lab-a',actorId:'admin-a',
  plan:'Bundle',apps:ALL,seats:2});
 assert.deepEqual(bundle.apps,[...ALL].sort());
 assert.equal(purchase(store,'mixed-test','Mixed',mixed,2).applied,true);
 assert.equal(appsFor(store).find(a=>a.id==='dataduck').purchased,2);
 assert.equal(purchase(store,'bundle-test','Bundle',ALL,3).applied,true);
 assert.equal(appsFor(store).find(a=>a.id==='dataduck').purchased,5);
 assert.throws(()=>purchase(store,'invalid-legacy-new','Bundle',SIX),/invalid_purchase/);
 assert.equal(appsFor(store,'lab-b','admin-b').every(a=>a.purchased===0),true);
});

test('existing six-app organizations gain only an unpaid DataDuck seat row on migration',t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'duckbio-seventh-backfill-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const databasePath=path.join(dir,'org.sqlite');
 const old=new DatabaseSync(databasePath);
 old.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL);
  CREATE TABLE seats(org TEXT NOT NULL REFERENCES organizations(id),
    app TEXT NOT NULL,purchased INTEGER NOT NULL DEFAULT 0 CHECK(purchased>=0),
    PRIMARY KEY(org,app));
  INSERT INTO organizations VALUES('legacy','Six app lab');`);
 for(const [index,app] of SIX.entries())old.prepare('INSERT INTO seats VALUES(?,?,?)').run('legacy',app,index+1);
 old.close();
 const store=createOrganizationStore({databasePath});
 t.after(()=>store.close());
 const current=new DatabaseSync(databasePath);
 t.after(()=>current.close());
 const seats=current.prepare('SELECT app,purchased FROM seats WHERE org=? ORDER BY app').all('legacy');
 assert.equal(seats.length,7);
 assert.equal(seats.find(x=>x.app==='dataduck').purchased,0);
 for(const [i,app] of SIX.entries())assert.equal(seats.find(x=>x.app===app).purchased,i+1);
 store.close();
 // Reopening twice never resets any of the prior six purchased seats.
 const reopened=createOrganizationStore({databasePath});
 t.after(()=>reopened.close());
 assert.equal(current.prepare('SELECT COUNT(*) AS n FROM seats WHERE org=? AND app=?').get('legacy','dataduck').n,1);
});

test('historical six-app paid Bundle renewals can be planned, but NEW six-app Bundle purchases cannot',()=>{
 const existing={organizationId:'legacy',subscriptionId:'legacy-sub',plan:'Bundle',
  apps:SIX,seats:2,revision:1,status:'active',paidThrough:future()};
 const knownApps=entitlements(ALL).map(x=>({
  ...x,purchased:SIX.includes(x.appId)?2:0,
 }));
 const renewal=planVerifiedSubscriptionTransition({
  organizationId:'legacy',subscriptionId:'legacy-sub',knownApps,existing,
  next:{...existing,revision:2,paidThrough:future()+30*24*3600},now:1800000000000,
 });
 assert.equal(renewal.allowed,true);
 assert.equal(renewal.changes.find(x=>x.appId==='dataduck').delta,0);
 assert.equal(renewal.nextApps.length,6);
 const upgrade=planVerifiedSubscriptionTransition({
  organizationId:'legacy',subscriptionId:'legacy-sub',knownApps,existing,
  next:{...existing,revision:2,apps:ALL},now:1800000000000,
 });
 assert.equal(upgrade.allowed,true);
 assert.equal(upgrade.changes.find(x=>x.appId==='dataduck').delta,2);
 assert.throws(()=>planVerifiedSubscriptionTransition({
  organizationId:'brand-new',subscriptionId:'new-sub',knownApps:entitlements(ALL),
  next:{...existing,revision:1,apps:SIX},now:1800000000000,
 }),/invalid_subscription_transition/);
});

test('legacy six-app receipt replays are idempotent without granting DataDuck seats',t=>{
 const {store,databasePath}=fixture(t);
 const selection=[...SIX].sort();
 const digest=createHash('sha256')
  .update(JSON.stringify(['lab-a','Bundle',selection,2])).digest('hex');
 const connection=new DatabaseSync(databasePath);
 connection.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run('historical-receipt','lab-a',digest,1800000000000);
 connection.close();
 assert.deepEqual(purchase(store,'historical-receipt','Bundle',SIX,2),{applied:false});
 assert.equal(appsFor(store).find(x=>x.id==='dataduck').purchased,0);
 assert.throws(()=>purchase(store,'historical-receipt','Bundle',SIX,3),/purchase_reference_conflict/);
 assert.throws(()=>purchase(store,'new-receipt','Bundle',SIX,2),/invalid_purchase/);
});

test('central identity store accepts a DataDuck native mapping but does not grant access without assignment',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'duckbio-data-native-id-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const identity=createIdentityStore({databasePath:path.join(dir,'identity.sqlite')});
 t.after(()=>identity.close());
 const user=await identity.createUser({
  email:'dataduck-identity@example.test',displayName:'DataDuck synthetic tester',
  password:'Synthetic only passphrase 12345',
 });
 const id=randomUUID(),org=randomUUID();
 const grant=identity.grantAppAccess({userId:user.id,appId:'dataduck',
  localUserId:id,organizationId:org});
 assert.equal(grant.appId,'dataduck');
 assert.equal(grant.localUserId,id);
 const look=identity.getAppAccess(user.id,'dataduck');
 assert.equal(look.localUserId,id);
 assert.equal(look.organizationId,org);
 assert.equal(identity.getAppAccess(user.id,'goflo'),null);
});
