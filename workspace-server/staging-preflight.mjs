// Read-only source gate for a future PRIVATE synthetic Workspace staging environment.
// It never starts a server, opens a database or makes an external request.
// Passing this gate is NOT evidence that HTTPS staging is deployed or operational.
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolve as resolvePath} from 'node:path';

export const NATIVE_APP_IDS=Object.freeze([
 'goflo','eel','methpipe','mantrain','duckman','limsman'
]);

function canonicalHttps(value){
 if(typeof value!=='string')return null;
 try{
  const u=new URL(value);
  return u.protocol==='https:'&&u.origin===value&&u.pathname==='/'&&
   !u.username&&!u.password&&!u.search&&!u.hash?u.origin:null;
 }catch{return null}
}

function privateAbsolutePath(value){
 if(typeof value!=='string'||!isAbsolute(value))return null;
 const raw=resolve(value);
 const forbidden=parts=>parts.some(p=>['public_html','docs'].includes(p.toLowerCase()));
 if(forbidden(raw.split(sep)))return null;
 let ancestor=raw;
 while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor);
 try{
  if(forbidden(realpathSync(ancestor).split(sep)))return null;
 }catch{return null}
 return raw;
}

export function validateWorkspaceStagingConfig(config){
 const errors=[];
 const reject=code=>{if(!errors.includes(code))errors.push(code)};
 if(!config||typeof config!=='object'||Array.isArray(config)){
  return {ok:false,errors:['invalid_config']};
 }
 if(config.SUITE_STAGING_ACK!=='synthetic-accounts-only')
  reject('synthetic_only_ack_required');
 if(config.SUITE_MODE!=='broker')reject('broker_mode_required');
 if(!/^[a-f0-9]{40}$/i.test(config.SUITE_BUILD_SHA||''))
  reject('reviewed_git_sha_required');
 const origin=canonicalHttps(config.SUITE_ORIGIN);
 if(!origin)reject('workspace_https_origin_required');
 if(!origin||canonicalHttps(config.SUITE_ISSUER||config.SUITE_ORIGIN)!==origin)
  reject('workspace_issuer_must_match_origin');
 let registrations;
 try{
  registrations=typeof config.SUITE_CLIENTS==='string'
   ?JSON.parse(config.SUITE_CLIENTS):null;
 }catch{registrations=null}
 if(!Array.isArray(registrations)||registrations.length!==NATIVE_APP_IDS.length){
  reject('exactly_six_native_clients_required');
 }else{
  const ids=new Set(),hosts=new Set(),secrets=new Set();
  for(const client of registrations){
   if(!client||typeof client!=='object'||Array.isArray(client)||
      typeof client.id!=='string'||!NATIVE_APP_IDS.includes(client.id)||
      client.appId!==client.id||ids.has(client.id)){
    reject('invalid_native_client_registration');continue;
   }
   ids.add(client.id);
   const native=canonicalHttps(client.nativeOrigin);
   if(!native||native===origin||hosts.has(native)){
    reject('distinct_native_https_origins_required');
   }else hosts.add(native);
   if(!native||!Array.isArray(client.redirectUris)||
      client.redirectUris.length!==1||
      client.redirectUris[0]!==native+'/auth/callback'){
    reject('exact_native_callback_required');
   }
   if(typeof client.secret!=='string'||client.secret.length<32||
      client.secret.length>512||/[\r\n]/.test(client.secret)||
      secrets.has(client.secret)){
    reject('unique_private_client_secrets_required');
   }else secrets.add(client.secret);
  }
  if(ids.size!==NATIVE_APP_IDS.length)reject('exactly_six_native_clients_required');
 }
 const paths=['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
  'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH','SUITE_ASSET_ROOT'];
 const normalized=[];
 for(const key of paths){
  const p=privateAbsolutePath(config[key]);
  if(!p)reject('private_absolute_path_required');
  else normalized.push(p);
 }
 if(normalized.length===paths.length&&new Set(normalized).size!==paths.length)
  reject('private_paths_must_be_distinct');
 // Synthetic staging must not accidentally send real mail, contact messages,
 // owner alerts or payment requests. Test-mode checkout is also disabled here.
 for(const key of ['SUITE_RESEND_API_KEY','SUITE_INVITATION_FROM',
  'SUITE_OWNER_ALERT_FROM','SUITE_OWNER_ALERT_EMAIL','SUITE_CONTACT_FROM',
  'SUITE_CONTACT_REAL_EMAIL','SUITE_STRIPE_TEST_KEY',
  'SUITE_STRIPE_TEST_WEBHOOK_SECRET','SUITE_STRIPE_LIVE_SECRET_KEY']){
  if(config[key])reject('outbound_integrations_must_be_disabled');
 }
 for(const key of ['SUITE_CONTACT_ENABLED','SUITE_OWNER_ALERTS_ENABLED',
  'SUITE_STRIPE_TEST_RECONCILE_ENABLED']){
  if(config[key]&&config[key]!=='false')reject('outbound_integrations_must_be_disabled');
 }
 return {ok:errors.length===0,errors};
}

function readPrivateConfiguration(filename){
 const path=privateAbsolutePath(filename);
 if(!path||!existsSync(path))throw Error('invalid_config_file');
 // On the Linux staging host, no group/other access to secret-bearing JSON.
 const mode=statSync(path).mode;
 if(process.platform!=='win32'&&(mode&0o077)!==0)
  throw Error('config_file_permissions');
 const data=JSON.parse(readFileSync(path,'utf8'));
 if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.entries(data).some(([key,value])=>!/^SUITE_[A-Z0-9_]+$/.test(key)||
     typeof value!=='string'))throw Error('invalid_config_file');
 return data;
}

const invoked=process.argv[1]&&resolvePath(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--config'){
  console.error('Usage: node staging-preflight.mjs --config /absolute/private/workspace-staging.json');
  process.exitCode=2;
 }else{
  try{
   const report=validateWorkspaceStagingConfig(readPrivateConfiguration(args[1]));
   if(report.ok)console.log('Workspace synthetic staging configuration: PASS (offline only; not deployed)');
   else{
    console.error('Workspace synthetic staging configuration: FAIL ('+report.errors.join(', ')+')');
    process.exitCode=1;
   }
  }catch{
   // Do not reveal configuration values, file contents or private paths.
   console.error('Workspace synthetic staging configuration: FAIL (unreadable_or_unsafe_config)');
   process.exitCode=1;
  }
 }
}
