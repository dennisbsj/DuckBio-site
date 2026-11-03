// OFFLINE, read-only native environment audit. Does not start services,
// transfer credentials or attest a deployed staging system. Never reports values.
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {NATIVE_APP_IDS,validateWorkspaceStagingConfig,readPrivateConfiguration}
 from './staging-preflight.mjs';

function parseEnv(content){
 if(Buffer.byteLength(content)>32768)throw Error('malformed_env');
 const result=Object.create(null);
 for(const line of content.split(/\r?\n/)){
  if(!line||line.startsWith('#'))continue;
  const m=/^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(line);
  if(!m||Object.hasOwn(result,m[1])||/['"\\]/.test(m[2])||
     /[\x00-\x1f\x7f]/.test(m[2]))throw Error('malformed_env');
  result[m[1]]=m[2];
 }
 return result;
}
const nonempty=v=>typeof v==='string'&&v.length>0&&v===v.trim();
const same=(a,b)=>typeof a==='string'&&a===b;
const key32=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&
 Buffer.from(v,'base64url').length===32&&
 Buffer.from(v,'base64url').toString('base64url')===v;
const under=(root,value)=>typeof value==='string'&&value.startsWith('/')&&
 !value.split('/').includes('..')&&resolve(value).startsWith(root+sep);
function pgUrl(value){
 try{
  const u=new URL(value);
  return ['postgres:','postgresql:'].includes(u.protocol)&&
   ['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&
   decodeURIComponent(u.pathname).includes('staging')&&
   Boolean(u.username)&&Boolean(u.password)&&!u.search&&!u.hash;
 }catch{return false}
}
function auditApp(env,client,id,dir,config){
 const errors=[];
 const require=(condition,code)=>{if(!condition)errors.push(code)};
 for(const k of Object.keys(env)){
  if(k.startsWith('SUITE_')||/^(?:NODE_ENV|HOST|PORT|NODE_OPTIONS|LD_PRELOAD|DUCKNOTE_RUNTIME_DIR)$/.test(k)||
     /^(?:STRIPE_|RESEND_|MAIL_WEBHOOK_)/.test(k))
   errors.push('forbidden_runtime_override');
 }
 require(same(env.DUCKBIO_WORKSPACE_ORIGIN,config.SUITE_ORIGIN),
  'workspace_origin_mismatch');
 require(same(env.DUCKBIO_WORKSPACE_ISSUER,config.SUITE_ORIGIN),
  'workspace_issuer_mismatch');
 require(same(env.DUCKBIO_WORKSPACE_CLIENT_SECRET,client.secret),
  'native_client_secret_mismatch');
 const organizationKey=['eel','duckman'].includes(id)?
  'DUCKBIO_WORKSPACE_ORGANIZATION_ID':'DUCKBIO_WORKSPACE_ORG_ID';
 require(nonempty(env[organizationKey])&&env[organizationKey].length<=128,
  'native_organization_mapping_missing');
 if(id==='eel'){
  // The native service unit injects this fixed location after reading
  // native.env; the environment file must never choose its own path.
  const runtime=join(dir,'runtime');
  let safeRuntime=false;
  try{
   const stat=lstatSync(runtime);
   safeRuntime=stat.isDirectory()&&!stat.isSymbolicLink()&&
    realpathSync(runtime)===runtime&&
    (process.platform==='win32'||(stat.mode&0o077)===0)&&
    !lstatSync(join(runtime,'reset-eel-database.once'),{throwIfNoEntry:false});
  }catch{}
  require(safeRuntime,'native_runtime_missing_or_unsafe');
  require(['FRONTEND_ORIGIN','APP_BASE_URL','CANONICAL_ORIGIN',
   'DUCKBIO_WORKSPACE_NATIVE_ORIGIN'].every(k=>same(env[k],client.nativeOrigin)),
   'native_origin_mismatch');
  require(env.DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED==='true',
   'native_link_not_enabled');
  require(key32(env.DUCKBIO_WORKSPACE_VAULT_KEY)&&
   env.DUCKBIO_WORKSPACE_VAULT_KEY!==client.secret,
   'independent_vault_key_missing');
  const pgKeys=['PGHOST','PGDATABASE','PGUSER','PGPASSWORD'];
  if(nonempty(env.DATABASE_URL)){
   require(pgUrl(env.DATABASE_URL),'private_staging_postgres_required');
   require(pgKeys.every(k=>!Object.hasOwn(env,k)),
    'ambiguous_postgres_configuration');
  }else{
   require(['localhost','127.0.0.1','::1'].includes(env.PGHOST)&&
    nonempty(env.PGDATABASE)&&env.PGDATABASE.includes('staging')&&
    nonempty(env.PGUSER)&&nonempty(env.PGPASSWORD),
    'private_staging_postgres_required');
  }
 }else{
  if(id!=='limsman')require(same(env.APP_BASE_URL,client.nativeOrigin),
   'native_origin_mismatch');
  const dbKey=id==='duckman'?'DUCKMAN_DATABASE_PATH':
   id==='limsman'?'LIMSMAN_CONFIG_PATH':'SCIENCE_DATABASE_PATH';
  require(under(dir,env[dbKey]),'native_database_path_outside_app');
  if(id==='duckman'){
   require(!env.DUCKBIO_WORKSPACE_CLIENT_ID||
    env.DUCKBIO_WORKSPACE_CLIENT_ID==='duckman','wrong_client_id');
   require(key32(env.DUCKBIO_WORKSPACE_PROOF_KEY)&&
    env.DUCKBIO_WORKSPACE_PROOF_KEY!==client.secret,
    'independent_proof_key_missing');
  }
 }
 return [...new Set(errors)];
}

export function auditSixNativeEnvironmentFiles(config,dataRoot){
 if(!validateWorkspaceStagingConfig(config).ok)
  return {ok:false,checked:0,failures:[{appId:'all',code:'invalid_synthetic_config'}]};
 let root;
 try{root=approvedPrivateRoot(dataRoot)}
 catch{return {ok:false,checked:0,failures:[{appId:'all',code:'unsafe_private_root'}]}}
 const clients=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 const failures=[];let checked=0;
 for(const id of NATIVE_APP_IDS){
  try{
   const dir=approvedPrivateRoot(join(root,id));
   const stat=lstatSync(join(dir,'native.env'));
   if(!stat.isFile()||stat.isSymbolicLink()||
      (process.platform!=='win32'&&(stat.mode&0o077)!==0))
    throw Error('unsafe_environment_file');
   const env=parseEnv(readFileSync(join(dir,'native.env'),'utf8'));
   const client=clients.get(id);
   if(!client)throw Error('missing_registered_client');
   for(const code of auditApp(env,client,id,dir,config))
    failures.push({appId:id,code});
   checked++;
  }catch(err){
   const known=['malformed_env','unsafe_environment_file','missing_registered_client'];
   failures.push({appId:id,code:known.includes(err.message)?
    err.message:'missing_or_unsafe_environment_file'});
  }
 }
 return {ok:failures.length===0,checked,failures};
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const a=process.argv.slice(2);
 if(a.length!==5||a[0]!=='--config'||a[2]!=='--private-data-root'||
    a[4]!=='--confirm-offline-only'){
  console.error('Usage: node staging-six-native-env-audit.mjs --config PRIVATE_WORKSPACE_JSON --private-data-root PRIVATE_NATIVE_ROOT --confirm-offline-only');
  process.exitCode=2;
 }else try{
  const result=auditSixNativeEnvironmentFiles(readPrivateConfiguration(a[1]),a[3]);
  if(result.ok)console.log('PASS six native staging env policies (offline only; no deployment)');
  else{
   console.error('FAIL native staging env policy: '+
    result.failures.map(e=>e.appId+':'+e.code).join(','));
   process.exitCode=1;
  }
 }catch{
  console.error('FAIL native staging env policy (unreadable_or_unsafe_input)');
  process.exitCode=1;
 }
}
