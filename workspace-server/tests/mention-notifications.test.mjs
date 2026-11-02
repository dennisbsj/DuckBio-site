import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommunicationsStore} from '../communications-store.mjs';
import {mentionHandleForUser} from '../message-references.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-mentions-'));
 const options={databasePath:join(dir,'private','comms.sqlite'),
  ownerAccountId:'owner1',clock:()=>1800000000000};
 let store=createCommunicationsStore(options);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createCommunicationsStore(options);}};
}
const tag=id=>'@'+mentionHandleForUser(id);
test('chat and internal mail mentions notify the recipient exactly once',t=>{
 const f=fixture(t);
 const msg={senderId:'alice',recipientId:'bob',body:'Hello '+tag('bob')+' @ld000001',
  clientId:'msg1'};
 f.store.sendChat(msg);
 f.store.sendChat(msg);
 let box=f.store.mentionInbox('bob');
 assert.equal(box.length,1);
 assert.equal(box[0].source,'chat');
 assert.equal(box[0].senderId,'alice');
 assert.equal(f.store.mentionInbox('alice').length,0);
 const to=f.store.addressFor('bob');
 f.store.sendMail({senderId:'alice',recipientId:'bob',toAddress:to,subject:'Update',
  body:'See '+tag('bob'),clientId:'mail1'});
 assert.equal(f.store.mentionInbox('bob').length,2);
 assert.equal(f.store.markMentionRead('alice',box[0].id).marked,false);
 assert.equal(f.store.markMentionRead('bob',box[0].id).marked,true);
 assert.equal(f.store.markMentionRead('bob',box[0].id).marked,false);
 f.reopen();
 box=f.store.mentionInbox('bob');
 assert.equal(box.length,2);
 assert(box.some(x=>x.source==='chat'&&x.readAt!==null));
});
test('group mentions notify only named members and not all participants',t=>{
 const f=fixture(t);
 const group=f.store.createGroup({creatorId:'alice',
  memberIds:['bob','charlie'],kind:'chat',title:'Project',clientId:'group1'});
 f.store.sendGroup({groupId:group.id,senderId:'alice',clientId:'gmsg1',
  body:'Take a look '+tag('bob')+' at @ld000001'});
 assert.equal(f.store.mentionInbox('bob').length,1);
 assert.equal(f.store.mentionInbox('charlie').length,0);
 assert.equal(f.store.mentionInbox('bob')[0].source,'group_chat');
 assert.equal(f.store.mentionInbox('bob')[0].groupId,group.id);
 assert.throws(()=>f.store.sendGroup({groupId:group.id,senderId:'alice',
  clientId:'notMember',body:'Hello '+tag('outsider')}),/mention_not_in_conversation/);
 assert.equal(f.store.mentionInbox('outsider').length,0);
 const mailGroup=f.store.createGroup({creatorId:'alice',
  memberIds:['bob','owner1'],kind:'mail',title:'Status',clientId:'group2'});
 f.store.sendGroup({groupId:mailGroup.id,senderId:'bob',clientId:'gmail1',
  subject:'Escalation',body:'For '+tag('owner1')});
 assert.equal(f.store.mentionInbox('owner1')[0].source,'group_mail');
});
test('users cannot tag nonparticipants in direct mail or send illicit owner chats',t=>{
 const f=fixture(t);
 const to=f.store.addressFor('bob');
 assert.throws(()=>f.store.sendMail({senderId:'alice',recipientId:'bob',
  toAddress:to,subject:'Hi',body:tag('outsider'),clientId:'badmail'}),
  /mention_not_in_conversation/);
 assert.throws(()=>f.store.sendChat({senderId:'alice',recipientId:'owner1',
  body:tag('owner1'),clientId:'badchat'}),/owner_chat_forbidden/);
 assert.equal(f.store.mentionInbox('owner1').length,0);
 assert.equal(f.store.mentionInbox('bob').length,0);
});
