/**
 * Synthetic lookup factory ABI tests. CI DOES NOT execute six private source
 * modules. Operator-only CLI imports them from clean pinned local checkouts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,chmodSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SIX_NATIVE_LOOKUP_MODULES,rehearseSixNativeLookupFactories,
 verifySixNativeLookupSources,auditSixGenuineNativeLookups}
 from '../six-native-ownership-lookup-interoperability.mjs';

const APPS=['goflo','eel','methpipe','mantrain','duckman','limsman'];
const expected={
 workspaceAccountId:'synthetic-workspace-account',
 workspaceOrganizationId:'synthetic-workspace-org-a',
 nativeUserId:'synthetic-native-user-a',
 nativeOrganizationId:'synthetic-native-org-a'
};
function sqliteFactory(id){
 return ({databasePath,workspaceOrganizationId,nativeOrganizationId,clock})=>
  async input=>{
   if(input?.appId!==id||
      input.workspaceOrganizationId!==workspaceOrganizationId||
      input.nativeOrganizationId!==nativeOrganizationId||
      !['inspect','bind','migrate'].includes(input.purpose))return null;
   const db=new DatabaseSync(databasePath,{readOnly:true});
   try{
    const row=db.prepare(`SELECT m.* FROM workspace_native_ownership m
     INNER JOIN accounts a ON a.id=m.native_user_id
     WHERE m.workspace_account_id=? AND m.workspace_organization_id=?
      AND m.native_user_id=? AND m.native_organization_id=?
      AND m.status='active' AND m.revoked_at_ms IS NULL
     LIMIT 2`).all(input.workspaceAccountId,
      input.workspaceOrganizationId,input.nativeUserId,
      input.nativeOrganizationId);
    if(row.length!==1)return null;
    const r=row[0];
    if(r.binding_revision<1||r.verified_at_ms<=0||
       r.verified_at_ms>clock()||r.valid_until_ms<=clock()||
       r.valid_until_ms-r.verified_at_ms>86400000)return null;
    const native=db.prepare(`SELECT COUNT(*) AS n FROM workspace_native_ownership
       WHERE native_user_id=? AND native_organization_id=?
       AND status='active' AND revoked_at_ms IS NULL`).get(
         input.nativeUserId,input.nativeOrganizationId);
    const central=db.prepare(`SELECT COUNT(*) AS n FROM workspace_native_ownership
      WHERE workspace_account_id=? AND workspace_organization_id=?
      AND status='active' AND revoked_at_ms IS NULL`).get(
        input.workspaceAccountId,input.workspaceOrganizationId);
    return native.n===1&&central.n===1?
      {active:true,ownershipVerified:true}:null;
   }finally{db.close()}
  };
}
function postgresFactory({pool,workspaceOrganizationId,nativeOrganizationId,clock}){
 return async input=>{
  if(input?.appId!=='eel'||
     input.workspaceOrganizationId!==workspaceOrganizationId||
     input.nativeOrganizationId!==nativeOrganizationId)return null;
  const client=await pool.connect();
  try{
   await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const r=await client.query('SELECT m.workspace_account_id FROM eln_workspace_native_ownership',
    [input.workspaceAccountId,input.workspaceOrganizationId,
     input.nativeUserId,input.nativeOrganizationId]);
   if(r.rows.length!==1)return null;
   const row=r.rows[0];
   if(row.valid_until.getTime()<=clock())return null;
   const a=await client.query('SELECT COUNT(*)::INTEGER AS total FROM eln_workspace_native_ownership WHERE native_user_id=$1');
   const b=await client.query('SELECT COUNT(*)::INTEGER AS total FROM eln_workspace_native_ownership WHERE workspace_account_id=$1');
   return a.rows[0].total===1&&b.rows[0].total===1?
    {active:true,ownershipVerified:true}:null;
  }finally{
   await client.query('ROLLBACK');
   client.release();
  }
 };
}
const factories=()=>new Map(APPS.map(id=>[
 id,id==='eel'?postgresFactory:sqliteFactory(id)
]));
const privateRoot=t=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-lookup-fixtures-'));
 chmodSync(dir,0o700);
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return dir;
};

test('six native app lookup entrypoints are uniquely pinned including DuckNote PostgreSQL',()=>{
 assert.deepEqual(SIX_NATIVE_LOOKUP_MODULES.map(x=>x.id),APPS);
 assert.equal(new Set(SIX_NATIVE_LOOKUP_MODULES.map(x=>x.factory)).size,6);
 for(const row of SIX_NATIVE_LOOKUP_MODULES)assert(Object.isFrozen(row));
 assert.equal(SIX_NATIVE_LOOKUP_MODULES.find(x=>x.id==='eel').file,
  'server/workspace-native-ownership-lookup.js');
});

test('five disposable SQLite stores and DuckNote query mock reject revoked, expired, deleted and ambiguous ownership',async()=>{
 const result=await rehearseSixNativeLookupFactories({factories:factories()});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.reason,'five_real_sqlite_stores_plus_one_mock_pg_query');
 assert.equal(result.deploymentAuthorized,false);
 assert.deepEqual(result.checks.map(x=>x.id),APPS);
});

test('missing native lookup and extra unreleased DataDuck cannot pass the strict matrix',async()=>{
 const one=factories();one.delete('goflo');
 assert.equal((await rehearseSixNativeLookupFactories({factories:one})).ok,false);
 const two=factories();two.set('dataduck',()=>{});
 assert.equal((await rehearseSixNativeLookupFactories({factories:two})).ok,false);
 assert.equal((await rehearseSixNativeLookupFactories({factories:new Map()})).ok,false);
 assert.equal((await rehearseSixNativeLookupFactories({factories:factories(),now:0})).ok,false);
});

test('wrong native implementation fails closed without continuing other apps',async()=>{
 const a=factories();a.set('goflo',()=>async()=>({active:true}));
 const result=await rehearseSixNativeLookupFactories({factories:a});
 assert.equal(result.ok,false);
 assert.equal(result.reason,'native_lookup_failed_goflo');
 assert.equal(result.checks.length,0);
});

test('all six actual private repo lookup sources are required before any module import',async t=>{
 const root=privateRoot(t);
 const absent=verifySixNativeLookupSources(root);
 assert.equal(absent.ok,false);
 assert.equal(absent.reason,'native_signer_source_unverified');
 assert.equal((await auditSixGenuineNativeLookups({sourcesRoot:root})).ok,false);
 chmodSync(root,0o755);
 assert.equal(verifySixNativeLookupSources(root).ok,false);
});

test('source audit fails before git if native checkout is substituted with symlink',t=>{
 const root=privateRoot(t);
 mkdirSync(join(root,'CytoDuck-real'),{mode:0o700});
 symlinkSync(join(root,'CytoDuck-real'),join(root,'CytoDuck'));
 let called=0;
 const check=verifySixNativeLookupSources(root,{
  runGit:()=>{called++;return ''}
 });
 assert.equal(check.ok,false);
 assert.equal(check.reason,'native_signer_source_unverified');
 assert.equal(called,0);
});

test('operator-only CLI never inspects checkouts without explicit opt-in',()=>{
 const script=fileURLToPath(new URL(
  '../six-native-ownership-lookup-interoperability.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,2);
 assert.match(r.stderr,/--confirm-offline-native-lookup-only/);
 assert.doesNotMatch(r.stdout,/PASS/);
});
