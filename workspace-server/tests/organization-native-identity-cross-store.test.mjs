/**
 * Real Workspace SQLite organization membership + real central identity
 * SQLite tenant-native mapping. Private synthetic trust adapters ONLY.
 * This tests the bind seam; it does not configure the active SSO runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';

const PASSWORD='cross-store-native-identity-synthetic-only';
async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-org-native-cross-store-'));
 const organization=createOrganizationStore({
  databasePath:path.join(root,'private','org.sqlite'),clock:()=>1800000000000
 });
 const identityPath=path.join(root,'private','identity.sqlite');
 let duringNative=null;
 let owner,member;
 const identity=createIdentityStore({
  databasePath:identityPath,clock:()=>1800000000000,
  orgNativeLinks:{
   authorizeMutation:async ({actorId,userId,appId,workspaceOrganizationId,operation})=>{
    const admin=organization.organizationsFor(actorId).some(
     org=>org.id===workspaceOrganizationId&&org.admin===true
    );
    if(!admin)return false;
    if(operation==='revoke')return true;
    return Boolean(organization.accessFor({
     organizationId:workspaceOrganizationId,accountId:userId,appId
    }))&&organization.effectivePermissions({
     organizationId:workspaceOrganizationId,accountId:userId,appId
    }).includes('workspace.view');
   },
   verifyNativeOwnership:async ({userId,appId,workspaceOrganizationId,
    nativeUserId,nativeOrganizationId})=>{
    if(duringNative)await duringNative();
    return userId===member?.id&&appId==='goflo'&&
      workspaceOrganizationId==='lab-alpha'&&
      nativeUserId==='native-user-lab-alpha'&&
      nativeOrganizationId==='native-lab-alpha';
   }
  }
 });
 t.after(()=>{identity.close();organization.close();
   rmSync(root,{force:true,recursive:true})});
 owner=await identity.createUser({email:'owner@example.test',
  displayName:'Lab Admin',password:PASSWORD});
 member=await identity.createUser({email:'member@example.test',
  displayName:'Lab Analyst',password:PASSWORD});
 for(const id of ['lab-alpha','lab-beta']){
  organization.setupOrganization({organizationId:id,name:id,
   owner:{accountId:owner.id,name:'Admin',nickname:'Admin',
    email:'owner@example.test'}});
  organization.applyVerifiedSeatPurchase({reference:'test-seat-'+id,
   organizationId:id,plan:'Single',apps:['goflo'],seats:3});
 }
 organization.saveMember({organizationId:'lab-alpha',actorId:owner.id,
  member:{accountId:member.id,name:'Analyst',nickname:'Analyst',
   email:'member@example.test',admin:false,roles:{goflo:'Analyst'}}});
 const request={actorId:owner.id,userId:member.id,appId:'goflo',
  workspaceOrganizationId:'lab-alpha',
  nativeUserId:'native-user-lab-alpha',
  nativeOrganizationId:'native-lab-alpha'};
 return {identity,organization,owner,member,request,
  duringNative:x=>{duringNative=x}};
}

test('real organization admin and active app assignment permit only a native mapping candidate',async t=>{
 const f=await fixture(t);
 const first=await f.identity.bindVerifiedOrganizationNativeLink(f.request);
 assert.equal(first.applied,true);
 assert.equal(first.link.accessGranted,false);
 assert.equal(first.link.licensesGranted,false);
 assert.equal(f.identity.getAccess(f.member.id,'goflo'),null);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:'goflo',workspaceOrganizationId:'lab-beta'}),null);
 await assert.rejects(f.identity.bindVerifiedOrganizationNativeLink({
  ...f.request,workspaceOrganizationId:'lab-beta'
 }),/org_native_link_not_authorized/);
 assert.equal(f.identity.orgNativeLinkAudit({
  appId:'goflo',workspaceOrganizationId:'lab-alpha'}).length,1);
});

test('native mapping cannot bind when the effective organization role loses its permission during verification',async t=>{
 const f=await fixture(t);
 f.duringNative(()=>{
  const policy=f.organization.listRoles({organizationId:'lab-alpha',
   actorId:f.owner.id,appId:'goflo'});
  const analyst=policy.roles.find(x=>x.name==='Analyst');
  f.organization.saveRole({organizationId:'lab-alpha',actorId:f.owner.id,
   appId:'goflo',role:'Analyst',
   permissions:analyst.permissions.filter(x=>x!=='workspace.view')});
 });
 await assert.rejects(f.identity.bindVerifiedOrganizationNativeLink(f.request),
  /org_native_link_not_authorized/);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:'goflo',workspaceOrganizationId:'lab-alpha'}),null);
});

test('after removing a member, organization admin can still revoke an existing mapping',async t=>{
 const f=await fixture(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.request);
 f.organization.setMemberActive({organizationId:'lab-alpha',actorId:f.owner.id,
  accountId:f.member.id,active:false});
 await assert.rejects(f.identity.bindVerifiedOrganizationNativeLink({
  ...f.request,nativeUserId:'new-native-user'
 }),/org_native_link_not_authorized/);
 const removed=await f.identity.revokeVerifiedOrganizationNativeLink({
  actorId:f.owner.id,userId:f.member.id,appId:'goflo',
  workspaceOrganizationId:'lab-alpha'
 });
 assert.equal(removed.applied,true);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.member.id,appId:'goflo',workspaceOrganizationId:'lab-alpha'}),null);
 assert.deepEqual(f.identity.orgNativeLinkAudit({
  appId:'goflo',workspaceOrganizationId:'lab-alpha'
 }).map(x=>x.action),['link.revoked','link.bound']);
});
