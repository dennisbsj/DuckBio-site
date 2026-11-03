import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDataDuckNativeLinkStore} from '../dataduck-native-links.mjs';

const A='123e4567-e89b-42d3-a456-426614174000';
const B='123e4567-e89b-42d3-a456-426614174001';
const C='123e4567-e89b-42d3-a456-426614174002';
const D='123e4567-e89b-42d3-a456-426614174003';
function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-dd-link-'));
 const databasePath=path.join(root,'private','links.sqlite');
 const assignments=new Set(['org1/alice','org1/bob','org2/charlie']);
 let native=true,operator=true;
 const opts={databasePath,clock:()=>1000,
  authorizeMutation:async ({actorId,workspaceOrganizationId})=>operator&&actorId==='admin-'+workspaceOrganizationId,
  currentAssignment:async ({workspaceOrganizationId,workspaceAccountId,appId})=>
   appId==='dataduck'&&assignments.has(workspaceOrganizationId+'/'+workspaceAccountId),
  verifyNativeOwnership:async ({evidence})=>native&&evidence==='proof-from-native-only'};
 const store=createDataDuckNativeLinkStore(opts);
 t.after(()=>{store.close();rmSync(root,{force:true,recursive:true})});
 const bind=(organization,account,nativeOrg,nativeUser,actor='admin-'+organization,evidence='proof-from-native-only')=>
  store.bindVerified({actorId:actor,workspaceOrganizationId:organization,workspaceAccountId:account,
   nativeOrganizationId:nativeOrg,nativeUserId:nativeUser,evidence});
 const get=(organization,account)=>store.findCurrent({workspaceOrganizationId:organization,workspaceAccountId:account});
 return {store,bind,get,assignments,opts,setNative:x=>{native=x},setOperator:x=>{operator=x}};
}
test('isolated native UUID bindings do not grant SSO, user roles or paid seats',async t=>{
 const f=fixture(t);
 await assert.rejects(f.bind('org1','alice',A,B,'admin-org2'),/access_denied/);
 await assert.rejects(f.bind('org1','alice',A,B,'admin-org1','untrusted'),/native_identity_unverified/);
 assert.equal(await f.get('org1','alice'),null);
 assert.deepEqual(await f.bind('org1','alice',A,B),
  {recorded:true,reverified:false,licenseGranted:false,loginEnabled:false});
 assert.deepEqual(await f.get('org1','alice'),{
  appId:'dataduck',workspaceOrganizationId:'org1',workspaceAccountId:'alice',
  nativeOrganizationId:A,nativeUserId:B,source:'explicit_verified_native_link',
  licenseGranted:false,loginEnabled:false});
 assert.equal(await f.get('org2','alice'),null);
 assert.equal(await f.get('org1','bob'),null);
 f.assignments.delete('org1/alice');
 assert.equal(await f.get('org1','alice'),null);
});
test('one native org cannot be claimed by multiple central organizations',async t=>{
 const f=fixture(t);
 await f.bind('org1','alice',A,B);
 await assert.rejects(f.bind('org2','charlie',A,C),/native_organization_conflict/);
 await f.bind('org2','charlie',C,D);
 await assert.rejects(f.bind('org1','bob',C,A),/native_organization_conflict/);
 assert.equal(await f.get('org1','bob'),null);
});
test('native user ownership is unique and remapping requires a separate migration',async t=>{
 const f=fixture(t);
 await f.bind('org1','alice',A,B);
 await assert.rejects(f.bind('org1','bob',A,B),/native_user_conflict/);
 await assert.rejects(f.bind('org1','alice',A,C),/native_user_conflict/);
 await f.bind('org1','bob',A,C);
 assert((await f.get('org1','bob')).nativeUserId===C);
});
test('revocation is immediate, administrator guarded and does not free ownership for hijack',async t=>{
 const f=fixture(t);
 await f.bind('org1','alice',A,B);
 await assert.rejects(f.store.revoke({actorId:'admin-org2',workspaceOrganizationId:'org1',workspaceAccountId:'alice'}),/access_denied/);
 assert.deepEqual(await f.store.revoke({actorId:'admin-org1',workspaceOrganizationId:'org1',workspaceAccountId:'alice'}),
  {revoked:true,licenseGranted:false,loginEnabled:false});
 assert.equal(await f.get('org1','alice'),null);
 await assert.rejects(f.bind('org1','bob',A,B),/native_user_conflict/);
 f.setNative(false);
 await assert.rejects(f.bind('org1','alice',A,B),/native_identity_unverified/);
 f.setNative(true);
 assert.equal((await f.bind('org1','alice',A,B)).reverified,true);
 assert((await f.get('org1','alice')).nativeUserId===B);
});
test('restart retains mappings; missing assignment still denies; no email matching',async t=>{
 const f=fixture(t);
 await f.bind('org1','alice',A,B);
 const reopened=createDataDuckNativeLinkStore(f.opts);
 t.after(()=>reopened.close());
 assert((await reopened.findCurrent({workspaceOrganizationId:'org1',workspaceAccountId:'alice'})).nativeUserId===B);
 assert.equal(await reopened.findCurrent({workspaceOrganizationId:'org1',workspaceAccountId:'alice@example.test'}),null);
 f.assignments.delete('org1/alice');
 assert.equal(await reopened.findCurrent({workspaceOrganizationId:'org1',workspaceAccountId:'alice'}),null);
});
test('invalid configuration, malformed UUIDs, revoked operators and unassigned subjects fail closed',async t=>{
 assert.throws(()=>createDataDuckNativeLinkStore({databasePath:'/tmp/absent.sqlite'}),/trusted_link_adapters_required/);
 const f=fixture(t);
 await assert.rejects(f.bind('org1','alice','123',B),/invalid_native_identity/);
 await assert.rejects(f.bind('org1','alice',A,B.toUpperCase()),/invalid_native_identity/);
 await assert.rejects(f.bind('org1','no-seat',A,B),/access_denied/);
 f.setOperator(false);
 await assert.rejects(f.bind('org1','alice',A,B),/access_denied/);
 assert.equal(await f.get('org1','alice'),null);
});
