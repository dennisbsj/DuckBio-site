/**
 * Offline six-app authoritative native ownership LOOKUP verification.
 * Import the existing native lookup modules only from pinned private source.
 * Five ACTUAL SQLite lookup implementations run against disposable real SQLite
 * databases. DuckNote's ACTUAL PostgreSQL query implementation runs against an
 * explicit strict in-process fake pool (NOT a real Postgres service).
 *
 * No server route, tenant membership mutation, client credentials, network,
 * data export from private apps, or production access. No SSO grant.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,lstatSync,realpathSync}
 from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {SIX_NATIVE_SIGNER_CHECKOUTS,verifySixNativeSignerSources,
 rehearseSixNativeSignerFactories}
 from './six-native-signer-interoperability.mjs';
import {rehearseSixNativeOwnershipOverRealTls}
 from './six-native-real-https-rehearsal.mjs';

export const SIX_NATIVE_LOOKUP_MODULES=Object.freeze([
 Object.freeze({id:'goflo',file:'server/workspace-native-ownership-lookup.cjs',
  factory:'createCytoDuckAuthoritativeOwnershipLookup'}),
 Object.freeze({id:'eel',file:'server/workspace-native-ownership-lookup.js',
  factory:'createDuckNoteAuthoritativeOwnershipLookup'}),
 Object.freeze({id:'methpipe',file:'server/workspace-native-ownership-lookup.cjs',
  factory:'createDuckPipeAuthoritativeOwnershipLookup'}),
 Object.freeze({id:'mantrain',file:'server/workspace-native-ownership-lookup.cjs',
  factory:'createDuckTrainAuthoritativeOwnershipLookup'}),
 Object.freeze({id:'duckman',file:'server/workspace-native-ownership-lookup.cjs',
  factory:'createDuckManAuthoritativeOwnershipLookup'}),
 Object.freeze({id:'limsman',file:'server/workspace-native-ownership-lookup.cjs',
  factory:'createLabDuckAuthoritativeOwnershipLookup'})
]);
const NOW=1_800_000_000_000;
const ACCOUNT='synthetic-workspace-account';
const ORG='synthetic-workspace-org-a';
const USER='synthetic-native-user-a';
const NATIVE_ORG='synthetic-native-org-a';
const proof={active:true,ownershipVerified:true};
const result=(ok,reason,checks=[])=>Object.freeze({
 ok,reason,checks,deploymentAuthorized:false
});
const git=(dir,args)=>execFileSync('git',['-C',dir,...args],{
 encoding:'utf8',timeout:8000,maxBuffer:32768,
 stdio:['ignore','pipe','ignore']
}).trim();
const input=(id,purpose='inspect')=>({
 appId:id,purpose,workspaceAccountId:ACCOUNT,
 workspaceOrganizationId:ORG,nativeUserId:USER,
 nativeOrganizationId:NATIVE_ORG
});
const sameProof=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===2&&x.active===true&&
 x.ownershipVerified===true;

/** Ensure lookup sources, not just signers, are tracked unchanged by Git.
 * Caller must also run the complete six source/HEAD/remotes check first.
 */
export function verifySixNativeLookupSources(root,{runGit=git}={}){
 const first=verifySixNativeSignerSources(root,{runGit});
 if(!first.ok)return result(false,'native_signer_source_unverified');
 const checks=[];
 for(let i=0;i<SIX_NATIVE_LOOKUP_MODULES.length;i++){
  const row=SIX_NATIVE_LOOKUP_MODULES[i],repo=SIX_NATIVE_SIGNER_CHECKOUTS[i];
  if(row.id!==repo.id)return result(false,'native_app_matrix_mismatch');
  const dir=join(root,repo.repo),filename=join(dir,row.file);
  try{
   const stat=lstatSync(filename);
   if(!stat.isFile()||stat.isSymbolicLink()||
      realpathSync(filename)!==filename||
      !/^[a-f0-9]{40}$/.test(runGit(dir,['rev-parse','HEAD:'+row.file]))||
      runGit(dir,['rev-parse','HEAD:'+row.file])!==
       runGit(dir,['hash-object','--',row.file]))
    throw Error('not_pinned');
   checks.push({id:row.id,ok:true});
  }catch{return result(false,'unverified_'+row.id+'_native_lookup',checks)}
 }
 return result(true,'six_private_native_lookup_sources_pinned',checks);
}

// Real native SQLite lookup SQL runs inside independent, isolated temporary
// private accounts/ownership tables. No native customer DB or app DB is read.
function sqliteFixture(dir,id,factory,now){
 const filename=join(dir,'accounts.sqlite');
 const db=new DatabaseSync(filename);
 try{
  db.exec(`
   CREATE TABLE accounts (id TEXT PRIMARY KEY);
   CREATE TABLE workspace_native_ownership (
    workspace_account_id TEXT NOT NULL,
    workspace_organization_id TEXT NOT NULL,
    native_user_id TEXT NOT NULL,
    native_organization_id TEXT NOT NULL,
    binding_revision INTEGER NOT NULL,
    verified_at_ms INTEGER NOT NULL,
    valid_until_ms INTEGER NOT NULL,
    status TEXT NOT NULL,
    revoked_at_ms INTEGER
   );
  `);
  db.prepare('INSERT INTO accounts(id) VALUES(?)').run(USER);
  db.prepare(`INSERT INTO workspace_native_ownership
   (workspace_account_id,workspace_organization_id,native_user_id,
    native_organization_id,binding_revision,verified_at_ms,valid_until_ms,
    status,revoked_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(
      ACCOUNT,ORG,USER,NATIVE_ORG,1,now-1000,now+60000,'active',null
    );
 }finally{db.close()}
 chmodSync(filename,0o600);
 const lookup=factory({
  databasePath:filename,workspaceOrganizationId:ORG,
  nativeOrganizationId:NATIVE_ORG,clock:()=>now
 });
 const write=sql=>{const db=new DatabaseSync(filename);try{db.exec(sql)}
  finally{db.close()}};
 return {
  lookup,
  revoke:()=>write("UPDATE workspace_native_ownership SET status='revoked',revoked_at_ms="+now),
  restore:()=>write("UPDATE workspace_native_ownership SET status='active',revoked_at_ms=NULL"),
  expire:()=>write("UPDATE workspace_native_ownership SET valid_until_ms="+(now-1)),
  unexpire:()=>write("UPDATE workspace_native_ownership SET valid_until_ms="+(now+60000)),
  removeAccount:()=>write("DELETE FROM accounts WHERE id='"+USER+"'"),
  restoreAccount:()=>write("INSERT INTO accounts(id) VALUES('"+USER+"')"),
  duplicate:()=>write(`INSERT INTO workspace_native_ownership
    SELECT 'synthetic-other-workspace-account',workspace_organization_id,
     native_user_id,native_organization_id,binding_revision,verified_at_ms,
     valid_until_ms,status,revoked_at_ms FROM workspace_native_ownership`),
  unduplicate:()=>write("DELETE FROM workspace_native_ownership WHERE workspace_account_id='synthetic-other-workspace-account'")
 };
}

/** A strict DuckNote PostgreSQL QUERY simulator, NOT an actual Postgres DB.
 * DuckNote's exported real SQL and mapping checks still run, but schema and
 * native account status must later be proven against a real staging Postgres.
 */
function duckNoteFixture(id,factory,now){
 let state={status:'active',expired:false,account:true,duplicate:false};
 let starts=0,finishes=0;
 const pool={async connect(){
  let started=false;
  return {
   async query(sql,values){
    if(sql==='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'){
     started=true;starts++;return {rows:[]};
    }
    if(sql==='ROLLBACK'){if(started){finishes++;started=false}
     return {rows:[]}}
    if(!started||!sql.includes('eln_workspace_native_ownership'))
     throw Error('unexpected_synthetic_pg_query');
    if(sql.includes('SELECT m.workspace_account_id')){
     if(!state.account||state.status!=='active'||!Array.isArray(values)||
        values.join('|')!==[ACCOUNT,ORG,USER,NATIVE_ORG].join('|'))
      return {rows:[]};
     return {rows:[{
      workspace_account_id:ACCOUNT,workspace_organization_id:ORG,
      native_user_id:USER,native_organization_id:NATIVE_ORG,
      binding_revision:1,
      verified_at:new Date(now-1000),
      valid_until:new Date(state.expired?now-1:now+60000),
      existing_user_id:USER,existing_organization_id:NATIVE_ORG,
      member_user_id:USER
     }]};
    }
    if(sql.includes('SELECT COUNT(*)::INTEGER AS total')){
     if(sql.includes('WHERE native_user_id=')||
        sql.includes('WHERE workspace_account_id='))
      return {rows:[{total:state.duplicate?2:1}]};
    }
    throw Error('unexpected_synthetic_pg_query');
   },
   release(){if(started)throw Error('unclosed_synthetic_pg_transaction')}
  };
 }};
 const lookup=factory({
  pool,workspaceOrganizationId:ORG,nativeOrganizationId:NATIVE_ORG,
  clock:()=>now
 });
 return {
  lookup,
  revoke:()=>{state.status='revoked'},
  restore:()=>{state.status='active'},
  expire:()=>{state.expired=true},
  unexpire:()=>{state.expired=false},
  removeAccount:()=>{state.account=false},
  restoreAccount:()=>{state.account=true},
  duplicate:()=>{state.duplicate=true},
  unduplicate:()=>{state.duplicate=false},
  transactions:()=>({starts,finishes})
 };
}

/**
 * Test real or synthetic INJECTED native lookup factory exports against
 * synthetic isolated native data. A positive lookup is NOT native permission
 * and MUST NOT become central SSO authority.
 */
export async function rehearseSixNativeLookupFactories({
 factories,onVerifiedLookups=null,now=NOW
}={}){
 if(!(factories instanceof Map)||factories.size!==6||
    !Number.isSafeInteger(now)||now<=0||
    (onVerifiedLookups!==null&&typeof onVerifiedLookups!=='function'))
  return result(false,'invalid_native_lookup_matrix');
 const root=mkdtempSync(join(tmpdir(),'duckbio-six-native-lookups-'));
 chmodSync(root,0o700);
 const checks=[],lookups=new Map(),syntheticControls=new Map();
 try{
  for(const row of SIX_NATIVE_LOOKUP_MODULES){
   const factory=factories.get(row.id);
   if(typeof factory!=='function')return result(false,
     'missing_'+row.id+'_native_lookup',checks);
   let fixture;
   try{
    if(row.id==='eel')fixture=duckNoteFixture(row.id,factory,now);
    else{
     const dir=join(root,row.id);
     mkdirSync(dir,{mode:0o700});
     fixture=sqliteFixture(dir,row.id,factory,now);
    }
    if(typeof fixture.lookup!=='function')
     throw Error('invalid_lookup');
   }catch{return result(false,'invalid_'+row.id+'_native_lookup',checks)}
   lookups.set(row.id,fixture.lookup);
   // Controls only disposable native DBs while the TLS rehearsal is active.
   syntheticControls.set(row.id,Object.freeze({
    revoke:fixture.revoke,restore:fixture.restore,
    expire:fixture.expire,unexpire:fixture.unexpire,
    removeAccount:fixture.removeAccount,restoreAccount:fixture.restoreAccount,
    duplicate:fixture.duplicate,unduplicate:fixture.unduplicate
   }));
   try{
    for(const purpose of ['inspect','bind','migrate']){
     if(!sameProof(await fixture.lookup(input(row.id,purpose))))
      throw Error('verified_native_lookup_failed');
    }
    for(const bad of [
     {workspaceAccountId:'synthetic-other-account'},
     {workspaceOrganizationId:'synthetic-other-org'},
     {nativeUserId:'synthetic-other-native-user'},
     {nativeOrganizationId:'synthetic-other-native-org'}
    ]){
     if(await fixture.lookup({...input(row.id),...bad})!==null)
      throw Error('wrong_native_tuple_accepted');
    }
    fixture.revoke();
    if(await fixture.lookup(input(row.id))!==null)
     throw Error('revoked_native_binding_accepted');
    fixture.restore();
    fixture.expire();
    if(await fixture.lookup(input(row.id))!==null)
     throw Error('expired_native_binding_accepted');
    fixture.unexpire();
    fixture.removeAccount();
    if(await fixture.lookup(input(row.id))!==null)
     throw Error('deleted_native_account_accepted');
    fixture.restoreAccount();
    fixture.duplicate();
    if(await fixture.lookup(input(row.id))!==null)
     throw Error('ambiguous_native_binding_accepted');
    fixture.unduplicate();
    if(!sameProof(await fixture.lookup(input(row.id))))
     throw Error('native_restoration_unverified');
    if(fixture.transactions){
     const stats=fixture.transactions();
     if(stats.starts===0||stats.starts!==stats.finishes)
      throw Error('postgres_readonly_transaction_leak');
    }
    checks.push({id:row.id,ok:true});
   }catch{return result(false,'native_lookup_failed_'+row.id,checks)}
  }
  // Before disposable databases are destroyed, optionally connect the
  // genuinely imported lookup implementations to the six native signers
  // and the central Workspace Ed25519 verifier, in the SAME offline flow.
  if(onVerifiedLookups){
   let linked;
   try{linked=await onVerifiedLookups(lookups,syntheticControls)}
   catch{return result(false,'signed_native_lookup_chain_failed',checks)}
   if(!linked||linked.ok!==true||linked.deploymentAuthorized!==false||
      !Array.isArray(linked.checks)||linked.checks.length!==6)
    return result(false,'signed_native_lookup_chain_failed',checks);
  }
  const done=result(true,'five_real_sqlite_stores_plus_one_mock_pg_query',checks);
  return Object.freeze({...done,
   signedNativeChainChecked:onVerifiedLookups!==null});
 }finally{rmSync(root,{recursive:true,force:true})}
}

/** Operators with all SIX reviewed private native repo clones may invoke
 * this explicitly; no automatic cloning, Git remote access or token export.
 */
export async function auditSixGenuineNativeLookups({sourcesRoot,realTls=false}={}){
 if(typeof realTls!=='boolean')return result(false,'invalid_offline_transport_mode');
 const before=verifySixNativeLookupSources(sourcesRoot);
 if(!before.ok)return before;
 let factories,signerFactories;
 try{
  factories=new Map();signerFactories=new Map();
  for(let i=0;i<SIX_NATIVE_LOOKUP_MODULES.length;i++){
   const row=SIX_NATIVE_LOOKUP_MODULES[i];
   const repo=SIX_NATIVE_SIGNER_CHECKOUTS[i];
   const module=await import(pathToFileURL(join(
     sourcesRoot,repo.repo,row.file)).href);
   const factory=module[row.factory]??module.default?.[row.factory];
   if(typeof factory!=='function')
    return result(false,'missing_'+row.id+'_native_lookup_export');
   factories.set(row.id,factory);
   const signerModule=await import(pathToFileURL(join(
     sourcesRoot,repo.repo,repo.file)).href);
   const signerFactory=signerModule[repo.factory]??
    signerModule.default?.[repo.factory];
   if(typeof signerFactory!=='function')
    return result(false,'missing_'+row.id+'_native_signer_export');
   signerFactories.set(row.id,signerFactory);
  }
 }catch{return result(false,'native_lookup_import_failed')}
 const output=await rehearseSixNativeLookupFactories({
  factories,
  onVerifiedLookups:(lookups,controls)=>realTls?
   rehearseSixNativeOwnershipOverRealTls({
    signerFactories,nativeLookups:lookups,syntheticControls:controls
   }):
   rehearseSixNativeSignerFactories({
    factories:signerFactories,nativeLookups:lookups
   })
 });
 if(!output.ok)return output;
 const after=verifySixNativeLookupSources(sourcesRoot);
 if(!after.ok)return result(false,'native_lookup_sources_changed');
 return Object.freeze({...output,
  reason:realTls?
   'six_genuine_native_modules_real_loopback_tls_verified':
   'six_real_native_signer_and_lookup_chain_offline_verified',
  sourcesPinned:true,deploymentAuthorized:false});
}

if(process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 const tls=args.length===3&&
  args[2]==='--confirm-offline-six-native-real-https-only';
 if(args.length!==3||args[0]!=='--sources-root'||
    (!tls&&args[2]!=='--confirm-offline-native-lookup-only')){
  console.error('Usage: node six-native-ownership-lookup-interoperability.mjs --sources-root PRIVATE_SIX_NATIVE_REPO_ROOT (--confirm-offline-native-lookup-only | --confirm-offline-six-native-real-https-only)');
  process.exitCode=2;
 }else{
  const output=await auditSixGenuineNativeLookups({sourcesRoot:args[1],realTls:tls});
  for(const row of output.checks??[])
   console.log((row.ok?'PASS ':'FAIL ')+row.id);
  if(!output.ok){
   console.error('BLOCKED offline native lookup: '+output.reason);
   process.exitCode=1;
  }else console.log(tls?
   'PASS six pinned real native lookup+signer modules using disposable native records and six real loopback HTTPS/TLS endpoints; no active native app, live SSO, genuine Postgres, or deployment':
   'PASS six real native signer+lookup modules against Workspace Ed25519 with synthetic data; five real SQLite DBs, one mocked DuckNote PostgreSQL query; NO native service, live SSO or deployment');
 }
}
