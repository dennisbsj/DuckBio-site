#!/usr/bin/env node
// Operator-only, offline organization setup. Never expose this command through HTTP.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOrganizationStore} from './organization-store.mjs';

function parse(argv){
 const names=new Set(['--identity-db','--organization-db','--id','--name','--owner-id','--nickname']);
 const args={};
 for(let i=0;i<argv.length;i+=2){
  if(!names.has(argv[i])||argv[i+1]===undefined||args[argv[i]]!==undefined)throw Error('invalid_args');
  args[argv[i]]=argv[i+1];
 }
 if(Object.keys(args).length!==names.size)throw Error('invalid_args');
 return args;
}
function privateFile(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||!existsSync(file))throw Error('private_identity_required');
 const segments=realpathSync(file).split(path.sep).map(x=>x.toLowerCase());
 if(segments.some(x=>['docs','public_html','.github','site-preview'].includes(x)))throw Error('private_identity_required');
}
export function setupOrganizationOffline(argv){
 const opts=parse(argv);
 privateFile(opts['--identity-db']);
 const db=new DatabaseSync(opts['--identity-db'],{readOnly:true});
 let owner;
 try{
  owner=db.prepare('SELECT id,email,display_name,role,state FROM suite_identity_users WHERE id=?').get(opts['--owner-id']);
 }finally{db.close();}
 if(!owner||owner.state!=='active'||owner.role!=='admin')throw Error('verified_admin_required');
 const store=createOrganizationStore({databasePath:opts['--organization-db']});
 try{
  return store.setupOrganization({organizationId:opts['--id'],name:opts['--name'],
   owner:{accountId:owner.id,name:owner.display_name,nickname:opts['--nickname'],email:owner.email}});
 }finally{store.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=setupOrganizationOffline(process.argv.slice(2));
  process.stdout.write(JSON.stringify({ok:true,organizationId:result.id})+'\n');
 }catch(error){
  // Never print account IDs, email addresses, private paths, or SQLite records.
  const allowed=new Set(['invalid_args','private_identity_required','verified_admin_required','organization_exists','invalid_organization','private_path_required']);
  process.stderr.write((allowed.has(error?.message)?error.message:'setup_failed')+'\n');
  process.exitCode=1;
 }
}
