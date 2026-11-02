import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {extractMessageReferences} from './message-references.mjs';
import {chmodSync,existsSync,mkdirSync,realpathSync} from 'node:fs';
import path from 'node:path';

// Private DuckBio-only messages: no SMTP, IMAP, DNS or public mailbox.
// Authorization of authenticated accounts and membership is enforced by the
// caller; privileged system methods must NEVER be exposed as web routes.
export const VIRTUAL_DOMAIN='duckbio.internal';
export const OWNER_SUPPORT='support@duckbio.internal';
export const OWNER_BILLING='billing@duckbio.internal';
export const SECURITY_SENDER='duckbio-security';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const validText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
const fail=code=>{throw Error(code);};

export function createCommunicationsStore({databasePath,clock=Date.now,ownerAccountId=null,verifyCoauthorEvent=null}={}){
 if(verifyCoauthorEvent!==null&&typeof verifyCoauthorEvent!=='function')fail('invalid_coauthor_verifier');
 if(typeof databasePath!=='string'||!path.isAbsolute(databasePath)||
    databasePath.split(path.sep).some(x=>['public_html','docs','.github'].includes(x))||
    typeof clock!=='function'||(ownerAccountId!==null&&!validId(ownerAccountId)))
   fail('private_communications_path_required');
 let ancestor=path.dirname(databasePath);
 while(!existsSync(ancestor)&&path.dirname(ancestor)!==ancestor)ancestor=path.dirname(ancestor);
 if(realpathSync(ancestor).split(path.sep).some(x=>['public_html','docs','.github'].includes(x)))
  fail('private_communications_path_required');
 mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec([
  "CREATE TABLE IF NOT EXISTS virtual_addresses(account TEXT PRIMARY KEY,local_part TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS chat_messages(id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,client_id TEXT,UNIQUE(sender,client_id))",
  "CREATE INDEX IF NOT EXISTS idx_chat_by_recipient ON chat_messages(recipient,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_chat_by_sender ON chat_messages(sender,created_at)",
  "CREATE TABLE IF NOT EXISTS internal_mails(id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,from_address TEXT NOT NULL,to_address TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('user','billing','contact')),created_at INTEGER NOT NULL,read_at INTEGER,system_reference TEXT UNIQUE,client_id TEXT,UNIQUE(sender,client_id))",
  "CREATE INDEX IF NOT EXISTS idx_mail_inbox ON internal_mails(recipient,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_mail_sent ON internal_mails(sender,created_at)",
  "CREATE TABLE IF NOT EXISTS conversation_groups(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('chat','mail')),title TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,create_client_id TEXT NOT NULL,UNIQUE(created_by,create_client_id))",
  "CREATE TABLE IF NOT EXISTS conversation_group_members(group_id TEXT NOT NULL REFERENCES conversation_groups(id),account TEXT NOT NULL,joined_at INTEGER NOT NULL,PRIMARY KEY(group_id,account))",
  "CREATE INDEX IF NOT EXISTS idx_group_by_member ON conversation_group_members(account,group_id)",
  "CREATE TABLE IF NOT EXISTS conversation_group_messages(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES conversation_groups(id),sender TEXT NOT NULL,subject TEXT,body TEXT NOT NULL,created_at INTEGER NOT NULL,client_id TEXT NOT NULL,UNIQUE(sender,client_id))",
  "CREATE INDEX IF NOT EXISTS idx_group_messages ON conversation_group_messages(group_id,created_at)",
  "CREATE TABLE IF NOT EXISTS conversation_group_reads(group_id TEXT NOT NULL REFERENCES conversation_groups(id),account TEXT NOT NULL,message_id TEXT NOT NULL REFERENCES conversation_group_messages(id),read_at INTEGER NOT NULL,PRIMARY KEY(group_id,account,message_id))",
  "CREATE TABLE IF NOT EXISTS message_mentions(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,sender TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('chat','mail','group_chat','group_mail')),message_id TEXT NOT NULL,group_id TEXT,created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(recipient,source,message_id))",
  "CREATE INDEX IF NOT EXISTS idx_mentions_recipient ON message_mentions(recipient,created_at DESC)",
  "CREATE TABLE IF NOT EXISTS coauthor_notifications(id TEXT PRIMARY KEY,source_event TEXT UNIQUE NOT NULL,recipient TEXT NOT NULL,actor TEXT NOT NULL,content_id TEXT NOT NULL,app_id TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_coauthor_notifications ON coauthor_notifications(recipient,created_at DESC)",
  "CREATE TABLE IF NOT EXISTS internal_sync_cursors(name TEXT PRIMARY KEY,offset INTEGER NOT NULL CHECK(offset>=0))",
  "CREATE TABLE IF NOT EXISTS public_contact_delivery(submission_id TEXT PRIMARY KEY,mail_id TEXT NOT NULL UNIQUE REFERENCES internal_mails(id),contact_email TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),state TEXT NOT NULL CHECK(state IN ('pending','sending','accepted','failed')),attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,lease_token TEXT,locked_until INTEGER,created_at INTEGER NOT NULL)"
 ].join(';')+';');
 for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))
  chmodSync(databasePath+suffix,0o600);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}};
 const generateAddress=account=>{
  if(!validId(account))fail('invalid_account');
  return tx(()=>{
   let row=db.prepare('SELECT local_part FROM virtual_addresses WHERE account=?').get(account);
   if(row)return row.local_part+'@'+VIRTUAL_DOMAIN;
   for(let n=0;n<8;n++){
    const local='duck-'+randomBytes(12).toString('hex');
    try{
     db.prepare('INSERT INTO virtual_addresses VALUES(?,?,?)').run(account,local,clock());
     return local+'@'+VIRTUAL_DOMAIN;
    }catch(error){
     if(!String(error).includes('UNIQUE constraint'))throw error;
    }
   }
   fail('address_unavailable');
  });
 };
 const ensureRate=(sender,table,now)=>{
  const n=db.prepare('SELECT count(*) AS n FROM '+table+' WHERE sender=? AND created_at>?')
   .get(sender,now-60000).n;
  if(n>=20)fail('message_rate_limited');
 };
 const recordMentions=({refs,senderId,messageId,source,groupId=null,now})=>{
  const stmt=db.prepare('INSERT OR IGNORE INTO message_mentions(id,recipient,sender,source,message_id,group_id,created_at) VALUES(?,?,?,?,?,?,?)');
  for(const recipient of refs.userIds)if(recipient!==senderId)
    stmt.run(randomUUID(),recipient,senderId,source,messageId,groupId,now);
 };
 const mailView=x=>({
  id:x.id,from:x.from_address,to:x.to_address,subject:x.subject,
  body:x.body,kind:x.kind,createdAt:x.created_at,readAt:x.read_at,
  mentions:extractMessageReferences(x.body)
 });
 const chatView=x=>({id:x.id,senderId:x.sender,recipientId:x.recipient,
  body:x.body,createdAt:x.created_at,readAt:x.read_at,
  mentions:extractMessageReferences(x.body)});
 return Object.freeze({
  // A group includes the creator plus 2–29 explicitly verified participants.
  // The HTTP caller must resolve every account against active central identities
  // and membership before calling these private persistence operations.
  createGroup({creatorId,memberIds,kind='chat',title,clientId}={}){
   if(!validId(creatorId)||!validId(clientId)||
      !['chat','mail'].includes(kind)||!validText(title,100)||
      !Array.isArray(memberIds)||memberIds.length<2||memberIds.length>29||
      memberIds.some(x=>!validId(x)||x===SECURITY_SENDER)||
      new Set(memberIds).size!==memberIds.length||
      memberIds.includes(creatorId))fail('invalid_group');
   const participants=[creatorId,...memberIds].sort();
   if(kind==='chat'&&ownerAccountId&&participants.includes(ownerAccountId)&&
      creatorId!==ownerAccountId)fail('owner_chat_forbidden');
   return tx(()=>{
    const old=db.prepare('SELECT * FROM conversation_groups WHERE created_by=? AND create_client_id=?')
      .get(creatorId,clientId);
    if(old){
     const members=db.prepare('SELECT account FROM conversation_group_members WHERE group_id=? ORDER BY account')
      .all(old.id).map(x=>x.account);
     if(old.title!==title.trim()||old.kind!==kind||
        JSON.stringify(members)!==JSON.stringify(participants))fail('message_conflict');
     return {id:old.id,kind:old.kind,title:old.title,members,duplicate:true};
    }
    const now=clock(),groupId=randomUUID();
    db.prepare('INSERT INTO conversation_groups VALUES(?,?,?,?,?,?)')
      .run(groupId,kind,title.trim(),creatorId,now,clientId);
    const insert=db.prepare('INSERT INTO conversation_group_members VALUES(?,?,?)');
    for(const member of participants)insert.run(groupId,member,now);
    return {id:groupId,kind,title:title.trim(),members:participants,duplicate:false};
   });
  },
  groupsFor(accountId){
   if(!validId(accountId))fail('invalid_account');
   return db.prepare(`SELECT g.id,g.kind,g.title,g.created_by,g.created_at,
      (SELECT count(*) FROM conversation_group_members x WHERE x.group_id=g.id) AS member_count
    FROM conversation_groups g JOIN conversation_group_members m ON m.group_id=g.id
    WHERE m.account=? ORDER BY g.created_at DESC,g.id DESC LIMIT 100`)
    .all(accountId).map(x=>({id:x.id,kind:x.kind,title:x.title,
      createdBy:x.created_by,createdAt:x.created_at,memberCount:x.member_count}));
  },
  groupMembers({groupId,actorId}={}){
   if(!validId(groupId)||!validId(actorId))fail('invalid_group');
   if(!db.prepare('SELECT 1 FROM conversation_group_members WHERE group_id=? AND account=?')
     .get(groupId,actorId))fail('group_access_denied');
   return db.prepare('SELECT account FROM conversation_group_members WHERE group_id=? ORDER BY account')
    .all(groupId).map(x=>x.account);
  },
  sendGroup({groupId,senderId,body,subject=null,clientId}={}){
   if(!validId(groupId)||!validId(senderId)||!validId(clientId)||
      !validText(body,8000))fail('invalid_group_message');
   const refs=extractMessageReferences(body);
   return tx(()=>{
    const group=db.prepare('SELECT * FROM conversation_groups WHERE id=?').get(groupId);
    if(!group||!db.prepare('SELECT 1 FROM conversation_group_members WHERE group_id=? AND account=?')
      .get(groupId,senderId))fail('group_access_denied');
    if(group.kind==='chat'&&subject!==null||
       group.kind==='mail'&&!validText(subject,160))fail('invalid_group_message');
    const members=db.prepare('SELECT account FROM conversation_group_members WHERE group_id=?')
      .all(groupId).map(x=>x.account);
    if(group.kind==='chat'&&ownerAccountId&&members.includes(ownerAccountId)&&
       senderId!==ownerAccountId)fail('owner_chat_forbidden');
    // Mentioning somebody is not silently adding them to a private conversation.
    if(refs.userIds.some(x=>!members.includes(x)))fail('mention_not_in_conversation');
    const old=db.prepare('SELECT * FROM conversation_group_messages WHERE sender=? AND client_id=?')
      .get(senderId,clientId);
    if(old){
     if(old.group_id!==groupId||old.subject!==subject||old.body!==body.trim())
      fail('message_conflict');
     return {id:old.id,created:false};
    }
    const now=clock();
    ensureRate(senderId,'conversation_group_messages',now);
    const messageId=randomUUID();
    db.prepare('INSERT INTO conversation_group_messages VALUES(?,?,?,?,?,?,?)')
      .run(messageId,groupId,senderId,subject,body.trim(),now,clientId);
    recordMentions({refs,senderId,messageId,source:group.kind==='chat'?'group_chat':'group_mail',
      groupId,now});
    return {id:messageId,created:true,mentions:refs};
   });
  },
  groupHistory({groupId,actorId,limit=100}={}){
   if(!validId(groupId)||!validId(actorId)||
      !Number.isSafeInteger(limit)||limit<1||limit>100)fail('invalid_group');
   const group=db.prepare('SELECT * FROM conversation_groups WHERE id=?').get(groupId);
   if(!group||!db.prepare('SELECT 1 FROM conversation_group_members WHERE group_id=? AND account=?')
      .get(groupId,actorId))fail('group_access_denied');
   return {group:{id:group.id,kind:group.kind,title:group.title,createdBy:group.created_by},
     messages:db.prepare(`SELECT m.id,m.sender,m.subject,m.body,m.created_at,
       (SELECT read_at FROM conversation_group_reads r WHERE r.group_id=m.group_id AND r.account=? AND r.message_id=m.id) AS read_at
       FROM conversation_group_messages m WHERE m.group_id=?
       ORDER BY m.created_at DESC,m.id DESC LIMIT ?`).all(actorId,groupId,limit).reverse().map(x=>({
         id:x.id,senderId:x.sender,subject:x.subject,body:x.body,
         createdAt:x.created_at,readAt:x.read_at,
         mentions:extractMessageReferences(x.body)
       }))};
  },
  markGroupRead({groupId,actorId,messageId}={}){
   if(!validId(groupId)||!validId(actorId)||!validId(messageId))
    fail('invalid_group');
   return tx(()=>{
    if(!db.prepare('SELECT 1 FROM conversation_group_members WHERE group_id=? AND account=?')
       .get(groupId,actorId))fail('group_access_denied');
    const msg=db.prepare('SELECT sender FROM conversation_group_messages WHERE group_id=? AND id=?')
       .get(groupId,messageId);
    if(!msg)fail('message_not_found');
    if(msg.sender===actorId)return {marked:false};
    const result=db.prepare('INSERT OR IGNORE INTO conversation_group_reads VALUES(?,?,?,?)')
       .run(groupId,actorId,messageId,clock());
    return {marked:result.changes>0};
   });
  },
  // Account-scoped, internal-only notification inbox. An @tag does not grant
  // group membership, create a user account, or reveal native app content.
  mentionInbox(accountId,{limit=50}={}){
   if(!validId(accountId)||!Number.isSafeInteger(limit)||limit<1||limit>100)
    fail('invalid_mention_query');
   return db.prepare('SELECT * FROM message_mentions WHERE recipient=? ORDER BY created_at DESC,id DESC LIMIT ?')
     .all(accountId,limit).map(x=>({id:x.id,senderId:x.sender,source:x.source,
       groupId:x.group_id,messageId:x.message_id,createdAt:x.created_at,
       readAt:x.read_at}));
  },
  markMentionRead(accountId,notificationId){
   if(!validId(accountId)||!validId(notificationId))fail('invalid_mention');
   const changed=db.prepare('UPDATE message_mentions SET read_at=COALESCE(read_at,?) WHERE recipient=? AND id=? AND read_at IS NULL')
     .run(clock(),accountId,notificationId).changes;
   return {marked:changed>0};
  },
  // Trusted native-app events only; there is NO user-callable web route.
  // A callback must independently validate content membership/ownership,
  // collaborator grant and authenticity. Never accept arbitrary UI claims.
  postCoauthorNotification({proof,reference,recipientId,actorId,contentId,appId}={}){
   if(!verifyCoauthorEvent)fail('coauthor_integration_unavailable');
   const prefixes={limsman:'ld',duckman:'dm',eel:'dn',goflo:'cd',methpipe:'md',mantrain:'dt'};
   if(!validId(reference)||!validId(recipientId)||!validId(actorId)||
      recipientId===actorId||!Object.hasOwn(prefixes,appId)||
      typeof contentId!=='string'||!new RegExp('^'+prefixes[appId]+'[0-9]{6,}$').test(contentId))
    fail('invalid_coauthor_event');
   const event={reference,recipientId,actorId,contentId,appId};
   if(verifyCoauthorEvent({proof,event})!==true)fail('coauthor_event_unverified');
   return tx(()=>{
    const prior=db.prepare('SELECT * FROM coauthor_notifications WHERE source_event=?').get(reference);
    if(prior){
     if(prior.recipient!==recipientId||prior.actor!==actorId||
        prior.content_id!==contentId||prior.app_id!==appId)fail('coauthor_event_conflict');
     return {id:prior.id,created:false};
    }
    const notificationId=randomUUID();
    db.prepare('INSERT INTO coauthor_notifications(id,source_event,recipient,actor,content_id,app_id,created_at) VALUES(?,?,?,?,?,?,?)')
     .run(notificationId,reference,recipientId,actorId,contentId,appId,clock());
    return {id:notificationId,created:true};
   });
  },
  notifications(accountId,{limit=50}={}){
   if(!validId(accountId)||!Number.isSafeInteger(limit)||limit<1||limit>100)
    fail('invalid_notification_query');
   const mentions=db.prepare('SELECT * FROM message_mentions WHERE recipient=? ORDER BY created_at DESC,id DESC LIMIT ?')
     .all(accountId,limit).map(x=>({id:x.id,kind:'mention',senderId:x.sender,
       source:x.source,groupId:x.group_id,messageId:x.message_id,
       contentId:null,appId:null,createdAt:x.created_at,readAt:x.read_at}));
   const coauthors=db.prepare('SELECT * FROM coauthor_notifications WHERE recipient=? ORDER BY created_at DESC,id DESC LIMIT ?')
     .all(accountId,limit).map(x=>({id:x.id,kind:'coauthor',senderId:x.actor,
       source:'coauthor',groupId:null,messageId:null,contentId:x.content_id,
       appId:x.app_id,createdAt:x.created_at,readAt:x.read_at}));
   return [...mentions,...coauthors].sort((a,b)=>b.createdAt-a.createdAt||
     b.id.localeCompare(a.id)).slice(0,limit);
  },
  markNotificationRead(accountId,notificationId){
   if(!validId(accountId)||!validId(notificationId))fail('invalid_notification');
   return tx(()=>{
    const first=db.prepare('UPDATE message_mentions SET read_at=? WHERE recipient=? AND id=? AND read_at IS NULL')
     .run(clock(),accountId,notificationId).changes;
    const second=db.prepare('UPDATE coauthor_notifications SET read_at=? WHERE recipient=? AND id=? AND read_at IS NULL')
     .run(clock(),accountId,notificationId).changes;
    return {marked:first+second>0};
   });
  },
  unreadCounts(accountId){
   if(!validId(accountId))fail('invalid_account');
   const one=(q,...args)=>db.prepare(q).get(...args).n;
   const directChat=one('SELECT count(*) n FROM chat_messages WHERE recipient=? AND read_at IS NULL',accountId);
   const directMail=one('SELECT count(*) n FROM internal_mails WHERE recipient=? AND read_at IS NULL',accountId);
   const groups= db.prepare(`SELECT g.kind,count(*) n FROM conversation_group_messages m
     JOIN conversation_groups g ON g.id=m.group_id
     JOIN conversation_group_members members ON members.group_id=m.group_id AND members.account=?
     LEFT JOIN conversation_group_reads r ON r.group_id=m.group_id AND r.message_id=m.id AND r.account=?
     WHERE m.sender<>? AND r.read_at IS NULL GROUP BY g.kind`).all(accountId,accountId,accountId);
   const byKind=Object.fromEntries(groups.map(x=>[x.kind,x.n]));
   const notifications=one('SELECT count(*) n FROM message_mentions WHERE recipient=? AND read_at IS NULL',accountId)+
     one('SELECT count(*) n FROM coauthor_notifications WHERE recipient=? AND read_at IS NULL',accountId);
   return {chat:directChat+(byKind.chat||0),mail:directMail+(byKind.mail||0),notifications};
  },
  addressFor(account){return generateAddress(account);},
  ownerAddresses(){return ownerAccountId?
   {support:OWNER_SUPPORT,billing:OWNER_BILLING}:null;},
  // Stable address mapping is not a public user directory: callers must
  // verify an active, discoverable recipient through central identity/membership.
  resolveAddress(address){
   if(typeof address!=='string'||address.length>100)return null;
   const normalized=address.trim().toLowerCase();
   if((normalized===OWNER_SUPPORT||normalized===OWNER_BILLING)&&ownerAccountId)
    return {accountId:ownerAccountId,alias:normalized};
   const match=/^duck-[a-f0-9]{24}@duckbio\.internal$/.exec(normalized);
   if(!match)return null;
   const row=db.prepare('SELECT account FROM virtual_addresses WHERE local_part=?')
    .get(normalized.split('@')[0]);
   return row?{accountId:row.account,alias:null}:null;
  },
  sendChat({senderId,recipientId,body,clientId}){
   if(!validId(senderId)||!validId(recipientId)||senderId===recipientId||
      senderId===SECURITY_SENDER||recipientId===SECURITY_SENDER||
      !validText(body,2000)||!validId(clientId))fail('invalid_chat_message');
   if(ownerAccountId&&recipientId===ownerAccountId&&senderId!==ownerAccountId)
    fail('owner_chat_forbidden');
   const refs=extractMessageReferences(body);
   if(refs.userIds.some(x=>x!==senderId&&x!==recipientId))
    fail('mention_not_in_conversation');
   return tx(()=>{
    const prior=db.prepare('SELECT * FROM chat_messages WHERE sender=? AND client_id=?')
     .get(senderId,clientId);
    if(prior){
     if(prior.recipient!==recipientId||prior.body!==body.trim())fail('message_conflict');
     return {...chatView(prior),duplicate:true};
    }
    const now=clock();
    ensureRate(senderId,'chat_messages',now);
    const id=randomUUID();
    db.prepare('INSERT INTO chat_messages(id,sender,recipient,body,created_at,client_id) VALUES(?,?,?,?,?,?)')
     .run(id,senderId,recipientId,body.trim(),now,clientId);
    recordMentions({refs,senderId,messageId:id,source:'chat',now});
    return {id,senderId,recipientId,body:body.trim(),createdAt:now,readAt:null,duplicate:false};
   });
  },
  chatThreads(accountId){
   if(!validId(accountId))fail('invalid_account');
   const rows=db.prepare(`SELECT id,sender,recipient,body,created_at,read_at
    FROM chat_messages WHERE sender=? OR recipient=? ORDER BY created_at DESC,id DESC LIMIT 2000`)
    .all(accountId,accountId);
   const map=new Map();
   for(const x of rows){
    const peerId=x.sender===accountId?x.recipient:x.sender;
    if(!map.has(peerId))map.set(peerId,{peerId,last:chatView(x),
      unread:0,system:peerId===SECURITY_SENDER});
    if(x.recipient===accountId&&x.read_at===null)map.get(peerId).unread++;
   }
   return [...map.values()].slice(0,100);
  },
  chatHistory(accountId,peerId){
   if(!validId(accountId)||!validId(peerId)||
      (peerId===SECURITY_SENDER&&accountId!==ownerAccountId))
    fail('access_denied');
   const rows=db.prepare(`SELECT * FROM chat_messages
     WHERE (sender=? AND recipient=?) OR (sender=? AND recipient=?)
     ORDER BY created_at DESC,id DESC LIMIT 100`)
    .all(accountId,peerId,peerId,accountId).reverse();
   return rows.map(chatView);
  },
  markChatRead(accountId,peerId){
   if(!validId(accountId)||!validId(peerId))fail('invalid_account');
   return db.prepare('UPDATE chat_messages SET read_at=? WHERE recipient=? AND sender=? AND read_at IS NULL')
    .run(clock(),accountId,peerId).changes;
  },
  sendMail({senderId,recipientId,toAddress,subject,body,clientId}){
   if(!validId(senderId)||!validId(recipientId)||!validId(clientId)||
      !validText(subject,160)||!validText(body,8000)||typeof toAddress!=='string')
    fail('invalid_internal_mail');
   const normalized=toAddress.trim().toLowerCase();
   const destination=this.resolveAddress(normalized);
   if(!destination||destination.accountId!==recipientId||
      destination.alias===OWNER_BILLING)
    fail('mail_recipient_unavailable');
   if(ownerAccountId&&recipientId===ownerAccountId&&
      destination.alias!==OWNER_SUPPORT)fail('mail_recipient_unavailable');
   const refs=extractMessageReferences(body);
   if(refs.userIds.some(x=>x!==senderId&&x!==recipientId))
    fail('mention_not_in_conversation');
   const fromAddress=ownerAccountId&&senderId===ownerAccountId?
    OWNER_SUPPORT:generateAddress(senderId);
   return tx(()=>{
    const prior=db.prepare("SELECT * FROM internal_mails WHERE sender=? AND client_id=?")
      .get(senderId,clientId);
    if(prior){
     if(prior.recipient!==recipientId||prior.to_address!==normalized||
        prior.subject!==subject.trim()||prior.body!==body.trim())
      fail('message_conflict');
     return {...mailView(prior),duplicate:true};
    }
    const now=clock();
    ensureRate(senderId,'internal_mails',now);
    const id=randomUUID();
    db.prepare(`INSERT INTO internal_mails(id,sender,recipient,from_address,to_address,
     subject,body,kind,created_at,client_id) VALUES(?,?,?,?,?,?,?,'user',?,?)`)
      .run(id,senderId,recipientId,fromAddress,normalized,subject.trim(),body.trim(),now,clientId);
    recordMentions({refs,senderId,messageId:id,source:'mail',now});
    return {id,from:fromAddress,to:normalized,subject:subject.trim(),body:body.trim(),
      kind:'user',createdAt:now,readAt:null,duplicate:false};
   });
  },
  listMail(accountId,folder='inbox'){
   if(!validId(accountId)||!['inbox','sent'].includes(folder))fail('invalid_mail_folder');
   const col=folder==='inbox'?'recipient':'sender';
   return db.prepare('SELECT * FROM internal_mails WHERE '+col+'=? ORDER BY created_at DESC,id DESC LIMIT 100')
     .all(accountId).map(mailView);
  },
  markMailRead(accountId,id){
   if(!validId(accountId)||!validId(id))fail('invalid_account');
   return db.prepare('UPDATE internal_mails SET read_at=? WHERE recipient=? AND id=? AND read_at IS NULL')
    .run(clock(),accountId,id).changes;
  },
  // Public contact handler MUST verify Turnstile and exact Origin first.
  // Persist internal owner mail and external delivery job atomically. The
  // public endpoint never directly claims actual external mail delivery.
  acceptPublicContact({submissionId,name,email,organization='',subject,message}={}){
   if(!ownerAccountId||!validId(submissionId)||!validText(name,120)||
      typeof email!=='string'||email.length>254||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
      /[\r\n]/.test(email)||typeof organization!=='string'||
      organization.length>180||/[\r\n]/.test(organization)||/[\r\n]/.test(name)||
      !validText(subject,120)||/[\r\n]/.test(subject)||!validText(message,5000))
    fail('invalid_contact');
   const clean={name:name.trim(),email:email.trim().toLowerCase(),
     organization:organization.trim(),subject:subject.trim(),message:message.trim()};
   return tx(()=>{
    const previous=db.prepare('SELECT payload FROM public_contact_delivery WHERE submission_id=?')
      .get(submissionId);
    if(previous){
     if(JSON.stringify(clean)!==previous.payload)fail('contact_submission_conflict');
     return {accepted:true,internalDelivered:true,externalStatus:'queued',duplicate:true};
    }
    const now=clock();
    const recent=db.prepare('SELECT count(*) AS n FROM public_contact_delivery WHERE contact_email=? AND created_at>?')
      .get(clean.email,now-3600000).n;
    const total=db.prepare('SELECT count(*) AS n FROM public_contact_delivery WHERE created_at>?')
      .get(now-3600000).n;
    if(recent>=5||total>=200)fail('contact_rate_limited');
    const id=randomUUID(),body=[
      'New DuckBio website contact','',
      'Name: '+clean.name,
      'External email: '+clean.email,
      'Organization: '+(clean.organization||'Not provided'),
      'Subject: '+clean.subject,'',
      clean.message
    ].join('\n');
    db.prepare(`INSERT INTO internal_mails(id,sender,recipient,from_address,to_address,
     subject,body,kind,created_at,system_reference) VALUES(?,?,?,?,?,?,?,'contact',?,?)`)
      .run(id,'duckbio-contact-form',ownerAccountId,'form@duckbio.internal',
        OWNER_SUPPORT,'Website: '+clean.subject,body,now,'contact:'+submissionId);
    db.prepare("INSERT INTO public_contact_delivery(submission_id,mail_id,contact_email,payload,state,available_at,created_at) VALUES(?,?,?,?,'pending',?,?)")
      .run(submissionId,id,clean.email,JSON.stringify(clean),now,now);
    return {accepted:true,internalDelivered:true,externalStatus:'queued',duplicate:false};
   });
  },
  claimPublicContactDelivery(){
   return tx(()=>{
    const now=clock();
    const row=db.prepare("SELECT * FROM public_contact_delivery WHERE attempts<6 AND ((state='pending' AND available_at<=?) OR (state='sending' AND locked_until<=?)) ORDER BY created_at,submission_id LIMIT 1")
      .get(now,now);
    if(!row)return null;
    const leaseToken=randomUUID();
    db.prepare("UPDATE public_contact_delivery SET state='sending',attempts=attempts+1,lease_token=?,locked_until=? WHERE submission_id=?")
      .run(leaseToken,now+120000,row.submission_id);
    return {submissionId:row.submission_id,leaseToken,
      idempotencyKey:'duckbio-contact-'+row.submission_id,...JSON.parse(row.payload)};
   });
  },
  finishPublicContactDelivery({submissionId,leaseToken,accepted}={}){
   if(!validId(submissionId)||!validId(leaseToken)||typeof accepted!=='boolean')
    fail('invalid_contact_delivery');
   return tx(()=>{
    const row=db.prepare('SELECT state,lease_token,attempts FROM public_contact_delivery WHERE submission_id=?')
      .get(submissionId);
    if(!row||row.state!=='sending'||row.lease_token!==leaseToken)
     fail('contact_delivery_lease_conflict');
    const now=clock(),exhausted=row.attempts>=6;
    const delay=Math.min(6*3600000,60000*2**Math.min(row.attempts,8));
    const state=accepted?'accepted':exhausted?'failed':'pending';
    db.prepare("UPDATE public_contact_delivery SET state=?,lease_token=NULL,locked_until=NULL,available_at=? WHERE submission_id=?")
      .run(state,accepted?now:now+delay,submissionId);
    return {state};
   });
  },
  // Private cross-database delivery progress. Insert into the communications
  // DB before moving the watermark so a restart safely replays undelivered
  // events without duplicating notices.
  ownerAuditCursor(){
   return db.prepare("SELECT offset FROM internal_sync_cursors WHERE name='owner-audit'")
     .get()?.offset??0;
  },
  advanceOwnerAuditCursor(id){
   if(!Number.isSafeInteger(id)||id<0)fail('invalid_audit_cursor');
   return tx(()=>{
    const old=db.prepare("SELECT offset FROM internal_sync_cursors WHERE name='owner-audit'")
      .get()?.offset??0;
    if(id>old)db.prepare("INSERT INTO internal_sync_cursors(name,offset) VALUES('owner-audit',?) ON CONFLICT(name) DO UPDATE SET offset=excluded.offset")
      .run(id);
    return Math.max(old,id);
   });
  },
  // Private system-only boundaries: never callable through an authenticated
  // user route, even by a central administrator.
  postSubscriptionNotice({reference,organizationName,description}){
   if(!ownerAccountId||!validId(reference)||!validText(organizationName,200)||
      !validText(description,4000))fail('invalid_system_notice');
   return tx(()=>{
    const prior=db.prepare('SELECT id FROM internal_mails WHERE system_reference=?')
     .get('billing:'+reference);
    if(prior)return {id:prior.id,duplicate:true};
    const id=randomUUID();
    db.prepare(`INSERT INTO internal_mails(id,sender,recipient,from_address,to_address,
      subject,body,kind,created_at,system_reference) VALUES(?,?,?,?,?,?,?,'billing',?,?)`)
      .run(id,SECURITY_SENDER,ownerAccountId,'subscriptions@duckbio.internal',
       OWNER_BILLING,'Subscription update: '+organizationName,
       description.trim(),clock(),'billing:'+reference);
    return {id,duplicate:false};
   });
  },
  postSecurityAlert({reference,description}){
   if(!ownerAccountId||!validId(reference)||!validText(description,2000))
    fail('invalid_system_notice');
   return tx(()=>{
    const prior=db.prepare('SELECT id FROM chat_messages WHERE sender=? AND client_id=?')
     .get(SECURITY_SENDER,'security:'+reference);
    if(prior)return {id:prior.id,duplicate:true};
    const id=randomUUID();
    db.prepare('INSERT INTO chat_messages(id,sender,recipient,body,created_at,client_id) VALUES(?,?,?,?,?,?)')
     .run(id,SECURITY_SENDER,ownerAccountId,description.trim(),clock(),'security:'+reference);
    return {id,duplicate:false};
   });
  },
  close(){db.close();}
 });
}
