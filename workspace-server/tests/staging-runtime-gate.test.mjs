import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSuiteRuntime} from '../shared-auth/runtime.mjs';
import {NATIVE_APP_IDS} from '../staging-preflight.mjs';

function syntheticStaging(root){
 const workspace='https://staging-workspace.duckbio.net';
 const clients=NATIVE_APP_IDS.map(id=>({
  id,appId:id,secret:'synthetic-client-only-'+id+'-'.repeat(40),
  nativeOrigin:'https://staging-'+id+'.duckbio.net',
  redirectUris:['https://staging-'+id+'.duckbio.net/auth/callback']
 }));
 return {
  NODE_ENV:'production',
  SUITE_MODE:'broker',SUITE_STAGING_ACK:'synthetic-accounts-only',
  SUITE_ORIGIN:workspace,SUITE_ISSUER:workspace,
  SUITE_BUILD_SHA:'a'.repeat(40),SUITE_CLIENTS:JSON.stringify(clients),
  SUITE_AUTH_DB_PATH:join(root,'auth.sqlite'),
  SUITE_IDENTITY_DB_PATH:join(root,'identity.sqlite'),
  SUITE_ORGANIZATION_DB_PATH:join(root,'organizations.sqlite'),
  SUITE_COMMUNICATIONS_DB_PATH:join(root,'communications.sqlite'),
  SUITE_ASSET_ROOT:join(root,'private-ui')
 };
}

test('staging guard blocks invalid origin before touching any private database',{timeout:15000},t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-runtime-stage-block-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env=syntheticStaging(root);
 env.SUITE_ORIGIN='https://workspace.duckbio.net';
 assert.throws(()=>createSuiteRuntime({env}),/Unsafe synthetic staging configuration: workspace_https_origin_required/);
 for(const key of ['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
   'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH']){
  assert.equal(existsSync(env[key]),false,'no staging DB creation for '+key);
 }
});

test('staging guard also rejects disabled acknowledgement and outbound provider before database creation',t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-runtime-stage-safe-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const change of [
  {SUITE_STAGING_ACK:'wrong'},
  {SUITE_RESEND_API_KEY:'synthetic-should-not-send'},
  {SUITE_STRIPE_TEST_KEY:'sk_test_never_checkout'}
 ]){
  const env={...syntheticStaging(root),...change};
  assert.throws(()=>createSuiteRuntime({env}),/Unsafe synthetic staging configuration/);
  assert.equal(existsSync(env.SUITE_AUTH_DB_PATH),false);
  assert.equal(existsSync(env.SUITE_IDENTITY_DB_PATH),false);
  assert.equal(existsSync(env.SUITE_COMMUNICATIONS_DB_PATH),false);
 }
});

test('valid explicitly marked synthetic staging broker can initialize its own isolated stores',t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-runtime-stage-valid-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env=syntheticStaging(root);
 mkdirSync(env.SUITE_ASSET_ROOT);
 const runtime=createSuiteRuntime({env,fetchImpl:async()=>{
  throw Error('External network forbidden in isolated runtime test');
 }});
 try{
  for(const key of ['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
   'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH']){
   assert.equal(existsSync(env[key]),true,key+' created only after validation');
  }
  assert.equal(runtime.server.listening,false,'no staging listener or deployment');
 }finally{runtime.close();}
});

test('private SUITE_ENV_FILE staging values are checked before constructing the broker',t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-runtime-stage-file-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env=syntheticStaging(root);
 delete env.NODE_ENV;
 env.SUITE_ORIGIN='https://live.duckbio.net';
 const filename=join(root,'stage.json');
 writeFileSync(filename,JSON.stringify(env),{mode:0o600});
 assert.throws(()=>createSuiteRuntime({env:{NODE_ENV:'production',SUITE_ENV_FILE:filename}}),
  /Unsafe synthetic staging configuration/);
 assert.equal(existsSync(env.SUITE_AUTH_DB_PATH),false);
});
