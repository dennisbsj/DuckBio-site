/**
 * Synthetic lookup factory ABI tests. CI DOES NOT execute six private source
 * modules. Operator-only CLI imports them from clean pinned local checkouts.
 */
import test from 'node:test';
import {createPrivateKey,sign} from 'node:crypto';
import {createServer as httpsServer} from 'node:https';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,chmodSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';
import {rehearseSixNativeSignerFactories}
 from '../six-native-signer-interoperability.mjs';
import {rehearseSixNativeOwnershipOverRealTls}
 from '../six-native-real-https-rehearsal.mjs';
import {rehearseSixNativeMtlSidecars}
 from '../six-native-mtls-sidecar-rehearsal.mjs';
import {SIX_NATIVE_LOOKUP_MODULES,SIX_NATIVE_MTLS_SIDECAR_MODULES,rehearseSixNativeLookupFactories,
 verifySixNativeMtlSidecarSources,
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

function nativeSignerFactories(){
 return new Map(APPS.map(id=>[id,
  ({privateKeyPem,keyId,lookupOwnership,clock})=>{
   const key=createPrivateKey(privateKeyPem);
   return {async prove(body){
    if(!body||body.appId!==id||
       body.version!=='duckbio.native-ownership.v1'||
       !['inspect','bind','migrate'].includes(body.purpose))return null;
    const trusted=await lookupOwnership({
     appId:id,workspaceAccountId:body.workspaceAccountId,
     workspaceOrganizationId:body.workspaceOrganizationId,
     nativeUserId:body.nativeUserId,nativeOrganizationId:body.nativeOrganizationId,
     purpose:body.purpose
    });
    if(trusted?.active!==true||trusted.ownershipVerified!==true)return null;
    const payload={...body,keyId,issuedAt:clock(),expiresAt:clock()+15000,
     active:true,ownershipVerified:true};
    return {payload,signature:sign(null,
     canonicalNativeOwnershipProofBytes(payload),key).toString('base64url')};
   }};
  }
 ]));
}

test('same offline chain verifies six native datastore lookups -> signer -> Workspace Ed25519, no access granted',async()=>{
 let signed=null;
 const output=await rehearseSixNativeLookupFactories({
  factories:factories(),
  onVerifiedLookups:async lookups=>{
   signed=await rehearseSixNativeSignerFactories({
    factories:nativeSignerFactories(),nativeLookups:lookups
   });
   return signed;
  }
 });
 assert.equal(output.ok,true,JSON.stringify(output));
 assert.equal(output.signedNativeChainChecked,true);
 assert.equal(output.deploymentAuthorized,false);
 assert.equal(signed.ok,true,JSON.stringify(signed));
 assert.equal(signed.deploymentAuthorized,false);
 assert.deepEqual(signed.checks.map(x=>x.id),APPS);
});

test('broken signed native chain prevents any positive offline conclusion',async()=>{
 const result=await rehearseSixNativeLookupFactories({
  factories:factories(),
  onVerifiedLookups:async lookups=>{
   const fake=nativeSignerFactories();
   fake.delete('eel');
   return rehearseSixNativeSignerFactories({
    factories:fake,nativeLookups:lookups
   });
  }
 });
 assert.equal(result.ok,false);
 assert.equal(result.reason,'signed_native_lookup_chain_failed');
 assert.equal(result.deploymentAuthorized,false);
});

test('six independent real local HTTPS/TLS native services validate Ed25519 plus owned native storage and deny abuse',async()=>{
 let witness=null;
 const result=await rehearseSixNativeLookupFactories({
  factories:factories(),
  onVerifiedLookups:async(lookups,controls)=>{
   witness=await rehearseSixNativeOwnershipOverRealTls({
    signerFactories:nativeSignerFactories(),
    nativeLookups:lookups,syntheticControls:controls
   });
   return witness;
  }
 });
 assert.equal(result.ok,true,JSON.stringify({result,witness}));
 assert.equal(result.signedNativeChainChecked,true);
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(witness.ok,true,JSON.stringify(witness));
 assert.equal(witness.deploymentAuthorized,false);
 assert.equal(witness.category,'six-real-loopback-https-native-owned-only');
 assert.deepEqual(witness.checks.map(x=>x.id),APPS);
});

test('real TLS integration refuses missing app/mapping controls or unsupported clock without opening any service',async()=>{
 const signer=nativeSignerFactories();
 const denied=await rehearseSixNativeOwnershipOverRealTls({
  signerFactories:signer,nativeLookups:new Map(),syntheticControls:new Map()
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.reason,'invalid_six_native_tls_fixture');
 assert.equal(denied.deploymentAuthorized,false);
 const badClock=await rehearseSixNativeOwnershipOverRealTls({
  signerFactories:signer,nativeLookups:new Map(),syntheticControls:new Map(),now:0
 });
 assert.equal(badClock.ok,false);
});

// Synthetic sidecar factories for public CI. The operator-only CLI loads
// the genuine six native sidecars from their exact private Git commits.
function syntheticSidecarFactories(){
 return new Map(APPS.map(id=>[id,({
  keyPem,certPem,clientCaPem,clientFingerprint256,bearerToken,
  expectedHostname,signer
 })=>{
  const used=new Set();
  const server=httpsServer({
   key:keyPem,cert:certPem,ca:clientCaPem,
   requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3'
  },async(req,res)=>{
   const reject=(status=403)=>{res.writeHead(status,{
    'content-type':'application/json','cache-control':'no-store'
   });res.end(JSON.stringify({error:'denied'}))};
   if(String(req.headers.host||'').split(':')[0]!==expectedHostname||
      req.socket.servername!==expectedHostname)return reject(421);
   if(req.method!=='POST'||req.url!=='/private/v1/native-ownership')
    return reject(404);
   if(!req.socket.authorized||
      req.socket.getPeerCertificate().fingerprint256!==clientFingerprint256||
      req.headers.authorization!=='Bearer '+bearerToken)
    return reject(401);
   try{
    const chunks=[];let bytes=0;
    for await(const chunk of req){
     bytes+=chunk.byteLength;
     if(bytes>2048)return reject(413);
     chunks.push(chunk);
    }
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(body.appId!==id||body.version!=='duckbio.native-ownership.v1'||
       typeof body.nonce!=='string'||body.nonce.length!==43)
     return reject(400);
    if(used.has(body.nonce))return reject(409);
    used.add(body.nonce);
    const envelope=await signer.prove(body);
    if(!envelope)return reject(403);
    res.writeHead(200,{'content-type':'application/json',
     'cache-control':'no-store'});
    res.end(JSON.stringify(envelope));
   }catch{return reject(400)}
  });
  const originalListen=server.listen.bind(server);
  server.listen=function(port,host,...rest){
   if(host!=='127.0.0.1')throw Error('private_mtls_loopback_only');
   return originalListen(port,host,...rest);
  };
  return server;
 }]));
}

test('six distinct real mutual TLS listeners validate Workspace client certificate, bearer and native signed ownership',async()=>{
 let attestation=null;
 const result=await rehearseSixNativeLookupFactories({
  factories:factories(),
  onVerifiedLookups:async(lookups,controls)=>{
   attestation=await rehearseSixNativeMtlSidecars({
    sidecarFactories:syntheticSidecarFactories(),
    signerFactories:nativeSignerFactories(),
    nativeLookups:lookups,syntheticControls:controls
   });
   return attestation;
  }
 });
 assert.equal(result.ok,true,JSON.stringify({result,attestation}));
 assert.equal(result.deploymentAuthorized,false);
 assert.equal(attestation.ok,true,JSON.stringify(attestation));
 assert.equal(attestation.category,
  'six-real-loopback-mutual-tls-native-sidecars-only');
 assert.equal(attestation.separateAppTlsIdentitiesVerified,true,
  'every native app must have a distinct server CA and Workspace client certificate');
 assert.equal(attestation.deploymentAuthorized,false);
 assert.deepEqual(attestation.checks.map(x=>x.id),APPS);
});

test('native mTLS sidecar matrix cannot promote absent clients and requires actual private source provenance',async t=>{
 assert.deepEqual(SIX_NATIVE_MTLS_SIDECAR_MODULES.map(x=>x.id),APPS);
 for(const row of SIX_NATIVE_MTLS_SIDECAR_MODULES){
  assert(Object.isFrozen(row));
  assert.match(row.file,/^server\/workspace-native-ownership-https\.(?:js|cjs)$/);
 }
 const root=privateRoot(t);
 assert.equal(verifySixNativeMtlSidecarSources(root).ok,false);
 const wrong=await rehearseSixNativeMtlSidecars({
  sidecarFactories:new Map(),signerFactories:nativeSignerFactories(),
  nativeLookups:new Map(),syntheticControls:new Map()
 });
 assert.equal(wrong.ok,false);
 assert.equal(wrong.reason,'invalid_six_native_mtls_fixture');
 assert.equal(wrong.deploymentAuthorized,false);
});
