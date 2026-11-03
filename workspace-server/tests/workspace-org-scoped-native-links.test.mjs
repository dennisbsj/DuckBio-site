import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import {
  createWorkspaceScopedNativeLinks, ScopedNativeLinkError
} from '../shared-auth/organization-native-grants.mjs';

function fixture(t, verifier = async()=>true) {
  const root = mkdtempSync(path.join(os.tmpdir(),'duckbio-native-link-'));
  const databasePath = path.join(root,'private','scoped.sqlite');
  let now = 1800000000000;
  const open = () => createWorkspaceScopedNativeLinks({
    databasePath, clock:()=>now, verifyNativeOwnership:verifier
  });
  let store = open();
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true})});
  const input = {workspaceAccountId:'alice',workspaceOrganizationId:'org-a',
    appId:'goflo',nativeUserId:'native-alice',
    nativeOrganizationId:'native-org-a',approvedBy:'operator'};
  return {input, get store(){return store}, setNow(value){now=value},
    restart(){store.close();store=open()}, databasePath};
}

test('requires authoritative verifier and a private absolute database path',()=>{
  assert.throws(()=>createWorkspaceScopedNativeLinks({databasePath:'/tmp/a.sqlite'}),
    /private_native_ownership_verifier_required/);
  assert.throws(()=>createWorkspaceScopedNativeLinks({
    databasePath:'relative.sqlite',verifyNativeOwnership:async()=>true
  }),/private_scoped_link_database_required/);
});

test('exact organization mapping is persisted and does not leak to another tenant',async t=>{
  const f=fixture(t);
  const {input}=f;
  assert.equal(f.store.get(input),null);
  const first=await f.store.link(input);
  assert.equal(first.nativeUserId,'native-alice');
  assert.equal(first.revision,1);
  assert.equal(f.store.get({...input,workspaceOrganizationId:'org-b'}),null);
  const second=await f.store.link({...input,workspaceOrganizationId:'org-b',
    nativeOrganizationId:'native-org-b',nativeUserId:'native-bob'});
  assert.equal(second.nativeOrganizationId,'native-org-b');
  f.restart();
  assert.equal(f.store.get(input).nativeOrganizationId,'native-org-a');
  assert.equal(f.store.get({...input,workspaceOrganizationId:'org-b'}).nativeUserId,'native-bob');
  assert.equal(f.store.auditFor(input).length,1);
});

test('independent verifier denial cannot write link or audit',async t=>{
  const f=fixture(t,async()=>false);
  await assert.rejects(f.store.link(f.input),
    error=>error instanceof ScopedNativeLinkError && error.code==='native_ownership_unverified');
  assert.equal(f.store.get(f.input),null);
  assert.deepEqual(f.store.auditFor(f.input),[]);
});

test('verified ownership exceptions fail closed',async t=>{
  const f=fixture(t,async()=>{throw Error('native unavailable')});
  await assert.rejects(f.store.link(f.input),/native_ownership_unavailable/);
  assert.equal(f.store.get(f.input),null);
});

test('native actor cannot be linked to another central account or tenant',async t=>{
  const f=fixture(t);
  await f.store.link(f.input);
  await assert.rejects(f.store.link({...f.input,workspaceAccountId:'mallory'}),
    /native_actor_already_linked/);
  await assert.rejects(f.store.link({...f.input,workspaceOrganizationId:'org-b'}),
    /native_actor_already_linked/);
  assert.equal(f.store.get({...f.input,workspaceOrganizationId:'org-b'}),null);
  assert.equal(f.store.auditFor(f.input).length,1);
});

test('replacement must be explicitly revoked, audit retained and revision incremented',async t=>{
  const f=fixture(t);
  await f.store.link(f.input);
  assert.equal((await f.store.link(f.input)).revision,1);
  assert.equal(f.store.auditFor(f.input).length,1);
  await assert.rejects(f.store.link({...f.input,nativeUserId:'other-native-user'}),
    /existing_scoped_link_requires_revocation/);
  assert.equal(f.store.revoke(f.input),true);
  assert.equal(f.store.revoke(f.input),false);
  assert.equal(f.store.get(f.input),null);
  const renewed=await f.store.link({...f.input,nativeUserId:'other-native-user'});
  assert.equal(renewed.revision,3);
  assert.equal(renewed.nativeUserId,'other-native-user');
  assert.deepEqual(f.store.auditFor(f.input).map(x=>x.action),
    ['link','revoke','link']);
  f.restart();
  assert.equal(f.store.get(f.input).revision,3);
});

test('invalid, wildcard, unapproved and unreleased seventh-app inputs fail closed',async t=>{
  const f=fixture(t);
  for(const change of [
    {workspaceOrganizationId:'*'}, {nativeUserId:''},
    {nativeOrganizationId:'unknown/name'}, {approvedBy:''},
    {appId:'dataduck'}, {appId:'unknown'}, {workspaceAccountId:'alice@host'}
  ])await assert.rejects(f.store.link({...f.input,...change}),
    /invalid_scoped_link/);
  assert.equal(f.store.get(f.input),null);
});

test('legacy unscoped grant tables are never imported or automatically trusted',async t=>{
  const f=fixture(t);
  // This intentionally simulates legacy grants without a Workspace tenant.
  const db=new DatabaseSync(f.databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS suite_identity_grants
    (user_id TEXT,app_id TEXT,local_user_id TEXT,organization_id TEXT)`);
  db.prepare('INSERT INTO suite_identity_grants VALUES(?,?,?,?)')
    .run('alice','goflo','legacy-native','legacy-org');
  db.close();
  assert.equal(f.store.get(f.input),null);
  assert.equal(f.store.get({...f.input,workspaceOrganizationId:'org-b'}),null);
});
