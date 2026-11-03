import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,
 readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {STAGING_PROXY_PORTS,validateStagingProxyPorts,
 buildSevenOriginProxyPlan,writeSevenOriginProxyPlan}
 from '../staging-seven-proxy-plan.mjs';

const lock=JSON.parse(readFileSync(
 new URL('../six-app-source-qa-lock.json',import.meta.url),'utf8'));
function setup(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-seven-proxy-test-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const central=join(home,'central'),output=join(home,'operator-plan');
 mkdirSync(central,{mode:0o700});
 mkdirSync(output,{mode:0o700});
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:lock.central.sha
 });
 return {home,central,output,config};
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const clients=cfg=>JSON.parse(cfg.SUITE_CLIENTS);

test('creates seven distinct native/Workspace HTTPS host routes to unique loopback ports',t=>{
 const {config}=setup(t);
 const {caddy,manifest}=buildSevenOriginProxyPlan(config,lock);
 const hosts=new Set([new URL(config.SUITE_ORIGIN).hostname,
  ...clients(config).map(c=>new URL(c.nativeOrigin).hostname)]);
 assert.equal(hosts.size,7);
 assert.equal(manifest.routeCount,7);
 assert.equal(manifest.routes.length,7);
 assert.deepEqual(manifest.routes.map(r=>r.id),[
  'workspace','goflo','eel','methpipe','mantrain','duckman','limsman'
 ]);
 assert.equal(manifest.sourceQaWorkspaceSha,lock.central.sha);
 assert.equal(manifest.caddySha256,hash(caddy));
 for(const item of manifest.routes){
  assert(hosts.has(item.hostname));
  assert.match(item.reviewedSourceSha,/^[a-f0-9]{40}$/);
  assert.equal(item.repo.startsWith('dennisbsj/'),true);
  assert.match(caddy,new RegExp('^'+item.hostname.replaceAll('.','\\.')+' \\{$','m'));
  assert(caddy.includes('reverse_proxy 127.0.0.1:'+item.loopbackPort+' {'));
  assert.equal(caddy.split(item.hostname+' {').length,2);
 }
 assert.equal(caddy.match(/^  reverse_proxy 127\.0\.0\.1:\d+ \{$/gm)?.length,7);
 assert.equal(caddy.match(/header_up Host/g)?.length||0,0,
  'all seven backends must inspect the real incoming Host header');
 assert.equal(caddy.match(/^    \?X-Content-Type-Options/gm)?.length,7,
  'no duplicate nosniff headers across seven native backends');
 assert.equal(caddy.match(/^    header_up -X-Forwarded-For$/gm)?.length,7);
 assert.equal(new Set(manifest.routes.map(r=>r.loopbackPort)).size,7);
 assert(!/0\.0\.0\.0|tls internal|reverse_proxy \*:|https?:\/\/|:443\b/.test(
  caddy.split('\n').filter(x=>!x.startsWith('#')).join('\n')));
 for(const secret of [config.SUITE_SETUP_TOKEN,
  ...clients(config).map(c=>c.secret)]){
  assert(!caddy.includes(secret));
  assert(!JSON.stringify(manifest).includes(secret));
 }
 for(const db of ['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
  'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH']){
  assert(!caddy.includes(config[db]));
  assert(!JSON.stringify(manifest).includes(config[db]));
 }
});

test('fails closed before planning when Workspace source is not six-app certified',t=>{
 const {config,output}=setup(t);
 assert.throws(()=>buildSevenOriginProxyPlan({
  ...config,SUITE_BUILD_SHA:'f'.repeat(40)
 },lock),/staging_workspace_sha_not_jointly_verified/);
 assert.throws(()=>writeSevenOriginProxyPlan({
  config:{...config,SUITE_BUILD_SHA:'f'.repeat(40)},
  lock,outputRoot:output
 }),/staging_workspace_sha_not_jointly_verified/);
 assert.deepEqual(readdirSync(output),[]);
 const invalidLock=structuredClone(lock);
 invalidLock.apps[0].repo='foreign/CytoDuck';
 assert.throws(()=>buildSevenOriginProxyPlan(config,invalidLock),
  /invalid_source_qa_lock/);
});
test('rejects duplicate/out-of-range ports and malformed route inputs',t=>{
 const {config}=setup(t);
 const bad=[
  {...STAGING_PROXY_PORTS,goflo:3307},
  {...STAGING_PROXY_PORTS,duckman:80},
  {...STAGING_PROXY_PORTS,eel:65536},
  {...STAGING_PROXY_PORTS,workspace:0},
  {...STAGING_PROXY_PORTS,workspace:'3307'},
  {...STAGING_PROXY_PORTS,unexpected:3314},
  {workspace:3307},
  null
 ];
 for(const ports of bad){
  assert.equal(validateStagingProxyPorts(ports),false);
  assert.throws(()=>buildSevenOriginProxyPlan(config,lock,ports),
   /invalid_or_duplicate_proxy_ports/);
 }
 const invalid={...config,SUITE_STAGING_ACK:''};
 assert.throws(()=>buildSevenOriginProxyPlan(invalid,lock),
  /invalid_synthetic_staging_config/);
 const duplicated=clients(config);
 duplicated[1].nativeOrigin=duplicated[0].nativeOrigin;
 duplicated[1].redirectUris=[duplicated[1].nativeOrigin+'/auth/callback'];
 assert.throws(()=>buildSevenOriginProxyPlan({
  ...config,SUITE_CLIENTS:JSON.stringify(duplicated)
 },lock),/invalid_synthetic_staging_config/);
});

test('uses one fresh owner-only directory, verifies hashes and refuses overwrite',t=>{
 const {config,output}=setup(t);
 const generated=writeSevenOriginProxyPlan({config,lock,outputRoot:output});
 assert.deepEqual(generated,{ok:true,origins:7,workspaceSha:lock.central.sha});
 const dir=join(output,'seven-origin-proxy-plan');
 assert.deepEqual(readdirSync(dir),[
  'Caddyfile.seven-origin-staging','routing-manifest.json'
 ]);
 const raw=readFileSync(join(dir,'Caddyfile.seven-origin-staging'),'utf8');
 const manifest=JSON.parse(readFileSync(join(dir,'routing-manifest.json'),'utf8'));
 assert.equal(manifest.caddySha256,hash(raw));
 assert.equal(manifest.scope,'uninstalled-caddy-source-template-only');
 if(process.platform!=='win32'){
  assert.equal(statSync(dir).mode&0o777,0o700);
  for(const item of readdirSync(dir))
   assert.equal(statSync(join(dir,item)).mode&0o777,0o600);
 }
 assert.throws(()=>writeSevenOriginProxyPlan({config,lock,outputRoot:output}));
 assert.equal(readFileSync(join(dir,'Caddyfile.seven-origin-staging'),'utf8'),raw);
 assert.equal(existsSync(join(output,'workspace-staging.json')),false);
});

test('refuses public and symlinked destination directories with no side effects',t=>{
 const {home,config,output}=setup(t);
 const publicDir=join(home,'public_html');
 mkdirSync(publicDir,{mode:0o700});
 assert.throws(()=>writeSevenOriginProxyPlan({config,lock,outputRoot:publicDir}));
 const link=join(home,'linked-plan-root');
 symlinkSync(output,link);
 assert.throws(()=>writeSevenOriginProxyPlan({config,lock,outputRoot:link}));
 assert.deepEqual(readdirSync(output),[]);
});

test('CLI requires explicit uninstalled-only acknowledgment and never prints secrets',t=>{
 const {central,config,output}=setup(t);
 const cfg=join(central,'workspace-staging.json');
 writeFileSync(cfg,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
 chmodSync(cfg,0o600);
 const script=fileURLToPath(new URL('../staging-seven-proxy-plan.mjs',import.meta.url));
 const args=[script,'--config',cfg,'--private-output-root',output];
 const denied=spawnSync(process.execPath,args,{
  encoding:'utf8',timeout:10000
 });
 assert.equal(denied.status,2);
 assert.equal(denied.stdout,'');
 assert.deepEqual(readdirSync(output),[]);
 const accepted=spawnSync(process.execPath,[...args,'--confirm-uninstalled-only'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(accepted.status,0,accepted.stderr);
 assert.match(accepted.stdout,/uninstalled only/);
 assert.equal(readdirSync(output).length,1);
 const duplicate=spawnSync(process.execPath,
  [...args,'--confirm-uninstalled-only'],{encoding:'utf8',timeout:10000});
 assert.equal(duplicate.status,1);
 for(const value of [cfg,output,config.SUITE_SETUP_TOKEN,
  ...clients(config).map(x=>x.secret)]){
  for(const result of [accepted,duplicate]){
   assert(!result.stdout.includes(value));
   assert(!result.stderr.includes(value));
  }
 }
});
