import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runDisposableWorkspaceRecoveryDrill} from '../staging-recovery-drill.mjs';

test('disposable Workspace recovery preserves native separation, owner identity and organizations after SQLite restore',
 {timeout:120000},async()=>{
  const result=await runDisposableWorkspaceRecoveryDrill();
  assert.equal(result.ok,true);
  assert.deepEqual(result.checks,[
   'private_config','fresh_health','first_admin_no_app_grants',
   'stopped_sqlite_snapshot_integrity','restored_health',
   'restored_owner_login','restored_organization_isolation'
  ]);
 });
test('recovery CLI refuses any implicit invocation without explicit disposable-only opt-in',()=>{
 const script=fileURLToPath(new URL('../staging-recovery-drill.mjs',import.meta.url));
 const command=spawnSync(process.execPath,[script],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(command.status,2);
 assert.match(command.stderr,/confirm-disposable-only/);
 assert.equal(command.stdout,'');
});
