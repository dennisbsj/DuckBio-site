/**
 * Private, DORMANT SSO authorization preflight for the six currently
 * registered apps and the unreleased DataDuck seventh candidate.
 *
 * This module has no HTTP route and is never invoked by the active broker.
 * Even a fully verified candidate NEVER issues a login, native privilege,
 * app seat, bearer token or per-request authorization. Native apps must
 * separately enforce their own current project/resource/role permissions.
 *
 * Sources of authority:
 *  - Central parent session + active account from identityStore
 *  - Exact session-locked central organization from organizationStore
 *  - Current app assignment, edited roles + effective permissions and
 *    independently verified LIVE paid seat from organizationStore
 *  - Explicit organization-scoped mapping from the canonical identity
 *    store (no legacy (user,app) fallback), confirmed by
 *    an authoritative native-app verifier (no email joins).
 */
export const WORKSPACE_NATIVE_APPS=Object.freeze([
 'limsman','goflo','methpipe','eel','duckman','mantrain','dataduck'
]);
const CURRENT=new Set(WORKSPACE_NATIVE_APPS.filter(x=>x!=='dataduck'));
const safe=value=>typeof value==='string'&&
 /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const safeRole=value=>typeof value==='string'&&
 /^[A-Za-z][A-Za-z0-9 _-]{0,47}$/.test(value)&&value===value.trim();
const deny=reason=>Object.freeze({candidateReady:false,accessGranted:false,
 licensesGranted:false,loginEnabled:false,reason});

/**
 * verifyNativeMapping is a REQUIRED private server-to-server check:
 * it MUST return true only after the native backend validates the exact
 * native user/tenant tuple and current identity ownership.
 * This library never trusts browser-supplied roles, email or claimed seats.
 */
export function createWorkspaceNativeAccessInspector({
 identityStore,organizationStore,verifyNativeMapping,clock=Date.now
}={}){
 for(const [store,methods] of [
  [identityStore,['getParentSession','getUser','getOrganizationNativeLink']],
  [organizationStore,['currentSessionOrganization','verifiedNativePermissionCandidate']]
 ])if(!store||methods.some(method=>typeof store[method]!=='function'))
   throw Error('private_access_stores_required');
 if(typeof verifyNativeMapping!=='function'||typeof clock!=='function')
   throw Error('trusted_native_mapping_verifier_required');

 function current(sessionId,organizationId,appId,permission){
  const parent=identityStore.getParentSession(sessionId);
  if(!parent||parent.id!==sessionId||!safe(parent.subject)||
     !Number.isSafeInteger(parent.expiresAt)||parent.expiresAt<=clock()||
     parent.passwordChangeRequired===true)return null;
  const user=identityStore.getUser(parent.subject);
  if(!user||user.id!==parent.subject||user.state!=='active')return null;
  const selected=organizationStore.currentSessionOrganization({
   sessionId,accountId:parent.subject
  });
  if(!selected||selected.id!==organizationId||
     !Number.isSafeInteger(selected.sessionSelectionRevision)||
     selected.sessionSelectionRevision<=0)return null;
  const policy=organizationStore.verifiedNativePermissionCandidate({
   organizationId,accountId:parent.subject,appId,permission
  });
  if(!policy||policy.source!=='verified_live_subscription_ledger'||
     policy.accessGranted!==false||policy.nativeEnforcementRequired!==true||
     policy.appId!==appId||policy.accountId!==parent.subject||
     policy.organizationId!==organizationId||policy.permission!==permission||
     !safeRole(policy.role)||
     !Number.isSafeInteger(policy.authorizationAuditRevision)||
     policy.authorizationAuditRevision<1||
     !Number.isSafeInteger(policy.verifiedPaidThroughMs)||
     policy.verifiedPaidThroughMs<=clock())return null;
  // Never fall back to legacy (user,app) grants across organizations.
  // Missing explicit (user,session-locked org,app) binding always denies.
  const grant=identityStore.getOrganizationNativeLink({
   userId:parent.subject,workspaceOrganizationId:organizationId,appId
  });
  if(!grant||grant.userId!==parent.subject||
     grant.workspaceOrganizationId!==organizationId||grant.appId!==appId||
     grant.linkOnly!==true||grant.accessGranted!==false||
     grant.licensesGranted!==false||grant.loginEnabled!==false||
     !safe(grant.nativeUserId)||!safe(grant.nativeOrganizationId)||
     !Number.isSafeInteger(grant.linkRevision)||grant.linkRevision<=0)
   return null;
  return {parent,policy,nativeUserId:grant.nativeUserId,
   nativeOrganizationId:grant.nativeOrganizationId,
   linkRevision:grant.linkRevision,
   sessionSelectionRevision:selected.sessionSelectionRevision};
 }
 return Object.freeze({
  async inspect({sessionId,organizationId,appId,permission}={}){
   if(!safe(sessionId)||!safe(organizationId)||!safe(permission)||
      !WORKSPACE_NATIVE_APPS.includes(appId))
     return deny('invalid_or_unknown_app_request');
   // Main's broker, seat ledger and central app role catalog still contain
   // only six apps. DataDuck cannot become a grant through this candidate.
   if(!CURRENT.has(appId))return deny('dataduck_not_released');
   let first;
   try{first=current(sessionId,organizationId,appId,permission);}
   catch{return deny('current_access_unavailable');}
   if(!first)return deny('central_session_role_seat_or_link_missing');
   let verified=false;
   try{
    verified=(await verifyNativeMapping({appId,
     workspaceAccountId:first.parent.subject,workspaceOrganizationId:organizationId,
     nativeUserId:first.nativeUserId,
     nativeOrganizationId:first.nativeOrganizationId}))===true;
   }catch{return deny('native_mapping_unavailable');}
   if(!verified)return deny('native_mapping_unverified');
   // A native call may take time. Re-read session, account state, org lock
   // AND its durable selection revision (clear + reselect ABA), live seat,
   // and custom role/permission edits after awaiting it.
   let second;
   try{second=current(sessionId,organizationId,appId,permission);}
   catch{return deny('current_access_unavailable');}
   if(!second||first.parent.subject!==second.parent.subject||
      first.sessionSelectionRevision!==second.sessionSelectionRevision||
      first.nativeUserId!==second.nativeUserId||
      first.nativeOrganizationId!==second.nativeOrganizationId||
      first.linkRevision!==second.linkRevision||
      first.policy.role!==second.policy.role||
      first.policy.authorizationAuditRevision!==second.policy.authorizationAuditRevision||
      first.policy.verifiedPaidThroughMs!==second.policy.verifiedPaidThroughMs)
     return deny('access_changed_during_verification');
   return Object.freeze({candidateReady:true,accessGranted:false,
    licensesGranted:false,loginEnabled:false,appId,permission,
    workspaceOrganizationId:organizationId,workspaceAccountId:second.parent.subject,
    nativeUserId:second.nativeUserId,
    nativeOrganizationId:second.nativeOrganizationId,
    role:second.policy.role,
    validAt:clock(),
    verifiedPaidThroughMs:second.policy.verifiedPaidThroughMs,
    // Diagnostic only; this cursor is not a native authorization decision.
    authorizationAuditRevision:second.policy.authorizationAuditRevision,
    nativeEnforcementRequired:true});
  }
 });
}
