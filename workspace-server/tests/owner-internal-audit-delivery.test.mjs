import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';
import {deliverOwnerInternalAudit} from '../owner-internal-audit-delivery.mjs';

const clock=()=>1800000000000;
const owner={accountId:'owner1',name:'DuckBio Owner',nickname:'O',email:'owner@example.test'};
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-internal-delivery-'));
 const orgOptions={databasePath:join(dir,'private','organizations.sqlite'),clock,
  verifyLiveSubscriptionEvidence:e=>{if(e?.proof!=='PRIVATE_SYNTHETIC')throw Error('not verified');return e.payload;}};
 const commOptions={databasePath:join(dir,'private','communications.sqlite'),clock,ownerAccountId:owner.accountId};
 let organizationStore=createOrganizationStore(orgOptions),communicationsStore=createCommunicationsStore(commOptions);
 t.after(()=>{organizationStore?.close();communicationsStore?.close();rmSync(dir,{recursive:true,force:true});});
 return {get organizationStore(){return organizationStore;},
   get communicationsStore(){return communicationsStore;},
   reopen(){organizationStore.close();communicationsStore.close();
    organizationStore=createOrganizationStore(orgOptions);
    communicationsStore=createCommunicationsStore(commOptions);}
 };
}
function paid(revision=1,seats=2){
 return {proof:'PRIVATE_SYNTHETIC',payload:{
  source:'stripe_live',eventKey:'evt_internal_'+revision,
  organizationId:'org-1',subscriptionId:'sub_internal_12345',
  revision,plan:'Single',apps:['eel'],seats,status:'active',
  paidThrough:1900000000+revision*1000000
 }};
}
test('verified subscription revisions land exactly once in owner billing inbox, even after restart',t=>{
 const f=fixture(t);
 f.organizationStore.setupOrganization({organizationId:'org-1',name:'First Lab',owner});
 f.organizationStore.applyVerifiedSubscriptionTransition(paid());
 let done=deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore});
 assert.equal(done.billing,1);
 assert.equal(done.security,0);
 assert.equal(f.communicationsStore.listMail(owner.accountId)[0].to,'billing@duckbio.internal');
 assert.match(f.communicationsStore.listMail(owner.accountId)[0].body,/DuckNote: \+2 seats/);
 assert.equal(deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore}).processed,0);
 f.reopen();
 assert.equal(f.communicationsStore.listMail(owner.accountId).length,1);
 assert.equal(deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore}).processed,0);
 f.organizationStore.applyVerifiedSubscriptionTransition(paid(2,2));
 done=deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore});
 assert.equal(done.billing,1,'renewal is recorded as billing update without granting extra seats');
 assert.equal(f.communicationsStore.listMail(owner.accountId).length,2);
 assert.equal(f.organizationStore.overview('org-1',owner.accountId).apps.find(x=>x.id==='eel').purchased,2);
 assert(f.communicationsStore.chatThreads(owner.accountId).every(x=>x.peerId!=='duckbio-security'));
});
test('real admin promotions and permission grants create owner security chats, not user chats',t=>{
 const f=fixture(t);
 f.organizationStore.setupOrganization({organizationId:'org-1',name:'First Lab',owner});
 f.organizationStore.applyVerifiedSubscriptionTransition(paid());
 const member={accountId:'member1',name:'Scientist',nickname:'S',email:'scientist@example.test',
  admin:false,roles:{eel:'scientist'}};
 f.organizationStore.saveMember({organizationId:'org-1',actorId:owner.accountId,member});
 let result=deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore});
 assert.equal(result.security,0,'ordinary member creation is not classified as a security incident');
 f.organizationStore.saveMember({organizationId:'org-1',actorId:owner.accountId,member:{...member,admin:true}});
 result=deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore});
 assert.equal(result.security,1);
 const history=f.communicationsStore.chatHistory(owner.accountId,'duckbio-security');
 assert.equal(history.length,1);
 assert.match(history[0].body,/Administrator privileges granted/);
 assert.throws(()=>f.communicationsStore.chatHistory(member.accountId,'duckbio-security'),/access_denied/);
 assert.throws(()=>f.communicationsStore.sendChat({
  senderId:member.accountId,recipientId:owner.accountId,body:'Unwanted',clientId:'blocked-123'}),/owner_chat_forbidden/);
 assert.equal(f.communicationsStore.listMail(owner.accountId).length,1);
});
test('failed internal delivery keeps cursor at unprocessed event for later safe replay',t=>{
 const f=fixture(t);
 f.organizationStore.setupOrganization({organizationId:'org-1',name:'First Lab',owner});
 f.organizationStore.applyVerifiedSubscriptionTransition(paid());
 const fake={ownerAuditCursor:()=>f.communicationsStore.ownerAuditCursor(),
  advanceOwnerAuditCursor:x=>f.communicationsStore.advanceOwnerAuditCursor(x),
  postSubscriptionNotice:()=>{throw Error('Injected transient failure');},
  postSecurityAlert:x=>f.communicationsStore.postSecurityAlert(x)};
 assert.throws(()=>deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:fake}),/Injected transient failure/);
 assert.equal(f.communicationsStore.ownerAuditCursor(),1,'only the irrelevant prior event was acknowledged');
 f.reopen();
 assert.equal(deliverOwnerInternalAudit({organizationStore:f.organizationStore,communicationsStore:f.communicationsStore}).billing,1);
 assert.equal(f.communicationsStore.listMail(owner.accountId).length,1);
});
test('audit data is bounded and cannot be sent via a user-triggered communications route',t=>{
 const f=fixture(t);
 f.organizationStore.setupOrganization({organizationId:'org-1',name:'First Lab',owner});
 assert.throws(()=>f.organizationStore.ownerCommunicationEvents(-1),/invalid_audit_cursor/);
 assert.throws(()=>f.organizationStore.ownerCommunicationEvents(0,101),/invalid_audit_cursor/);
 const entries=f.organizationStore.ownerCommunicationEvents(0,10);
 assert.equal(entries[0].category,null);
 assert.equal(entries[0].organizationName,'First Lab');
 assert.equal(Object.hasOwn(entries[0],'details'),false);
 assert.equal(f.communicationsStore.ownerAuditCursor(),0);
 assert.throws(()=>f.communicationsStore.advanceOwnerAuditCursor(-1),/invalid_audit_cursor/);
});
