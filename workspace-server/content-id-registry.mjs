import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,chmodSync,realpathSync} from 'node:fs';
import path from 'node:path';

const prefixes=Object.freeze({
 limsman:'ld',duckman:'dm',eel:'dn',goflo:'cd',methpipe:'md',mantrain:'dt'
});
const categories=new Set(['sample','document','workspace','analysis','method','experiment','run','other']);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const validName=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200&&
 !/[\u0000-\u001f\u007f]/.test(x);
const fail=code=>{throw Error(code);};
export const CONTENT_PREFIXES=prefixes;
export const CONTENT_MENTION_PATTERN=/(?:^|[^\p{L}\p{N}_])@((?:ld|dm|dn|cd|md|dt)(?=[0-9]{6,}(?:\\b|$))0*[1-9][0-9]*)\b/gu;
const canonicalName=name=>name.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US');
const formatId=(prefix,sequence)=>prefix+String(sequence).padStart(6,'0');
export function extractContentMentions(text){
 if(typeof text!=='string')return [];
 const found=new Set();
 for(const m of text.matchAll(CONTENT_MENTION_PATTERN))found.add(m[1]);
 return [...found].slice(0,50);
}

// One PRIVATE registry/database must be shared by all six apps.
// Only an independently verified server adapter can register an app's object.
export function createContentIdRegistry({
 databasePath,verifyRegistration=null,canView=null,clock=Date.now
}={}){
 if(typeof databasePath!=='string'||!path.isAbsolute(databasePath)||
    databasePath.split(path.sep).some(s=>['public_html','.github','docs'].includes(s))||
    typeof verifyRegistration!=='function'||typeof canView!=='function'||
    typeof clock!=='function')fail('private_resource_registry_configuration_required');
 let existing=path.dirname(databasePath);
 while(!existsSync(existing)&&path.dirname(existing)!==existing)existing=path.dirname(existing);
 if(realpathSync(existing).split(path.sep).some(s=>['public_html','.github','docs'].includes(s)))
  fail('private_resource_registry_configuration_required');
 mkdirSync(path.dirname(databasePath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
 db.exec(`
 CREATE TABLE IF NOT EXISTS content_registry(
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT UNIQUE NOT NULL,
  app_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  name TEXT NOT NULL,
  canonical_name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  UNIQUE(app_id,organization_id,source_key)
 );
 CREATE INDEX IF NOT EXISTS idx_registry_org_app ON content_registry(organization_id,app_id);
 `);
 for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix))
  chmodSync(databasePath+suffix,0o600);
 const tx=work=>{db.exec('BEGIN IMMEDIATE');try{
   const result=work();db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}};
 const rowView=row=>row?Object.freeze({
  id:row.content_id,appId:row.app_id,organizationId:row.organization_id,
  type:row.resource_type,name:row.name,archived:row.archived_at!==null
 }):null;
 function verified(proof,operation,record){
  if(verifyRegistration({proof,operation,record})!==true)fail('resource_registration_denied');
 }
 return Object.freeze({
  register({proof,organizationId,appId,type,sourceKey,name}={}){
   if(!id(organizationId)||!Object.hasOwn(prefixes,appId)||
      !categories.has(type)||!id(sourceKey)||!validName(name))
    fail('invalid_resource_registration');
   const key=canonicalName(name);
   if(key.length<1||key.length>200)fail('invalid_resource_registration');
   const record={organizationId,appId,type,sourceKey,name:name.normalize('NFKC').trim()};
   verified(proof,'register',record);
   return tx(()=>{
    const old=db.prepare('SELECT * FROM content_registry WHERE app_id=? AND organization_id=? AND source_key=?')
      .get(appId,organizationId,sourceKey);
    if(old){
     if(old.resource_type!==type||old.canonical_name!==key)
      fail('resource_source_conflict');
     return {...rowView(old),created:false};
    }
    if(db.prepare('SELECT 1 FROM content_registry WHERE canonical_name=?').get(key))
     fail('resource_name_conflict');
    // SQLite AUTOINCREMENT uses one GLOBAL sequence, across every app.
    const assigned=db.prepare(`INSERT INTO content_registry(content_id,app_id,organization_id,resource_type,source_key,name,canonical_name,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('pending-'+randomUUID(),
       appId,organizationId,type,sourceKey,record.name,key,clock());
    const sequence=Number(assigned.lastInsertRowid);
    if(!Number.isSafeInteger(sequence)||sequence<1)fail('resource_sequence_exhausted');
    const contentId=formatId(prefixes[appId],sequence);
    db.prepare('UPDATE content_registry SET content_id=? WHERE sequence=?')
      .run(contentId,sequence);
    return {id:contentId,appId,organizationId,type,name:record.name,
      archived:false,created:true};
   });
  },
  archive({proof,contentId}={}){
   if(typeof contentId!=='string'||!/^(?:ld|dm|dn|cd|md|dt)(?=[0-9]{6,}(?:\\b|$))0*[1-9][0-9]*$/.test(contentId))
    fail('invalid_resource_id');
   return tx(()=>{
    const row=db.prepare('SELECT * FROM content_registry WHERE content_id=?').get(contentId);
    if(!row)fail('resource_not_found');
    verified(proof,'archive',rowView(row));
    if(row.archived_at!==null)return {id:contentId,archived:true,changed:false};
    db.prepare('UPDATE content_registry SET archived_at=? WHERE content_id=?').run(clock(),contentId);
    return {id:contentId,archived:true,changed:true};
   });
  },
  inspect({contentId,viewerId}={}){
   if(typeof contentId!=='string'||!/^(?:ld|dm|dn|cd|md|dt)(?=[0-9]{6,}(?:\\b|$))0*[1-9][0-9]*$/.test(contentId)||
      !id(viewerId))return null;
   const row=db.prepare('SELECT * FROM content_registry WHERE content_id=? AND archived_at IS NULL').get(contentId);
   if(!row)return null;
   // Never return name, tenant, type or existence without app-native authorization.
   if(canView({viewerId,organizationId:row.organization_id,
      appId:row.app_id,type:row.resource_type,sourceKey:row.source_key,contentId})!==true)
    return null;
   return rowView(row);
  },
  close(){db.close();}
 });
}
