import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chmodSync,existsSync,mkdtempSync,readFileSync,readdirSync,
 rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from '../staging-preflight.mjs';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';
import {preparePostBootstrapStagingConfig,verifyConsumedSyntheticBootstrap}
 from '../staging-retire-bootstrap.mjs';

const SHA=x=>createHash('sha256').update(x).digest('hex');
function setup(t){
 const root=mkdtempSync(join(tmpdir(),'duckbio-retire-bootstrap-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const filename=writeSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:root,buildSha:'a'.repeat(40)
 }).filename;
 const config=readPrivateConfiguration(filename);
 const other=[
  createSqliteAuthStores({databasePath:config.SUITE_AUTH_DB_PATH}),
  createOrganizationStore({databasePath:config.SUITE_ORGANIZATION_DB_PATH}),
  createCommunicationsStore({databasePath:config.SUITE_COMMUNICATIONS_DB_PATH})
 ];
 const identity=createIdentityStore({databasePath:config.SUITE_IDENTITY_DB_PATH});
 identity.configureBootstrapToken(config.SUITE_SETUP_TOKEN);
 const close=()=>{
  identity.close();
  for(const store of other)store.close();
  for(const key of ['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
   'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH'])
   chmodSync(config[key],0o600);
 };
 return {root,config,filename,identity,close};
}
async function activate(f){
 const owner=await f.identity.bootstrap(f.config.SUITE_SETUP_TOKEN,{
  email:'synthetic-owner@example.test',displayName:'Synthetic Owner',
  password:'Synthetic only test password 321654'
 });
 assert.equal(owner.role,'admin');
 return owner;
}

test('verified consumed synthetic first-admin token produces a private runtime without setup key',
 {timeout:30000},async t=>{
 const f=setup(t);
 await activate(f);
 f.close();
 const prior=readFileSync(f.filename);
 const result=preparePostBootstrapStagingConfig(f.config);
 assert.deepEqual(result,{ok:true,files:3,storesChecked:4});
 const target=join(f.root,'post-bootstrap');
 assert.equal(statSync(target).mode&0o777,0o700);
 const names=readdirSync(target).sort();
 assert.deepEqual(names,['manifest.json','runtime-without-setup-token.conf',
  'workspace-staging-runtime.json'].sort());
 for(const file of names)assert.equal(statSync(join(target,file)).mode&0o777,0o600);
 const runtimePath=join(target,'workspace-staging-runtime.json');
 const runtime=readPrivateConfiguration(runtimePath);
 assert.equal('SUITE_SETUP_TOKEN' in runtime,false);
 assert.deepEqual(validateWorkspaceStagingConfig(runtime),{ok:true,errors:[]});
 const expected={...f.config};delete expected.SUITE_SETUP_TOKEN;
 assert.deepEqual(runtime,expected,'native client secrets and approved origins are unchanged');
 assert.deepEqual(readFileSync(f.filename),prior,'original secrets/config remain untouched');
 const override=readFileSync(join(target,'runtime-without-setup-token.conf'),'utf8');
 assert.equal(override.includes('Environment=SUITE_ENV_FILE='+runtimePath),true);
 assert.equal(override.includes('ExecStart='),false,
  'systemd override cannot change the server binary');
 const manifest=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'));
 assert.equal(manifest.format,'duckbio-synthetic-post-bootstrap-v1');
 assert.equal(manifest.reviewedGitSha,f.config.SUITE_BUILD_SHA);
 assert.equal(manifest.storesChecked,4);
 assert.equal(manifest.bootstrapTokenRemoved,true);
 assert.equal(manifest.configSha256,SHA(readFileSync(runtimePath)));
 assert.equal(manifest.systemdOverrideSha256,SHA(override));
 for(const secret of [
  f.config.SUITE_SETUP_TOKEN,...JSON.parse(f.config.SUITE_CLIENTS).map(c=>c.secret)
 ])for(const str of [override,JSON.stringify(manifest)])
  assert.equal(str.includes(secret),false);
 assert.throws(()=>preparePostBootstrapStagingConfig(f.config));
 assert.deepEqual(readFileSync(f.filename),prior);
});

test('unconsumed setup token blocks all runtime config creation',
 {timeout:30000},t=>{
 const f=setup(t);f.close();
 assert.throws(()=>verifyConsumedSyntheticBootstrap(f.config),
  /synthetic_first_administrator_not_activated/);
 assert.throws(()=>preparePostBootstrapStagingConfig(f.config),
  /synthetic_first_administrator_not_activated/);
 assert.equal(existsSync(join(f.root,'post-bootstrap')),false);
});

test('mismatched config/setup token and missing identity store never create output',
 {timeout:30000},async t=>{
 const f=setup(t);await activate(f);f.close();
 const falseToken={...f.config,SUITE_SETUP_TOKEN:'z'.repeat(64)};
 assert.throws(()=>preparePostBootstrapStagingConfig(falseToken),
  /source_configuration_mismatch/);
 const differentClients={...f.config,SUITE_BUILD_SHA:'b'.repeat(40)};
 assert.throws(()=>preparePostBootstrapStagingConfig(differentClients),
  /source_configuration_mismatch/);
 assert.equal(existsSync(join(f.root,'post-bootstrap')),false);
});

test('noncheckpointed WAL, insecure DB mode or symlinked DB aborts without output',
 {timeout:30000},async t=>{
 const f=setup(t);await activate(f);f.close();
 const path=f.config.SUITE_IDENTITY_DB_PATH;
 const wal=path+'-wal';
 writeFileSync(wal,'synthetic leftover WAL',{mode:0o600});
 assert.throws(()=>preparePostBootstrapStagingConfig(f.config),
  /database_not_checkpointed/);
 rmSync(wal);
 chmodSync(path,0o644);
 if(process.platform!=='win32')assert.throws(()=>
  preparePostBootstrapStagingConfig(f.config),/private_file_required/);
 chmodSync(path,0o600);
 assert.equal(existsSync(join(f.root,'post-bootstrap')),false);
});
test('private source symlink is rejected even when its target remains private',
 {timeout:30000},async t=>{
 const f=setup(t);await activate(f);f.close();
 const alias=join(f.root,'another-private-copy.json');
 writeFileSync(alias,readFileSync(f.filename),{mode:0o600});
 rmSync(f.filename);
 symlinkSync(alias,f.filename);
 assert.throws(()=>preparePostBootstrapStagingConfig(f.config),/private_file_required/);
 assert.equal(existsSync(join(f.root,'post-bootstrap')),false);
});

test('CLI requires broker-stopped confirmation and emits no private value',
 {timeout:30000},async t=>{
 const f=setup(t);await activate(f);f.close();
 const path=fileURLToPath(new URL('../staging-retire-bootstrap.mjs',import.meta.url));
 const no=spawnSync(process.execPath,[path,'--config',f.filename],
  {encoding:'utf8',timeout:10000});
 assert.equal(no.status,2);
 assert.equal(existsSync(join(f.root,'post-bootstrap')),false);
 const yes=spawnSync(process.execPath,[path,'--config',f.filename,
  '--confirm-broker-stopped-and-synthetic'],{
  encoding:'utf8',timeout:10000
 });
 assert.equal(yes.status,0,yes.stderr);
 assert.match(yes.stdout,/not installed/);
 for(const secret of [f.config.SUITE_SETUP_TOKEN,
  ...JSON.parse(f.config.SUITE_CLIENTS).map(c=>c.secret)]){
  assert.equal(yes.stdout.includes(secret),false);
  assert.equal(yes.stderr.includes(secret),false);
 }
});
