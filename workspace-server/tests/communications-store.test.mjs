import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationsStore,OWNER_SUPPORT,OWNER_BILLING} from '../communications-store.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-comms-'));
 let time=1800000000000;
 const options={databasePath:join(dir,'private','messages.sqlite'),clock:()=>time,ownerAccountId:'owner1'};
 let store=createCommunicationsStore(options);
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createCommunicationsStore(options);},advance(ms){time+=ms;}};
}
test('virtual addresses are unique and persist through restart without SMTP',t=>{
 const f=fixture(t);
 const a=f.store.addressFor('alice');
 const b=f.store.addressFor('bob');
 assert.match(a,/^duck-[a-f0-9]{24}@duckbio\.internal$/);
 assert.notEqual(a,b);
 assert.deepEqual(f.store.resolveAddress(a),{accountId:'alice',alias:null});
 assert.deepEqual(f.store.resolveAddress(OWNER_SUPPORT),{accountId:'owner1',alias:OWNER_SUPPORT});
 assert.deepEqual(f.store.resolveAddress(OWNER_BILLING),{accountId:'owner1',alias:OWNER_BILLING});
 f.reopen();assert.equal(f.store.addressFor('alice'),a);
 assert.equal(f.store.resolveAddress('alice@example.com'),null);
});
test('chat replay is idempotent and owner cannot receive user chats even by ID',t=>{
 const f=fixture(t);
 const msg={senderId:'alice',recipientId:'bob',body:'Hello',clientId:'msg-1'};
 const a=f.store.sendChat(msg);
 const b=f.store.sendChat(msg);
 assert.equal(a.id,b.id);assert.equal(b.duplicate,true);
 assert.throws(()=>f.store.sendChat({...msg,body:'Changed'}),/message_conflict/);
 assert.throws(()=>f.store.sendChat({...msg,recipientId:'owner1',clientId:'msg-2'}),/owner_chat_forbidden/);
 assert.equal(f.store.chatHistory('bob','alice').length,1);
 assert.equal(f.store.chatThreads('bob')[0].unread,1);
 assert.equal(f.store.markChatRead('bob','alice'),1);
 assert.equal(f.store.chatThreads('bob')[0].unread,0);
 f.store.sendChat({senderId:'owner1',recipientId:'alice',body:'Important',clientId:'own-1'});
 assert.equal(f.store.chatHistory('alice','owner1')[0].body,'Important');
});
test('virtual mail supports user inbox, support alias and protects billing mailbox',t=>{
 const f=fixture(t);
 const bob=f.store.addressFor('bob');
 const a=f.store.sendMail({senderId:'alice',recipientId:'bob',toAddress:bob,
  subject:'Work',body:'Hi',clientId:'mail-1'});
 assert.equal(f.store.listMail('bob')[0].id,a.id);
 assert.equal(f.store.listMail('alice','sent')[0].subject,'Work');
 assert.equal(f.store.sendMail({senderId:'alice',recipientId:'bob',toAddress:bob,
  subject:'Work',body:'Hi',clientId:'mail-1'}).duplicate,true);
 assert.throws(()=>f.store.sendMail({senderId:'alice',recipientId:'bob',toAddress:bob,
  subject:'Changed',body:'Hi',clientId:'mail-1'}),/message_conflict/);
 assert.equal(f.store.markMailRead('bob',a.id),1);
 assert.equal(f.store.markMailRead('alice',a.id),0);
 f.store.sendMail({senderId:'alice',recipientId:'owner1',toAddress:OWNER_SUPPORT,
  subject:'Support',body:'Question',clientId:'mail-2'});
 assert.equal(f.store.listMail('owner1').length,1);
 assert.throws(()=>f.store.sendMail({senderId:'alice',recipientId:'owner1',
  toAddress:OWNER_BILLING,subject:'Fake',body:'No',clientId:'mail-3'}),/mail_recipient_unavailable/);
 const ownerAddress=f.store.addressFor('owner1');
 assert.throws(()=>f.store.sendMail({senderId:'alice',recipientId:'owner1',
  toAddress:ownerAddress,subject:'Fake',body:'No',clientId:'mail-4'}),/mail_recipient_unavailable/);
});
test('internal subscription notices and security chats only originate from privileged private methods',t=>{
 const f=fixture(t);
 assert.equal(f.store.postSubscriptionNotice({reference:'inv123',organizationName:'Lab One',
  description:'A subscription changed'}).duplicate,false);
 assert.equal(f.store.postSubscriptionNotice({reference:'inv123',organizationName:'Lab One',
  description:'A subscription changed'}).duplicate,true);
 assert.equal(f.store.listMail('owner1')[0].to,OWNER_BILLING);
 assert.equal(f.store.postSecurityAlert({reference:'security123',description:'Risk detected'}).duplicate,false);
 assert.equal(f.store.postSecurityAlert({reference:'security123',description:'Risk detected'}).duplicate,true);
 assert.equal(f.store.chatHistory('owner1','duckbio-security').length,1);
 assert.throws(()=>f.store.chatHistory('alice','duckbio-security'),/access_denied/);
 assert.throws(()=>f.store.sendChat({senderId:'alice',recipientId:'duckbio-security',
  body:'Forged',clientId:'test-123'}),/invalid_chat_message/);
 f.reopen();
 assert.equal(f.store.listMail('owner1').length,1);
 assert.equal(f.store.chatHistory('owner1','duckbio-security').length,1);
});
test('client rate limiting prevents unbounded messages in a one-minute window',t=>{
 const f=fixture(t);
 for(let i=0;i<20;i++)f.store.sendChat({senderId:'alice',recipientId:'bob',
  body:'Message '+i,clientId:'id-'+i});
 assert.throws(()=>f.store.sendChat({senderId:'alice',recipientId:'bob',
  body:'Overflow',clientId:'id-21'}),/message_rate_limited/);
 f.advance(60001);
 assert.equal(f.store.sendChat({senderId:'alice',recipientId:'bob',
  body:'Again',clientId:'id-22'}).body,'Again');
});
