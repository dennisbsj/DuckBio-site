import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';

function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-custom-role-'));
 const databasePath=path.join(root,'private','roles.sqlite');
 const s=createOrganizationStore({databasePath,clock:()=>1000});
 let closed=false;
 t.after(()=>{if(!closed)s.close();rmSync(root,{force:true,recursive:true})});
 s.setupOrganization({organizationId:'one',name:'Lab One',
  owner:{accountId:'admin-one',name:'Owner One',nickname:'Owner',email:'owner1@example.test'}});
 s.setupOrganization({organizationId:'two',name:'Lab Two',
  owner:{accountId:'admin-two',name:'Owner Two',nickname:'Owner',email:'owner2@example.test'}});
 const member=(id,role)=>({
  accountId:id,name:id,nickname:id,email:id+'@example.test',admin:false,
  roles:{goflo:role}
 });
 return {s,member,databasePath,close:()=>{s.close();closed=true}};
}
function buy(s,org,reference){
 s.applyVerifiedSeatPurchase({reference,organizationId:org,plan:'Single',
  apps:['goflo'],seats:3});
}
test('admins can edit existing per-app baseline roles without changing another organization',t=>{
 const {s,member}=fixture(t);buy(s,'one','seat-1');buy(s,'two','seat-2');
 s.saveMember({organizationId:'one',actorId:'admin-one',member:member('alice','Analyst')});
 s.saveMember({organizationId:'two',actorId:'admin-two',member:member('alice','Analyst')});
 const before=s.effectivePermissions({organizationId:'one',accountId:'alice',appId:'goflo'});
 assert(before.includes('workspace.view'));
 const baseline=s.listRoles({organizationId:'one',actorId:'admin-one',appId:'goflo'});
 const analyst=baseline.roles.find(x=>x.name==='Analyst');
 assert(analyst&&!analyst.custom&&analyst.permissions.length>0);
 const revised=analyst.permissions.filter(x=>x!=='workspace.view');
 assert(!revised.includes('workspace.view'));
 const updated=s.saveRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Analyst',permissions:revised});
 assert.equal(updated.nativeEnforcementPending,true);
 assert(!s.effectivePermissions({organizationId:'one',accountId:'alice',appId:'goflo'}).includes('workspace.view'));
 assert(s.effectivePermissions({organizationId:'two',accountId:'alice',appId:'goflo'}).includes('workspace.view'));
 assert.equal(s.listRoles({organizationId:'one',actorId:'admin-one',appId:'goflo'})
  .roles.find(x=>x.name==='Analyst').permissions.includes('workspace.view'),false);
 assert.deepEqual(s.listRoles({organizationId:'two',actorId:'admin-two',appId:'goflo'})
  .roles.find(x=>x.name==='Analyst').permissions,analyst.permissions);
});
test('custom roles are assignable, permission changes apply immediately and deletions are guarded',t=>{
 const {s,member}=fixture(t);
 buy(s,'one','custom-seat');
 const base=s.listRoles({organizationId:'one',actorId:'admin-one',appId:'goflo'});
 const permissions=base.availablePermissions;
 assert(permissions.includes('workspace.view'));
 const created=s.saveRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Senior Analyst',permissions:['workspace.view']});
 assert.deepEqual(created.permissions,['workspace.view']);
 assert.equal(created.custom,true);
 s.saveMember({organizationId:'one',actorId:'admin-one',member:member('analyst','Senior Analyst')});
 assert.deepEqual(s.effectivePermissions({organizationId:'one',accountId:'analyst',appId:'goflo'}),
  ['workspace.view']);
 assert.throws(()=>s.deleteRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Senior Analyst'}),/role_in_use/);
 const second=permissions.find(x=>x!=='workspace.view');
 assert(second);
 s.saveRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Senior Analyst',permissions:[second]});
 assert.deepEqual(s.effectivePermissions({organizationId:'one',accountId:'analyst',appId:'goflo'}),
  [second]);
 s.saveMember({organizationId:'one',actorId:'admin-one',member:member('analyst','Analyst')});
 const invite=s.issueInvitation({organizationId:'one',actorId:'admin-one',
  email:'pending@example.test',name:'Pending',nickname:'Pending',
  roles:{goflo:'Senior Analyst'}});
 assert(invite.token);
 assert.throws(()=>s.deleteRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Senior Analyst'}),/role_in_use/);
 s.revokeInvitation({organizationId:'one',actorId:'admin-one',email:'pending@example.test'});
 assert.equal(s.deleteRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Senior Analyst'}).deleted,true);
 assert.throws(()=>s.saveMember({organizationId:'one',actorId:'admin-one',
  member:member('other','Senior Analyst')}),/invalid_roles/);
 assert.throws(()=>s.deleteRole({organizationId:'one',actorId:'admin-one',
  appId:'goflo',role:'Analyst'}),/builtin_role_protected/);
});
test('role editing denies non-admins and invalid/wildcard or cross-app permissions',t=>{
 const {s,member}=fixture(t);buy(s,'one','seat');
 s.saveMember({organizationId:'one',actorId:'admin-one',member:member('member','Analyst')});
 const payload={organizationId:'one',actorId:'admin-one',appId:'goflo',
  role:'Researcher',permissions:['workspace.view']};
 for(const actorId of ['member','admin-two','not-a-user']){
  assert.throws(()=>s.saveRole({...payload,actorId}),/access_denied/);
  assert.throws(()=>s.listRoles({organizationId:'one',actorId,appId:'goflo'}),/access_denied/);
  assert.throws(()=>s.deleteRole({...payload,actorId}),/access_denied/);
 }
 for(const permissions of [['*'],['workspace.view','workspace.view'],
  ['unexpected.permission'],['document.approve'],null]){
  assert.throws(()=>s.saveRole({...payload,permissions}),/invalid_role/);
 }
 for(const role of ['Admin ', 'admin','../Admin','a'.repeat(49),'']){
  if(role==='admin')assert.throws(()=>s.saveRole({...payload,role}),/role_exists/);
  else assert.throws(()=>s.saveRole({...payload,role}),/invalid_role/);
 }
 assert.throws(()=>s.saveRole({...payload,appId:'unknown'}),/invalid_role/);
 assert.throws(()=>s.saveRole({...payload,role:'Reviewer',permissions:['workspace.view', 'wrong']}),/invalid_role/);
});
test('app role overrides persist across private SQLite restart without changing native app claims',t=>{
 const {s,close,databasePath}=fixture(t);
 s.saveRole({organizationId:'one',actorId:'admin-one',appId:'goflo',
  role:'Principal Scientist',permissions:['workspace.view']});
 s.saveRole({organizationId:'one',actorId:'admin-one',appId:'goflo',
  role:'Analyst',permissions:[]});
 close();
 const next=createOrganizationStore({databasePath});
 t.after(()=>next.close());
 const roles=next.listRoles({organizationId:'one',actorId:'admin-one',appId:'goflo'});
 assert.deepEqual(roles.roles.find(x=>x.name==='Principal Scientist').permissions,['workspace.view']);
 assert.deepEqual(roles.roles.find(x=>x.name==='Analyst').permissions,[]);
 assert.equal(roles.nativeEnforcementPending,true);
 assert(!next.listRoles({organizationId:'two',actorId:'admin-two',appId:'goflo'})
  .roles.some(x=>x.name==='Principal Scientist'));
});
