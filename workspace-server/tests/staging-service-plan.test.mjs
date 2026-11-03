import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdtempSync,readFileSync,readdirSync,
 rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {preparePrivateStagingUi} from '../staging-prepare-ui.mjs';
import {readPrivateConfiguration} from '../staging-preflight.mjs';
import {prepareStagingServicePlan,verifyNodeStagingExecutable}
 from '../staging-service-plan.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const sha=()=>execFileSync('git',['rev-parse','HEAD'],
 {cwd:repo,encoding:'utf8'}).trim();
const hash=txt=>createHash('sha256').update(txt).digest('hex');
const rootFor=t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-service-plan-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
};
const setup=t=>{
 const root=rootFor(t),file=writeSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:root,buildSha:sha()
 }).filename;
 const cfg=readPrivateConfiguration(file);
 preparePrivateStagingUi(cfg);
 return {root,file,cfg};
};

test('creates only two reviewed, uninstalled service/proxy templates, never starts anything',
 {timeout:30000},t=>{
 const {root,cfg}=setup(t);
 const output=prepareStagingServicePlan(cfg);
 assert.equal(output.ok,true);
 assert.equal(output.templates,2);
 assert.equal(output.reviewedGitSha,sha());
 const dir=join(root,'staging-service-plan');
 assert.deepEqual(readdirSync(dir).sort(),[
  'Caddyfile.workspace-staging',
  'duckbio-workspace-staging.service',
  'plan-manifest.json'
 ].sort());
 assert.equal(statSync(dir).mode&0o777,0o700);
 for(const name of readdirSync(dir))assert.equal(statSync(join(dir,name)).mode&0o777,0o600);
 const unit=readFileSync(join(dir,'duckbio-workspace-staging.service'),'utf8');
 const caddy=readFileSync(join(dir,'Caddyfile.workspace-staging'),'utf8');
 const manifest=JSON.parse(readFileSync(join(dir,'plan-manifest.json'),'utf8'));
 assert.equal(manifest.reviewedGitSha,sha());
 assert.equal(manifest.assetCount,20);
 assert.equal(manifest.nodeVersion,process.version);
 assert.equal(manifest.unitSha256,hash(unit));
 assert.equal(manifest.caddySha256,hash(caddy));
 assert.equal(manifest.scope,'templates-only-no-deployment');
 assert.match(unit,/^User=duckbio-staging$/m);
 assert.match(unit,/^Group=duckbio-staging$/m);
 assert.match(unit,/^Environment=NODE_ENV=production$/m);
 assert.match(unit,/^Environment=PORT=3307$/m);
 assert.match(unit,/^Environment=SUITE_ENV_FILE=\/.*\/workspace-staging.json$/m);
 assert.ok(unit.split('\n').some(line=>line.startsWith('ExecStart='+process.execPath+' ')&&
  line.endsWith('/shared-auth/runtime.mjs')),
  'service unit must use the Node executable actually verified on this host');
 assert.match(unit,/^UMask=0077$/m);
 assert.match(unit,/^NoNewPrivileges=true$/m);
 assert.match(unit,/^ProtectSystem=strict$/m);
 assert.match(unit,/^ReadWritePaths=\/.*$/m);
 assert.doesNotMatch(unit,/^User=root$/m);
 assert.doesNotMatch(unit,/0\.0\.0\.0|ExecStartPre|sudo|curl|wget|chown|chmod|npm install/);
 assert.match(caddy,/^staging-workspace\.duckbio\.net \{$/m);
 assert.match(caddy,/reverse_proxy 127\.0\.0\.1:3307/);
 assert.doesNotMatch(caddy,/header_up Host/,
  'proxy must preserve original HTTP Host for backend origin validation');
 assert.match(caddy,/\?X-Content-Type-Options/,
  'proxy must not duplicate backend security headers');
 assert.match(caddy,/header_up -X-Forwarded-Host/);
 assert.doesNotMatch(caddy,/staging-(?:goflo|eel|methpipe|mantrain|duckman|limsman)\.duckbio\.net/);
 assert.doesNotMatch(caddy,/tls internal|reverse_proxy 0\.0\.0\.0|\*:443/);
 for(const s of [
  cfg.SUITE_SETUP_TOKEN,
  ...JSON.parse(cfg.SUITE_CLIENTS).map(x=>x.secret)
 ])for(const value of [unit,caddy,JSON.stringify(manifest)])
  assert.equal(value.includes(s),false,'never serialize secrets into service templates');
 for(const name of ['auth.sqlite','identity.sqlite','organizations.sqlite','communications.sqlite'])
  assert.equal(existsSync(join(root,name)),false,'must not start a database');
 const previous=readFileSync(join(dir,'Caddyfile.workspace-staging'));
 assert.throws(()=>prepareStagingServicePlan(cfg));
 assert.deepEqual(readFileSync(join(dir,'Caddyfile.workspace-staging')),previous);
});

test('rejects modified private UI and source manifest without creating a service plan',t=>{
 const {root,cfg}=setup(t);
 const page=join(root,'private-ui','workspace.html');
 writeFileSync(page,'unexpected modification',{mode:0o600});
 assert.throws(()=>prepareStagingServicePlan(cfg),/private_ui_source_mismatch/);
 assert.equal(existsSync(join(root,'staging-service-plan')),false);
});
test('rejects missing private UI manifest, mismatched source SHA and config mismatch',t=>{
 const {root,cfg}=setup(t);
 assert.throws(()=>prepareStagingServicePlan({...cfg,SUITE_BUILD_SHA:'b'.repeat(40)}));
 assert.equal(existsSync(join(root,'staging-service-plan')),false);
 const incorrect={...cfg,SUITE_SETUP_TOKEN:'replaced-synthetic-token'};
 assert.throws(()=>prepareStagingServicePlan(incorrect),/private_config_file_mismatch/);
 assert.equal(existsSync(join(root,'staging-service-plan')),false);
});
test('only an existing executable Node 22.13+ binary is permitted for staging',()=>{
 assert.equal(verifyNodeStagingExecutable(process.execPath),process.version);
 for(const version of ['v18.20.0','v20.19.5','v22.12.9','vnot-a-node','v22.12.0']){
  assert.throws(()=>verifyNodeStagingExecutable(process.execPath,{
   runNode:()=>version
  }),/node_executable_unverified/);
 }
 for(const version of ['v22.13.0','v24.0.0','v26.1.0'])
  assert.equal(verifyNodeStagingExecutable(process.execPath,{
   runNode:()=>version
  }),version);
 assert.throws(()=>verifyNodeStagingExecutable('/missing/server/node'),
  /node_executable_unverified/);
});
test('validates privileged service identity, loopback port and safely escaped Node binary path',t=>{
 const {root,cfg}=setup(t);
 for(const bad of [
  {serviceUser:'root'}, {serviceUser:'bad user'},
  {listenPort:80},{listenPort:0},{listenPort:65536},
  {listenPort:'3307'}, {nodeBinary:'./node'},
  {nodeBinary:'/bin/sh'}, {nodeBinary:'/usr/bin/node;rm'}
 ]){
  assert.throws(()=>prepareStagingServicePlan(cfg,bad));
  assert.equal(existsSync(join(root,'staging-service-plan')),false);
 }
});
test('preexisting plan symlink cannot overwrite other private content',t=>{
 const {root,cfg}=setup(t),victim=join(root,'unrelated');
 writeFileSync(victim,'must remain',{mode:0o600});
 symlinkSync(victim,join(root,'staging-service-plan'));
 assert.throws(()=>prepareStagingServicePlan(cfg));
 assert.equal(readFileSync(victim,'utf8'),'must remain');
 assert.deepEqual(readdirSync(root).sort(),[
  'private-ui','staging-service-plan','unrelated','workspace-staging.json'
 ].sort());
});
test('CLI requires deliberate plan-only flag and never prints credentials',t=>{
 const {root,cfg,file}=setup(t);
 const path=fileURLToPath(new URL('../staging-service-plan.mjs',import.meta.url));
 const argv=[path,'--config',file,'--service-user','duckbio-staging',
  '--listen-port','3307'];
 const denied=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:10000});
 assert.equal(denied.status,2);
 assert.equal(existsSync(join(root,'staging-service-plan')),false);
 const started=spawnSync(process.execPath,[...argv,'--node-binary',
  process.execPath,'--confirm-plan-only'],
  {encoding:'utf8',timeout:10000});
 assert.equal(started.status,0,started.stderr);
 assert.match(started.stdout,/not installed/);
 for(const secret of [cfg.SUITE_SETUP_TOKEN,
  ...JSON.parse(cfg.SUITE_CLIENTS).map(x=>x.secret)]){
  assert.equal(started.stdout.includes(secret),false);
  assert.equal(started.stderr.includes(secret),false);
 }
});
