/**
 * DORMANT broker-compatible adapter for security-only native SSO rehearsal.
 *
 * It permits existing Workspace credentials / parent-session lookup but
 * NEVER returns an application grant to the real PKCE broker. A positive
 * read-only native candidate is NOT an app login entitlement.
 *
 * NOT imported in production runtime. No browser route or feature toggle.
 */
const CURRENT_APPS = new Set(['limsman','goflo','methpipe','eel','duckman','mantrain']);
const safe = value => typeof value === 'string' &&
  /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const denied = reason => Object.freeze({
  candidateReady:false,accessGranted:false,
  licensesGranted:false,loginEnabled:false,reason
});

export function createWorkspaceNativeBrokerDenyAdapter({
  identity, organizationStore, inspector, permissions
} = {}) {
  for (const method of ['getSession','authenticate','getParentSession','logout']) {
    if (typeof identity?.[method] !== 'function')
      throw Error('trusted_parent_identity_adapter_required');
  }
  if (typeof organizationStore?.currentSessionOrganization !== 'function' ||
      typeof inspector?.inspect !== 'function')
    throw Error('trusted_private_native_inspector_required');
  if (!permissions || typeof permissions !== 'object' ||
      Array.isArray(permissions) || Object.keys(permissions).length === 0 ||
      Object.entries(permissions).some(([appId, permission]) =>
        !CURRENT_APPS.has(appId) || !safe(permission)))
    throw Error('explicit_six_app_permission_map_required');

  const permissionMap = Object.freeze({...permissions});

  async function inspectParent(parent, appId) {
    if (!parent || !safe(parent.id) || !safe(parent.subject) ||
        !CURRENT_APPS.has(appId) || !permissionMap[appId])
      return denied('unknown_parent_or_app');
    try {
      // Use the *server-side* parent session to select the organization.
      // Browser-supplied organization IDs are deliberately not accepted.
      const current = await identity.getParentSession(parent.id);
      if (!current || current.id !== parent.id ||
          current.subject !== parent.subject ||
          current.passwordChangeRequired === true)
        return denied('parent_session_missing_or_changed');
      const selected = organizationStore.currentSessionOrganization({
        sessionId:current.id,accountId:current.subject
      });
      if (!selected || !safe(selected.id))
        return denied('session_organization_missing');
      const result = await inspector.inspect({
        sessionId:current.id,organizationId:selected.id,
        appId,permission:permissionMap[appId]
      });
      // Re-read the session and locked tenant after any awaited native call.
      const latest = await identity.getParentSession(parent.id);
      const finalSelection = latest && organizationStore.currentSessionOrganization({
        sessionId:latest.id,accountId:latest.subject
      });
      if (!latest || latest.id !== current.id ||
          latest.subject !== current.subject ||
          !finalSelection || finalSelection.id !== selected.id)
        return denied('session_or_tenant_changed_during_inspection');
      // A malformed verifier response cannot promote login or licensing.
      if (result?.candidateReady !== true ||
          result.accessGranted !== false ||
          result.licensesGranted !== false ||
          result.loginEnabled !== false ||
          result.nativeEnforcementRequired !== true ||
          result.workspaceAccountId !== current.subject ||
          result.workspaceOrganizationId !== selected.id ||
          result.appId !== appId ||
          result.permission !== permissionMap[appId])
        return denied('no_verified_native_candidate');
      return Object.freeze({...result,
        accessGranted:false,licensesGranted:false,loginEnabled:false});
    } catch {
      // Never leak the native verifier's error or trust a legacy grant.
      return denied('native_preflight_unavailable');
    }
  }

  return Object.freeze({
    // This is a PRIVATE diagnostic seam, never a web API.
    inspectCandidate:inspectParent,
    async getSession(req) { return identity.getSession(req); },
    async authenticate(req,res,credentials) {
      return identity.authenticate(req,res,credentials);
    },
    async getParentSession(id) { return identity.getParentSession(id); },
    async logout(parentSessionId) { return identity.logout(parentSessionId); },
    async getAccess(parent,appId) {
      // Exercise the full session / org / paid seat / native preflight.
      // A candidate is intentionally NOT an authorization decision.
      await inspectParent(parent,appId);
      return null;
    }
  });
}
