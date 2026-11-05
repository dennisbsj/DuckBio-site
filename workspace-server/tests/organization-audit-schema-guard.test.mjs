import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertOrganizationAuditSchema as verify} from '../organization-audit-schema-guard.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-org-audit-guard-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'org.sqlite');
 return {open:()=>new DatabaseSync(file)};
}
const initialized=db=>db.exec(`
 CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS organization_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,org TEXT,action TEXT);
 PRAGMA user_version=1;
`);
const guarded=db=>{
 db.exec('BEGIN IMMEDIATE');
 try {verify(db);db.exec('COMMIT');}
 catch(e){db.exec('ROLLBACK');throw e;}
};

test('new unversioned DB is allowed for first complete schema initialization',t=>{
 const f=fixture(t),db=f.open();guarded(db);initialized(db);db.close();
 const next=f.open();guarded(next);next.close();
});

test('marked database with lost policy audit rejects before silently recreating it',t=>{
 const f=fixture(t),db=f.open();initialized(db);
 db.exec('DROP TABLE organization_audit');db.close();
 const again=f.open();assert.throws(()=>guarded(again),/organization_audit_unavailable/);
 assert.equal(again.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='organization_audit'").get().n,0);
 again.close();
});

test('marked DB with both base organization and audit tables missing fails closed',t=>{
 const f=fixture(t),db=f.open();initialized(db);
 db.exec('DROP TABLE organization_audit; DROP TABLE organizations');
 assert.throws(()=>guarded(db),/organization_audit_unavailable/);db.close();
});

test('unmarked legacy organization database with intact audit is preserved',t=>{
 const f=fixture(t),db=f.open();initialized(db);
 db.exec('PRAGMA user_version=0');
 db.exec("INSERT INTO organization_audit(org,action) VALUES('alpha','role.revoked')");
 const before=db.prepare('SELECT MAX(id) AS id FROM organization_audit').get().id;
 guarded(db);
 assert.equal(db.prepare('SELECT MAX(id) AS id FROM organization_audit').get().id,before);
 db.close();
});

test('unmarked established DB missing audit is not mistaken for a new blank database',t=>{
 const f=fixture(t),db=f.open();initialized(db);
 db.exec('DROP TABLE organization_audit; PRAGMA user_version=0');
 assert.throws(()=>guarded(db),/organization_audit_unavailable/);db.close();
});

test('without a write-serialized transaction the schema verification refuses to attest',t=>{
 const f=fixture(t),db=f.open();
 assert.throws(()=>verify(db),/organization_audit_write_lock_required/);db.close();
});
