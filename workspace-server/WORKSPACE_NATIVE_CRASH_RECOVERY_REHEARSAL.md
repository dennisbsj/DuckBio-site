# Private SIGKILL/SQLite recovery rehearsal — tests only

This draft stacks on PR #159 (read-only two-file SQLite snapshot drift auditing) and #158 (opt-in final-commit write fence). It does not change runtime, broker, native apps, DataDuck or live Stripe. It never touches customer data.

## Real killed subprocesses

`tests/native-crash-injection-recovery.test.mjs` launches a separate Node.js subprocess through `tests/helpers/native-recovery-crash-child.mjs`, on a real **disposable** local SQLite WAL file. The child refuses paths outside the known temporary test prefix. It sends `READY` only after a test-only `BEGIN IMMEDIATE` write, and the parent sends actual `SIGKILL` to **that child process only**. The tests then create fresh permission-0600 `VACUUM INTO` snapshots and run the existing read-only dual-DB inspector.

The cases are:
1. Kill an uncommitted organization-member deactivation while it holds a write lock. The opted-in final-commit fence must be blocked while locked, recover after kill, and preserve the previously committed member state.
2. Kill an uncommitted native-identity link deletion. The canonical link and audit history must survive SQLite WAL recovery.
3. Commit a member deactivation in the organization DB, then kill before reconciling the identity DB. The auditor must detect an orphaned active native link and deny restore — including when combining differently timed identity/organization snapshots.
4. Commit a native link revocation, then kill before coordinated organization processing. The native link must disappear, revocation audit must remain, but the apparently clean offline report must **still** deny recovery.

This deliberately demonstrates why **two independent SQLite commits are not atomically consistent** even though each database individually preserves a valid WAL state.

## Strict boundaries

A process kill is not a power-outage simulation and does not certify storage/remote filesystem durability, native service ownership or genuine Stripe LIVE evidence. No runtime auth change, auto-restore, grant, licence, native API or production environment is introduced. An offline audit NEVER approves recovery: `recoveryApproved:false`, `loginEnabled:false`, `accessGranted:false` and `licensesGranted:false`. Coordinated backup generations, kill/power-loss/restore reconciliation, native resource ACL and eight-origin HTTPS staging remain blockers under #140 and #26.

Keep draft/unmerged/undeployed. The helper must remain a test-only fixture; do not invoke it on production paths.
