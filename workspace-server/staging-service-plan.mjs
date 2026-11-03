// Source-verified, UNINSTALLED synthetic Workspace service + HTTPS proxy templates.
// No systemd, Caddy, DNS, network, account or database changes.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig} from './staging-preflight.mjs';
import {verifyStagingSourceCommit,UI_FILES,ICON_FILES} from './staging-prepare-ui.mjs';
const SOURCE=fileURLToPath(new URL('./',import.meta.url));
const REPO=resolve(SOURCE,'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function safePath(s){
 if(typeof s!=='string'||!/^\/[A-Za-z0-9_./+-]+$/.test(s)||
    s.includes('//')||s.split('/').includes('..'))
  throw Error('unsafe_service_path');
 return s;
}
export function verifyNodeStagingExecutable(binary,{runNode=execFileSync}={}){
 if(!safePath(binary).endsWith('/node'))
  throw Error('node_executable_required');
 try{
  const stat=statSync(binary);
  if(!stat.isFile()||(stat.mode&0o111)===0)
   throw Error('node_executable_not_runnable');
  const version=runNode(binary,['--version'],{
   encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']
  }).trim();
  const m=/^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if(!m||Number(m[1])<22||(Number(m[1])===22&&Number(m[2])<13))
   throw Error('unsupported_node_version');
  return version;
 }catch{throw Error('node_executable_unverified')}
}
function verifyAssets(config,root){
 const target=join(root,'private-ui');
 if(config.SUITE_ASSET_ROOT!==target)throw Error('unexpected_ui_destination');
 const dir=lstatSync(target);
 if(!dir.isDirectory()||dir.isSymbolicLink()||
   (process.platform!=='win32'&&(dir.mode&0o077)!==0))
  throw Error('private_ui_not_ready');
 const manifestPath=join(target,'source-manifest.json');
 const stat=lstatSync(manifestPath);
 if(!stat.isFile()||stat.isSymbolicLink()||
   (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('private_ui_not_ready');
 const m=JSON.parse(readFileSync(manifestPath,'utf8'));
 const names=[...UI_FILES,...Object.keys(ICON_FILES).map(x=>'assets/'+x+'.svg')];
 if(m.format!=='duckbio-private-staging-ui-v1'||
    m.reviewedGitSha!==config.SUITE_BUILD_SHA||
    !m.files||typeof m.files!=='object'||Array.isArray(m.files)||
    Object.keys(m.files).length!==names.length)
  throw Error('private_ui_source_mismatch');
 for(const name of names){
  const installed=join(target,name),info=lstatSync(installed);
  if(!info.isFile()||info.isSymbolicLink()||
     (process.platform!=='win32'&&(info.mode&0o077)!==0))
   throw Error('private_ui_not_ready');
  const source=name.startsWith('assets/')
   ?join(REPO,'assets','app-icons',ICON_FILES[name.slice(7,-4)])
   :join(SOURCE,'private-ui',name);
  const sourceSha=hash(readFileSync(source));
  if(m.files[name]!==sourceSha||hash(readFileSync(installed))!==sourceSha)
   throw Error('private_ui_source_mismatch');
 }
 return names.length;
}
export function prepareStagingServicePlan(config,{
 serviceUser='duckbio-staging',listenPort=3307,nodeBinary=process.execPath,runGit
}={}){
 if(!validateWorkspaceStagingConfig(config).ok)
  throw Error('invalid_synthetic_staging_config');
 const root=approvedPrivateRoot(dirname(config.SUITE_ASSET_ROOT));
 if(config.SUITE_ASSET_ROOT!==join(root,'private-ui'))
  throw Error('unexpected_ui_destination');
 if(typeof serviceUser!=='string'||
    !/^[a-z_][a-z0-9_-]{0,30}$/.test(serviceUser)||
    serviceUser==='root')throw Error('dedicated_service_user_required');
 if(!Number.isInteger(listenPort)||listenPort<1024||listenPort>65535)
  throw Error('private_port_required');
 const nodeVersion=verifyNodeStagingExecutable(nodeBinary);
 const configPath=join(root,'workspace-staging.json');
 if(!existsSync(configPath)||
    JSON.stringify(readPrivateConfiguration(configPath))!==JSON.stringify(config))
  throw Error('private_config_file_mismatch');
 verifyStagingSourceCommit(config,runGit?{runGit}:{});
 const assetCount=verifyAssets(config,root);
 for(const path of [SOURCE,REPO,root,configPath,
   join(SOURCE,'shared-auth','runtime.mjs')])safePath(path);
 const unit=[
  '[Unit]',
  'Description=DuckBio synthetic Workspace staging (no customer data)',
  'After=network-online.target',
  'Wants=network-online.target',
  '',
  '[Service]',
  'Type=simple',
  'User='+serviceUser,
  'Group='+serviceUser,
  'WorkingDirectory='+SOURCE,
  'Environment=NODE_ENV=production',
  'Environment=SUITE_ENV_FILE='+configPath,
  'Environment=PORT='+listenPort,
  'ExecStart='+nodeBinary+' '+join(SOURCE,'shared-auth','runtime.mjs'),
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
  'ReadOnlyPaths='+REPO,
  'ReadWritePaths='+root,
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  ''
 ].join('\n');
 const hostname=new URL(config.SUITE_ORIGIN).hostname;
 const caddy=[
  '# UNINSTALLED: activating Caddy may request public TLS certificates.',
  '# Workspace only: each native app needs its own separately reviewed server.',
  hostname+' {',
  '  header {',
  '    ?X-Content-Type-Options "nosniff"',
  '    ?X-Frame-Options "DENY"',
  '    ?Referrer-Policy "no-referrer"',
  '  }',
  '  reverse_proxy 127.0.0.1:'+listenPort+' {',
  '    header_up -Forwarded',
  '    header_up -X-Forwarded-For',
  '    header_up -X-Forwarded-Host',
  '    header_up X-Forwarded-Proto https',
  '  }',
  '}',
  ''
 ].join('\n');
 const dir=join(root,'staging-service-plan');
 // Exclusive creation rejects an existing directory or symlink. Never touches
 // /etc/systemd, /etc/caddy, sockets or running services.
 mkdirSync(dir,{mode:0o700});
 try{
  writeFileSync(join(dir,'duckbio-workspace-staging.service'),unit,
   {flag:'wx',mode:0o600});
  writeFileSync(join(dir,'Caddyfile.workspace-staging'),caddy,
   {flag:'wx',mode:0o600});
  writeFileSync(join(dir,'plan-manifest.json'),
   JSON.stringify({format:'duckbio-staging-service-plan-v1',
    reviewedGitSha:config.SUITE_BUILD_SHA,assetCount,port:listenPort,
    nodeVersion,
    unitSha256:hash(Buffer.from(unit)),caddySha256:hash(Buffer.from(caddy)),
    scope:'templates-only-no-deployment'},null,2)+'\n',
   {flag:'wx',mode:0o600});
 }catch(error){rmSync(dir,{recursive:true,force:true});throw error}
 return Object.freeze({ok:true,templates:2,reviewedGitSha:config.SUITE_BUILD_SHA});
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 const hasBinary=args.length===9&&args[6]==='--node-binary'&&
    args[8]==='--confirm-plan-only';
 const standard=args.length===7&&args[6]==='--confirm-plan-only';
 if((!hasBinary&&!standard)||args[0]!=='--config'||
    args[2]!=='--service-user'||args[4]!=='--listen-port'){
  console.error('Usage: node staging-service-plan.mjs --config PRIVATE_JSON --service-user duckbio-staging --listen-port 3307 [--node-binary /absolute/path/to/node] --confirm-plan-only');
  process.exitCode=2;
 }else try{
  prepareStagingServicePlan(readPrivateConfiguration(args[1]),
   {serviceUser:args[3],listenPort:Number(args[5]),
    nodeBinary:hasBinary?args[7]:process.execPath});
  console.log('PASS private Workspace service and HTTPS proxy templates (not installed)');
 }catch{
  console.error('FAIL staging service plan (source, private UI and config verification required)');
  process.exitCode=1;
 }
}
