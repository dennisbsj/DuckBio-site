import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {createOrganizationStore,APPLICATIONS} from '../organization-store.mjs';
function fixture(t){
 const directory=mkdtempSync(path.join(os.tmpdir(),'duckbio-org-'));
 const dbPath=path.join(directory,'private','org.sqlite');
 const store=createOrganizationStore({databasePath:dbPath,clock:()=>1000});
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 store.setupOrganization({organizationId:'one',name:'Lab A',owner:{accountId:'admin1',name:'Admin A',nickname:'A',email:'ADMIN@EXAMPLE.TEST'}});
 return {store,dbPath};
}
const member=(accountId,roles={},extra={})=>({accountId,name:'Scientist',nickname:'Sci',email:accountId+'@example.test',admin:false,roles,...extra});
const buy=(store,reference,plan,apps,seats=1,organizationId='one')=>store.applyVerifiedSeatPurchase({reference,organizationId,plan,apps,seats});
test('canonical list has exactly six apps and per-app role catalogs',()=>{
 assert.deepEqual(APPLICATIONS.map(x=>x.name),['LabDuck','CytoDuck','DuckPipe','DuckNote','DuckMan','DuckTrain']);
 assert(APPLICATIONS.find(x=>x.id==='eel').roles.includes('scientist'));assert(APPLICATIONS.find(x=>x.id==='limsman').roles.includes('QC'));
});
test('DataDuck seventh app is visible as an unlicensed candidate, never a paid seat or role',t=>{
 const {store}=fixture(t);
 const view=store.overview('one','admin1');
 assert.equal(view.apps.length,6,'legacy six app licenses are unchanged');
 assert.deepEqual(view.upcomingApps,[{
  id:'dataduck',name:'DataDuck',status:'unreleased-integration-candidate',
  licensingAvailable:false,nativeRoles:['Admin','Analyst','Reviewer','ReadOnly']
 }]);
 assert.equal(view.apps.some(x=>x.id==='dataduck'),false);
 assert.throws(()=>buy(store,'evt-data','Single',['dataduck']),/invalid_purchase/);
 assert.throws(()=>store.createSubscriptionDraft({
  organizationId:'one',actorId:'admin1',plan:'Single',apps:['dataduck'],seats:1
 }),/invalid_subscription/);
 assert.throws(()=>store.saveMember({
  organizationId:'one',actorId:'admin1',member:member('scientist',{dataduck:'Analyst'})
 }),/invalid_roles/);
 assert.equal(store.accessFor({organizationId:'one',accountId:'admin1',appId:'dataduck'}),null);
});
test('verified Single Mixed Bundle seat events are idempotent',t=>{
 const {store}=fixture(t);
 assert.deepEqual(store.overview('one','admin1').apps.map(x=>x.purchased),[0,0,0,0,0,0]);
 assert.equal(buy(store,'evt1','Single',['eel'],2).applied,true);
 assert.equal(buy(store,'evt1','Single',['eel'],2).applied,false);
 assert.throws(()=>buy(store,'evt1','Single',['eel'],1),/purchase_reference_conflict/);
 assert.throws(()=>buy(store,'wrong','Single',['eel','goflo']),/invalid_purchase/);
 assert.throws(()=>buy(store,'wrong2','Bundle',['eel']),/invalid_purchase/);
 buy(store,'evt2','Mixed',['goflo','mantrain'],1);
 buy(store,'evt3','Bundle',APPLICATIONS.map(a=>a.id),1);
 assert.equal(store.overview('one','admin1').apps.find(a=>a.id==='eel').purchased,3);
 assert.equal(store.overview('one','admin1').apps.find(a=>a.id==='duckman').purchased,1);
});
test('per-app capacity, role changes and atomic failures',t=>{
 const {store}=fixture(t);
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{eel:'scientist'})}),/app_seats_exhausted/);
 buy(store,'evt','Single',['eel']);
 assert.equal(store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{eel:'scientist'})}).roles.eel,'scientist');
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('other',{eel:'scientist'})}),/app_seats_exhausted/);
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('other',{eel:'fake'})}),/invalid_roles/);
 assert.equal(store.overview('one','admin1').users.length,2);
 assert.equal(store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{eel:'reviewer'})}).roles.eel,'reviewer');
 assert.equal(store.accessFor({organizationId:'one',accountId:'person',appId:'eel'}).role,'reviewer');
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{})});
 assert.equal(store.accessFor({organizationId:'one',accountId:'person',appId:'eel'}),null);
 assert.equal(store.saveMember({organizationId:'one',actorId:'admin1',member:member('other',{eel:'scientist'})}).roles.eel,'scientist');
});
test('organization isolation and last admin invariants',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Lab B',owner:{accountId:'admin2',name:'Admin B',nickname:'B',email:'admin2@example.test'}});
 assert.throws(()=>store.overview('one','admin2'),/access_denied/);
 assert.throws(()=>store.saveMember({organizationId:'two',actorId:'admin1',member:member('nope',{})}),/access_denied/);
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('admin1',{}, {name:'Admin A',nickname:'A',email:'admin@example.test',admin:false})}),/last_organization_admin/);
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('newadmin',{}, {admin:true})});
 store.saveMember({organizationId:'one',actorId:'newadmin',member:member('admin1',{}, {name:'Admin A',nickname:'A',email:'admin@example.test',admin:false})});
 assert.equal(store.overview('one','newadmin').users.filter(x=>x.admin).length,1);
 assert.equal(store.organizationsFor('admin2')[0].id,'two');
});
test('same account in separate organizations has independent roles and seats',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Lab B',owner:{accountId:'admin2',name:'Admin B',nickname:'B',email:'admin2@example.test'}});
 buy(store,'evt-one','Single',['goflo']);
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('scientist',{goflo:'Analyst'})});
 assert.throws(()=>store.saveMember({organizationId:'two',actorId:'admin2',member:member('scientist',{goflo:'Reviewer'})}),/app_seats_exhausted/);
 buy(store,'evt-two','Single',['goflo'],1,'two');
 store.saveMember({organizationId:'two',actorId:'admin2',member:member('scientist',{goflo:'Reviewer'})});
 assert.equal(store.accessFor({organizationId:'one',accountId:'scientist',appId:'goflo'}).role,'Analyst');
 assert.equal(store.accessFor({organizationId:'two',accountId:'scientist',appId:'goflo'}).role,'Reviewer');
});
test('private SQLite root and file permissions',t=>{
 const {dbPath}=fixture(t);assert.equal(statSync(dbPath).mode&0o077,0);
 assert.throws(()=>createOrganizationStore({databasePath:'relative.sqlite'}),/private_path_required/);
 assert.throws(()=>createOrganizationStore({databasePath:path.resolve('docs/private.sqlite')}),/private_path_required/);
});

test('permission toggles are tenant scoped, persisted and removed when the app role changes',t=>{
 const {store}=fixture(t);
 buy(store,'permission-seat','Single',['eel']);
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('scientist',{eel:'scientist'})});
 const original=store.effectivePermissions({organizationId:'one',accountId:'scientist',appId:'eel'});
 assert(original.includes('document.edit'));
 assert(!original.includes('document.review'));
 assert.throws(()=>store.setPermission({organizationId:'one',actorId:'admin1',accountId:'scientist',appId:'eel',permission:'does.not.exist',enabled:true}),/invalid_permission/);
 assert.throws(()=>store.setPermission({organizationId:'one',actorId:'other',accountId:'scientist',appId:'eel',permission:'document.edit',enabled:false}),/access_denied/);
 store.setPermission({organizationId:'one',actorId:'admin1',accountId:'scientist',appId:'eel',permission:'document.edit',enabled:false});
 store.setPermission({organizationId:'one',actorId:'admin1',accountId:'scientist',appId:'eel',permission:'document.review',enabled:true});
 assert(!store.effectivePermissions({organizationId:'one',accountId:'scientist',appId:'eel'}).includes('document.edit'));
 assert(store.effectivePermissions({organizationId:'one',accountId:'scientist',appId:'eel'}).includes('document.review'));
 const row=store.matrix('one','admin1').users.find(u=>u.accountId==='scientist');
 assert.equal(row.overrides.eel['document.edit'],false);
 assert.equal(row.overrides.eel['document.review'],true);
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('scientist',{eel:'reviewer'})});
 assert.deepEqual(store.matrix('one','admin1').users.find(u=>u.accountId==='scientist').overrides.eel,{});
 assert(store.effectivePermissions({organizationId:'one',accountId:'scientist',appId:'eel'}).includes('document.review'));
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('scientist',{})});
 assert.deepEqual(store.effectivePermissions({organizationId:'one',accountId:'scientist',appId:'eel'}),[]);
 assert.throws(()=>store.setPermission({organizationId:'one',actorId:'admin1',accountId:'scientist',appId:'eel',permission:'document.review',enabled:true}),/app_access_required/);
});

test('organization invitation is opaque, one-use, expires, and does not pre-grant application access',t=>{
 const {store}=fixture(t);
 const invitation=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'New member',nickname:'N',email:'NEW@example.test'});
 assert.match(invitation.token,/^[A-Za-z0-9_-]{43}$/);
 const preview=store.previewInvitation(invitation.token);
 assert.equal(preview.email,'new@example.test');
 assert.equal(preview.organizationId,'one');
 assert.equal(preview.admin,false);
 assert.equal(store.overview('one','admin1').users.length,1);
 assert.throws(()=>store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Dup',nickname:'D',email:'new@example.test'}),/invitation_exists/);
 assert.throws(()=>store.issueInvitation({organizationId:'one',actorId:'stranger',name:'Bad',nickname:'B',email:'other@example.test'}),/access_denied/);
 assert.throws(()=>store.acceptInvitation({token:invitation.token,accountId:'person',email:'incorrect@example.test'}),/invalid_invitation/);
 const accepted=store.acceptInvitation({token:invitation.token,accountId:'person',email:'new@example.test'});
 assert.equal(accepted.organizationId,'one');
 assert.deepEqual(store.overview('one','admin1').users.find(u=>u.accountId==='person').roles,{});
 assert.equal(store.previewInvitation(invitation.token),null);
 assert.throws(()=>store.acceptInvitation({token:invitation.token,accountId:'other',email:'new@example.test'}),/invalid_invitation/);
});
test('administrators list and revoke only their own pending invitations, without exposing tokens',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Another lab',owner:{accountId:'admin2',name:'Admin Two',nickname:'Two',email:'two@example.test'}});
 const first=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Scientist',nickname:'Sci',email:'scientist@example.test'});
 store.issueInvitation({organizationId:'two',actorId:'admin2',name:'Other',nickname:'Other',email:'other@example.test'});
 assert.throws(()=>store.listPendingInvitations('one','admin2'),/access_denied/);
 const pending=store.listPendingInvitations('one','admin1');
 assert.equal(pending.length,1);
 assert.equal(pending[0].email,'scientist@example.test');
 assert.equal(Object.keys(pending[0]).includes('token'),false);
 assert.deepEqual(store.listPendingInvitations('two','admin2').map(i=>i.email),['other@example.test']);
 assert.throws(()=>store.revokeInvitation({organizationId:'one',actorId:'admin2',email:'scientist@example.test'}),/access_denied/);
 assert.deepEqual(store.revokeInvitation({organizationId:'one',actorId:'admin1',email:'scientist@example.test'}),{revoked:true});
 assert.equal(store.previewInvitation(first.token),null);
 assert.equal(store.listPendingInvitations('one','admin1').length,0);
 assert.deepEqual(store.revokeInvitation({organizationId:'one',actorId:'admin1',email:'scientist@example.test'}),{revoked:false});
 assert.equal(store.listPendingInvitations('two','admin2').length,1);
 const replacement=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Scientist',nickname:'Sci',email:'scientist@example.test'});
 assert.notEqual(replacement.token,first.token);
 assert.equal(store.previewInvitation(replacement.token).email,'scientist@example.test');
});
test('invited app roles reserve paid seats atomically and transfer them on acceptance',t=>{
 const {store}=fixture(t);
 buy(store,'seat-reserved','Single',['eel'],1);
 assert.throws(()=>store.issueInvitation({organizationId:'one',actorId:'admin1',name:'No seat',nickname:'N',email:'no@example.test',roles:{goflo:'Analyst'}}),/app_seats_exhausted/);
 const invitation=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Scientist',nickname:'Sci',email:'invited@example.test',roles:{eel:'scientist'}});
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').reserved,1);
 assert.equal(store.listPendingInvitations('one','admin1')[0].roles.eel,'scientist');
 assert.throws(()=>store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Second',nickname:'S',email:'second@example.test',roles:{eel:'reviewer'}}),/app_seats_exhausted/);
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('someone',{eel:'scientist'})}),/app_seats_exhausted/);
 const result=store.acceptInvitation({token:invitation.token,accountId:'invited',email:'invited@example.test'});
 assert.equal(result.roles.eel,'scientist');
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').reserved,0);
 assert.equal(store.accessFor({organizationId:'one',accountId:'invited',appId:'eel'}).role,'scientist');
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').assigned,1);
 assert.throws(()=>store.acceptInvitation({token:invitation.token,accountId:'other',email:'invited@example.test'}),/invalid_invitation/);
 store.removeMember({organizationId:'one',actorId:'admin1',accountId:'invited'});
 const again=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Again',nickname:'A',email:'again@example.test',roles:{eel:'reviewer'}});
 assert.equal(store.revokeInvitation({organizationId:'one',actorId:'admin1',email:'again@example.test'}).revoked,true);
 assert.equal(store.previewInvitation(again.token),null);
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').reserved,0);
});
test('audit trail records committed changes within one organization and never includes bearer tokens',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Another lab',owner:{accountId:'admin2',name:'Admin Two',nickname:'Two',email:'two@example.test'}});
 buy(store,'audited-seat','Single',['eel']);
 const invitation=store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Scientist',nickname:'Sci',email:'scientist@example.test',roles:{eel:'scientist'}});
 assert.throws(()=>store.auditLog('one','admin2'),/access_denied/);
 assert.throws(()=>store.issueInvitation({organizationId:'one',actorId:'admin1',name:'Bad',nickname:'B',email:'bad@example.test',roles:{goflo:'Analyst'}}),/app_seats_exhausted/);
 assert.equal(store.auditLog('one','admin1').filter(x=>x.action==='invitation.issued').length,1,'failed operations leave no audit entry');
 store.acceptInvitation({token:invitation.token,accountId:'person',email:'scientist@example.test'});
 store.setPermission({organizationId:'one',actorId:'admin1',accountId:'person',appId:'eel',permission:'document.review',enabled:true});
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{eel:'reviewer'},{email:'scientist@example.test'})});
 store.removeMember({organizationId:'one',actorId:'admin1',accountId:'person'});
 const events=store.auditLog('one','admin1');
 assert(events.some(e=>e.action==='invitation.issued'&&e.actorId==='admin1'));
 assert(events.some(e=>e.action==='invitation.accepted'&&e.actorId==='person'));
 assert(events.some(e=>e.action==='permission.updated'&&e.details.permission==='document.review'));
 assert(events.some(e=>e.action==='member.updated'));
 assert(events.some(e=>e.action==='member.removed'));
 assert(!JSON.stringify(events).includes(invitation.token),'audit never stores bearer invitation token');
 assert(!store.auditLog('two','admin2').some(e=>e.subject==='person'),'audit is tenant scoped');
});
test('Stripe test Checkout intents are durable, tenant isolated, idempotent and never grant seats',t=>{
 const {store}=fixture(t);
 const draft=store.createSubscriptionDraft({organizationId:'one',actorId:'admin1',plan:'Single',apps:['eel'],seats:3});
 assert.throws(()=>store.prepareTestCheckout({organizationId:'one',actorId:'admin2',draftId:draft.id,price:'price_test123456'}),/access_denied/);
 const result=store.prepareTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,price:'price_test123456'});
 assert.equal(result.draft.seats,3);
 assert.deepEqual(result.draft.apps,['eel']);
 assert.equal(result.idempotencyKey,'duckbio-test-'+draft.id);
 assert.equal(store.prepareTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,price:'price_test123456'}).idempotencyKey,result.idempotencyKey);
 assert.throws(()=>store.prepareTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,price:'price_other123456'}),/checkout_price_changed/);
 assert.throws(()=>store.cancelSubscriptionDraft({organizationId:'one',actorId:'admin1',draftId:draft.id}),/checkout_started/);
 const checkout={id:'cs_test_session_123',url:'https://checkout.stripe.com/c/pay/example'};
 assert.equal(store.completeTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,session:checkout}).alreadySaved,false);
 assert.equal(store.completeTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,session:checkout}).alreadySaved,true);
 assert.throws(()=>store.completeTestCheckout({organizationId:'one',actorId:'admin1',draftId:draft.id,session:{...checkout,id:'cs_test_other'}}),/checkout_conflict/);
 const list=store.listSubscriptionDrafts('one','admin1');
 assert.equal(list[0].checkoutState,'ready');
 assert.equal(list[0].checkoutUrl,checkout.url);
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').purchased,0);
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').assigned,0);
 assert.equal(store.auditLog('one','admin1').filter(x=>x.action==='checkout.test.started').length,1);
});
test('member deactivation is tenant-scoped, revokes access, retains seat and can be reversed',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Second laboratory',owner:{accountId:'admin2',name:'Admin Two',nickname:'Two',email:'two@example.test'}});
 buy(store,'suspend-seat-a','Single',['eel']);
 buy(store,'suspend-seat-b','Single',['eel'],1,'two');
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('person',{eel:'scientist'})});
 store.saveMember({organizationId:'two',actorId:'admin2',member:member('person',{eel:'reviewer'})});
 store.selectSessionOrganization({sessionId:'test-session',accountId:'person',organizationId:'one'});
 assert.throws(()=>store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'admin1',active:false}),/last_organization_admin/);
 assert.throws(()=>store.setMemberActive({organizationId:'one',actorId:'admin2',accountId:'person',active:false}),/access_denied/);
 assert.deepEqual(store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'person',active:false}),{accountId:'person',active:false,changed:true});
 assert.equal(store.currentSessionOrganization({sessionId:'test-session',accountId:'person'}),null);
 assert.throws(()=>store.selectSessionOrganization({sessionId:'test-session',accountId:'person',organizationId:'two'}),/organization_locked/,'cannot switch organizations in same session');
 assert.deepEqual(store.organizationsFor('person').map(x=>x.id),['two']);
 assert.equal(store.accessFor({organizationId:'one',accountId:'person',appId:'eel'}),null);
 assert.deepEqual(store.effectivePermissions({organizationId:'one',accountId:'person',appId:'eel'}),[]);
 assert.equal(store.accessFor({organizationId:'two',accountId:'person',appId:'eel'}).role,'reviewer');
 assert.equal(store.overview('one','admin1').apps.find(x=>x.id==='eel').assigned,1,'deactivated user still occupies purchased seat');
 assert.equal(store.overview('one','admin1').users.find(x=>x.accountId==='person').active,false);
 assert.deepEqual(store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'person',active:true}),{accountId:'person',active:true,changed:true});
 assert.equal(store.currentSessionOrganization({sessionId:'test-session',accountId:'person'}).id,'one');
 assert.equal(store.accessFor({organizationId:'one',accountId:'person',appId:'eel'}).role,'scientist');
 assert.deepEqual(store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'person',active:true}),{accountId:'person',active:true,changed:false});
 assert.equal(store.auditLog('one','admin1').filter(x=>x.action==='member.deactivated').length,1);
 assert.equal(store.auditLog('one','admin1').filter(x=>x.action==='member.reactivated').length,1);
});
test('suspended admins cannot manage their organization and the last active admin cannot be removed',t=>{
 const {store}=fixture(t);
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('admin2',{}, {admin:true})});
 store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'admin2',active:false});
 assert.throws(()=>store.overview('one','admin2'),/access_denied/);
 assert.throws(()=>store.removeMember({organizationId:'one',actorId:'admin1',accountId:'admin1'}),/last_organization_admin/);
 assert.throws(()=>store.saveMember({organizationId:'one',actorId:'admin1',member:member('admin1',{}, {name:'Admin A',nickname:'A',email:'admin@example.test',admin:false})}),/last_organization_admin/);
 store.setMemberActive({organizationId:'one',actorId:'admin1',accountId:'admin2',active:true});
 assert.equal(store.removeMember({organizationId:'one',actorId:'admin2',accountId:'admin1'}).removed,true);
});
test('removing a user revokes only this org, while other organization membership persists',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Other lab',owner:{accountId:'admin2',name:'Admin Two',nickname:'Two',email:'two@example.test'}});
 buy(store,'one-seat','Single',['goflo']);
 buy(store,'two-seat','Single',['goflo'],1,'two');
 store.saveMember({organizationId:'one',actorId:'admin1',member:member('researcher',{goflo:'Analyst'})});
 store.saveMember({organizationId:'two',actorId:'admin2',member:member('researcher',{goflo:'Reviewer'})});
 assert.throws(()=>store.removeMember({organizationId:'one',actorId:'admin1',accountId:'admin1'}),/last_organization_admin/);
 assert.throws(()=>store.removeMember({organizationId:'two',actorId:'admin1',accountId:'researcher'}),/access_denied/);
 assert.equal(store.removeMember({organizationId:'one',actorId:'admin1',accountId:'researcher'}).removed,true);
 assert.equal(store.accessFor({organizationId:'one',accountId:'researcher',appId:'goflo'}),null);
 assert.equal(store.accessFor({organizationId:'two',accountId:'researcher',appId:'goflo'}).role,'Reviewer');
 assert.deepEqual(store.organizationsFor('researcher').map(x=>x.id),['two']);
 assert.equal(store.overview('one','admin1').apps.find(a=>a.id==='goflo').assigned,0);
});

test('subscription drafts are tenant scoped and cannot ever grant seats',t=>{
 const {store}=fixture(t);
 store.setupOrganization({organizationId:'two',name:'Two',owner:{accountId:'admin2',name:'Admin Two',nickname:'T',email:'two@example.test'}});
 assert.throws(()=>store.createSubscriptionDraft({organizationId:'one',actorId:'admin1',plan:'Single',apps:['eel','goflo'],seats:2}),/invalid_subscription/);
 assert.throws(()=>store.createSubscriptionDraft({organizationId:'one',actorId:'admin2',plan:'Single',apps:['eel'],seats:2}),/access_denied/);
 const draft=store.createSubscriptionDraft({organizationId:'one',actorId:'admin1',plan:'Mixed',apps:['eel','goflo'],seats:10});
 assert.equal(draft.status,'draft');
 assert.equal(store.listSubscriptionDrafts('one','admin1').length,1);
 assert.deepEqual(store.listSubscriptionDrafts('two','admin2'),[]);
 assert.throws(()=>store.cancelSubscriptionDraft({organizationId:'two',actorId:'admin2',draftId:draft.id}),/subscription_not_found/);
 assert.equal(store.cancelSubscriptionDraft({organizationId:'one',actorId:'admin1',draftId:draft.id}).status,'canceled');
 assert.equal(store.cancelSubscriptionDraft({organizationId:'one',actorId:'admin1',draftId:draft.id}).status,'canceled');
 assert.deepEqual(store.overview('one','admin1').apps.map(a=>a.purchased),[0,0,0,0,0,0]);
 assert.deepEqual(store.overview('one','admin1').apps.map(a=>a.assigned),[0,0,0,0,0,0]);
});
