import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,chmodSync,readFileSync,readdirSync,
 statSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig} from '../staging-generate-config.mjs';
import {NATIVE_APP_IDS} from '../staging-preflight.mjs';
import {scopedNativeRegistration,writeScopedNativeRegistration}
 from '../staging-native-handoff.mjs';

function setup(t){
 const home=mkdtempSync(join(tmpdir(),'duckbio-native-export-test-'));
 chmodSync(home,0o700);
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const central=join(home,'central');
 mkdirSync(central,{mode:0o700});
 const config=createSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:central,buildSha:'a'.repeat(40)
 });
 const output=id=>{
  const dir=join(home,'handoff-'+id);
  mkdirSync(dir,{mode:0o700});
  return dir;
 };
 return {home,central,config,output};
}
const allClients=cfg=>JSON.parse(cfg.SUITE_CLIENTS);
const readOne=filename=>JSON.parse(readFileSync(filename,'utf8'));

test('every native app receives only its own reviewed credentials, never broker-wide secrets',t=>{
 const f=setup(t);
 const clients=allClients(f.config);
 for(const appId of NATIVE_APP_IDS){
  const dir=f.output(appId);
  const receipt=writeScopedNativeRegistration({
   config:f.config,appId,outputRoot:dir
  });
  assert.equal(receipt.appId,appId);
  assert.equal(receipt.filename,join(dir,'workspace-native-'+appId+'.json'));
  assert.deepEqual(readdirSync(dir),['workspace-native-'+appId+'.json']);
  const contents=readFileSync(receipt.filename,'utf8');
  const entry=readOne(receipt.filename);
  const client=clients.find(c=>c.id===appId);
  assert.deepEqual(Object.keys(entry).sort(),[
   'format','appId','clientId','clientSecret','workspaceOrigin',
   'issuer','nativeOrigin','redirectUri'].sort());
  assert.equal(entry.format,'duckbio-private-native-registration-v1');
  assert.equal(entry.appId,appId);
  assert.equal(entry.clientId,appId);
  assert.equal(entry.clientSecret,client.secret);
  assert.equal(entry.workspaceOrigin,f.config.SUITE_ORIGIN);
  assert.equal(entry.issuer,f.config.SUITE_ISSUER);
  assert.equal(entry.nativeOrigin,client.nativeOrigin);
  assert.equal(entry.redirectUri,client.redirectUris[0]);
  assert(!contents.includes(f.config.SUITE_SETUP_TOKEN));
  assert(!contents.includes('SUITE_CLIENTS'));
  assert(!contents.includes(f.config.SUITE_AUTH_DB_PATH));
  assert(!contents.includes(f.config.SUITE_COMMUNICATIONS_DB_PATH));
  assert(!contents.includes('DUCKBIO_WORKSPACE_ORGANIZATION_ID'));
  for(const other of clients.filter(c=>c.id!==appId)){
   assert(!contents.includes(other.secret),'cannot leak another app secret');
  }
  if(process.platform!=='win32')
   assert.equal(statSync(receipt.filename).mode&0o077,0,'owner-only output');
 }
});

test('exports reject invalid IDs and tampered central registration without writing output',t=>{
 const f=setup(t);
 for(const appId of ['__proto__','goflo/eel','workspace','',null]){
  assert.throws(()=>scopedNativeRegistration(f.config,appId),/invalid_native_app_id/);
 }
 const clients=allClients(f.config);
 clients[0].secret=clients[1].secret;
 const invalid={...f.config,SUITE_CLIENTS:JSON.stringify(clients)};
 const dir=f.output('bad');
 assert.throws(()=>writeScopedNativeRegistration({
  config:invalid,appId:'goflo',outputRoot:dir
 }),/invalid_synthetic_staging_config/);
 assert.deepEqual(readdirSync(dir),[]);
});

test('an export is exclusive: cannot overwrite or mix two app secrets in one directory',t=>{
 const f=setup(t),dir=f.output('exclusive');
 const initial=writeScopedNativeRegistration({
  config:f.config,appId:'eel',outputRoot:dir
 });
 const previous=readFileSync(initial.filename,'utf8');
 for(const appId of ['eel','goflo']){
  assert.throws(()=>writeScopedNativeRegistration({
   config:f.config,appId,outputRoot:dir
  }),/native_handoff_destination_must_be_empty/);
 }
 assert.equal(readFileSync(initial.filename,'utf8'),previous);
 assert.deepEqual(readdirSync(dir),['workspace-native-eel.json']);
});

test('rejects co-location, descendant, ancestor, public paths and symlinked destinations',t=>{
 const f=setup(t);
 const nested=join(f.central,'native');
 mkdirSync(nested,{mode:0o700});
 for(const root of [f.central,nested,f.home]){
  assert.throws(()=>writeScopedNativeRegistration({
   config:f.config,appId:'goflo',outputRoot:root
  }),/native_handoff_must_use_separate_private_root/);
 }
 const publicDir=join(f.home,'public_html');
 mkdirSync(publicDir,{mode:0o700});
 assert.throws(()=>writeScopedNativeRegistration({
  config:f.config,appId:'goflo',outputRoot:publicDir
 }),/public_or_repository_root/);
 const safeDir=f.output('real-dir');
 const symlink=join(f.home,'linked');
 symlinkSync(safeDir,symlink);
 assert.throws(()=>writeScopedNativeRegistration({
  config:f.config,appId:'goflo',outputRoot:symlink
 }));
 assert.deepEqual(readdirSync(safeDir),[]);
});

test('nonempty private root cannot be used to replace a preexisting symlink',t=>{
 const f=setup(t);
 const dir=f.output('no-clobber'),original=join(f.home,'original.txt');
 writeFileSync(original,'STABLE', {mode:0o600});
 symlinkSync(original,join(dir,'workspace-native-duckman.json'));
 assert.throws(()=>writeScopedNativeRegistration({
  config:f.config,appId:'duckman',outputRoot:dir
 }),/native_handoff_destination_must_be_empty/);
 assert.equal(readFileSync(original,'utf8'),'STABLE');
});

test('CLI demands explicit one-client consent and does not print passwords or paths',t=>{
 const f=setup(t);
 const filename=join(f.central,'workspace-staging.json');
 writeFileSync(filename,JSON.stringify(f.config),{mode:0o600});
 chmodSync(filename,0o600);
 const script=fileURLToPath(new URL('../staging-native-handoff.mjs',import.meta.url));
 const bad=spawnSync(process.execPath,[script,'--config',filename,
  '--app-id','eel','--private-output-root',f.output('unconfirmed')],{
   encoding:'utf8',timeout:10000
  });
 assert.equal(bad.status,2);
 assert.equal(bad.stdout,'');
 const dir=f.output('confirmed');
 const good=spawnSync(process.execPath,[script,'--config',filename,
  '--app-id','eel','--private-output-root',dir,'--confirm-one-app-only'],{
   encoding:'utf8',timeout:10000
  });
 assert.equal(good.status,0,good.stderr);
 assert.match(good.stdout,/single native staging registration/);
 assert(!good.stdout.includes(f.config.SUITE_SETUP_TOKEN));
 assert(!good.stdout.includes(filename));
 assert(!good.stdout.includes(dir));
 assert.equal(readdirSync(dir).length,1);
 const retry=spawnSync(process.execPath,[script,'--config',filename,
  '--app-id','eel','--private-output-root',dir,'--confirm-one-app-only'],{
   encoding:'utf8',timeout:10000
  });
 assert.equal(retry.status,1);
 assert(!retry.stderr.includes(f.config.SUITE_SETUP_TOKEN));
 assert(!retry.stderr.includes(dir));
});
