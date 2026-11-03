import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,
 chmodSync,statSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NATIVE_APP_IDS,validateWorkspaceStagingConfig,readPrivateConfiguration}
 from '../staging-preflight.mjs';
import {createSyntheticStagingConfig,writeSyntheticStagingConfig}
 from '../staging-generate-config.mjs';

const commit='a'.repeat(40);
const args=root=>({baseDomain:'duckbio.net',privateRoot:root,buildSha:commit});
const rootFor=t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-stage-generator-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
};

test('a fresh synthetic config uses six private independent app credentials and one-use owner setup token',t=>{
 const root=rootFor(t),cfg=createSyntheticStagingConfig(args(root));
 assert.deepEqual(validateWorkspaceStagingConfig(cfg),{ok:true,errors:[]});
 assert.equal(cfg.SUITE_ORIGIN,'https://staging-workspace.duckbio.net');
 assert.equal(cfg.SUITE_ISSUER,cfg.SUITE_ORIGIN);
 assert.equal(cfg.SUITE_BUILD_SHA,commit);
 const clients=JSON.parse(cfg.SUITE_CLIENTS);
 assert.deepEqual(clients.map(c=>c.id),NATIVE_APP_IDS);
 const secrets=new Set();
 for(const client of clients){
  assert.equal(client.appId,client.id);
  assert.equal(client.nativeOrigin,'https://staging-'+client.id+'.duckbio.net');
  assert.deepEqual(client.redirectUris,[client.nativeOrigin+'/auth/callback']);
  assert.match(client.secret,/^[A-Za-z0-9_-]{64}$/);
  assert.equal(secrets.has(client.secret),false);
  secrets.add(client.secret);
 }
 assert.match(cfg.SUITE_SETUP_TOKEN,/^[A-Za-z0-9_-]{64}$/);
 assert.equal(secrets.has(cfg.SUITE_SETUP_TOKEN),false);
 assert.deepEqual(readdirSync(root),[],'no accounts, databases or networks are created');
});

test('config write is owner-only, atomic, never overwrites and creates no databases',t=>{
 const root=rootFor(t);
 const report=writeSyntheticStagingConfig(args(root));
 const path=join(root,'workspace-staging.json');
 assert.equal(report.filename,path);
 assert.equal(report.clientCount,6);
 assert.equal(statSync(path).mode&0o777,0o600);
 assert.deepEqual(validateWorkspaceStagingConfig(readPrivateConfiguration(path)),
  {ok:true,errors:[]});
 const initial=readFileSync(path);
 assert.throws(()=>writeSyntheticStagingConfig(args(root)));
 assert.deepEqual(readFileSync(path),initial,'existing private secrets must never be replaced');
 assert.deepEqual(readdirSync(root),['workspace-staging.json'],
  'temporary candidate is always removed, including on duplicate failure');
 for(const file of ['auth.sqlite','identity.sqlite','organizations.sqlite','communications.sqlite'])
  assert.equal(existsSync(join(root,file)),false);
 assert.equal(existsSync(join(root,'private-ui')),false,
  'static UI assets must be deployed from a reviewed source separately');
});

test('a preexisting symlink output is never overwritten or followed',t=>{
 const root=rootFor(t),victim=join(root,'unrelated-private-file');
 writeFileSync(victim,'DO NOT MODIFY',{mode:0o600});
 symlinkSync(victim,join(root,'workspace-staging.json'));
 assert.throws(()=>writeSyntheticStagingConfig(args(root)));
 assert.equal(readFileSync(victim,'utf8'),'DO NOT MODIFY');
 assert.deepEqual(readdirSync(root).sort(),['unrelated-private-file','workspace-staging.json']);
});

test('private output cannot be a Git checkout, world-readable, docs, public_html or symlink',t=>{
 const parent=rootFor(t),privateRoot=join(parent,'private');
 mkdirSync(privateRoot,{mode:0o700});
 const git=join(parent,'git');mkdirSync(git,{mode:0o700});
 mkdirSync(join(git,'.git'));
 const checked=join(git,'private');mkdirSync(checked,{mode:0o700});
 assert.throws(()=>createSyntheticStagingConfig(args(checked)),/public_or_repository_root/);
 for(const forbidden of ['docs','public_html']){
  const location=join(parent,forbidden);mkdirSync(location,{mode:0o700});
  const child=join(location,'private');mkdirSync(child,{mode:0o700});
  assert.throws(()=>writeSyntheticStagingConfig(args(child)),/public_or_repository_root/);
  assert.equal(readdirSync(child).length,0);
 }
 const alias=join(parent,'looks-private');
 symlinkSync(privateRoot,alias);
 assert.throws(()=>writeSyntheticStagingConfig(args(alias)),/private_root_required/);
 chmodSync(privateRoot,0o755);
 if(process.platform!=='win32')
  assert.throws(()=>writeSyntheticStagingConfig(args(privateRoot)),/private_root_permissions/);
 chmodSync(privateRoot,0o700);
 assert.throws(()=>writeSyntheticStagingConfig(args(join(parent,'missing'))),/private_root_required/);
 assert.deepEqual(readdirSync(privateRoot),[]);
});

test('invalid or production-like domains and missing commit never generate config',t=>{
 const root=rootFor(t);
 for(const domain of [
  'example.test','celluloidconsulting.net','github.io','duckbio.github.io',
  'localhost','127.0.0.1','bad/domain','www.duckbio.net','duckbio.net:443',
  'duCKBio..net','duckbio.net/evil',''
 ]){
  assert.throws(()=>writeSyntheticStagingConfig({...args(root),baseDomain:domain}),
   undefined,domain);
 }
 assert.throws(()=>writeSyntheticStagingConfig({...args(root),buildSha:'HEAD'}));
 assert.deepEqual(readdirSync(root),[]);
});

test('CLI requires explicit synthetic-only confirmation and does not print private secrets',t=>{
 const root=rootFor(t);
 const path=fileURLToPath(new URL('../staging-generate-config.mjs',import.meta.url));
 const command=[
  path,'--base-domain','duckbio.net','--private-root',root,
  '--build-sha',commit
 ];
 const denied=spawnSync(process.execPath,command,{encoding:'utf8',timeout:10000});
 assert.equal(denied.status,2);
 assert.deepEqual(readdirSync(root),[],'no write without affirmative flag');
 const created=spawnSync(process.execPath,[...command,'--confirm-synthetic-only'],
  {encoding:'utf8',timeout:10000});
 assert.equal(created.status,0,created.stderr);
 assert.match(created.stdout,/Created owner-only synthetic staging configuration/);
 const config=readPrivateConfiguration(join(root,'workspace-staging.json'));
 const sensitive=[config.SUITE_SETUP_TOKEN,
  ...JSON.parse(config.SUITE_CLIENTS).map(c=>c.secret)];
 for(const value of sensitive){
  assert.equal(created.stdout.includes(value),false);
  assert.equal(created.stderr.includes(value),false);
 }
 const second=spawnSync(process.execPath,[...command,'--confirm-synthetic-only'],
  {encoding:'utf8',timeout:10000});
 assert.equal(second.status,1);
 assert.equal(second.stderr.includes(config.SUITE_SETUP_TOKEN),false);
 assert.deepEqual(readdirSync(root),['workspace-staging.json']);
});
