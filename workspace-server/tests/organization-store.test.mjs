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
