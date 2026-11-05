import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureNativeOrganizationAuditSchema as ensure,IDENTITY_NATIVE_AUDIT_APPLICATION_ID as MARKER} from '../shared-auth/native-org-audit-schema-guard.mjs';
const has=(db,t)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
const audit='suite_identity_org_native_audit';
const links='suite_identity_org_native_links';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-native-audit-schema-'));
 const file=join(dir,'identity.sqlite');
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const open=()=>new DatabaseSync(file);
 return {open};
}
function init(db){db.exec('BEGIN IMMEDIATE');try{ensure(db);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}

test('first native-use migration persists a distinct SQLite header marker atomically',t=>{
 const f=fixture(t),db=f.open();
 init(db);
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,MARKER);
 assert(has(db,links));assert(has(db,audit));
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,0,
  'native audit marker must not collide with global grant user_version');
 db.close();
 const another=f.open();
 assert.equal(another.prepare('PRAGMA application_id').get().application_id,MARKER);
 init(another);another.close();
});

test('first native-use migration must roll back both tables and header when interrupted',t=>{
 const f=fixture(t),db=f.open();
 db.exec('BEGIN IMMEDIATE');ensure(db);
 assert(has(db,audit));assert.equal(db.prepare('PRAGMA application_id').get().application_id,MARKER);
 db.exec('ROLLBACK');
 assert(!has(db,audit));assert(!has(db,links));
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,0);
 db.close();
});

test('deleting native audit but keeping live identity table fails closed without re-seeding',t=>{
 const f=fixture(t),db=f.open();init(db);
 db.exec('DROP TABLE suite_identity_org_native_audit');db.close();
 const restored=f.open();
 assert.throws(()=>init(restored),/invalid_native_link_revision/);
 assert(!has(restored,audit));assert(has(restored,links));
 assert.equal(restored.prepare('PRAGMA application_id').get().application_id,MARKER);
 restored.close();
});

test('deleting both native tables after initial migration is not treated as a fresh install',t=>{
 const f=fixture(t),db=f.open();init(db);
 db.exec('DROP TABLE suite_identity_org_native_links; DROP TABLE suite_identity_org_native_audit');
 assert.throws(()=>init(db),/invalid_native_link_revision/);
 assert(!has(db,audit));assert(!has(db,links));db.close();
});

test('legacy DB with only one native table present is not silently repaired',t=>{
 const f=fixture(t),db=f.open();init(db);
 db.exec('DROP TABLE suite_identity_org_native_audit; PRAGMA application_id=0');
 assert.throws(()=>init(db),/invalid_native_link_revision/);
 assert(!has(db,audit));db.close();
});

test('genuine unmarked legacy tables retain historical audit IDs on first marker migration',t=>{
 const f=fixture(t),db=f.open();init(db);
 db.exec('PRAGMA application_id=0');
 db.prepare(`INSERT INTO suite_identity_org_native_audit
 (actor_id,user_id,app_id,workspace_org_id,action,recorded_at)
 VALUES(?,?,?,?,?,?)`).run('operator','user','goflo','tenant','link.bound',1800000000000);
 const prior=db.prepare('SELECT MAX(id) AS id FROM suite_identity_org_native_audit').get().id;
 init(db);
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,MARKER);
 assert.equal(db.prepare('SELECT MAX(id) AS id FROM suite_identity_org_native_audit').get().id,prior);
 db.close();
});

test('conflicting pre-existing SQLite application_id fails closed without replacing it',t=>{
 const f=fixture(t),db=f.open();db.exec('PRAGMA application_id=42');
 assert.throws(()=>init(db),/invalid_native_link_revision/);
 assert.equal(db.prepare('PRAGMA application_id').get().application_id,42);
 assert(!has(db,audit));db.close();
});

test('caller cannot create audit tables outside a SQLite write transaction',t=>{
 const f=fixture(t),db=f.open();
 assert.throws(()=>ensure(db),/native_link_schema_write_lock_required/);
 assert(!has(db,audit));db.close();
});
