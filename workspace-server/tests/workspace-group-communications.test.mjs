import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationsStore} from '../communications-store.mjs';
import {mentionHandleForUser,extractMessageReferences,visibleContentReferences}
 from '../message-references.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-groups-'));
 let now=1800000000000;
 const config={databasePath:join(dir,'private','messages.sqlite'),clock:()=>now,ownerAccountId:'owner1'};
 let store=createCommunicationsStore(config);
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},advance:n=>{now+=n;},
  reopen(){store.close();store=createCommunicationsStore(config);}};
}
test('group chat with cross-organization members, stable creation and no duplicate sends',t=>{
 const f=fixture(t);
 const args={creatorId:'alice',memberIds:['charlie','bob'],kind:'chat',title:'Project coordination',clientId:'create1'};
 const g=f.store.createGroup(args);
 assert.equal(g.kind,'chat');assert.equal(g.members.length,3);
 assert.deepEqual(f.store.createGroup({...args,memberIds:['bob','charlie']}),{...g,duplicate:true});
 assert.throws(()=>f.store.createGroup({...args,title:'Changed'}),/message_conflict/);
 assert.equal(f.store.groupsFor('outsider').length,0);
 assert.equal(f.store.groupsFor('bob').length,1);
 assert.deepEqual(f.store.groupMembers({groupId:g.id,actorId:'bob'}),['alice','bob','charlie']);
 assert.throws(()=>f.store.groupMembers({groupId:g.id,actorId:'outsider'}),/group_access_denied/);
 const u=mentionHandleForUser('bob');
 const message={groupId:g.id,senderId:'alice',body:'Hi @'+u+', check @ld000001 and @dm000002',
  clientId:'m1'};
 const sent=f.store.sendGroup(message);
 assert.equal(sent.created,true);
 assert.deepEqual(sent.mentions,{userIds:['bob'],resourceIds:['ld000001','dm000002']});
 assert.equal(f.store.sendGroup(message).created,false);
 assert.throws(()=>f.store.sendGroup({...message,body:'Changed'}),/message_conflict/);
 const hist=f.store.groupHistory({groupId:g.id,actorId:'charlie'});
 assert.equal(hist.group.title,'Project coordination');
 assert.equal(hist.messages.length,1);
 assert.equal(hist.messages[0].mentions.userIds[0],'bob');
 assert.throws(()=>f.store.groupHistory({groupId:g.id,actorId:'outsider'}),/group_access_denied/);
 assert.equal(f.store.markGroupRead({groupId:g.id,actorId:'bob',messageId:sent.id}).marked,true);
 assert.equal(f.store.markGroupRead({groupId:g.id,actorId:'bob',messageId:sent.id}).marked,false);
 assert.throws(()=>f.store.markGroupRead({groupId:g.id,actorId:'outsider',messageId:sent.id}),/group_access_denied/);
 f.reopen();
 assert.equal(f.store.groupHistory({groupId:g.id,actorId:'bob'}).messages.length,1);
});
test('mentions cannot silently add users outside a group',t=>{
 const f=fixture(t);
 const group=f.store.createGroup({creatorId:'alice',memberIds:['bob','charlie'],kind:'chat',
  title:'Only this team',clientId:'create2'});
 assert.throws(()=>f.store.sendGroup({groupId:group.id,senderId:'alice',
  body:'Hello @'+mentionHandleForUser('outsider'),clientId:'outside'}),/mention_not_in_conversation/);
 assert.equal(f.store.groupHistory({groupId:group.id,actorId:'bob'}).messages.length,0);
 assert.deepEqual(extractMessageReferences('@ld000001 @ld000001 @u-'+
  Buffer.from('bob').toString('hex')),{
   userIds:['bob'],resourceIds:['ld000001']});
 assert.equal(visibleContentReferences({text:'Check @ld000001 and @dm000002',
  viewerId:'bob',contentRegistry:{inspect:({contentId})=>contentId==='ld000001'?
  {id:contentId,name:'Allowed sample'}:null}}).length,1);
 assert.deepEqual(visibleContentReferences({text:'@ld000001',viewerId:'bob'}),[],
  'no native content verifier means no resource details');
});
test('group mail supports subject, history and user mentions',t=>{
 const f=fixture(t);
 const group=f.store.createGroup({creatorId:'alice',memberIds:['bob','owner1'],
  kind:'mail',title:'Team status',clientId:'createMail'});
 const m=f.store.sendGroup({groupId:group.id,senderId:'bob',subject:'Friday',
  body:'Status for @'+mentionHandleForUser('alice'),clientId:'groupmail1'});
 assert.equal(m.created,true);
 assert.equal(f.store.groupHistory({groupId:group.id,actorId:'owner1'}).messages[0].subject,'Friday');
 assert.throws(()=>f.store.sendGroup({groupId:group.id,senderId:'bob',
  body:'No subject',clientId:'groupmail2'}),/invalid_group_message/);
 assert.equal(f.store.groupsFor('owner1').length,1);
});
test('only owner can initiate/send to owner-including group chat',t=>{
 const f=fixture(t);
 assert.throws(()=>f.store.createGroup({creatorId:'alice',memberIds:['bob','owner1'],
  title:'Owner group',kind:'chat',clientId:'badowner'}),/owner_chat_forbidden/);
 const group=f.store.createGroup({creatorId:'owner1',memberIds:['alice','bob'],
  title:'Owner announcement',kind:'chat',clientId:'ownercreate'});
 assert.equal(f.store.sendGroup({groupId:group.id,senderId:'owner1',
  body:'Announcement',clientId:'ownerMsg'}).created,true);
 assert.equal(f.store.groupHistory({groupId:group.id,actorId:'alice'}).messages.length,1);
 assert.throws(()=>f.store.sendGroup({groupId:group.id,senderId:'alice',
  body:'Reply',clientId:'noReply'}),/owner_chat_forbidden/);
});
test('non-members, invalid groups and duplicate participant IDs fail closed',t=>{
 const f=fixture(t);
 assert.throws(()=>f.store.createGroup({creatorId:'alice',memberIds:['bob','bob'],
  kind:'chat',title:'Duplicate',clientId:'bad'}),/invalid_group/);
 const g=f.store.createGroup({creatorId:'alice',memberIds:['bob','charlie'],
  kind:'chat',title:'Team',clientId:'create3'});
 assert.throws(()=>f.store.sendGroup({groupId:g.id,senderId:'outsider',body:'Hi',
  clientId:'unauthorized'}),/group_access_denied/);
 assert.throws(()=>f.store.sendGroup({groupId:g.id,senderId:'bob',subject:'No',
  body:'Bad chat',clientId:'bad-subject'}),/invalid_group_message/);
 assert.equal(f.store.groupsFor('outsider').length,0);
});
