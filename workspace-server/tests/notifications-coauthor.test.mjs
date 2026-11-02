import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationsStore} from '../communications-store.mjs';
import {mentionHandleForUser} from '../message-references.mjs';
function fixture(t,{enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-notification-suite-'));
 const options={databasePath:join(dir,'private','comms.sqlite'),ownerAccountId:'owner1',
  clock:()=>1800000000000,
  verifyCoauthorEvent:enabled?({proof,event})=>proof==='trusted-app-assertion'&&
    event.appId==='limsman'&&event.contentId.startsWith('ld'):null};
 let store=createCommunicationsStore(options);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createCommunicationsStore(options);}};
}
test('Notifications combines private mentions and verified coauthor notices without granting content',t=>{
 const f=fixture(t);
 const tag='@'+mentionHandleForUser('bob');
 f.store.sendChat({senderId:'alice',recipientId:'bob',body:'Ping '+tag,clientId:'chat-notify1'});
 const x=f.store.postCoauthorNotification({proof:'trusted-app-assertion',
  reference:'coauthor-event-001',recipientId:'bob',actorId:'alice',
  appId:'limsman',contentId:'ld000001'});
 const again=f.store.postCoauthorNotification({proof:'trusted-app-assertion',
  reference:'coauthor-event-001',recipientId:'bob',actorId:'alice',
  appId:'limsman',contentId:'ld000001'});
 assert.equal(x.created,true);assert.equal(again.created,false);assert.equal(again.id,x.id);
 assert.equal(f.store.notifications('bob').length,2);
 assert.equal(f.store.notifications('alice').length,0);
 assert.deepEqual(f.store.unreadCounts('bob'),{chat:1,mail:0,notifications:2});
 assert.equal(f.store.markNotificationRead('alice',x.id).marked,false);
 assert.equal(f.store.markNotificationRead('bob',x.id).marked,true);
 assert.equal(f.store.markNotificationRead('bob',x.id).marked,false);
 f.reopen();
 assert.equal(f.store.notifications('bob').length,2);
 assert.equal(f.store.unreadCounts('bob').notifications,1);
 assert.equal(f.store.notifications('bob').find(z=>z.kind==='coauthor').contentId,'ld000001');
 assert.throws(()=>f.store.postCoauthorNotification({proof:'trusted-app-assertion',
  reference:'coauthor-event-001',recipientId:'bob',actorId:'alice',
  appId:'limsman',contentId:'ld000002'}),/coauthor_event_conflict/);
});
test('No app verifier, invalid proof or invalid ID cannot invent a coauthor notice',t=>{
 const f=fixture(t,{enabled:false});
 assert.throws(()=>f.store.postCoauthorNotification({proof:'no',
  reference:'event1',recipientId:'alice',actorId:'bob',
  appId:'limsman',contentId:'ld000001'}),/coauthor_integration_unavailable/);
 const s=fixture(t);
 for(const payload of [
  {proof:'untrusted',reference:'event2',recipientId:'bob',actorId:'alice',appId:'limsman',contentId:'ld000001'},
  {proof:'trusted-app-assertion',reference:'event3',recipientId:'bob',actorId:'bob',appId:'limsman',contentId:'ld000001'},
  {proof:'trusted-app-assertion',reference:'event4',recipientId:'bob',actorId:'alice',appId:'limsman',contentId:'dm000001'},
 ]){
  assert.throws(()=>s.store.postCoauthorNotification(payload),
    /coauthor_event_unverified|invalid_coauthor_event/);
 }
 assert.equal(s.store.notifications('bob').length,0);
});
test('Unread counts distinguish direct/group chat, group mail and internal mail',t=>{
 const f=fixture(t);
 f.store.sendChat({senderId:'alice',recipientId:'bob',body:'Hello',clientId:'c1'});
 const to=f.store.addressFor('bob');
 const mail=f.store.sendMail({senderId:'alice',recipientId:'bob',toAddress:to,
  subject:'Note',body:'Hi',clientId:'m1'});
 const chat=f.store.createGroup({creatorId:'alice',kind:'chat',
  memberIds:['bob','charlie'],title:'Team chat',clientId:'groupC'});
 const groupMail=f.store.createGroup({creatorId:'alice',kind:'mail',
  memberIds:['bob','charlie'],title:'Team mail',clientId:'groupM'});
 const cm=f.store.sendGroup({groupId:chat.id,senderId:'alice',body:'Team',clientId:'gc1'});
 const gm=f.store.sendGroup({groupId:groupMail.id,senderId:'alice',subject:'Subject',body:'Team',
  clientId:'gm1'});
 assert.deepEqual(f.store.unreadCounts('bob'),{chat:2,mail:2,notifications:0});
 assert.deepEqual(f.store.unreadCounts('alice'),{chat:0,mail:0,notifications:0});
 f.store.markChatRead('bob','alice');f.store.markMailRead('bob',mail.id);
 f.store.markGroupRead({groupId:chat.id,actorId:'bob',messageId:cm.id});
 f.store.markGroupRead({groupId:groupMail.id,actorId:'bob',messageId:gm.id});
 assert.deepEqual(f.store.unreadCounts('bob'),{chat:0,mail:0,notifications:0});
});
