/** Synchronous multi-query native access candidate must use a stable audit epoch.
 * All provider evidence, app IDs and SQLite databases are synthetic/private.
 * No SSO, paid seats, native process or permissions are enabled by this test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';

const NOW=1800000000000;
const PAID_THROUGH=1900000000;
const REQ=Object.freeze({
 organizationId:'alpha',accountId:'alice',appId:'goflo',permission:'workspace.view'
});

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-native-candidate-read-barrier-'));
 const databasePath=join(dir,'organizations.sqlite');
 let duringRead=null,reads=0;
 const clock=()=>{
  if(duringRead&&reads++===0){
   const change=duringRead;
   duringRead=null; // A second connection can commit while the first reads.
   change();
  }
  return NOW;
 };
 const store=createOrganizationStore({databasePath,clock,
  verifyLiveSubscriptionEvidence:evidence=>evidence});
 const peer=createOrganizationStore({databasePath,clock:()=>NOW,
  verifyLiveSubscriptionEvidence:evidence=>evidence});
 t.after(()=>{store.close();peer.close();rmSync(dir,{recursive:true,force:true})});
 for(const org of ['alpha','beta']){
  store.setupOrganization({
   organizationId:org,name:'Lab '+org,
   owner:{accountId:'owner-'+org,name:'Owner',nickname:'Owner',
    email:'owner-'+org+'@example.test'}
  });
 }
 store.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-verified-billing-alpha',
  organizationId:'alpha',subscriptionId:'synthetic-paid-alpha',revision:1,
  plan:'Single',apps:['goflo'],seats:2,status:'active',
  paidThrough:PAID_THROUGH
 });
 store.saveMember({organizationId:'alpha',actorId:'owner-alpha',
  member:{accountId:'alice',name:'Alice',nickname:'Alice',
   email:'alice@example.test',admin:false,roles:{goflo:'Analyst'}}
 });
 const candidate=()=>store.verifiedNativePermissionCandidate(REQ);
 return {store,peer,candidate,mutateDuringRead:fn=>{reads=0;duringRead=fn}};
}

test('a stable candidate is diagnostic-only with a valid verified-live backing term',t=>{
 const f=fixture(t);
 const result=f.candidate();
 assert(result);
 assert.equal(result.role,'Analyst');
 assert(Number.isSafeInteger(result.authorizationAuditRevision));
 assert.equal(result.verifiedPaidThroughMs,PAID_THROUGH*1000);
 assert.equal(result.nativeEnforcementRequired,true);
 assert.equal(result.accessGranted,false);
 assert.equal(result.licensesGranted,false);
});

test('revoke and regrant on another SQLite connection during ONE candidate read denies (policy ABA)',t=>{
 const f=fixture(t);
 const initial=f.candidate();
 assert(initial);
 f.mutateDuringRead(()=>{
  f.peer.setPermission({organizationId:'alpha',actorId:'owner-alpha',
   accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:false});
  f.peer.setPermission({organizationId:'alpha',actorId:'owner-alpha',
   accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:true});
 });
 assert.equal(f.candidate(),null,'same final permission must not hide changed audit epoch');
 const fresh=f.candidate();
 assert(fresh);
 assert(fresh.authorizationAuditRevision>initial.authorizationAuditRevision);
 assert.equal(fresh.accessGranted,false);
 assert.equal(fresh.licensesGranted,false);
});

test('a concurrent same-org audit invalidates the multi-query read, but another tenant audit does not',t=>{
 const f=fixture(t);
 const original=f.candidate();
 assert(original);
 const permissions=f.store.listRoles({
  organizationId:'alpha',actorId:'owner-alpha',appId:'goflo'
 }).roles.find(r=>r.name==='Analyst').permissions;
 f.mutateDuringRead(()=>f.peer.saveRole({
  organizationId:'alpha',actorId:'owner-alpha',appId:'goflo',
  role:'Analyst',permissions
 }));
 assert.equal(f.candidate(),null,'a same-tenant policy epoch change must deny');
 const next=f.candidate();
 assert(next);
 assert(next.authorizationAuditRevision>original.authorizationAuditRevision);
 const betaPermissions=f.store.listRoles({
  organizationId:'beta',actorId:'owner-beta',appId:'goflo'
 }).roles.find(r=>r.name==='Analyst').permissions;
 f.mutateDuringRead(()=>f.peer.saveRole({
  organizationId:'beta',actorId:'owner-beta',appId:'goflo',
  role:'Analyst',permissions:betaPermissions
 }));
 const unaffected=f.candidate();
 assert(unaffected,'a different tenant audit cannot revoke alpha');
 assert.equal(unaffected.authorizationAuditRevision,next.authorizationAuditRevision);
 assert.equal(unaffected.accessGranted,false);
});

test('legacy unverified purchased capacity remains insufficient regardless of audit checks',t=>{
 const f=fixture(t);
 f.peer.setPermission({organizationId:'alpha',actorId:'owner-alpha',
  accountId:'alice',appId:'goflo',permission:'workspace.view',enabled:true});
 assert.equal(f.store.verifiedNativePermissionCandidate({...REQ,appId:'dataduck'}),null);
 assert.equal(f.store.verifiedNativePermissionCandidate({...REQ,permission:'*'}),null);
 assert.equal(f.store.verifiedNativePermissionCandidate({...REQ,organizationId:'beta'}),null);
});
