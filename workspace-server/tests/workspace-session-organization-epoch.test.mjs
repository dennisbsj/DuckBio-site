/** Security regression: session-organization clear/reselect ABA during native await.
 * Synthetic private Workspace/SQLite only. Never a grant or live service test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {createOrganizationStore} from '../organization-store.mjs';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createWorkspaceNativeAccessInspector} from '../workspace-native-access-inspector.mjs';

const NOW=1800000000000;
const ACCOUNT='416d57fa-ac77-4b4e-a0ed-34fb44161111';
const NATIVE_USER='416d57fa-ac77-4b4e-a0ed-34fb44161112';
const NATIVE_ORG='416d57fa-ac77-4b4e-a0ed-34fb44161113';

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-session-epoch-'));
 const organizationPath=path.join(root,'private','org.sqlite');
 const identity=createIdentityStore({databasePath:path.join(root,'private','identity.sqlite'),
  clock:()=>NOW,orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}});
 const organization=createOrganizationStore({databasePath:organizationPath,
  clock:()=>NOW,verifyLiveSubscriptionEvidence:x=>x});
 t.after(()=>{identity.close();organization.close();rmSync(root,{recursive:true,force:true})});
 const user=await identity.createUser({id:ACCOUNT,email:'session-epoch@example.test',
  displayName:'Session user',password:'synthetic-private-only-password'});
 organization.setupOrganization({organizationId:'alpha',name:'Alpha lab',
  owner:{accountId:user.id,name:'Session user',nickname:'Tester',
   email:'session-epoch@example.test'}});
 organization.applyVerifiedSubscriptionTransition({eventKey:'session-epoch-live-synthetic',
  source:'stripe_live',organizationId:'alpha',subscriptionId:'sub-session-epoch',
  revision:1,plan:'Single',apps:['goflo'],seats:2,status:'active',paidThrough:1900000000});
 organization.saveMember({organizationId:'alpha',actorId:user.id,
  member:{accountId:user.id,name:'Session user',nickname:'Tester',
   email:'session-epoch@example.test',admin:true,roles:{goflo:'Analyst'}}});
 const session=identity.createSession(user.id).parent;
 organization.selectSessionOrganization({sessionId:session.id,accountId:user.id,organizationId:'alpha'});
 await identity.bindVerifiedOrganizationNativeLink({actorId:user.id,userId:user.id,appId:'goflo',
  workspaceOrganizationId:'alpha',nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG});
 const request={sessionId:session.id,organizationId:'alpha',appId:'goflo',permission:'workspace.view'};
 const selected=()=>organization.currentSessionOrganization({sessionId:session.id,accountId:user.id});
 const inspector=verifyNativeMapping=>createWorkspaceNativeAccessInspector({
  identityStore:identity,organizationStore:organization,clock:()=>NOW,
  verifyNativeMapping:verifyNativeMapping??(async()=>true)});
 const reselect=()=>organization.selectSessionOrganization({
  sessionId:session.id,accountId:user.id,organizationId:'alpha'});
 return {root,organizationPath,organization,identity,user,session,request,selected,inspector,reselect};
}

test('idempotent selection retains version; clear and same-tenant reselect advance it despite an unchanged clock',async t=>{
 const f=await fixture(t);
 assert.equal(f.selected().sessionSelectionRevision,1);
 assert.equal(f.reselect().alreadySelected,true);
 assert.equal(f.selected().sessionSelectionRevision,1);
 const before=await f.inspector().inspect(f.request);
 assert.equal(before.candidateReady,true);
 assert.equal(before.accessGranted,false);
 assert.equal(before.licensesGranted,false);
 f.organization.clearSessionOrganization(f.session.id);
 assert.equal(f.selected(),null);
 assert.equal(f.reselect().alreadySelected,false);
 assert.equal(f.selected().sessionSelectionRevision,3);
 assert.equal(f.reselect().alreadySelected,true);
 assert.equal(f.selected().sessionSelectionRevision,3);
 const after=await f.inspector().inspect(f.request);
 assert.equal(after.candidateReady,true);
 assert.equal(after.accessGranted,false);
 assert.equal(after.loginEnabled,false);
});

test('clear + reselect of the SAME session, account and organization during native await fails closed (ABA)',async t=>{
 const f=await fixture(t),before=f.selected();
 const check=f.inspector(async()=>{
  f.organization.clearSessionOrganization(f.session.id);
  assert.equal(f.selected(),null);
  f.reselect();
  assert.equal(f.selected().id,before.id);
  assert.equal(f.selected().sessionSelectionRevision,before.sessionSelectionRevision+2);
  return true;
 });
 const decision=await check.inspect(f.request);
 assert.equal(decision.reason,'access_changed_during_verification');
 assert.equal(decision.candidateReady,false);
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.licensesGranted,false);
 assert.equal(decision.loginEnabled,false);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,true);
});

test('clear without reselect in native verifier denies; reselect never resurrects an older candidate',async t=>{
 const f=await fixture(t);
 const check=f.inspector(async()=>{f.organization.clearSessionOrganization(f.session.id);return true;});
 const decision=await check.inspect(f.request);
 assert.equal(decision.candidateReady,false);
 assert.equal(decision.accessGranted,false);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,false);
 f.reselect();
 assert.equal(f.selected().sessionSelectionRevision,3);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,true);
});

test('missing or tampered persisted session epoch never yields a native preflight candidate',async t=>{
 const f=await fixture(t);
 const db=new DatabaseSync(f.organizationPath);
 try{db.prepare('DELETE FROM session_organization_versions WHERE session_id=?').run(f.session.id);}
 finally{db.close();}
 assert.equal(f.selected(),null);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,false);
 assert.throws(()=>f.organization.clearSessionOrganization(f.session.id),/session_revision_unavailable/);
});

test('a legacy selected session is migrated once and subsequent clear/reselect cannot reset its version',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-legacy-epoch-'));
 const file=path.join(root,'private','org.sqlite');
 const cfg={databasePath:file,clock:()=>NOW};
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 let store=createOrganizationStore(cfg);
 const account='legacy-user';
 try{
  store.setupOrganization({organizationId:'legacy-lab',name:'Legacy Lab',
   owner:{accountId:account,name:'Legacy User',nickname:'Legacy',
    email:'legacy@example.test'}});
  store.selectSessionOrganization({sessionId:'legacy-session',accountId:account,organizationId:'legacy-lab'});
 }finally{store.close();}
 const db=new DatabaseSync(file);
 try{
  // Simulate a *genuine pre-epoch* database, NOT a destructive restore of
  // a migrated database. Legacy SQLite has no version table or header marker.
  db.exec('DROP TABLE session_organization_versions; PRAGMA user_version=0');
 }finally{db.close();}
 store=createOrganizationStore(cfg);
 try{
  const current=()=>store.currentSessionOrganization({sessionId:'legacy-session',accountId:account});
  assert.equal(current().sessionSelectionRevision,1);
  store.clearSessionOrganization('legacy-session');
  assert.equal(current(),null);
  store.selectSessionOrganization({sessionId:'legacy-session',accountId:account,organizationId:'legacy-lab'});
  assert.equal(current().sessionSelectionRevision,3);
 }finally{store.close();}
 const check=new DatabaseSync(file);
 try{
  // A damaged existing epoch table must NOT be silently repaired on restart.
  check.prepare('DELETE FROM session_organization_versions WHERE session_id=?').run('legacy-session');
 }finally{check.close();}
 store=createOrganizationStore(cfg);
 try{
  assert.equal(store.currentSessionOrganization({sessionId:'legacy-session',accountId:account}),null);
 }finally{store.close();}
});

test('epoch overflow refuses the mutation without clearing a live selection',async t=>{
 const f=await fixture(t),db=new DatabaseSync(f.organizationPath);
 try{db.prepare('UPDATE session_organization_versions SET revision=? WHERE session_id=?')
  .run(Number.MAX_SAFE_INTEGER,f.session.id);}
 finally{db.close();}
 assert.equal(f.selected().sessionSelectionRevision,Number.MAX_SAFE_INTEGER);
 assert.throws(()=>f.organization.clearSessionOrganization(f.session.id));
 assert.equal(f.selected().id,'alpha');
 assert.equal(f.selected().sessionSelectionRevision,Number.MAX_SAFE_INTEGER);
});


test('separate organization-store connection detects same-tenant ABA across SQLite handles',async t=>{
 const f=await fixture(t);
 const peer=createOrganizationStore({databasePath:f.organizationPath,
  clock:()=>NOW,verifyLiveSubscriptionEvidence:x=>x});
 t.after(()=>peer.close());
 const previous=f.selected().sessionSelectionRevision;
 const inspector=f.inspector(async()=>{
  peer.clearSessionOrganization(f.session.id);
  assert.equal(f.selected(),null); // The primary connection sees committed peer writes.
  peer.selectSessionOrganization({sessionId:f.session.id,
   accountId:f.user.id,organizationId:'alpha'});
  assert.equal(f.selected().sessionSelectionRevision,previous+2);
  return true;
 });
 const result=await inspector.inspect(f.request);
 assert.equal(result.reason,'access_changed_during_verification');
 assert.equal(result.candidateReady,false);
 assert.equal(result.accessGranted,false);
 assert.equal((await f.inspector().inspect(f.request)).candidateReady,true);
});

test('reopening the same SQLite store does not reseed a cleared session tombstone',async t=>{
 const f=await fixture(t);
 f.organization.clearSessionOrganization(f.session.id);
 const afterClear=new DatabaseSync(f.organizationPath,{readOnly:true});
 try{
  assert.equal(afterClear.prepare('SELECT revision FROM session_organization_versions WHERE session_id=?')
   .get(f.session.id)?.revision,2);
 }finally{afterClear.close();}
 const reopened=createOrganizationStore({databasePath:f.organizationPath,
  clock:()=>NOW,verifyLiveSubscriptionEvidence:x=>x});
 t.after(()=>reopened.close());
 assert.equal(reopened.currentSessionOrganization({
  sessionId:f.session.id,accountId:f.user.id}),null);
 reopened.selectSessionOrganization({sessionId:f.session.id,
  accountId:f.user.id,organizationId:'alpha'});
 assert.equal(f.selected().sessionSelectionRevision,3);
 // Reopening once more must not reset or duplicate migration rows.
 const third=createOrganizationStore({databasePath:f.organizationPath,
  clock:()=>NOW,verifyLiveSubscriptionEvidence:x=>x});
 t.after(()=>third.close());
 assert.equal(third.currentSessionOrganization({
  sessionId:f.session.id,accountId:f.user.id})?.sessionSelectionRevision,3);
 third.clearSessionOrganization(f.session.id);
 third.clearSessionOrganization(f.session.id); // idempotent no-op
 const check=new DatabaseSync(f.organizationPath,{readOnly:true});
 try{
  assert.equal(check.prepare('SELECT revision FROM session_organization_versions WHERE session_id=?')
   .get(f.session.id)?.revision,4);
 }finally{check.close();}
});

test('selection epoch is isolated to the session, not to every session of the same account',async t=>{
 const f=await fixture(t);
 const other=f.identity.createSession(f.user.id).parent;
 f.organization.selectSessionOrganization({sessionId:other.id,
  accountId:f.user.id,organizationId:'alpha'});
 const peerRequest={...f.request,sessionId:other.id};
 assert.equal(f.organization.currentSessionOrganization({
  sessionId:other.id,accountId:f.user.id})?.sessionSelectionRevision,1);
 f.organization.clearSessionOrganization(f.session.id);
 f.reselect();
 assert.equal(f.selected().sessionSelectionRevision,3);
 assert.equal(f.organization.currentSessionOrganization({
  sessionId:other.id,accountId:f.user.id})?.sessionSelectionRevision,1);
 const otherDecision=await f.inspector().inspect(peerRequest);
 assert.equal(otherDecision.candidateReady,true);
 assert.equal(otherDecision.accessGranted,false);
 assert.equal(otherDecision.licensesGranted,false);
});


test('dropping a migrated session generation table cannot reseed a prior selection after restart',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-session-table-loss-'));
 const file=path.join(root,'private','org.sqlite');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const config={databasePath:file,clock:()=>NOW};
 let store=createOrganizationStore(config);
 try{
  store.setupOrganization({organizationId:'alpha',name:'Alpha lab',
   owner:{accountId:'alice',name:'Alice',nickname:'A',email:'alice@example.test'}});
  store.selectSessionOrganization({sessionId:'session-1',accountId:'alice',organizationId:'alpha'});
  store.clearSessionOrganization('session-1');
  store.selectSessionOrganization({sessionId:'session-1',accountId:'alice',organizationId:'alpha'});
  assert.equal(store.currentSessionOrganization({sessionId:'session-1',accountId:'alice'})
   .sessionSelectionRevision,3);
 }finally{store.close();}
 const db=new DatabaseSync(file);
 try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  db.exec('DROP TABLE session_organization_versions');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
 }finally{db.close();}
 assert.throws(()=>createOrganizationStore(config),/session_revision_unavailable/,
  'reopening after tombstone-table loss must never seed old sessions at generation 1');
 const read=new DatabaseSync(file,{readOnly:true});
 try{
  assert.equal(read.prepare("SELECT COUNT(*) AS n FROM session_organizations").get().n,1,
   'preexisting selected organization is still present but must not be trusted');
  assert.equal(read.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='session_organization_versions'").get().n,0,
   'failed migration must not recreate the missing generation table');
  assert.equal(read.prepare('PRAGMA user_version').get().user_version,1);
 }finally{read.close();}
});

test('SQLite schema header marker commits with first-session generations and persists on reopen',async t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-session-header-'));
 const file=path.join(root,'private','org.sqlite');
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const config={databasePath:file,clock:()=>NOW};
 let first=createOrganizationStore(config);
 try{
  first.setupOrganization({organizationId:'alpha',name:'Alpha lab',
   owner:{accountId:'alice',name:'Alice',nickname:'A',email:'alice@example.test'}});
  first.selectSessionOrganization({sessionId:'session-1',accountId:'alice',organizationId:'alpha'});
 }finally{first.close();}
 let db=new DatabaseSync(file,{readOnly:true});
 try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(db.prepare('SELECT revision FROM session_organization_versions WHERE session_id=?')
   .get('session-1').revision,1);
 }finally{db.close();}
 const reopened=createOrganizationStore(config);
 try{
  reopened.clearSessionOrganization('session-1');
  reopened.selectSessionOrganization({sessionId:'session-1',accountId:'alice',organizationId:'alpha'});
  assert.equal(reopened.currentSessionOrganization({sessionId:'session-1',accountId:'alice'})
   .sessionSelectionRevision,3);
 }finally{reopened.close();}
 db=new DatabaseSync(file,{readOnly:true});
 try{
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(db.prepare('SELECT revision FROM session_organization_versions WHERE session_id=?')
   .get('session-1').revision,3);
 }finally{db.close();}
});
