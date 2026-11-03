import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DATADUCK_NATIVE_ROLES,DATADUCK_NATIVE_ACTIONS,
 DATADUCK_WORKSPACE_PERMISSIONS,inspectDataDuckPermissionCompatibility as preview
} from '../dataduck-native-permissions-contract.mjs';

const examine=(nativeRole,action,workspacePermissions=[action])=>
 preview({nativeRole,action,workspacePermissions});

test('pin exact draft DataDuck route names/categories without enabling native grants',()=>{
 assert.deepEqual(DATADUCK_NATIVE_ROLES,['Admin','Analyst','Reviewer','ReadOnly']);
 assert.equal(DATADUCK_NATIVE_ACTIONS.length,18);
 assert.equal(new Set(DATADUCK_NATIVE_ACTIONS.map(x=>x.name)).size,18);
 assert.deepEqual(DATADUCK_NATIVE_ACTIONS.filter(x=>x.category==='self')
  .map(x=>x.name),['auth.logout','auth.logout_all']);
 assert.equal(DATADUCK_WORKSPACE_PERMISSIONS.length,16);
 for(const action of DATADUCK_NATIVE_ACTIONS){
  assert(['read','write','admin','self'].includes(action.category));
  assert.equal(action.editable,action.category!=='self');
 }
});
test('Admin may be compatible with selected read/write/admin permissions but never receives grant',()=>{
 for(const action of DATADUCK_WORKSPACE_PERMISSIONS){
  const x=examine('Admin',action);
  assert.equal(x.compatible,true,action);
  assert.equal(x.accessGranted,false);
  assert.equal(x.licensesGranted,false);
  assert.equal(x.nativeEnforcementRequired,true);
  assert.equal(x.reason,'source_contract_only');
 }
});
test('Analyst native role can write data but cannot edit central-only admin endpoints or delete a project',()=>{
 for(const action of DATADUCK_NATIVE_ACTIONS.filter(x=>x.category==='write')){
  const x=examine('Analyst',action.name);
  assert.equal(x.compatible,true,action.name);
 }
 for(const action of DATADUCK_NATIVE_ACTIONS.filter(x=>x.category==='admin')){
  const x=examine('Analyst',action.name);
  assert.equal(x.compatible,false,action.name);
  assert.equal(x.reason,'native_role_restriction');
 }
});
test('Reviewer and ReadOnly native roles remain read-only regardless of Workspace custom permissions',()=>{
 for(const role of ['Reviewer','ReadOnly']){
  for(const action of DATADUCK_NATIVE_ACTIONS.filter(x=>x.category==='read')){
   assert.equal(examine(role,action.name).compatible,true);
  }
  for(const action of DATADUCK_NATIVE_ACTIONS.filter(x=>['write','admin'].includes(x.category))){
   const x=examine(role,action.name,DATADUCK_WORKSPACE_PERMISSIONS);
   assert.equal(x.compatible,false,role+' '+action.name);
   assert.equal(x.reason,'native_role_restriction');
   assert.equal(x.accessGranted,false);
  }
 }
});
test('Workspace deny for a valid native Admin restricts candidate; org admin is never implicit native Admin',()=>{
 const denied=examine('Admin','admin.users',['projects.list']);
 assert.equal(denied.compatible,false);
 assert.equal(denied.workspacePermissionSelected,false);
 assert.equal(denied.reason,'workspace_permission_denied');
 assert.equal(examine('Organization Admin','admin.users').compatible,false);
 assert.equal(examine('admin','admin.users').compatible,false);
});
test('logout/logout-all remain native self-service and cannot be assigned as custom permission grants',()=>{
 for(const role of DATADUCK_NATIVE_ROLES){
  for(const action of ['auth.logout','auth.logout_all']){
   const result=examine(role,action,[]);
   assert.equal(result.compatible,true);
   assert.equal(result.selfService,true);
   assert.equal(result.accessGranted,false);
   assert.equal(result.reason,'self_service_native_guard_required');
   assert.equal(examine(role,action,[action]).compatible,false);
  }
 }
});
test('unknown actions, wildcards, duplicate or tampered permission catalogs fail closed',()=>{
 for(const p of [undefined,null,'all',['*'],['workspace.view'],
  ['projects.list','projects.list'],['projects.list','unknown'],[null],
  DATADUCK_WORKSPACE_PERMISSIONS.concat('admin.export')]){
  assert.equal(preview({nativeRole:'Admin',action:'projects.list',workspacePermissions:p}).compatible,false);
 }
 for(const action of ['admin', '/api/v1/admin/users','auth.csrf',
  '__proto__','PROJECTS.LIST','','projects.list?org=other']){
  assert.equal(examine('Admin',action,DATADUCK_WORKSPACE_PERMISSIONS).compatible,false);
 }
 assert.equal(preview().accessGranted,false);
});
