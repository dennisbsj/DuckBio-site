// Six independent native systemd service templates for SYNTHETIC staging only.
// The file is generated OFFLINE; it creates no users, env files, databases,
// app instances, sockets, DNS, public certificates or live service config.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';
import {validateQaLock} from './six-app-source-qa-audit.mjs';
import {auditSevenLocalSources} from './staging-seven-source-gate.mjs';
import {buildSevenOriginProxyPlan,STAGING_PROXY_PORTS}
 from './staging-seven-proxy-plan.mjs';
import {verifyNodeStagingExecutable} from './staging-service-plan.mjs';

export const NATIVE_SERVICE_KINDS=Object.freeze({
 goflo:Object.freeze({repo:'CytoDuck',entrypoint:'startup.cjs',
  database:'sqlite',requiredPrivateSettings:['SCIENCE_DATABASE_PATH','APP_BASE_URL']}),
 eel:Object.freeze({repo:'DuckNote',entrypoint:'server/index.js',
  database:'postgresql',requiredPrivateSettings:[
   'DATABASE_URL_or_PGHOST_PGDATABASE_PGUSER_PGPASSWORD',
   'FRONTEND_ORIGIN','APP_BASE_URL','CANONICAL_ORIGIN',
   'DUCKBIO_WORKSPACE_ORIGIN','DUCKBIO_WORKSPACE_NATIVE_ORIGIN',
   'DUCKBIO_WORKSPACE_ISSUER','DUCKBIO_WORKSPACE_ORGANIZATION_ID',
   'DUCKBIO_WORKSPACE_CLIENT_SECRET','DUCKBIO_WORKSPACE_VAULT_KEY',
   'DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED']}),
 methpipe:Object.freeze({repo:'DuckPipe',entrypoint:'startup.cjs',
  database:'sqlite',requiredPrivateSettings:['SCIENCE_DATABASE_PATH','APP_BASE_URL']}),
 mantrain:Object.freeze({repo:'DuckTrain',entrypoint:'startup.cjs',
  database:'sqlite',requiredPrivateSettings:['SCIENCE_DATABASE_PATH','APP_BASE_URL']}),
 duckman:Object.freeze({repo:'DuckMan',entrypoint:'startup.cjs',
  database:'sqlite',requiredPrivateSettings:['DUCKMAN_DATABASE_PATH','APP_BASE_URL']}),
 limsman:Object.freeze({repo:'LabDuck',entrypoint:'startup.cjs',
  database:'sqlite-config-and-sessions',
  requiredPrivateSettings:['LIMSMAN_CONFIG_PATH']})
});
const digest=value=>createHash('sha256').update(value).digest('hex');
const approvedPath=value=>{
 const valueReal=approvedPrivateRoot(value);
 // systemd unit and EnvironmentFile values are unquoted absolute paths.
 if(!/^\/[A-Za-z0-9_./+-]+$/.test(valueReal)||valueReal.includes('//')||
  valueReal.split('/').includes('..'))throw Error('unsafe_systemd_path');
 return valueReal;
};
const overlaps=(a,b)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
const safeExecutable=value=>typeof value==='string'&&
 /^\/[A-Za-z0-9_./+-]+$/.test(value)&&
 !value.includes('//')&&!value.split('/').includes('..');
const isFixedNodeVersion=version=>{
 const parsed=/^v(22|24)\.(\d+)\.(\d+)$/.exec(version||'');
 return Boolean(parsed&&(parsed[1]==='24'||Number(parsed[2])>=16));
};

export function prepareSixNativeServicePlan({
 config,lock,sourcesRoot,dataRoot,nodeBinary=process.execPath,
 ports=STAGING_PROXY_PORTS,runGit
}={}){
 if(!validateWorkspaceStagingConfig(config).ok)
  throw Error('invalid_synthetic_staging_config');
 if(!validateQaLock(lock).ok)throw Error('invalid_source_qa_lock');
 const source=approvedPath(sourcesRoot),data=approvedPath(dataRoot);
 const centralData=approvedPath(resolve(config.SUITE_AUTH_DB_PATH,'..'));
 if([source,data].some(v=>overlaps(v,centralData))||overlaps(source,data))
  throw Error('service_data_sources_must_be_isolated');
 const audit=auditSevenLocalSources({
  sourcesRoot:source,workspaceBuildSha:config.SUITE_BUILD_SHA,lock,
  ...(runGit?{runGit}:{})
 });
 if(!audit.ok||audit.verified!==7)throw Error('unverified_seven_source_checkouts');
 const routing=buildSevenOriginProxyPlan(config,lock,ports);
 if(!safeExecutable(nodeBinary)||!nodeBinary.endsWith('/node'))
  throw Error('unsafe_node_executable');
 const nodeVersion=verifyNodeStagingExecutable(nodeBinary);
 if(!isFixedNodeVersion(nodeVersion))
  throw Error('native_node_requires_node_22_16_or_24');
 const byRoute=new Map(routing.manifest.routes.map(row=>[row.id,row]));
 const units=[],services=[];
 for(const app of lock.apps){
  const kind=NATIVE_SERVICE_KINDS[app.id],route=byRoute.get(app.id);
  if(!kind||!route||app.repo!=='dennisbsj/'+kind.repo||
     route.reviewedSourceSha!==app.sha||route.loopbackPort!==ports[app.id])
   throw Error('native_source_service_mismatch');
  const checkout=join(source,kind.repo);
  const entry=join(checkout,kind.entrypoint);
  const stat=lstatSync(entry);
  if(!stat.isFile()||stat.isSymbolicLink())
   throw Error('missing_or_symlinked_native_entrypoint');
  const privateDir=join(data,app.id);
  const envFile=join(privateDir,'native.env');
  const serviceUser='duckbio-stg-'+app.id;
  const unitName='duckbio-native-'+app.id+'-staging.service';
  // /usr/bin/env ensures HOST/PORT/NODE_ENV cannot be overwritten by the
  // systemd EnvironmentFile even if an operator mistakenly sets them there.
  const unit=[
   '[Unit]',
   'Description=DuckBio '+app.name+' synthetic native staging (not production)',
   'After=network-online.target',
   'Wants=network-online.target',
   '',
   '[Service]',
   'Type=simple',
   'User='+serviceUser,
   'Group='+serviceUser,
   'WorkingDirectory='+checkout,
   'EnvironmentFile='+envFile,
   'ExecStart=/usr/bin/env NODE_ENV=production HOST=127.0.0.1 PORT='+
     route.loopbackPort+' '+nodeBinary+' '+entry,
   'Restart=on-failure',
   'RestartSec=5s',
   'UMask=0077',
   'NoNewPrivileges=true',
   'PrivateTmp=true',
   'PrivateDevices=true',
   'ProtectSystem=strict',
   'ProtectHome=read-only',
   'ProtectKernelTunables=true',
   'ProtectControlGroups=true',
   'RestrictSUIDSGID=true',
   'LockPersonality=true',
   'ReadOnlyPaths='+checkout,
   'ReadWritePaths='+privateDir,
   '',
   '[Install]',
   'WantedBy=multi-user.target',
   ''
  ].join('\n');
  units.push({name:unitName,content:unit});
  services.push({
   appId:app.id,repo:app.repo,reviewedSourceSha:app.sha,
   entrypoint:kind.entrypoint,loopbackHost:'127.0.0.1',
   loopbackPort:route.loopbackPort,serviceUser,
   nativeHostname:route.hostname,storageKind:kind.database,
   requiredPrivateSettings:kind.requiredPrivateSettings,
   environmentFile:envFile,privateDataDirectory:privateDir,
   unitName,unitSha256:digest(unit)
  });
 }
 return Object.freeze({units,manifest:Object.freeze({
  format:'duckbio-six-native-uninstalled-service-plan-v1',
  scope:'source-verified-template-only-no-deployment',
  jointlyVerifiedWorkspaceSha:lock.central.sha,
  nodeVersion,serviceCount:6,
  routesSha256:routing.manifest.caddySha256,
  services
 })});
}
export function writeSixNativeServicePlan({
 config,lock,sourcesRoot,dataRoot,outputRoot,
 nodeBinary=process.execPath,ports=STAGING_PROXY_PORTS,runGit
}={}){
 // Validate all seven Git checkouts and six independent service contracts
 // BEFORE creating an output directory or writing any files.
 const plan=prepareSixNativeServicePlan({
  config,lock,sourcesRoot,dataRoot,nodeBinary,ports,runGit
 });
 const output=approvedPath(outputRoot);
 const source=approvedPath(sourcesRoot),data=approvedPath(dataRoot),
  centralData=approvedPath(resolve(config.SUITE_AUTH_DB_PATH,'..'));
 if([source,data,centralData].some(root=>overlaps(root,output)))
  throw Error('native_service_plan_must_be_separate_private_root');
 const destination=join(output,'six-native-service-plan');
 mkdirSync(destination,{mode:0o700});
 try{
  for(const unit of plan.units)
   writeFileSync(join(destination,unit.name),unit.content,
    {flag:'wx',mode:0o600});
  writeFileSync(join(destination,'service-manifest.json'),
   JSON.stringify(plan.manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 }catch(error){rmSync(destination,{recursive:true,force:true});throw error}
 // No output file contains app secrets or materialized environment files.
 return Object.freeze({ok:true,templates:6,workspaceSha:lock.central.sha});
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==9||args[0]!=='--config'||args[2]!=='--sources-root'||
    args[4]!=='--private-data-root'||args[6]!=='--private-output-root'||
    args[8]!=='--confirm-uninstalled-only'){
  console.error('Usage: node staging-six-native-services.mjs --config PRIVATE_STAGING_JSON --sources-root PRIVATE_SEVEN_GIT_CHECKOUTS --private-data-root PRIVATE_NATIVE_DATA_ROOT --private-output-root PRIVATE_PLAN_ROOT --confirm-uninstalled-only');
  process.exitCode=2;
 }else{
  try{
   const config=readPrivateConfiguration(args[1]);
   const lock=JSON.parse(readFileSync(
    new URL('./six-app-source-qa-lock.json',import.meta.url),'utf8'));
   writeSixNativeServicePlan({
    config,lock,sourcesRoot:args[3],
    dataRoot:args[5],outputRoot:args[7]
   });
   console.log('PASS six source-verified native service templates (UNINSTALLED only)');
  }catch{
   console.error('FAIL native service source or private roots not verified');
   process.exitCode=1;
  }
 }
}
