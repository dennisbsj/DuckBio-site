/**
 * DORMANT PRIVATE session-bound provisioning controller for six Workspace apps.
 * No HTTP route, broker grant or native app mutation is introduced.
 * Inject the returned adapters into opt-in createIdentityStore and invoke
 * this controller's own methods for link, migration and revocation.
 * AsyncLocalStorage prevents concurrent administrators leaking authority
 * through a process-wide mutable current-session variable.
 */
import {AsyncLocalStorage} from 'node:async_hooks';

const SIX=new Set(['limsman','eel','methpipe','mantrain','duckman','goflo']);
const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valid=x=>typeof x==='string'&&SAFE.test(x);
const validUuid=x=>typeof x==='string'&&UUID.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));

const BASE=['sessionId','userId','appId','workspaceOrganizationId'];
const ACTION_FIELDS=Object.freeze({
 bind:[...BASE,'nativeUserId','nativeOrganizationId'],
 migrate:[...BASE,'nativeOrganizationId'],
 revoke:BASE
});

export class NativeLinkProvisioningError extends Error{
 constructor(code='native_operator_access_denied'){super(code);this.code=code;}
}
const deny=()=>{throw new NativeLinkProvisioningError();};

/**
 * getIdentityStore is a late-bound PRIVATE getter. It allows identity-store
 * construction with the controller's adapters, without circular imports.
 *
 * This is not a browser-facing API. A future HTTP management route still
 * needs a separate authenticated Origin/CSRF/authorization review.
 */
export function createWorkspaceNativeLinkProvisioner({
 getIdentityStore,organizationStore,verifyNativeOwnership,clock=Date.now
}={}){
 if(typeof getIdentityStore!=='function'||!organizationStore||
    ['currentSessionOrganization','verifiedNativePermissionCandidate',
     'nativeProvisioningAuditRevision','nativeProvisioningAcquireCommitFence']
      .some(k=>typeof organizationStore[k]!=='function')||
    typeof verifyNativeOwnership!=='function'||typeof clock!=='function')
   throw Error('trusted_native_operator_dependencies_required');

 const scope=new AsyncLocalStorage();
 function identity(){
  const store=getIdentityStore();
  if(!store||['getParentSession','getUser','bindVerifiedOrganizationNativeLink',
   'migrateVerifiedLegacyNativeLink','revokeVerifiedOrganizationNativeLink']
   .some(k=>typeof store[k]!=='function'))
    throw Error('private_identity_store_unavailable');
  return store;
 }
 function current(ctx){
  try{
   const store=identity();
   const parent=store.getParentSession(ctx.sessionId);
   const now=clock();
   if(!Number.isSafeInteger(now)||now<=0||!parent||
      parent.id!==ctx.sessionId||parent.subject!==ctx.actorId||
      !Number.isSafeInteger(parent.expiresAt)||
      parent.expiresAt<=now||parent.passwordChangeRequired===true)
     return false;
   const actor=store.getUser(ctx.actorId);
   if(!actor||actor.id!==ctx.actorId||actor.state!=='active')
     return false;
   const selected=organizationStore.currentSessionOrganization({
    sessionId:ctx.sessionId,accountId:ctx.actorId
   });
   if(!selected||selected.id!==ctx.workspaceOrganizationId||
      selected.admin!==true)return false;
   // A short-lived native proof may run across admin demote/re-add,
   // role disable/enable, seat cancellation/recovery, etc. Checking only
   // final boolean permissions would miss an ABA policy change.
   const revision=organizationStore.nativeProvisioningAuditRevision({
    organizationId:ctx.workspaceOrganizationId,
    accountId:ctx.actorId,sessionId:ctx.sessionId
   });
   if(!revision||!Number.isSafeInteger(revision.organizationAuditRevision)||
      !Number.isSafeInteger(revision.sessionLockEpoch)||
      revision.organizationAuditRevision!==ctx.auditRevision||
      revision.sessionLockEpoch!==ctx.sessionLockEpoch)
     return false;

   // Deprovision even if target member was suspended, seat expired, or
   // license removed, but require a CURRENT authenticated org admin.
   if(ctx.operation==='revoke')return true;

   const target=store.getUser(ctx.userId);
   if(!target||target.id!==ctx.userId||target.state!=='active')
     return false;
   const proof=organizationStore.verifiedNativePermissionCandidate({
    organizationId:ctx.workspaceOrganizationId,
    accountId:ctx.userId,appId:ctx.appId,permission:'workspace.view'
   });
   if(!proof||proof.source!=='verified_live_subscription_ledger'||
      proof.organizationId!==ctx.workspaceOrganizationId||
      proof.accountId!==ctx.userId||proof.appId!==ctx.appId||
      proof.permission!=='workspace.view'||
      proof.nativeEnforcementRequired!==true||
      proof.accessGranted!==false||proof.licensesGranted!==false||
      !Number.isSafeInteger(proof.verifiedPaidThroughMs)||
      proof.verifiedPaidThroughMs<=now)return false;
   return true;
  }catch{return false;}
 }

 function matchesScope(tuple){
  const ctx=scope.getStore();
  if(!ctx||!tuple||typeof tuple!=='object')return false;
  if(tuple.operation!==ctx.operation||
     tuple.actorId!==ctx.actorId||tuple.userId!==ctx.userId||
     tuple.appId!==ctx.appId||
     tuple.workspaceOrganizationId!==ctx.workspaceOrganizationId)return false;
  if(ctx.operation!=='revoke'){
   if(!valid(tuple.nativeUserId)||
      tuple.nativeOrganizationId!==ctx.nativeOrganizationId)return false;
   if(ctx.operation==='bind'&&tuple.nativeUserId!==ctx.nativeUserId)
     return false;
  }
  return true;
 }

 // The private commit fence must be taken AFTER the native HTTPS await
 // but BEFORE the last role/seat check and the canonical identity INSERT.
 // A separate SQLite writer cannot modify the organization while held.
 function takeCommitFence(ctx){
  if(ctx.guard.lease!==null)return false;
  const lease=organizationStore.nativeProvisioningAcquireCommitFence({
   organizationId:ctx.workspaceOrganizationId,accountId:ctx.actorId,
   sessionId:ctx.sessionId,
   organizationAuditRevision:ctx.auditRevision,
   sessionLockEpoch:ctx.sessionLockEpoch
  });
  if(!lease||typeof lease.release!=='function')return false;
  ctx.guard.lease=lease;
  return current(ctx)===true;
 }
 const adapters=Object.freeze({
  async authorizeMutation(tuple){
   const ctx=scope.getStore();
   if(!matchesScope(tuple)||!current(ctx))return false;
   if(ctx.operation==='revoke'&&ctx.guard.lease===null)
     return takeCommitFence(ctx);
   // For binds/migrations, initial authorization is pre-native; later
   // authorization MUST still be fenced by the verified native proof.
   return !ctx.guard.nativeVerified||ctx.guard.lease!==null;
  },
  async verifyNativeOwnership(tuple){
   const ctx=scope.getStore();
   if(!matchesScope(tuple)||ctx.operation==='revoke'||!current(ctx)||
      ctx.guard.nativeVerified||ctx.guard.lease!==null)
    return false;
   let verified;
   try{verified=(await verifyNativeOwnership(tuple))===true;}
   catch{return false;}
   if(!verified||!current(ctx))return false;
   // No external calls inside the fence. The identity store performs only
   // one final awaited local authority callback + synchronous SQLite commit.
   if(!takeCommitFence(ctx))return false;
   ctx.guard.nativeVerified=true;
   return true;
  }
 });

 async function invoke(operation,request){
  const keys=ACTION_FIELDS[operation];
  if(!keys||!exact(request,keys)||
     !validUuid(request.sessionId)||!validUuid(request.userId)||
     !SIX.has(request.appId)||!valid(request.workspaceOrganizationId)||
     (operation!=='revoke'&&!valid(request.nativeOrganizationId))||
     (operation==='bind'&&!valid(request.nativeUserId)))
    deny();
  const store=identity();
  // ActorId is derived from a real central parent, never from request JSON.
  const parent=store.getParentSession(request.sessionId);
  if(!parent||!validUuid(parent.subject))deny();
  // Read the durable monotonic audit generation BEFORE creating the
  // trusted per-request scope. Every callback compares it after native IO.
  const revision=organizationStore.nativeProvisioningAuditRevision({
   organizationId:request.workspaceOrganizationId,
   accountId:parent.subject,sessionId:request.sessionId
  });
  if(!revision||!Number.isSafeInteger(revision.organizationAuditRevision)||
     revision.organizationAuditRevision<=0||
     !Number.isSafeInteger(revision.sessionLockEpoch)||
     revision.sessionLockEpoch<=0)deny();
  const ctx=Object.freeze({
   guard:{nativeVerified:false,lease:null},
   operation,auditRevision:revision.organizationAuditRevision,
   sessionLockEpoch:revision.sessionLockEpoch,
   sessionId:request.sessionId,actorId:parent.subject,
   userId:request.userId,appId:request.appId,
   workspaceOrganizationId:request.workspaceOrganizationId,
   ...(operation!=='revoke'?{
    nativeOrganizationId:request.nativeOrganizationId}:{}),
   ...(operation==='bind'?{nativeUserId:request.nativeUserId}:{})
  });
  if(!current(ctx))deny();
  return scope.run(ctx,async()=>{
   try{
   let result;
   const base={actorId:ctx.actorId,userId:ctx.userId,appId:ctx.appId,
    workspaceOrganizationId:ctx.workspaceOrganizationId};
   if(operation==='bind')result=await store.bindVerifiedOrganizationNativeLink({
    ...base,nativeUserId:ctx.nativeUserId,
    nativeOrganizationId:ctx.nativeOrganizationId
   });
   else if(operation==='migrate')result=await store.migrateVerifiedLegacyNativeLink({
    ...base,nativeOrganizationId:ctx.nativeOrganizationId
   });
   else result=await store.revokeVerifiedOrganizationNativeLink(base);
   if(!result||typeof result.applied!=='boolean')deny();
   if(result.link&&(
       result.link.accessGranted!==false||
       result.link.licensesGranted!==false||
       result.link.loginEnabled!==false||result.link.linkOnly!==true))
     deny();
   return result;
   }finally{
    // Also releases on SQLite conflict, failed final authorization,
    // native timeout, failed revoke or unexpected identity errors.
    const lease=ctx.guard.lease;
    ctx.guard.lease=null;
    ctx.guard.nativeVerified=false;
    if(lease)lease.release();
   }
  });
 }
 return Object.freeze({
  adapters,
  bind:request=>invoke('bind',request),
  migrate:request=>invoke('migrate',request),
  revoke:request=>invoke('revoke',request)
 });
}
