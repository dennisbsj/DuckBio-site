// Least-privilege offline handoff: export ONE native client's registration.
// Never publishes the six-client SUITE_CLIENTS array, setup token, databases,
// organization mappings, payment credentials, or a runnable service config.
// Requires separately approved private owner-only staging directories.
import {randomBytes} from 'node:crypto';
import {closeSync,chmodSync,fsyncSync,linkSync,openSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {NATIVE_APP_IDS,readPrivateConfiguration,
 validateWorkspaceStagingConfig} from './staging-preflight.mjs';

const OUTPUT_PREFIX='workspace-native-';
const ATOMIC_TMP_PREFIX='.native-handoff-';

export function scopedNativeRegistration(config,appId){
 const report=validateWorkspaceStagingConfig(config);
 if(!report.ok)throw Error('invalid_synthetic_staging_config');
 if(typeof appId!=='string'||!NATIVE_APP_IDS.includes(appId))
  throw Error('invalid_native_app_id');
 const clients=JSON.parse(config.SUITE_CLIENTS);
 const client=clients.find(c=>c.id===appId);
 if(!client||client.appId!==appId)throw Error('native_client_missing');
 return Object.freeze({
  format:'duckbio-private-native-registration-v1',
  appId,
  clientId:appId,
  workspaceOrigin:config.SUITE_ORIGIN,
  issuer:config.SUITE_ISSUER||config.SUITE_ORIGIN,
  nativeOrigin:client.nativeOrigin,
  redirectUri:client.redirectUris[0],
  clientSecret:client.secret
 });
}

export function writeScopedNativeRegistration({config,appId,outputRoot}={}){
 const entry=scopedNativeRegistration(config,appId);
 const destinationRoot=approvedPrivateRoot(outputRoot);
 const centralRoot=resolve(dirname(config.SUITE_AUTH_DB_PATH));
 // The broker secrets and derived native secret must NOT be co-located.
 // Disallow equal and ancestor/descendant directories as well.
 if(destinationRoot===centralRoot||
    destinationRoot.startsWith(centralRoot+sep)||
    centralRoot.startsWith(destinationRoot+sep))
  throw Error('native_handoff_must_use_separate_private_root');
 const path=join(destinationRoot,OUTPUT_PREFIX+appId+'.json');
 const tmp=join(destinationRoot,ATOMIC_TMP_PREFIX+
  randomBytes(16).toString('hex')+'.tmp');
 let fd;
 try{
  fd=openSync(tmp,'wx',0o600);
  chmodSync(tmp,0o600);
  writeFileSync(fd,JSON.stringify(entry,null,2)+'\n','utf8');
  fsyncSync(fd);
  closeSync(fd);fd=undefined;
  // A hardlink cannot clobber an existing file or symlink, unlike rename.
  linkSync(tmp,path);
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(tmp)}catch(error){
   if(error.code!=='ENOENT')throw error;
  }
 }
 // Return only nonsecret metadata.
 return Object.freeze({appId,filename:path});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==7||args[0]!=='--config'||
    args[2]!=='--app-id'||args[4]!=='--private-output-root'||
    args[6]!=='--confirm-one-app-only'){
  console.error('Usage: node staging-native-handoff.mjs --config /absolute/private/workspace-staging.json --app-id NATIVE_ID --private-output-root /separate/owner-only/path --confirm-one-app-only');
  process.exitCode=2;
 }else{
  try{
   writeScopedNativeRegistration({
    config:readPrivateConfiguration(args[1]),
    appId:args[3],outputRoot:args[5]
   });
   // Never reveal secret values, private paths, IDs beyond validated app ID,
   // config contents or connection credentials in logs.
   console.log('PASS single native staging registration exported privately (no deployment)');
  }catch{
   console.error('FAIL native staging registration (unsafe_configuration_or_destination)');
   process.exitCode=1;
  }
 }
}
