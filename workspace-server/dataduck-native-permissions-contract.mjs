/**
 * DORMANT DataDuck ↔ Workspace PERMISSION COMPATIBILITY CONTRACT.
 *
 * Scoped to the exact DataDuck draft v0.27 native route-policy categories
 * (source workspace-route-policy.mjs, blob fed3c4f462157640160f948e7105056bc1346c93).
 * The central Workspace catalog does not yet activate DataDuck, and the
 * native DataDuck backend is not imported or modified by this module.
 *
 * A positive compatibility result is NEVER a login, license, seat, native
 * permission or route authorization. Native DataDuck checks the active
 * native session, tenant, role, resource ownership and live paid entitlement
 * independently for every request.
 */
export const DATADUCK_NATIVE_ROLES=Object.freeze([
 'Admin','Analyst','Reviewer','ReadOnly'
]);

// EXACT native route classification names from DataDuck's unmounted policy.
// Route names are future Workspace-editable permissions, except self-service
// logout which should never depend on an administrator-granted permission.
const actions=[
 ['auth.me','read'],['capabilities','read'],
 ['projects.list','read'],['projects.create','write'],
 ['project.get','read'],['project.update','write'],
 ['project.delete','admin'],['project.deletion_summary','admin'],
 ['datasets.list','read'],['datasets.create','write'],
 ['figures.list','read'],['figures.create','write'],
 ['dataset.derive','write'],
 ['admin.users','admin'],['admin.user_status','admin'],
 ['admin.user_role','admin'],
 ['auth.logout','self'],['auth.logout_all','self']
];
export const DATADUCK_NATIVE_ACTIONS=Object.freeze(
 actions.map(([name,category])=>Object.freeze({name,category,editable:category!=='self'}))
);
export const DATADUCK_WORKSPACE_PERMISSIONS=Object.freeze(
 DATADUCK_NATIVE_ACTIONS.filter(x=>x.editable).map(x=>x.name).sort()
);
const byAction=new Map(DATADUCK_NATIVE_ACTIONS.map(x=>[x.name,x]));
const nativeCategories=new Map([
 ['Admin',new Set(['read','write','admin','self'])],
 ['Analyst',new Set(['read','write','self'])],
 ['Reviewer',new Set(['read','self'])],
 ['ReadOnly',new Set(['read','self'])]
]);
const deny=reason=>Object.freeze({compatible:false,accessGranted:false,
 licensesGranted:false,nativeEnforcementRequired:true,reason});

/**
 * Pure read-only preview of Workspace permissions intersected with native
 * coarse DataDuck roles. workspacePermissions MUST be obtained from the
 * trusted Workspace org-scoped catalog, nativeRole from trusted DataDuck
 * local SQLite. Never use browser-supplied role / permission assertions.
 *
 * Granular Workspace decisions alone cannot safely authorize scientific
 * operations or override DataDuck's native/project/record-level guard.
 */
export function inspectDataDuckPermissionCompatibility({
 nativeRole,workspacePermissions,action
}={}){
 if(!nativeCategories.has(nativeRole)||typeof action!=='string'||
    !byAction.has(action))return deny('unknown_native_role_or_action');
 if(!Array.isArray(workspacePermissions)||
    workspacePermissions.length>DATADUCK_WORKSPACE_PERMISSIONS.length||
    new Set(workspacePermissions).size!==workspacePermissions.length||
    workspacePermissions.some(p=>typeof p!=='string'||
      !DATADUCK_WORKSPACE_PERMISSIONS.includes(p)))
   return deny('invalid_workspace_permission_set');
 const route=byAction.get(action);
 const nativeRoleEligible=nativeCategories.get(nativeRole).has(route.category);
 if(!nativeRoleEligible)return Object.freeze({
  compatible:false,nativeRoleEligible:false,workspacePermissionSelected:
    workspacePermissions.includes(action),
  accessGranted:false,licensesGranted:false,nativeEnforcementRequired:true,
  reason:'native_role_restriction'
 });
 if(!route.editable)
  return Object.freeze({compatible:true,nativeRoleEligible:true,
    workspacePermissionSelected:null,appId:'dataduck',action,
    selfService:true,accessGranted:false,licensesGranted:false,
    nativeEnforcementRequired:true,reason:'self_service_native_guard_required'});
 const selected=workspacePermissions.includes(action);
 return Object.freeze({compatible:selected,nativeRoleEligible:true,
  workspacePermissionSelected:selected,appId:'dataduck',action,
  selfService:false,accessGranted:false,licensesGranted:false,
  nativeEnforcementRequired:true,
  reason:selected?'source_contract_only':'workspace_permission_denied'});
}
