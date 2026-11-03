import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,
 rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {writeSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {UI_FILES,ICON_FILES} from '../staging-prepare-ui.mjs';
import {expectedSeventhWorkspaceUnit,auditSeventhWorkspaceUnit}
 from '../staging-workspace-seventh-unit-audit.mjs';
import {auditSevenCompleteUninstalledPrestart}
 from '../staging-seven-complete-prestart-gate.mjs';

const lock=JSON.parse(readFileSync(new URL(
 '../six-native-current-compat-lock.json',import.meta.url),'utf8'));
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixtures(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-seventh-workspace-unit-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const sourcesRoot=join(home,'sources'),privateRoot=join(home,'broker');
 for(const dir of [sourcesRoot,privateRoot])mkdirSync(dir,{mode:0o700});
 const source=join(sourcesRoot,'DuckBio-site');
 mkdirSync(source,{mode:0o700});
 const sourceUi=join(source,'workspace-server','private-ui');
 const sourceIcons=join(source,'assets','app-icons');
 for(const dir of [join(source,'workspace-server'),sourceUi,
   join(source,'assets'),sourceIcons])
  mkdirSync(dir,{mode:0o700,recursive:true});
 const configFile=writeSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot,
  buildSha:lock.central.sha
 }).filename;
 const config=JSON.parse(readFileSync(configFile,'utf8'));
 const target=join(privateRoot,'private-ui');
 mkdirSync(target,{mode:0o700});
 mkdirSync(join(target,'assets'),{mode:0o700});
 const entries={};
 for(const name of UI_FILES){
  const bytes=Buffer.from('inert synthetic pinned source '+name+'\n');
  writeFileSync(join(sourceUi,name),bytes,{mode:0o600});
  writeFileSync(join(target,name),bytes,{mode:0o600});
  entries[name]=hash(bytes);
 }
 for(const [id,filename] of Object.entries(ICON_FILES)){
  const bytes=Buffer.from('inert pinned vector icon '+id+' '+filename+'\n');
  writeFileSync(join(sourceIcons,filename),bytes,{mode:0o600});
  writeFileSync(join(target,'assets',id+'.svg'),bytes,{mode:0o600});
  entries['assets/'+id+'.svg']=hash(bytes);
 }
 const uiManifest={format:'duckbio-private-staging-ui-v1',
  reviewedGitSha:lock.central.sha,files:entries};
 writeFileSync(join(target,'source-manifest.json'),
  JSON.stringify(uiManifest,null,2)+'\n',{mode:0o600});
 const planDir=join(privateRoot,'staging-service-plan');
 mkdirSync(planDir,{mode:0o700});
 const expected=expectedSeventhWorkspaceUnit(config,{
  sourceRoot:sourcesRoot,privateRoot,nodeBinary:process.execPath
 });
 const unitFile=join(planDir,'duckbio-workspace-staging.service');
 const caddyFile=join(planDir,'Caddyfile.workspace-staging');
 const manifestFile=join(planDir,'plan-manifest.json');
 writeFileSync(unitFile,expected.unit,{mode:0o600});
 writeFileSync(caddyFile,expected.caddy,{mode:0o600});
 const planManifest={format:'duckbio-staging-service-plan-v1',
  reviewedGitSha:lock.central.sha,assetCount:UI_FILES.length+
  Object.keys(ICON_FILES).length,port:3307,nodeVersion:process.version,
  unitSha256:hash(expected.unit),caddySha256:hash(expected.caddy),
  scope:'templates-only-no-deployment'};
 writeFileSync(manifestFile,JSON.stringify(planManifest,null,2)+'\n',
  {mode:0o600});
 const audit=(overrides={})=>auditSeventhWorkspaceUnit({
  config,lock,sourcesRoot,...overrides
 });
 return {home,sourcesRoot,privateRoot,config,source,sourceUi,
  sourceIcons,target,entries,uiManifest,planDir,unitFile,caddyFile,
  manifestFile,expected,planManifest,audit};
}
test('checks source-locked seventh unit, private copied UI, central manifest and separate unused Caddyfile',t=>{
 const f=fixtures(t);
 const result=f.audit();
 assert.deepEqual(result,{
  ok:true,code:'ok',unitVerified:true,uiVerified:true,
  deploymentAuthorized:false,
  category:'uninstalled-seven-service-workspace-unit-source-only'
 });
 assert.match(f.expected.unit,/^WorkingDirectory=\/.*\/workspace-server\/$/m);
 assert.match(f.expected.unit,/^Environment=PORT=3307$/m);
 assert.match(f.expected.unit,/^User=duckbio-staging$/m);
 assert.match(f.expected.caddy,/reverse_proxy 127\.0\.0\.1:3307/);
 assert.doesNotMatch(f.expected.caddy,
  /staging-(?:goflo|eel|methpipe|mantrain|duckman|limsman)\.duckbio\.net/);
});
test('never rewrites the independent original manifest, Caddy or Workspace unit',t=>{
 const f=fixtures(t);
 const before=[f.unitFile,f.caddyFile,f.manifestFile].map(x=>readFileSync(x));
 const beforeNames=readdirSync(f.planDir);
 assert.equal(f.audit().ok,true);
 assert.deepEqual([f.unitFile,f.caddyFile,f.manifestFile]
  .map(x=>readFileSync(x)),before);
 assert.deepEqual(readdirSync(f.planDir),beforeNames);
});
test('modifying unit directives or Caddy block fails even when attacker updates manifest SHA',t=>{
 const f=fixtures(t);
 const altered=f.expected.unit.replace(
  'ProtectSystem=strict','ProtectSystem=full');
 writeFileSync(f.unitFile,altered);
 writeFileSync(f.manifestFile,JSON.stringify({
  ...f.planManifest,unitSha256:hash(altered)
 },null,2)+'\n');
 assert.equal(f.audit().ok,false);
 assert.equal(f.audit().code,'seventh_workspace_service_unit_unverified');
 writeFileSync(f.unitFile,f.expected.unit);
 writeFileSync(f.manifestFile,JSON.stringify(f.planManifest,null,2)+'\n');
 const changedCaddy=f.expected.caddy.replace(
  'reverse_proxy 127.0.0.1:3307 {',
  'reverse_proxy 127.0.0.1:3308 {');
 writeFileSync(f.caddyFile,changedCaddy);
 writeFileSync(f.manifestFile,JSON.stringify({
  ...f.planManifest,caddySha256:hash(changedCaddy)
 },null,2)+'\n');
 assert.equal(f.audit().ok,false);
});
test('rejects edited UI, unreviewed source asset, extra file, missing copied icon and wrong UI manifest',t=>{
 const f=fixtures(t),page=join(f.target,'workspace.js');
 const original=readFileSync(page);
 writeFileSync(page,'tampered private UI');
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
 writeFileSync(page,original);
 const source=join(f.sourceUi,'workspace.js');
 writeFileSync(source,'unreviewed checkout source');
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
 writeFileSync(source,original);
 const extra=join(f.target,'unexpected.js');
 writeFileSync(extra,'not reviewed');
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
 rmSync(extra);
 const icon=join(f.target,'assets','eel.svg');
 rmSync(icon);
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
});
test('rejects symlinked copied private UI or public permissions',t=>{
 const f=fixtures(t),file=join(f.target,'admin.html');
 const old=readFileSync(file);
 rmSync(file);
 symlinkSync(join(f.sourceUi,'admin.html'),file);
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
 rmSync(file);
 writeFileSync(file,old,{mode:0o600});
 chmodSync(file,0o644);
 assert.equal(f.audit().code,'private_workspace_ui_unverified');
});
test('requires exactly 3 owner-only plan files and valid immutable central manifest',t=>{
 const f=fixtures(t);
 const extra=join(f.planDir,'README.md');
 writeFileSync(extra,'unexpected artifact',{mode:0o600});
 assert.equal(f.audit().code,'seventh_workspace_service_unit_unverified');
 rmSync(extra);
 writeFileSync(f.manifestFile,JSON.stringify({
  ...f.planManifest,reviewedGitSha:'f'.repeat(40)
 }));
 assert.equal(f.audit().code,'seventh_workspace_service_unit_unverified');
});
test('rejects config edited after plan generation and source version mismatch',t=>{
 const f=fixtures(t);
 const changed={...f.config,SUITE_BUILD_SHA:'f'.repeat(40)};
 assert.equal(f.audit({config:changed}).code,'unreviewed_workspace_snapshot');
 const changedToken={...f.config,SUITE_SETUP_TOKEN:'A'.repeat(43)};
 assert.equal(f.audit({config:changedToken}).code,
  'private_workspace_inputs_unverified');
 const staleLock=structuredClone(lock);
 staleLock.apps[0].sha='f'.repeat(40);
 assert.equal(f.audit({lock:staleLock}).code,'unreviewed_workspace_snapshot');
});
test('combined seven-service gate refuses incomplete six-native prerequisites before reading Workspace UI',
 t=>{
 const f=fixtures(t);
 let workspaceCalls=0,sixCalls=0;
 const blocked=auditSevenCompleteUninstalledPrestart({
  config:f.config,lock,sourcesRoot:f.sourcesRoot,
  sixGate:()=>{sixCalls++;return {ok:false,checks:[]}},
  workspaceGate:()=>{workspaceCalls++;return f.audit()}
 });
 assert.equal(blocked.ok,false);
 assert.equal(sixCalls,1);
 assert.equal(workspaceCalls,0);
 assert.equal(blocked.checks.at(-1).name,'six-native-source-prestart');
});
test('combined seven-service gate passes only six genuine audited units PLUS source-pinned Workspace unit',
 t=>{
 const f=fixtures(t);
 const opts={config:f.config,lock,sourcesRoot:f.sourcesRoot};
 const sixGate=()=>({
  ok:true,checked:5,deploymentAuthorized:false,
  checks:Array.from({length:5},(_,i)=>({name:'synthetic-'+i,ok:true}))
 });
 const p=auditSevenCompleteUninstalledPrestart({...opts,
  sixGate,workspaceGate:f.audit});
 assert.equal(p.ok,true);
 assert.equal(p.deploymentAuthorized,false);
 assert.deepEqual(p.checks.map(c=>c.name),
  ['six-native-source-prestart','seventh-workspace-service-unit']);
 const broken=()=>({...f.audit(),unitVerified:false});
 assert.equal(auditSevenCompleteUninstalledPrestart({...opts,
  sixGate,workspaceGate:broken}).ok,false);
 const historical=structuredClone(lock);
 historical.scope='synthetic-source-ci-only';
 assert.equal(auditSevenCompleteUninstalledPrestart({
  ...opts,lock:historical,sixGate,workspaceGate:f.audit
 }).ok,false);
});
test('combined opt-in CLI without required explicit confirmation cannot inspect real host',()=>{
 const script=fileURLToPath(new URL(
  '../staging-seven-complete-prestart-gate.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[script],{
  encoding:'utf8',timeout:5000
 });
 assert.equal(out.status,2);
 assert.match(out.stderr,/confirm-offline-seven-uninstalled-only/);
});
