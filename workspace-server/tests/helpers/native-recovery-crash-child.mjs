/**
 * Test-only disposable SQLite crash worker.
 * MUST NEVER receive a real database path. The parent test creates a
 * private temporary directory and alone sends SIGKILL after READY.
 *
 * Modes:
 *  org_uncommitted: member deactivation in an open write transaction
 *  identity_uncommitted: native link deletion in an open transaction
 *  org_committed: deactivate member + audit, commit, then parent kills worker
 *  identity_committed: revoke link + audit, commit, then parent kills worker
 */
import {DatabaseSync} from 'node:sqlite';
import {realpathSync} from 'node:fs';
import os from 'node:os';

const [dbPath,mode,memberId,operatorId]=process.argv.slice(2);
const modes=new Set([
 'org_uncommitted','identity_uncommitted',
 'org_committed','identity_committed'
]);
// Hard restriction to the private temporary test fixture. This worker is
// not an operational recovery tool and cannot accept arbitrary production DBs.
if(!modes.has(mode)||typeof dbPath!=='string'||
   !realpathSync(dbPath).startsWith(realpathSync(os.tmpdir())+'/duckbio-native-crash-')||
   !/^[0-9a-f-]{36}$/i.test(memberId??'')||
   !/^[0-9a-f-]{36}$/i.test(operatorId??'')){
 process.stderr.write('disposable_test_fixture_required\n');
 process.exit(2);
}
let db;
try{
 db=new DatabaseSync(dbPath);
 db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
 if(mode.startsWith('org_')){
  const changed=db.prepare(
   "UPDATE members SET active=0 WHERE org='lab-a' AND account=?"
  ).run(memberId);
  if(changed.changes!==1)throw Error('synthetic_member_missing');
  if(mode==='org_committed'){
   db.prepare(`INSERT INTO organization_audit
    (org,actor,action,subject,details,recorded_at)
    VALUES('lab-a',?,'member.deactivated',?,'{}',1800000000000)`)
    .run(operatorId,memberId);
  }
 }else{
  const changed=db.prepare(
   "DELETE FROM suite_identity_org_native_links WHERE app_id='goflo' AND workspace_org_id='lab-a' AND user_id=?"
  ).run(memberId);
  if(changed.changes!==1)throw Error('synthetic_link_missing');
  if(mode==='identity_committed'){
   db.prepare(`INSERT INTO suite_identity_org_native_audit
    (actor_id,user_id,app_id,workspace_org_id,action,recorded_at)
    VALUES(?,?,'goflo','lab-a','link.revoked',1800000000000)`)
    .run(operatorId,memberId);
  }
 }
 if(mode.endsWith('_committed'))db.exec('COMMIT');
 process.stdout.write('READY\n');
 // Keep the process alive with the transaction/connection open until the
 // parent sends SIGKILL. Do NOT add automatic commits or cleanup handlers.
 setInterval(()=>{},1000);
}catch(error){
 try{db?.exec('ROLLBACK')}catch{}
 try{db?.close()}catch{}
 process.stderr.write('synthetic_crash_worker_failed: '+error.message+'\n');
 process.exit(3);
}
