// Generates private, synthetic-only Workspace staging configuration OFFLINE.
// No DNS changes, server provisioning, account creation, payment or network calls.
// Never prints client secrets and refuses existing configuration.
import {randomBytes} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,linkSync,openSync,
 realpathSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NATIVE_APP_IDS,stagingHttpsOrigin,
 validateWorkspaceStagingConfig} from './staging-preflight.mjs';

const OUTPUT_NAME='workspace-staging.json';
const TOKEN=()=>randomBytes(48).toString('base64url');

function approvedPrivateRoot(value){
 if(typeof value!=='string'||!isAbsolute(value))throw Error('private_root_required');
 const root=resolve(value);
 const segments=root.split(sep).map(x=>x.toLowerCase());
 if(segments.some(x=>['docs','public_html','.git'].includes(x)))
  throw Error('public_or_repository_root');
 let actual;
 try{
  actual=realpathSync(root);
  if(actual!==root||!statSync(actual).isDirectory())throw Error('private_root_required');
  if(process.platform!=='win32'&&(statSync(actual).mode&0o077)!==0)
   throw Error('private_root_permissions');
 }catch(e){
  if(e.message==='private_root_permissions'||e.message==='private_root_required')
   throw e;
  throw Error('private_root_required');
 }
 // Never place credentials anywhere under an existing Git checkout or worktree.
 for(let current=root;;current=dirname(current)){
  if(existsSync(join(current,'.git')))throw Error('public_or_repository_root');
  if(dirname(current)===current)break;
 }
 return root;
}

function checkedDomain(value){
 if(typeof value!=='string'||value.length>253||
   !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)||
   !value.split('.').every(label=>label.length<=63&&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))
  throw Error('invalid_staging_domain');
 const domain=value.toLowerCase();
 const center='https://staging-workspace.'+domain;
 if(stagingHttpsOrigin(center)!==center)throw Error('invalid_staging_domain');
 for(const id of NATIVE_APP_IDS){
  const native='https://staging-'+id+'.'+domain;
  if(stagingHttpsOrigin(native)!==native)throw Error('invalid_staging_domain');
 }
 return domain;
}

export function createSyntheticStagingConfig({baseDomain,privateRoot,buildSha}={}){
 const root=approvedPrivateRoot(privateRoot);
 const domain=checkedDomain(baseDomain);
 if(typeof buildSha!=='string'||!/^[a-f0-9]{40}$/i.test(buildSha))
  throw Error('reviewed_git_sha_required');
 const origin='https://staging-workspace.'+domain;
 const clients=NATIVE_APP_IDS.map(id=>{
  const nativeOrigin='https://staging-'+id+'.'+domain;
  return {id,appId:id,secret:TOKEN(),nativeOrigin,
   redirectUris:[nativeOrigin+'/auth/callback']};
 });
 const config={
  SUITE_STAGING_ACK:'synthetic-accounts-only',
  SUITE_MODE:'broker',
  SUITE_BUILD_SHA:buildSha,
  SUITE_ORIGIN:origin,
  SUITE_ISSUER:origin,
  SUITE_CLIENTS:JSON.stringify(clients),
  SUITE_AUTH_DB_PATH:join(root,'auth.sqlite'),
  SUITE_IDENTITY_DB_PATH:join(root,'identity.sqlite'),
  SUITE_ORGANIZATION_DB_PATH:join(root,'organizations.sqlite'),
  SUITE_COMMUNICATIONS_DB_PATH:join(root,'communications.sqlite'),
  SUITE_ASSET_ROOT:join(root,'private-ui'),
  SUITE_SETUP_TOKEN:TOKEN()
 };
 const check=validateWorkspaceStagingConfig(config);
 if(!check.ok)throw Error('invalid_staging_configuration');
 return config;
}

export function writeSyntheticStagingConfig(args){
 const config=createSyntheticStagingConfig(args);
 const root=approvedPrivateRoot(args.privateRoot);
 const final=join(root,OUTPUT_NAME);
 const temp=join(root,'.workspace-staging-'+randomBytes(16).toString('hex')+'.tmp');
 let fd;
 try{
  // Write + fsync a private 0600 file, then hard-link into its final name.
  // A hard link is atomic and, unlike rename, NEVER overwrites an existing file.
  fd=openSync(temp,'wx',0o600);
  writeFileSync(fd,JSON.stringify(config,null,2)+'\n','utf8');
  fsyncSync(fd);
  closeSync(fd);fd=undefined;
  linkSync(temp,final);
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(temp)}catch(e){if(e.code!=='ENOENT')throw e}
 }
 // Return only metadata; secrets are intentionally never included.
 return Object.freeze({filename:final,clientCount:NATIVE_APP_IDS.length});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 const names=['--base-domain','--private-root','--build-sha'];
 if(args.length!==7||!names.every((n,i)=>args[i*2]===n)||
    args[6]!=='--confirm-synthetic-only'){
  console.error('Usage: node staging-generate-config.mjs --base-domain DOMAIN --private-root /absolute/private/staging --build-sha 40_HEX --confirm-synthetic-only');
  process.exitCode=2;
 }else{
  try{
   writeSyntheticStagingConfig({
    baseDomain:args[1],privateRoot:args[3],buildSha:args[5]
   });
   console.log('Created owner-only synthetic staging configuration (source-only; no deployment)');
  }catch{
   // Never echo config values, path, DNS name, secrets or exception stack.
   console.error('Synthetic staging configuration: NOT CREATED (invalid_or_existing_private_destination)');
   process.exitCode=1;
  }
 }
}
