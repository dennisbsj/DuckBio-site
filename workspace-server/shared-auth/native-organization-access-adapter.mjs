/**
 * DORMANT, PRIVATE, broker-compatible ORGANIZATION SSO decision adapter.
 * This module is intentionally NOT imported by the active Workspace runtime.
 * It requires the reviewed inspector's signed native ownership verification,
 * real LIVE per-app seat ledger, current user/session/org and scoped native link.
 * It is not native resource authorization: each app must enforce its own ACL.
 *
 * Do not mount, deploy or activate until independent native + billing + MFA
 * review, eight-service HTTPS staging and rollback testing are complete.
 */
import {createHash} from 'node:crypto';

const APPS = new Set(['limsman','goflo','methpipe','eel','duckman','mantrain']);
const safeId = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const roleName = x => typeof x === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,47}$/.test(x) && x === x.trim();
const positive = x => Number.isSafeInteger(x) && x > 0;
const PERMISSION = 'workspace.view';

/**
 * A trustworthy inspector must be created server-side using
 * createWorkspaceNativeAccessInspector + a native Ed25519 verifier.
 * Browser-supplied claims or fake ownership proofs are NEVER input here.
 */
export function createNativeOrganizationBrokerAccessAdapter({
  identity, identityStore, organizationStore, inspector, clock = Date.now
} = {}) {
  for (const method of ['getSession','authenticate','getParentSession','logout'])
    if (typeof identity?.[method] !== 'function') throw Error('trusted_identity_adapter_required');
  for (const method of ['getParentSession','getUser','getOrganizationNativeLink'])
    if (typeof identityStore?.[method] !== 'function') throw Error('trusted_identity_store_required');
  for (const method of ['currentSessionOrganization','verifiedNativePermissionCandidate'])
    if (typeof organizationStore?.[method] !== 'function') throw Error('trusted_live_organization_store_required');
  if (typeof inspector?.inspect !== 'function' || typeof clock !== 'function')
    throw Error('signed_native_inspector_required');

  function current(parent, appId) {
    try {
      const now = clock();
      if (!parent || !safeId(parent.id) || !safeId(parent.subject) || !APPS.has(appId) ||
          !Number.isSafeInteger(now) || now <= 0) return null;
      const active = identityStore.getParentSession(parent.id);
      if (!active || active.id !== parent.id || active.subject !== parent.subject ||
          !Number.isSafeInteger(active.expiresAt) || active.expiresAt <= now ||
          active.passwordChangeRequired === true) return null;
      const user = identityStore.getUser(parent.subject);
      if (!user || user.id !== parent.subject || user.state !== 'active') return null;
      const selected = organizationStore.currentSessionOrganization({
        sessionId: active.id, accountId: active.subject
      });
      if (!selected || !safeId(selected.id) || !positive(selected.sessionSelectionRevision))
        return null;
      const policy = organizationStore.verifiedNativePermissionCandidate({
        organizationId: selected.id, accountId: active.subject,
        appId, permission: PERMISSION
      });
      if (!policy || policy.source !== 'verified_live_subscription_ledger' ||
          policy.organizationId !== selected.id || policy.accountId !== active.subject ||
          policy.appId !== appId || policy.permission !== PERMISSION ||
          policy.accessGranted !== false || policy.licensesGranted !== false ||
          policy.nativeEnforcementRequired !== true ||
          !roleName(policy.role) || !positive(policy.authorizationAuditRevision) ||
          !Number.isSafeInteger(policy.verifiedPaidThroughMs) ||
          policy.verifiedPaidThroughMs <= now) return null;
      const link = identityStore.getOrganizationNativeLink({
        userId: active.subject, appId, workspaceOrganizationId: selected.id
      });
      if (!link || link.userId !== active.subject || link.appId !== appId ||
          link.workspaceOrganizationId !== selected.id ||
          link.linkOnly !== true || link.accessGranted !== false ||
          link.licensesGranted !== false || link.loginEnabled !== false ||
          !safeId(link.nativeUserId) || !safeId(link.nativeOrganizationId) ||
          !positive(link.linkRevision)) return null;
      return Object.freeze({
        sessionId: active.id, subject: active.subject, appId,
        organizationId: selected.id,
        sessionSelectionRevision: selected.sessionSelectionRevision,
        authorizationAuditRevision: policy.authorizationAuditRevision,
        verifiedPaidThroughMs: policy.verifiedPaidThroughMs,
        role: policy.role, nativeUserId: link.nativeUserId,
        nativeOrganizationId: link.nativeOrganizationId,
        linkRevision: link.linkRevision
      });
    } catch {
      return null; // Provider/SQLite unavailable, deny instead of fallback.
    }
  }
  function cursor(snapshot) {
    // Stable, compact per-session authorization generation (<128 bytes).
    // A role revoke/regrant or same-tenant clear/reselect must change it.
    const tuple = [
      snapshot.sessionId, snapshot.subject, snapshot.appId,
      snapshot.organizationId, snapshot.sessionSelectionRevision,
      snapshot.authorizationAuditRevision, snapshot.linkRevision,
      snapshot.role, snapshot.verifiedPaidThroughMs,
      snapshot.nativeUserId, snapshot.nativeOrganizationId
    ];
    return 'org-native-v1:' + createHash('sha256')
      .update(JSON.stringify(tuple)).digest('base64url');
  }
  async function getAccess(parent, appId) {
    const first = current(parent, appId);
    if (!first) return null;
    let candidate;
    try {
      candidate = await inspector.inspect({
        sessionId:first.sessionId, organizationId:first.organizationId,
        appId, permission:PERMISSION
      });
    } catch { return null; }
    // The read-only inspector's result is signed-owner preflight evidence;
    // never copy its accessGranted/loginEnabled flags into this response.
    // Full real policy is rechecked against the trusted stores after await.
    if (!candidate || candidate.candidateReady !== true ||
        candidate.accessGranted !== false || candidate.licensesGranted !== false ||
        candidate.loginEnabled !== false || candidate.nativeEnforcementRequired !== true ||
        candidate.workspaceAccountId !== first.subject ||
        candidate.workspaceOrganizationId !== first.organizationId ||
        candidate.appId !== appId || candidate.permission !== PERMISSION ||
        candidate.nativeUserId !== first.nativeUserId ||
        candidate.nativeOrganizationId !== first.nativeOrganizationId ||
        candidate.authorizationAuditRevision !== first.authorizationAuditRevision ||
        candidate.verifiedPaidThroughMs !== first.verifiedPaidThroughMs ||
        candidate.role !== first.role) return null;
    const last = current(parent,appId);
    if (!last || cursor(first) !== cursor(last)) return null;
    return Object.freeze({
      localIdentity: Object.freeze({
        userId:last.nativeUserId,organizationId:last.nativeOrganizationId
      }),
      bindingRevision:cursor(last)
    });
  }
  return Object.freeze({
    getSession:req=>identity.getSession(req),
    authenticate:(req,res,credentials)=>identity.authenticate(req,res,credentials),
    getParentSession:id=>identity.getParentSession(id),
    logout:id=>identity.logout(id),
    getAccess
  });
}
