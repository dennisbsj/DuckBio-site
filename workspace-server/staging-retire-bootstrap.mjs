// Post-bootstrap synthetic Workspace staging configuration handoff.
// No DB changes, service operations, DNS, network, email or billing actions.
// The existing private config is never modified or deleted.
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig} from './staging-preflight.mjs';

const SHA=value=>createHash('sha256').update(value).digest('hex');
const DBS=Object.freeze([
 'SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
 'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH'
]);
const BUNDLE='post-bootstrap';
const ROOT_FILE='workspace-staging.json';
const RUNTIME_FILE='workspace-staging-runtime.json';
const OVERRIDE_FILE='runtime-without-setup-token.conf';

function privateRegularFile(filename){
 const stat=lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink()||
    (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('private_file_required');
}

function verifiedClosedStore(filename){
 privateRegularFile(filename);
 // A closed SQLite DB in WAL mode should have checkpointed its WAL.
 // This is a conservative offline check, not proof of process shutdown.
 if(existsSync(filename+'-wal')||existsSync(filename+'-shm'))
  throw Error('database_not_checkpointed');
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  const check=db.prepare('PRAGMA quick_check').all();
  if(check.length!==1||check[0].quick_check!=='ok')
   throw Error('database_integrity_failed');
  return db;
 }catch(error){db.close();throw error}
}

export function verifyConsumedSyntheticBootstrap(config){
 if(!validateWorkspaceStagingConfig(config).ok)
  throw Error('invalid_synthetic_staging_config');
 const root=approvedPrivateRoot(dirname(config.SUITE_IDENTITY_DB_PATH));
 const source=join(root,ROOT_FILE);
 privateRegularFile(source);
 if(JSON.stringify(readPrivateConfiguration(source))!==JSON.stringify(config))
  throw Error('source_configuration_mismatch');
 const setup=config.SUITE_SETUP_TOKEN;
 if(typeof setup!=='string'||!/^[A-Za-z0-9_-]{64}$/.test(setup))
  throw Error('generated_bootstrap_token_required');
 let identity;
 try{
  for(const key of DBS){
   if(dirname(config[key])!==root)throw Error('unexpected_staging_database_path');
   const db=verifiedClosedStore(config[key]);
   if(key==='SUITE_IDENTITY_DB_PATH')identity=db;
   else db.close();
  }
  const state=identity.prepare(
   'SELECT token_hash,consumed_at FROM suite_identity_bootstrap WHERE singleton=1'
  ).get();
  const administrators=identity.prepare(
   "SELECT COUNT(*) AS count FROM suite_identity_users WHERE role='admin' AND state='active' AND credential IS NOT NULL"
  ).get();
  if(!state||state.token_hash!==SHA(setup)||
     !Number.isInteger(state.consumed_at)||state.consumed_at<1||
     !administrators||administrators.count<1)
   throw Error('synthetic_first_administrator_not_activated');
  return Object.freeze({root,source,stores:DBS.length});
 }finally{identity?.close()}
}

export function preparePostBootstrapStagingConfig(config){
 const verified=verifyConsumedSyntheticBootstrap(config);
 // A fixed, first-use-only private output directory prevents any accidental
 // replacement of deployed credentials or mixing with production files.
 const destination=join(verified.root,BUNDLE);
 if(!/^\/[a-zA-Z0-9_/+.-]+$/.test(destination)||
    destination.includes('//'))
  throw Error('unsafe_systemd_override_path');
 const runtime={...config};
 delete runtime.SUITE_SETUP_TOKEN;
 if(!validateWorkspaceStagingConfig(runtime).ok)
  throw Error('invalid_post_bootstrap_configuration');
 const runtimeJson=JSON.stringify(runtime,null,2)+'\n';
 const runtimePath=join(destination,RUNTIME_FILE);
 const override=[
  '# PRIVATE SOURCE ONLY: install/restart separately after operator review.',
  '# Overrides only the broker config file; preserves its other service settings.',
  '[Service]',
  'Environment=SUITE_ENV_FILE='+runtimePath,
  ''
 ].join('\n');
 mkdirSync(destination,{mode:0o700});
 try{
  writeFileSync(runtimePath,runtimeJson,{flag:'wx',mode:0o600});
  writeFileSync(join(destination,OVERRIDE_FILE),override,
   {flag:'wx',mode:0o600});
  writeFileSync(join(destination,'manifest.json'),
   JSON.stringify({
    format:'duckbio-synthetic-post-bootstrap-v1',
    reviewedGitSha:config.SUITE_BUILD_SHA,
    bootstrapTokenRemoved:true,
    storesChecked:verified.stores,
    configSha256:SHA(runtimeJson),
    systemdOverrideSha256:SHA(override),
    scope:'private-uninstalled-operator-review'
   },null,2)+'\n',
   {flag:'wx',mode:0o600});
 }catch(error){
  rmSync(destination,{recursive:true,force:true});
  throw error;
 }
 // Never return config contents, token, client secrets or DB paths.
 return Object.freeze({ok:true,files:3,storesChecked:verified.stores});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--config'||
    args[2]!=='--confirm-broker-stopped-and-synthetic'){
  console.error('Usage: node staging-retire-bootstrap.mjs --config PRIVATE_JSON --confirm-broker-stopped-and-synthetic');
  process.exitCode=2;
 }else{
  try{
   preparePostBootstrapStagingConfig(readPrivateConfiguration(args[1]));
   console.log('PASS synthetic Workspace post-bootstrap config prepared (not installed)');
  }catch{
   console.error('FAIL post-bootstrap configuration (owner-only stopped synthetic broker and consumed token required)');
   process.exitCode=1;
  }
 }
}
