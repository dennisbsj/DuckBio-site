// Read-only check for the SEVENTH genuine staging unit, Workspace itself.
// Verifies the private UI copy against the immutable reviewed Workspace Git
// source, the standalone unit against its pinned template and its manifest.
// The old Workspace-only Caddyfile is checked but NEVER installed/combined
// with the canonical seven-origin Caddyfile by this verifier.
import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {validateWorkspaceStagingConfig} from './staging-preflight.mjs';
import {validateSixNativeStagingSnapshot}
 from './staging-six-native-snapshot.mjs';
import {UI_FILES,ICON_FILES} from './staging-prepare-ui.mjs';
import {verifyNodeStagingExecutable} from './staging-service-plan.mjs';

const SHA=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const isObject=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,names)=>isObject(x)&&Object.keys(x).sort().join('|')===
 names.slice().sort().join('|');
const fail=code=>Object.freeze({
 ok:false,code,unitVerified:false,uiVerified:false,
 deploymentAuthorized:false
});
const good=()=>Object.freeze({
 ok:true,code:'ok',unitVerified:true,uiVerified:true,
 deploymentAuthorized:false,
 category:'uninstalled-seven-service-workspace-unit-source-only'
});
const safeFile=path=>{
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024||
    stat.size<1||(process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('unsafe_private_file');
 if(realpathSync(path)!==resolve(path))
  throw Error('symlink_parent');
 return readFileSync(path);
};
const safeDir=path=>{
 const stat=lstatSync(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||
   realpathSync(path)!==resolve(path)||
   (process.platform!=='win32'&&(stat.mode&0o077)!==0))
  throw Error('unsafe_private_directory');
};
const exactNames=(dir,want)=>{
 safeDir(dir);
 const names=readdirSync(dir).sort();
 const expected=want.slice().sort();
 if(names.length!==expected.length||
    names.some((name,i)=>name!==expected[i]))
  throw Error('unexpected_artifact_inventory');
};
const safePath=value=>{
 if(typeof value!=='string'||!/^\/[A-Za-z0-9_./+-]+$/.test(value)||
    value.includes('//')||value.split('/').includes('..'))
  throw Error('invalid_absolute_path');
 return value;
};
const bounded=buffer=>buffer.length>0&&buffer.length<=512*1024;
const immutable=Object.freeze({
  files: Object.freeze([...UI_FILES]),
  icons: Object.freeze({...ICON_FILES})
});
// Matches the EXACT central Workspace-only generator output pinned to
// Workspace source 1a3b19c, not a future moving-HEAD service template.
export function expectedSeventhWorkspaceUnit(config,{
 sourceRoot,privateRoot,nodeBinary
}={}){
 const root=safePath(privateRoot);
 const repo=safePath(join(safePath(sourceRoot),'DuckBio-site'));
 const cwd=join(repo,'workspace-server');
 const configPath=join(root,'workspace-staging.json');
 const binary=safePath(nodeBinary);
 const unit=[
  '[Unit]',
  'Description=DuckBio synthetic Workspace staging (no customer data)',
  'After=network-online.target',
  'Wants=network-online.target',
  '',
  '[Service]',
  'Type=simple',
  'User=duckbio-staging',
  'Group=duckbio-staging',
  'WorkingDirectory='+cwd,
  'Environment=NODE_ENV=production',
  'Environment=SUITE_ENV_FILE='+configPath,
  'Environment=PORT=3307',
  'ExecStart='+binary+' '+join(cwd,'shared-auth','runtime.mjs'),
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
  'ReadOnlyPaths='+repo,
  'ReadWritePaths='+root,
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  ''
 ].join('\n');
 const host=new URL(config.SUITE_ORIGIN).hostname;
 const caddy=[
  '# UNINSTALLED: activating Caddy may request public TLS certificates.',
  '# Workspace only: each native app needs its own separately reviewed server.',
  host+' {',
  '  @wrongHost not host '+host,
  '  respond @wrongHost 421',
  '  header {',
  '    ?X-Content-Type-Options "nosniff"',
  '    ?X-Frame-Options "DENY"',
  '    ?Referrer-Policy "no-referrer"',
  '  }',
  '  reverse_proxy 127.0.0.1:3307 {',
  '    header_up Host {http.request.host}',
  '    header_up -Forwarded',
  '    header_up -X-Forwarded-For',
  '    header_up -X-Forwarded-Host',
  '    header_up X-Forwarded-Proto https',
  '  }',
  '}',
  ''
 ].join('\n');
 return Object.freeze({unit,caddy});
}

function assertPrivateWorkspaceUi(config,sourceRoot,root){
 const target=join(root,'private-ui');
 const names=[...immutable.files,...Object.keys(immutable.icons)
  .map(x=>'assets/'+x+'.svg')];
 exactNames(target,[...immutable.files,'assets','source-manifest.json']);
 exactNames(join(target,'assets'),Object.keys(immutable.icons)
  .map(x=>x+'.svg'));
 const manifest=JSON.parse(safeFile(join(target,'source-manifest.json')));
 if(!keys(manifest,['format','reviewedGitSha','files'])||
    manifest.format!=='duckbio-private-staging-ui-v1'||
    manifest.reviewedGitSha!==config.SUITE_BUILD_SHA||
    !keys(manifest.files,names))throw Error('invalid_ui_manifest');
 const repo=join(sourceRoot,'DuckBio-site');
 for(const name of names){
  const installed=join(target,name);
  const source=name.startsWith('assets/')?
   join(repo,'assets','app-icons',
    immutable.icons[name.slice(7,-4)]):
   join(repo,'workspace-server','private-ui',name);
  const installedBytes=safeFile(installed);
  const sourceBytes=readFileSync(source);
  const want=manifest.files[name];
  if(!SHA.test(want)||!bounded(sourceBytes)||
     hash(sourceBytes)!==want||hash(installedBytes)!==want)
   throw Error('private_asset_source_mismatch');
 }
 return names.length;
}

export function auditSeventhWorkspaceUnit({
 config,lock,sourcesRoot,nodeBinary=process.execPath,
 verifyNode=verifyNodeStagingExecutable
}={}){
 if(!validateWorkspaceStagingConfig(config).ok||
    validateSixNativeStagingSnapshot(lock).kind!=='current'||
    config.SUITE_BUILD_SHA!==lock.central.sha)
  return fail('unreviewed_workspace_snapshot');
 let source,root;
 try{
  source=approvedPrivateRoot(sourcesRoot);
  root=approvedPrivateRoot(dirname(config.SUITE_ASSET_ROOT));
  if(config.SUITE_ASSET_ROOT!==join(root,'private-ui')||
     typeof nodeBinary!=='string'||!nodeBinary.startsWith('/'))
   throw Error('untrusted_private_staging_root');
  const input=join(root,'workspace-staging.json');
  if(!keys(JSON.parse(safeFile(input)),Object.keys(config))||
     readFileSync(input,'utf8')!==JSON.stringify(config,null,2)+'\n')
   throw Error('unverified_config_source');
  safeDir(join(source,'DuckBio-site'));
 }catch{return fail('private_workspace_inputs_unverified')}
 let n;
 try{n=assertPrivateWorkspaceUi(config,source,root)}
 catch{return fail('private_workspace_ui_unverified')}
 try{
  const version=verifyNode(nodeBinary);
  const dir=join(root,'staging-service-plan');
  exactNames(dir,[
   'duckbio-workspace-staging.service',
   'Caddyfile.workspace-staging',
   'plan-manifest.json'
  ]);
  const unit=safeFile(join(dir,'duckbio-workspace-staging.service'));
  const caddy=safeFile(join(dir,'Caddyfile.workspace-staging'));
  const manifest=JSON.parse(safeFile(join(dir,'plan-manifest.json')));
  const expected=expectedSeventhWorkspaceUnit(config,{
   sourceRoot:source,privateRoot:root,nodeBinary
  });
  if(!keys(manifest,['format','reviewedGitSha','assetCount','port',
      'nodeVersion','unitSha256','caddySha256','scope'])||
     manifest.format!=='duckbio-staging-service-plan-v1'||
     manifest.reviewedGitSha!==lock.central.sha||
     manifest.assetCount!==n||manifest.port!==3307||
     manifest.nodeVersion!==version||
     manifest.scope!=='templates-only-no-deployment'||
     manifest.unitSha256!==hash(unit)||
     manifest.caddySha256!==hash(caddy)||
     unit.toString('utf8')!==expected.unit||
     caddy.toString('utf8')!==expected.caddy)
   throw Error('unverified_workspace_service_plan');
 }catch{return fail('seventh_workspace_service_unit_unverified')}
 return good();
}
