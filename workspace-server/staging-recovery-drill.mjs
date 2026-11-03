// Disposable Workspace recovery drill: real synthetic HTTP account flow,
// four private SQLite files, stopped-process backup and restored login.
// NEVER reads an existing staging/production database or contacts any DNS name.
// A green drill is not a validated live backup/restore procedure.
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,chmodSync,copyFileSync,readFileSync,
 writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSuiteRuntime} from './shared-auth/runtime.mjs';
import {createOrganizationStore} from './organization-store.mjs';
import {writeSyntheticStagingConfig} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';

const DB_NAMES=Object.freeze([
 'auth.sqlite','identity.sqlite','organizations.sqlite','communications.sqlite'
]);
const buildSha='a'.repeat(40);
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const privateDirectory=dir=>{mkdirSync(dir,{mode:0o700});chmodSync(dir,0o700)};
const dummyAssets=root=>{
 const target=join(root,'private-ui');
 privateDirectory(target);
 writeFileSync(join(target,'index.html'),'<h1>Disposable synthetic recovery test only</h1>',
  {flag:'wx',mode:0o600});
};
const offlineFetch=async()=>{throw Error('external_network_forbidden')};

async function launch(configPath){
 const runtime=createSuiteRuntime({
  env:{NODE_ENV:'production',SUITE_ENV_FILE:configPath},
  fetchImpl:offlineFetch
 });
 try{await new Promise((accept,reject)=>{
  runtime.server.once('error',reject);
  runtime.server.listen(0,'127.0.0.1',accept);
 })}catch(error){runtime.close();throw error}
 const port=runtime.server.address().port;
 return {
  port,
  async close(){
   runtime.server.closeAllConnections?.();
   await new Promise((accept,reject)=>
    runtime.server.close(error=>error?reject(error):accept()));
   runtime.close();
  }
 };
}

function browser(port,origin){
 const cookies=new Map();
 let csrf;
 async function call(path,body){
  const method=body===undefined?'GET':'POST';
  const raw=body===undefined?null:JSON.stringify(body);
  const headers={
   Host:new URL(origin).host,
   ...(cookies.size?{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}:{}),
   ...(raw===null?{}:{Origin:origin,'Content-Type':'application/json',
    ...(csrf?{'X-CSRF-Token':csrf}:{})})
  };
  const result=await new Promise((accept,reject)=>{
   const req=http.request({hostname:'127.0.0.1',port,path,method,headers},res=>{
    const chunks=[];
    res.on('data',chunk=>chunks.push(chunk));
    res.on('end',()=>{
     let value;
     try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
     catch{value=null}
     accept({status:res.statusCode,headers:res.headers,body:value});
    });
   });
   req.once('error',reject);req.end(raw===null?undefined:raw);
  });
  for(const cookie of result.headers['set-cookie']||[]){
   const piece=cookie.split(';')[0];
   const index=piece.indexOf('=');
   if(index<1)continue;
   const name=piece.slice(0,index),value=piece.slice(index+1);
   if(value)cookies.set(name,value);
   else cookies.delete(name);
  }
  return result;
 }
 return {
  call,
  async preflight(){
   const session=await call('/api/suite/auth/session');
   assert.equal(session.status,200);
   assert.equal(typeof session.body?.csrfToken,'string');
   csrf=session.body.csrfToken;
   return session.body;
  }
 };
}

function verifyClosedSQLite(file){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const result=db.prepare('PRAGMA quick_check').all();
  assert.equal(result.length,1);
  assert.equal(result[0].quick_check,'ok');
 }finally{db.close()}
}

function copyClosedStores(source,destination){
 const checks=[];
 for(const filename of DB_NAMES){
  const from=join(source,filename),to=join(destination,filename);
  verifyClosedSQLite(from);
  copyFileSync(from,to);
  chmodSync(to,0o600);
  assert.equal(sha(from),sha(to),'binary snapshot mismatch');
  verifyClosedSQLite(to);
  checks.push(filename);
 }
 return checks;
}

export async function runDisposableWorkspaceRecoveryDrill(){
 const temp=mkdtempSync(join(tmpdir(),'duckbio-disposable-recovery-'));
 chmodSync(temp,0o700);
 const original=join(temp,'original'),backup=join(temp,'backup'),
  restored=join(temp,'restored');
 for(const dir of [original,backup,restored])privateDirectory(dir);
 let running=null;
 try{
  const file=writeSyntheticStagingConfig({
   baseDomain:'duckbio.net',privateRoot:original,buildSha
  }).filename;
  const cfg=readPrivateConfiguration(file);
  assert.deepEqual(validateWorkspaceStagingConfig(cfg),{ok:true,errors:[]});
  dummyAssets(original);
  const password='Synthetic recovery passphrase '+randomBytes(28).toString('base64url');
  const origin=cfg.SUITE_ORIGIN;
  running=await launch(file);
  const initial=browser(running.port,origin);
  const health=await initial.call('/api/suite/health');
  assert.equal(health.status,200);
  assert.deepEqual({
   mode:health.body?.mode,buildVersion:health.body?.buildVersion,
   configured:health.body?.configured
  },{mode:'local',buildVersion:buildSha,configured:false});
  await initial.preflight();
  const setup=await initial.call('/api/suite/setup',{
   setupToken:cfg.SUITE_SETUP_TOKEN,
   email:'recovery-owner@example.test',displayName:'Synthetic Recovery Owner',
   password
  });
  assert.equal(setup.status,201);
  const ownerId=setup.body?.user?.id;
  assert.equal(typeof ownerId,'string');
  const after=await initial.call('/api/suite/health');
  assert.equal(after.body?.configured,true);
  const account=await initial.call('/api/suite/account');
  assert.equal(account.status,200);
  assert.equal(account.body?.user?.id,ownerId);
  assert.deepEqual(account.body?.apps?.filter(x=>x.enabled),[],
   'creating a test owner must never grant an app seat');
  await running.close();running=null;

  // Operator-only synthetic organization setup AFTER a clean shutdown.
  const org=createOrganizationStore({databasePath:cfg.SUITE_ORGANIZATION_DB_PATH});
  try{
   org.setupOrganization({organizationId:'synthetic-lab',name:'Recovery Test Lab',
    owner:{accountId:ownerId,name:'Synthetic Owner',nickname:'Owner',
     email:'recovery-owner@example.test'}});
  }finally{org.close()}

  // This deliberately copies only CLOSED synthetic databases. Running SQLite
  // WAL databases require a separate transactional backup implementation.
  assert.equal(copyClosedStores(original,backup).length,4);
  assert.equal(copyClosedStores(backup,restored).length,4);
  dummyAssets(restored);
  const restoredConfig={...cfg};
  for(const key of ['SUITE_AUTH_DB_PATH','SUITE_IDENTITY_DB_PATH',
    'SUITE_ORGANIZATION_DB_PATH','SUITE_COMMUNICATIONS_DB_PATH',
    'SUITE_ASSET_ROOT']){
   assert.ok(restoredConfig[key].startsWith(original+'/'));
   restoredConfig[key]=restored+restoredConfig[key].slice(original.length);
  }
  assert.deepEqual(validateWorkspaceStagingConfig(restoredConfig),
   {ok:true,errors:[]});
  const restoredFile=join(restored,'workspace-staging.json');
  writeFileSync(restoredFile,JSON.stringify(restoredConfig),{
   flag:'wx',mode:0o600
  });
  running=await launch(restoredFile);
  const restoredBrowser=browser(running.port,origin);
  const restoredHealth=await restoredBrowser.call('/api/suite/health');
  assert.equal(restoredHealth.status,200);
  assert.equal(restoredHealth.body?.configured,true);
  assert.equal(restoredHealth.body?.buildVersion,buildSha);
  await restoredBrowser.preflight();
  const login=await restoredBrowser.call('/api/suite/account/login',{
   email:'recovery-owner@example.test',password
  });
  assert.equal(login.status,200);
  assert.equal(login.body?.user?.id,ownerId,
   'authenticated owner must survive offline SQLite restore');
  const organizations=await restoredBrowser.call('/api/suite/organizations');
  assert.equal(organizations.status,200);
  assert.deepEqual(organizations.body?.organizations?.map(x=>x.id),
   ['synthetic-lab']);
  const appAccess=await restoredBrowser.call('/api/suite/account');
  assert.equal(appAccess.status,200);
  assert.deepEqual(appAccess.body?.apps?.filter(x=>x.enabled),[]);
  return Object.freeze({
   ok:true,checks:Object.freeze([
    'private_config','fresh_health','first_admin_no_app_grants',
    'stopped_sqlite_snapshot_integrity','restored_health',
    'restored_owner_login','restored_organization_isolation'
   ])
  });
 }finally{
  if(running)await running.close();
  rmSync(temp,{recursive:true,force:true});
 }
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 if(process.argv.length!==3||process.argv[2]!=='--confirm-disposable-only'){
  console.error('Usage: node staging-recovery-drill.mjs --confirm-disposable-only');
  process.exitCode=2;
 }else try{
  const report=await runDisposableWorkspaceRecoveryDrill();
  if(!report.ok)throw Error('unexpected_drill_failure');
  console.log('PASS disposable Workspace recovery drill (synthetic only; not a live backup)');
 }catch{
  console.error('FAIL disposable Workspace recovery drill (synthetic only; no live files touched)');
  process.exitCode=1;
 }
}
