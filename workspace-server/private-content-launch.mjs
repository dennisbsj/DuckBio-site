// Strict private navigation to globally registered native DuckBio resource IDs.
// A deep link is NEVER a native auth token, broker grant or paid app seat.
// Trusted native resolver must independently check the resource in its own DB.
const prefixes={ld:'limsman',dm:'duckman',dn:'eel',cd:'goflo',md:'methpipe',dt:'mantrain'};
const contentPattern=/^(ld|dm|dn|cd|md|dt)[0-9]{6,}$/;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;

export async function authorizedContentDestination({
 contentId,viewerId,sessionId,identityStore,resolveResource,clients,
 organizationStore
}={}){
 if(!safeId(viewerId)||!safeId(sessionId)||
    typeof contentId!=='string'||!contentPattern.test(contentId)||
    typeof resolveResource!=='function'||!Array.isArray(clients)||
    typeof identityStore?.getParentSession!=='function'||
    typeof identityStore?.getOrganizationNativeLink!=='function'||
    typeof organizationStore?.currentSessionOrganization!=='function'||
    typeof organizationStore?.verifiedNativePermissionCandidate!=='function')
  return null;
 const expectedApp=prefixes[contentId.slice(0,2)];
 // Never select an arbitrary native client by array order.
 const matching=clients.filter(x=>x?.appId===expectedApp);
 if(matching.length!==1)return null;
 const client=matching[0];
 if(typeof client.nativeOrigin!=='string')return null;
 let origin;
 try{origin=new URL(client.nativeOrigin);}catch{return null;}
 if(origin.origin!==client.nativeOrigin||origin.protocol!=='https:'||
    origin.username||origin.password||origin.pathname!=='/'||
    origin.search||origin.hash)return null;

 function currentAuthority(){
  try{
   const parent=identityStore.getParentSession(sessionId);
   if(!parent||parent.id!==sessionId||parent.subject!==viewerId)return null;
   const selected=organizationStore.currentSessionOrganization({
    sessionId,accountId:viewerId
   });
   if(!selected||!safeId(selected.id)||
      !positive(selected.sessionSelectionRevision))return null;
   const orgId=selected.id;
   // Central role+permission, active membership and a verified LIVE paid
   // subscription are required even for navigation, not only for SSO.
   const permission=organizationStore.verifiedNativePermissionCandidate({
    organizationId:orgId,accountId:viewerId,appId:expectedApp,
    permission:'workspace.view'
   });
   if(!permission||permission.organizationId!==orgId||
      permission.accountId!==viewerId||permission.appId!==expectedApp||
      permission.permission!=='workspace.view'||
      permission.source!=='verified_live_subscription_ledger'||
      permission.nativeEnforcementRequired!==true||
      permission.accessGranted!==false||permission.licensesGranted!==false||
      !positive(permission.authorizationAuditRevision)||
      !Number.isSafeInteger(permission.verifiedPaidThroughMs)||
      permission.verifiedPaidThroughMs<=0)return null;
   const link=identityStore.getOrganizationNativeLink({
    userId:viewerId,appId:expectedApp,workspaceOrganizationId:orgId
   });
   if(!link||link.userId!==viewerId||link.appId!==expectedApp||
      link.workspaceOrganizationId!==orgId||
      !safeId(link.nativeUserId)||!safeId(link.nativeOrganizationId)||
      !positive(link.linkRevision)||link.linkOnly!==true||
      link.accessGranted!==false||link.licensesGranted!==false||
      link.loginEnabled!==false)return null;
   return {organizationId:orgId,
    sessionRevision:selected.sessionSelectionRevision,
    authorizationRevision:permission.authorizationAuditRevision,
    paidThrough:permission.verifiedPaidThroughMs,
    linkRevision:link.linkRevision,
    nativeUserId:link.nativeUserId,
    nativeOrganizationId:link.nativeOrganizationId};
  }catch{return null;} // Missing/corrupt/temporarily unavailable authority: deny.
 }
 const first=currentAuthority();
 if(!first)return null;

 let resolved;
 try{
  // Browser supplies only the opaque content ID; all other values are trusted
  // private Workspace/verified-native records, not URL query assertions.
  resolved=await resolveResource({
   contentId,viewerId,appId:expectedApp,
   organizationId:first.organizationId,
   nativeUserId:first.nativeUserId,
   nativeOrganizationId:first.nativeOrganizationId
  });
 }catch{return null;}
 if(!resolved||resolved.authorized!==true||
    resolved.appId!==expectedApp||
    resolved.organizationId!==first.organizationId||
    resolved.nativeUserId!==first.nativeUserId||
    resolved.nativeOrganizationId!==first.nativeOrganizationId||
    typeof resolved.url!=='string')return null;

 const second=currentAuthority();
 if(!second||Object.keys(first).some(key=>first[key]!==second[key]))
  return null; // Session-org, role, seat or scoped native link ABA in-flight.

 let target;
 try{target=new URL(resolved.url);}catch{return null;}
 // An HTTPS destination without credentials, query or bearer fragment is
 // navigation only; the native application must still authenticate each GET.
 if(target.origin!==origin.origin||target.protocol!=='https:'||
    target.username||target.password||target.search||target.hash||
    target.pathname!=='/content/'+contentId)return null;
 return target.href;
}
