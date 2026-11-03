import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NATIVE_APP_IDS,validateWorkspaceStagingConfig} from '../staging-preflight.mjs';

function fixture(root='/srv/private/duckbio-staging'){
 const clients=NATIVE_APP_IDS.map(id=>({
  id,appId:id,secret:'synthetic-not-real-'+id+'-x'.repeat(40),
  nativeOrigin:'https://staging-'+id+'.example.test',
  redirectUris:['https://staging-'+id+'.example.test/auth/callback']
 }));
 return {
  SUITE_STAGING_ACK:'synthetic-accounts-only',SUITE_MODE:'broker',
  SUITE_BUILD_SHA:'a'.repeat(40),
  SUITE_ORIGIN:'https://staging-workspace.example.test',
  SUITE_ISSUER:'https://staging-workspace.example.test',
  SUITE_CLIENTS:JSON.stringify(clients),
  SUITE_AUTH_DB_PATH:join(root,'sessions.sqlite'),
  SUITE_IDENTITY_DB_PATH:join(root,'identity.sqlite'),
  SUITE_ORGANIZATION_DB_PATH:join(root,'org.sqlite'),
  SUITE_COMMUNICATIONS_DB_PATH:join(root,'messages.sqlite'),
  SUITE_ASSET_ROOT:join(root,'private-ui')
 };
}
const report=cfg=>validateWorkspaceStagingConfig(cfg);
const clients=cfg=>JSON.parse(cfg.SUITE_CLIENTS);
const withClients=(cfg,edit)=>{
 const list=clients(cfg);edit(list);return {...cfg,SUITE_CLIENTS:JSON.stringify(list)};
};
const fails=(cfg,key)=>{
 const result=report(cfg);
 assert.equal(result.ok,false);
 assert(result.errors.includes(key),'missing '+key+' in '+result.errors.join(', '));
};
test('offline preflight accepts only six explicit registered native clients and private paths',()=>{
 const cfg=fixture();
 assert.deepEqual(report(cfg),{ok:true,errors:[]});
 assert.deepEqual(NATIVE_APP_IDS,['goflo','eel','methpipe','mantrain','duckman','limsman']);
});
test('staging requires opt-in marker, broker mode, exact build and same-origin HTTPS issuer',()=>{
 for(const [key,value,reason] of [
  ['SUITE_STAGING_ACK','','synthetic_only_ack_required'],
  ['SUITE_MODE','static','broker_mode_required'],
  ['SUITE_BUILD_SHA','development','reviewed_git_sha_required'],
  ['SUITE_ORIGIN','http://staging-workspace.example.test','workspace_https_origin_required'],
  ['SUITE_ORIGIN','https://staging-workspace.example.test/','workspace_https_origin_required'],
  ['SUITE_ISSUER','https://unrelated.example.test','workspace_issuer_must_match_origin']
 ])fails({...fixture(),[key]:value},reason);
});
test('rejects missing, duplicated and additional client registrations',()=>{
 const base=fixture();
 fails({...base,SUITE_CLIENTS:'{}'},'exactly_six_native_clients_required');
 fails({...base,SUITE_CLIENTS:'invalid-json'},'exactly_six_native_clients_required');
 fails(withClients(base,list=>list.pop()),'exactly_six_native_clients_required');
 fails(withClients(base,list=>list[1].id=list[0].id),'invalid_native_client_registration');
 fails(withClients(base,list=>list[2].appId='foreign'),'invalid_native_client_registration');
});
test('requires per-app canonical HTTPS, independent hosts and exact native callbacks',()=>{
 const base=fixture();
 fails(withClients(base,list=>list[0].nativeOrigin='http://staging-goflo.example.test'),
  'distinct_native_https_origins_required');
 fails(withClients(base,list=>list[0].nativeOrigin=base.SUITE_ORIGIN),
  'distinct_native_https_origins_required');
 fails(withClients(base,list=>list[1].nativeOrigin=list[0].nativeOrigin),
  'distinct_native_https_origins_required');
 fails(withClients(base,list=>list[0].redirectUris.push('https://evil.example.test/auth/callback')),
  'exact_native_callback_required');
 fails(withClients(base,list=>list[0].redirectUris[0]='https://evil.example.test/auth/callback'),
  'exact_native_callback_required');
});
test('client secrets are present, private, unambiguous and not echoed into failures',()=>{
 const base=fixture();
 const bad=withClients(base,list=>list[0].secret='short');
 fails(bad,'unique_private_client_secrets_required');
 fails(withClients(base,list=>list[0].secret=list[1].secret),
  'unique_private_client_secrets_required');
 fails(withClients(base,list=>list[0].secret+='\\ninvalid'),
  'unique_private_client_secrets_required');
 assert.equal(JSON.stringify(report(bad)).includes('short'),false);
});
test('rejects public, relative, duplicated and symlinked-public paths',t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-stage-config-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const privateDir=join(root,'private'),publicDir=join(root,'docs');
 mkdirSync(privateDir);mkdirSync(publicDir);
 const base=fixture(privateDir);
 assert.equal(report(base).ok,true);
 fails({...base,SUITE_ASSET_ROOT:'./public-html'},'private_absolute_path_required');
 fails({...base,SUITE_ASSET_ROOT:join(publicDir,'ui')},'private_absolute_path_required');
 fails({...base,SUITE_AUTH_DB_PATH:base.SUITE_IDENTITY_DB_PATH},'private_paths_must_be_distinct');
 const link=join(privateDir,'safe-looking');
 symlinkSync(publicDir,link);
 fails({...base,SUITE_ASSET_ROOT:join(link,'ui')},'private_absolute_path_required');
});
test('synthetic-only staging cannot activate mailing, contact, alerts or Stripe handlers',()=>{
 const base=fixture();
 for(const [key,value] of [
  ['SUITE_RESEND_API_KEY','private-secret'],
  ['SUITE_INVITATION_FROM','mailer@example.test'],
  ['SUITE_STRIPE_TEST_KEY','sk_test_synthetic'],
  ['SUITE_STRIPE_LIVE_SECRET_KEY','sk_live_unsafe'],
  ['SUITE_CONTACT_ENABLED','true'],
  ['SUITE_OWNER_ALERTS_ENABLED','true'],
  ['SUITE_STRIPE_TEST_RECONCILE_ENABLED','true']
 ])fails({...base,[key]:value},'outbound_integrations_must_be_disabled');
});
test('CLI is read-only, does not reveal secret values and rejects group-readable config',t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-stage-cli-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const cfg=fixture(join(root,'private')),filename=join(root,'staging.json');
 mkdirSync(join(root,'private'));
 writeFileSync(filename,JSON.stringify(cfg),{mode:0o600});
 chmodSync(filename,0o600);
 const script=fileURLToPath(new URL('../staging-preflight.mjs',import.meta.url));
 const invoke=()=>spawnSync(process.execPath,[script,'--config',filename],{
  encoding:'utf8',timeout:10000
 });
 const pass=invoke();
 assert.equal(pass.status,0,pass.stderr);
 assert.match(pass.stdout,/PASS.*offline only/);
 assert.equal(existsSync(cfg.SUITE_AUTH_DB_PATH),false);
 assert.equal(existsSync(cfg.SUITE_ORGANIZATION_DB_PATH),false);
 assert.equal(pass.stdout.includes(clients(cfg)[0].secret),false);
 chmodSync(filename,0o644);
 const unsafe=invoke();
 if(process.platform!=='win32'){
  assert.equal(unsafe.status,1);
  assert.match(unsafe.stderr,/unreadable_or_unsafe_config/);
 }
 assert.equal(unsafe.stderr.includes(filename),false);
 assert.equal(unsafe.stderr.includes(clients(cfg)[0].secret),false);
});
