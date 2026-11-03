import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,
 statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {NATIVE_APP_IDS} from '../staging-preflight.mjs';
import {auditSixNativeEnvironmentFiles} from '../staging-six-native-env-audit.mjs';
const secret=()=>randomBytes(32).toString('base64url');
function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-native-env-check-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const central=join(home,'central'),data=join(home,'native');
 mkdirSync(central,{mode:0o700});mkdirSync(data,{mode:0o700});
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:'a'.repeat(40)
 });
 const clients=new Map(JSON.parse(config.SUITE_CLIENTS).map(c=>[c.id,c]));
 const dirs=new Map();
 const files=new Map();
 for(const id of NATIVE_APP_IDS){
  const dir=join(data,id);mkdirSync(dir,{mode:0o700});dirs.set(id,dir);
  const client=clients.get(id),origin=client.nativeOrigin;
  const env={
   DUCKBIO_WORKSPACE_ORIGIN:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_ISSUER:config.SUITE_ORIGIN,
   DUCKBIO_WORKSPACE_CLIENT_SECRET:client.secret
  };
  const orgKey=id==='eel'||id==='duckman'?
   'DUCKBIO_WORKSPACE_ORGANIZATION_ID':'DUCKBIO_WORKSPACE_ORG_ID';
  env[orgKey]='staging-synthetic-org-'+id;
  if(id==='eel'){
   mkdirSync(join(dir,'runtime'),{mode:0o700});
   Object.assign(env,{
    FRONTEND_ORIGIN:origin,APP_BASE_URL:origin,CANONICAL_ORIGIN:origin,
    DUCKBIO_WORKSPACE_NATIVE_ORIGIN:origin,
    DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED:'true',
    DUCKBIO_WORKSPACE_VAULT_KEY:secret(),
    PGHOST:'127.0.0.1',PGDATABASE:'ducknote_staging',
    PGUSER:'staging_eel',PGPASSWORD:secret()
   });
  }else{
   if(id!=='limsman')env.APP_BASE_URL=origin;
   env[id==='duckman'?'DUCKMAN_DATABASE_PATH':
    id==='limsman'?'LIMSMAN_CONFIG_PATH':'SCIENCE_DATABASE_PATH']=
    join(dir,id==='limsman'?'labduck-private.json':'records.sqlite');
   if(id==='duckman')Object.assign(env,{
    DUCKBIO_WORKSPACE_CLIENT_ID:'duckman',
    DUCKBIO_WORKSPACE_PROOF_KEY:secret()
   });
  }
  files.set(id,env);
 }
 const write=(id,extra={})=>{
  const path=join(dirs.get(id),'native.env');
  const env={...files.get(id),...extra};
  writeFileSync(path,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',
   {mode:0o600});
  chmodSync(path,0o600);
 };
 for(const id of NATIVE_APP_IDS)write(id);
 return {home,central,data,config,dirs,files,write};
}
const inspect=f=>auditSixNativeEnvironmentFiles(f.config,f.data);
const codes=(result,id)=>result.failures.filter(x=>x.appId===id).map(x=>x.code);

test('approves six isolated native environment policies without revealing credentials',t=>{
 const f=fixture(t),result=inspect(f);
 assert.deepEqual(result,{ok:true,checked:6,failures:[]});
 assert.equal(statSync(join(f.dirs.get('eel'),'native.env')).mode&0o777,0o600);
 const output=JSON.stringify(result);
 for(const c of JSON.parse(f.config.SUITE_CLIENTS))
  assert(!output.includes(c.secret));
});
test('rejects other apps secrets and central Workspace broker-wide settings',t=>{
 const f=fixture(t);
 const all=JSON.parse(f.config.SUITE_CLIENTS);
 f.write('goflo',{
  DUCKBIO_WORKSPACE_CLIENT_SECRET:all.find(c=>c.id==='eel').secret,
  SUITE_CLIENTS:'DO_NOT_EXPORT_CENTRAL'
 });
 const result=inspect(f);
 assert.equal(result.ok,false);
 assert(codes(result,'goflo').includes('native_client_secret_mismatch'));
 assert(codes(result,'goflo').includes('forbidden_runtime_override'));
 assert(!JSON.stringify(result).includes(all[1].secret));
});
test('rejects changed Workspace issuer, production-looking app origin and missing native org',t=>{
 const f=fixture(t);
 f.write('methpipe',{
  DUCKBIO_WORKSPACE_ISSUER:'https://production.duckbio.net',
  APP_BASE_URL:'https://duckpipe.duckbio.net',
  DUCKBIO_WORKSPACE_ORG_ID:''
 });
 const codesFor=codes(inspect(f),'methpipe');
 assert(codesFor.includes('workspace_issuer_mismatch'));
 assert(codesFor.includes('native_origin_mismatch'));
 assert(codesFor.includes('native_organization_mapping_missing'));
});
test('refuses external SQLite, foreign LabDuck configuration and unsafe host overrides',t=>{
 const f=fixture(t);
 f.write('duckman',{
  DUCKMAN_DATABASE_PATH:'/tmp/duckman-production.sqlite',
  DUCKBIO_WORKSPACE_PROOF_KEY:'not-a-real-independent-key',
  HOST:'0.0.0.0'
 });
 f.write('limsman',{LIMSMAN_CONFIG_PATH:'/etc/labduck-production.json'});
 const result=inspect(f);
 assert(codes(result,'duckman').includes('native_database_path_outside_app'));
 assert(codes(result,'duckman').includes('independent_proof_key_missing'));
 assert(codes(result,'duckman').includes('forbidden_runtime_override'));
 assert(codes(result,'limsman').includes('native_database_path_outside_app'));
});
test('DuckNote requires explicit link, independent vault, and private staging PostgreSQL',t=>{
 const f=fixture(t);
 f.write('eel',{
  DUCKBIO_WORKSPACE_NATIVE_LINK_ENABLED:'false',
  DUCKBIO_WORKSPACE_VAULT_KEY:f.files.get('eel').DUCKBIO_WORKSPACE_CLIENT_SECRET,
  PGHOST:'production-postgres.duckbio.net',
  PGDATABASE:'production'
 });
 const result=inspect(f);
 assert(codes(result,'eel').includes('native_link_not_enabled'));
 assert(codes(result,'eel').includes('independent_vault_key_missing'));
 assert(codes(result,'eel').includes('private_staging_postgres_required'));
});
test('DuckNote private runtime must exist, be owner-only and contain no reset marker',t=>{
 const f=fixture(t),runtime=join(f.dirs.get('eel'),'runtime');
 assert.equal(inspect(f).ok,true);
 chmodSync(runtime,0o755);
 if(process.platform!=='win32')
  assert(codes(inspect(f),'eel').includes('native_runtime_missing_or_unsafe'));
 chmodSync(runtime,0o700);
 const marker=join(runtime,'reset-eel-database.once');
 writeFileSync(marker,'synthetic reset marker',{mode:0o600});
 assert(codes(inspect(f),'eel').includes('native_runtime_missing_or_unsafe'));
 rmSync(marker);
 assert.equal(inspect(f).ok,true);
 f.write('eel',{DUCKNOTE_RUNTIME_DIR:'/tmp/unreviewed'});
 assert(codes(inspect(f),'eel').includes('forbidden_runtime_override'));
 f.write('eel');
 rmSync(runtime,{recursive:true});
 assert(codes(inspect(f),'eel').includes('native_runtime_missing_or_unsafe'));
 const source=join(f.dirs.get('eel'),'alternative');
 mkdirSync(source,{mode:0o700});
 symlinkSync(source,runtime);
 assert(codes(inspect(f),'eel').includes('native_runtime_missing_or_unsafe'));
});
test('malformed, symlinked and world-readable environment files fail without leaked content',t=>{
 const f=fixture(t),path=join(f.dirs.get('goflo'),'native.env');
 writeFileSync(path,'A=foo\nA=bar\n');chmodSync(path,0o600);
 assert(codes(inspect(f),'goflo').includes('malformed_env'));
 f.write('goflo');chmodSync(path,0o644);
 if(process.platform!=='win32')
  assert(codes(inspect(f),'goflo').includes('unsafe_environment_file'));
 chmodSync(path,0o600);
 rmSync(path);
 const hidden=join(f.dirs.get('goflo'),'secret-source');
 writeFileSync(hidden,'NO_CREDENTIALS',{mode:0o600});symlinkSync(hidden,path);
 assert(codes(inspect(f),'goflo').includes('unsafe_environment_file'));
});
test('CLI requires explicit opt-in; reports only fixed codes/app names',t=>{
 const f=fixture(t),source=fileURLToPath(new URL('../staging-six-native-env-audit.mjs',import.meta.url));
 const file=join(f.central,'workspace-staging.json');
 writeFileSync(file,JSON.stringify(f.config),{mode:0o600});
 const argv=[source,'--config',file,'--private-data-root',f.data];
 const denied=spawnSync(process.execPath,argv,{encoding:'utf8',timeout:10000});
 assert.equal(denied.status,2);
 const accepted=spawnSync(process.execPath,[...argv,'--confirm-offline-only'],
  {encoding:'utf8',timeout:10000});
 assert.equal(accepted.status,0,accepted.stderr);
 assert.match(accepted.stdout,/offline only/);
 f.write('eel',{DUCKBIO_WORKSPACE_CLIENT_SECRET:'INVALID_SECRET'});
 const bad=spawnSync(process.execPath,[...argv,'--confirm-offline-only'],
  {encoding:'utf8',timeout:10000});
 assert.equal(bad.status,1);
 assert.match(bad.stderr,/eel:native_client_secret_mismatch/);
 for(const v of [f.home,f.data,file,'INVALID_SECRET',
  f.config.SUITE_SETUP_TOKEN,
  ...JSON.parse(f.config.SUITE_CLIENTS).map(c=>c.secret)])
  assert(![denied,accepted,bad].some(x=>(x.stdout+x.stderr).includes(v)));
});
