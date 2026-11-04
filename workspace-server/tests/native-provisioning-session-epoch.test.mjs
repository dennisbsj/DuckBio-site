/**
 * Native provisioning session-lock generations use a separate opt-in
 * AUTOINCREMENT ledger. No existing users or ordinary six-app sessions
 * are migrated, modified or authorized by these tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';

const NOW=1800000000000;
const OWNER='native-session-epoch-owner';
const LOCK={sessionId:'private-session-one',accountId:OWNER,
 organizationId:'alpha'};

test('opt-in epoch ledger fails closed for existing pre-feature session locks and persists new selections on reopen',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'workspace-native-session-epoch-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const databasePath=path.join(root,'private','organizations.sqlite');
 const open=enabled=>createOrganizationStore({
  databasePath,clock:()=>NOW,nativeProvisioningSessionEpochs:enabled
 });
 const legacy=open(false);
 legacy.setupOrganization({organizationId:'alpha',name:'Alpha',
  owner:{accountId:OWNER,name:'Owner',nickname:'Owner',
   email:'owner@example.test'}});
 legacy.selectSessionOrganization(LOCK);
 assert.equal(legacy.nativeProvisioningAuditRevision(LOCK),null);
 legacy.close();
 const upgraded=open(true);
 assert.equal(upgraded.currentSessionOrganization({
  sessionId:LOCK.sessionId,accountId:LOCK.accountId
 }).id,'alpha','old app session works normally without auth migration');
 assert.equal(upgraded.nativeProvisioningAuditRevision(LOCK),null,
  'old session must not be retroactively trusted for provisioning');
 upgraded.clearSessionOrganization(LOCK.sessionId);
 assert.equal(upgraded.nativeProvisioningAuditRevision(LOCK),null);
 upgraded.selectSessionOrganization(LOCK);
 const initial=upgraded.nativeProvisioningAuditRevision(LOCK);
 assert(Number.isSafeInteger(initial.organizationAuditRevision));
 assert(Number.isSafeInteger(initial.sessionLockEpoch));
 assert(initial.sessionLockEpoch>0);
 upgraded.close();
 const reopened=open(true);
 assert.deepEqual(reopened.nativeProvisioningAuditRevision(LOCK),initial,
  'SQLite session epoch survives reopening with a static clock');
 reopened.clearSessionOrganization(LOCK.sessionId);
 assert.equal(reopened.nativeProvisioningAuditRevision(LOCK),null);
 reopened.selectSessionOrganization(LOCK);
 const next=reopened.nativeProvisioningAuditRevision(LOCK);
 assert(next.sessionLockEpoch>initial.sessionLockEpoch);
 assert.equal(next.organizationAuditRevision,initial.organizationAuditRevision,
  'session-only change must not be mistaken for organization policy revision');
 assert.equal(reopened.currentSessionOrganization({
  sessionId:LOCK.sessionId,accountId:LOCK.accountId
 }).id,'alpha');
 reopened.close();
});

test('default six-app organization store does not create or require a provisioning session epoch',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'workspace-native-session-default-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=createOrganizationStore({
  databasePath:path.join(root,'org.sqlite'),clock:()=>NOW
 });
 store.setupOrganization({organizationId:'alpha',name:'Alpha',
  owner:{accountId:OWNER,name:'Owner',nickname:'Owner',
   email:'owner@example.test'}});
 store.selectSessionOrganization(LOCK);
 assert.equal(store.nativeProvisioningAuditRevision(LOCK),null);
 store.clearSessionOrganization(LOCK.sessionId);
 assert.equal(store.currentSessionOrganization({
  sessionId:LOCK.sessionId,accountId:LOCK.accountId
 }),null);
 store.close();
});
