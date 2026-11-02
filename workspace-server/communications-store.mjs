import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
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

export function createCommunicationsStore({databasePath,clock=Date.now,ownerAccountId=null}={}){
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
  "CREATE INDEX IF NOT EXISTS idx_mail_sent ON internal_mails(sender,created_at)"
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
 const mailView=x=>({
  id:x.id,from:x.from_address,to:x.to_address,subject:x.subject,
  body:x.body,kind:x.kind,createdAt:x.created_at,readAt:x.read_at
 });
 const chatView=x=>({id:x.id,senderId:x.sender,recipientId:x.recipient,
  body:x.body,createdAt:x.created_at,readAt:x.read_at});
 return Object.freeze({
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
