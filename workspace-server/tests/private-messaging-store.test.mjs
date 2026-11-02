import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrivateMessagingStore} from '../private-messaging-store.mjs';

const users=new Map([
 ['owner1',{id:'owner1',displayName:'DuckBio Owner',state:'active'}],
 ['alice1',{id:'alice1',displayName:'Alice',state:'active'}],
 ['bob1',{id:'bob1',displayName:'Bob',state:'active'}],
 ['charlie1',{id:'charlie1',displayName:'Charlie',state:'active'}],
 ['disabled1',{id:'disabled1',displayName:'Disabled',state:'disabled'}]
]);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-msg-'));
 const databasePath=join(dir,'private','messages.sqlite');
 const settings={databasePath,ownerAccountId:'owner1',
  identityLookup:id=>users.get(id),
  sharedOrganizations:actor=>actor==='alice1'?['alice1','bob1']:
   actor==='bob1'?['alice1','bob1']:['charlie1'],clock:()=>1800000000000};
 let store=createPrivateMessagingStore(settings);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createPrivateMessagingStore(settings);}};
}
test('internal addresses are unique stable account aliases with no external mailbox',t=>{
 const f=fixture(t);
 const alice=f.store.address('alice1'),bob=f.store.address('bob1');
 assert.notEqual(alice,bob);assert.match(alice,/^u-[a-f0-9]+@duckbio\.internal$/);
 assert.equal(f.store.resolveInternalAddress(alice),'alice1');
 assert.throws(()=>f.store.resolveInternalAddress('alice@example.com'),/invalid_internal_address/);
 assert.throws(()=>f.store.address('disabled1'),/account_unavailable/);
 f.reopen();
 assert.equal(f.store.address('alice1'),alice);
});
test('owner may send instant messages, others may only send owner internal mail',t=>{
 const f=fixture(t);
 assert.throws(()=>f.store.send({actorId:'alice1',recipientId:'owner1',kind:'chat',
  body:'Hello',requestId:'chat1'}),/owner_chat_restricted/);
 const ownerChat=f.store.send({actorId:'owner1',recipientId:'alice1',kind:'chat',
  body:'Welcome',requestId:'chatowner1'});
 assert.equal(ownerChat.created,true);
 assert.equal(f.store.conversation('alice1','owner1').length,1);
 assert.equal(f.store.conversation('alice1','owner1')[0].body,'Welcome');
 assert.equal(f.store.send({actorId:'alice1',recipientId:'owner1',kind:'mail',
  subject:'Help',body:'Need support',requestId:'mail1'}).created,true);
 assert.equal(f.store.inbox('owner1').length,1);
 assert.equal(f.store.inbox('owner1')[0].subject,'Help');
 assert.equal(f.store.inbox('owner1',{kind:'chat'}).length,0);
});
test('organization directory excludes owner but includes coworkers',t=>{
 const f=fixture(t);
 const c=f.store.contacts('alice1');
 assert.deepEqual(c.contacts.map(x=>x.name),['Bob']);
 assert.equal(f.store.contacts('alice1',{query:'bOB'}).contacts.length,1);
 assert.equal(f.store.contacts('alice1',{query:'Charlie'}).contacts.length,0);
 assert.throws(()=>f.store.contacts('disabled1'),/account_unavailable/);
});
test('messages cannot be read as another recipient and idempotency survives restart',t=>{
 const f=fixture(t);
 const input={actorId:'alice1',recipientId:'bob1',kind:'mail',subject:'Hi',
  body:'Message',requestId:'request1'};
 const x=f.store.send(input);
 assert.equal(f.store.send(input).created,false);
 assert.throws(()=>f.store.send({...input,body:'changed'}),/message_request_conflict/);
 assert.equal(f.store.inbox('bob1').length,1);
 assert.equal(f.store.inbox('charlie1').length,0);
 assert.equal(f.store.markRead('charlie1',x.id).updated,false);
 assert.equal(f.store.markRead('bob1',x.id).updated,true);
 f.reopen();assert.equal(f.store.send(input).created,false);
 assert.equal(f.store.inbox('bob1').length,1);
});
test('cross-organization instant messages allowed to explicitly known account IDs',t=>{
 const f=fixture(t);
 f.store.send({actorId:'alice1',recipientId:'charlie1',kind:'chat',
  body:'Cross-org note',requestId:'cross1'});
 assert.equal(f.store.conversation('charlie1','alice1').length,1);
 assert.equal(f.store.inbox('charlie1',{kind:'chat'}).length,1);
 assert.throws(()=>f.store.send({actorId:'alice1',recipientId:'disabled1',
  kind:'mail',subject:'No',body:'No',requestId:'disabledMessage'}),/account_unavailable/);
});
