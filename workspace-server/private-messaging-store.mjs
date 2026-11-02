import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

// Private message persistence; identity and memberships must be verified by
// the caller against the central identity/organization stores, never by email.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const validText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
const error=message=>{throw Error(message);};
const addressFor=userId=>'u-'+Buffer.from(userId).toString('hex')+'@duckbio.internal';
export function createPrivateMessagingStore({
 databasePath,ownerAccountId,identityLookup,sharedOrganizations,clock=Date.now
}={}){
 if(!isAbsolute(databasePath||'')||!id(ownerAccountId)||
    typeof identityLookup!=='function'||typeof sharedOrganizations!=='function'||
    typeof clock!=='function')error('invalid_messaging_configuration');
 mkdirSync(dirname(databasePath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec(`
 CREATE TABLE IF NOT EXISTS internal_messages(
  id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('chat','mail')),
  sender TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT,body TEXT NOT NULL,
  created_at INTEGER NOT NULL,read_at INTEGER,
  sender_deleted INTEGER NOT NULL DEFAULT 0,recipient_deleted INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX IF NOT EXISTS messages_recipient_idx ON internal_messages(recipient,created_at DESC);
 CREATE INDEX IF NOT EXISTS messages_chat_idx ON internal_messages(sender,recipient,created_at DESC);
 CREATE TABLE IF NOT EXISTS internal_message_requests(
  actor TEXT NOT NULL,request_id TEXT NOT NULL,message_id TEXT NOT NULL UNIQUE REFERENCES internal_messages(id),
  PRIMARY KEY(actor,request_id)
 );
 `);
 for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))chmodSync(databasePath+suffix,0o600);
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}};
 function activeUser(userId){
  if(!id(userId))error('invalid_account');
  const result=identityLookup(userId);
  if(!result||result.id!==userId||result.state!=='active')error('account_unavailable');
  return result;
 }
 const access=(actor,recipient,kind)=>{
  const source=activeUser(actor),destination=activeUser(recipient);
  if(source.id===destination.id)error('self_message_not_allowed');
  if(kind==='chat'&&recipient===ownerAccountId&&actor!==ownerAccountId)
   error('owner_chat_restricted');
  return {source,destination};
 };
 return Object.freeze({
  address(userId){
   activeUser(userId);
   return addressFor(userId);
  },
  resolveInternalAddress(alias){
   if(typeof alias!=='string'||alias.length>300||
      !/^u-[a-f0-9]+@duckbio\.internal$/.test(alias))error('invalid_internal_address');
   let userId;
   try{userId=Buffer.from(alias.slice(2,-'@duckbio.internal'.length),'hex').toString('utf8');}
   catch{error('invalid_internal_address');}
   if(!id(userId)||addressFor(userId)!==alias)error('invalid_internal_address');
   return activeUser(userId).id;
  },
  contacts(actor,{query='',limit=30}={}){
   activeUser(actor);
   if(typeof query!=='string'||query.length>120||
      !Number.isSafeInteger(limit)||limit<1||limit>100)error('invalid_contact_query');
   const search=query.trim().toLocaleLowerCase();
   // Directory source is a trusted central identity listing; expose only
   // active users who are actually in the caller's organizations unless
   // searching explicitly across organizations.
   const shared=sharedOrganizations(actor);
   if(!Array.isArray(shared))error('invalid_contact_directory');
   const list=shared.filter(userId=>id(userId)&&userId!==actor&&userId!==ownerAccountId)
     .map(userId=>identityLookup(userId))
     .filter(x=>x?.state==='active'&&x.id&&x.displayName)
     .filter(x=>!search||x.displayName.toLocaleLowerCase().includes(search))
     .slice(0,limit).map(x=>({id:x.id,name:x.displayName,
       internalAddress:addressFor(x.id)}));
   return {contacts:list,crossOrganizationSearchRequired:true};
  },
  send({actorId,recipientId,kind,subject=null,body,requestId}){
   if(!['chat','mail'].includes(kind)||!validText(body,10000)||
      !id(requestId)||!id(actorId)||!id(recipientId)||
      (kind==='mail'&&!validText(subject,200))||
      (kind==='chat'&&subject!==null))error('invalid_message');
   access(actorId,recipientId,kind);
   return tx(()=>{
    const previous=db.prepare('SELECT m.id,m.kind,m.recipient,m.subject,m.body FROM internal_message_requests r JOIN internal_messages m ON r.message_id=m.id WHERE r.actor=? AND r.request_id=?')
      .get(actorId,requestId);
    if(previous){
     if(previous.kind!==kind||previous.recipient!==recipientId||
        previous.subject!==subject||previous.body!==body)error('message_request_conflict');
     return {id:previous.id,created:false};
    }
    const messageId=randomUUID();
    db.prepare('INSERT INTO internal_messages(id,kind,sender,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(messageId,kind,actorId,recipientId,subject,body.trim(),clock());
    db.prepare('INSERT INTO internal_message_requests(actor,request_id,message_id) VALUES(?,?,?)')
      .run(actorId,requestId,messageId);
    return {id:messageId,created:true};
   });
  },
  inbox(actorId,{kind='mail',limit=50}={}){
   activeUser(actorId);
   if(!['chat','mail'].includes(kind)||!Number.isSafeInteger(limit)||limit<1||limit>100)
    error('invalid_inbox_query');
   return db.prepare('SELECT id,kind,sender,recipient,subject,body,created_at,read_at FROM internal_messages WHERE recipient=? AND kind=? AND recipient_deleted=0 ORDER BY created_at DESC,id DESC LIMIT ?')
     .all(actorId,kind,limit).map(x=>({...x}));
  },
  conversation(actorId,otherId,{limit=50}={}){
   access(actorId,otherId,'chat');
   if(!Number.isSafeInteger(limit)||limit<1||limit>100)error('invalid_inbox_query');
   return db.prepare(`SELECT id,sender,recipient,body,created_at,read_at
    FROM internal_messages WHERE kind='chat' AND
    ((sender=? AND recipient=? AND sender_deleted=0) OR
     (sender=? AND recipient=? AND recipient_deleted=0))
    ORDER BY created_at DESC,id DESC LIMIT ?`)
    .all(actorId,otherId,otherId,actorId,limit).map(x=>({...x}));
  },
  markRead(actorId,messageId){
   activeUser(actorId);
   if(!id(messageId))error('invalid_message');
   const result=db.prepare('UPDATE internal_messages SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient=?')
     .run(clock(),messageId,actorId);
   return {updated:result.changes===1};
  },
  close(){db.close();}
 });
}
