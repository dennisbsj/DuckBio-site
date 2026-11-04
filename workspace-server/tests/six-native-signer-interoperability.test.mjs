// Public CI uses *synthetic* signer factories. Only the opt-in operator
// CLI imports the six true, private, commit-pinned native implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey,sign } from 'node:crypto';
import { mkdtempSync, rmSync,chmodSync,mkdirSync,symlinkSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';
import {SIX_NATIVE_SIGNER_CHECKOUTS,rehearseSixNativeSignerFactories,
 verifySixNativeSignerSources,auditSixGenuineNativeSignerInterop}
 from '../six-native-signer-interoperability.mjs';

const pinned=SIX_NATIVE_SIGNER_CHECKOUTS;
function factory(id,{wrongApp=false,badSignature=false}={}){
 return ({privateKeyPem,keyId,lookupOwnership,clock})=>{
  const key=createPrivateKey(privateKeyPem);
  return {async prove(body){
   if(body?.version!=='duckbio.native-ownership.v1'||
      body.appId!==(wrongApp?'other-app':id)||
      !['inspect','bind','migrate'].includes(body.purpose)||
      Object.keys(body).length!==8||body.nonce?.length!==43)return null;
   const outcome=await lookupOwnership({
    appId:body.appId,workspaceAccountId:body.workspaceAccountId,
    workspaceOrganizationId:body.workspaceOrganizationId,
    nativeUserId:body.nativeUserId,nativeOrganizationId:body.nativeOrganizationId,
    purpose:body.purpose
   });
   if(outcome?.active!==true||outcome.ownershipVerified!==true)return null;
   const payload={...body,keyId,issuedAt:clock(),expiresAt:clock()+15000,
    active:true,ownershipVerified:true};
   return {payload,signature:badSignature?'A'.repeat(86):
    sign(null,canonicalNativeOwnershipProofBytes(payload),key).toString('base64url')};
  }};
 };
}
const factories=changes=>new Map(pinned.map(row=>[
 row.id,factory(row.id,changes?.[row.id])
]));
function tempRoot(t){
 const root=mkdtempSync(join(tmpdir(),'duckbio-signer-source-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}

test('six exact private source/commit pins, never DataDuck',()=>{
 assert.deepEqual(pinned.map(x=>x.id),['goflo','eel','methpipe',
  'mantrain','duckman','limsman']);
 assert.equal(new Set(pinned.map(x=>x.repo)).size,6);
 for(const row of pinned){
  assert.match(row.sha,/^[a-f0-9]{40}$/);
  assert.match(row.file,/^server\/workspace-native-ownership\.(?:js|cjs)$/);
  assert(Object.isFrozen(row));
 }
});

test('synthetic six-native signer ABI agrees with Workspace Ed25519 verifier on positive and negative flows',async()=>{
 const result=await rehearseSixNativeSignerFactories({factories:factories()});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.deploymentAuthorized,false);
 assert.deepEqual(result.checks.map(x=>x.id),pinned.map(x=>x.id));
 assert(result.networkRequests>=60);
});

test('a malformed signer for any app denies without promotion or app fallback',async()=>{
 const a=await rehearseSixNativeSignerFactories({
  factories:factories({eel:{wrongApp:true}})
 });
 assert.equal(a.ok,false);
 assert.equal(a.reason,'interop_failed_eel');
 assert.deepEqual(a.checks.map(x=>x.id),['goflo']);
 const b=await rehearseSixNativeSignerFactories({
  factories:factories({goflo:{badSignature:true}})
 });
 assert.equal(b.ok,false);
 assert.equal(b.reason,'interop_failed_goflo');
 assert.equal(b.deploymentAuthorized,false);
});

test('missing or extra native modules, unknown clock and no factories fail closed',async()=>{
 const missing=factories();missing.delete('eel');
 assert.equal((await rehearseSixNativeSignerFactories({factories:missing})).ok,false);
 const extra=factories();extra.set('dataduck',()=>({prove(){}}));
 assert.equal((await rehearseSixNativeSignerFactories({factories:extra})).ok,false);
 assert.equal((await rehearseSixNativeSignerFactories({factories:new Map()})).ok,false);
 assert.equal((await rehearseSixNativeSignerFactories({factories:factories(),now:0})).ok,false);
});

test('no native private checkout cannot be mistaken for genuine source integration',async t=>{
 const root=tempRoot(t);
 assert.equal(verifySixNativeSignerSources(root).reason,
  'unverified_goflo_native_source');
 assert.equal((await auditSixGenuineNativeSignerInterop({sourcesRoot:root})).ok,false);
 chmodSync(root,0o755);
 assert.equal(verifySixNativeSignerSources(root).reason,
  'private_source_root_required');
});

test('native source path symlink is rejected before git inspection or module import',t=>{
 const root=tempRoot(t);
 mkdirSync(join(root,'CytoDuck-real'),{mode:0o700});
 symlinkSync(join(root,'CytoDuck-real'),join(root,'CytoDuck'));
 let gitCalls=0;
 const report=verifySixNativeSignerSources(root,{runGit:()=>{gitCalls++;return ''}});
 assert.equal(report.ok,false);
 assert.equal(report.reason,'unverified_goflo_native_source');
 assert.equal(gitCalls,0);
});

test('CLI requires explicit operator opt-in, never runs by default',()=>{
 const file=fileURLToPath(new URL('../six-native-signer-interoperability.mjs',
  import.meta.url));
 const proc=spawnSync(process.execPath,[file],{encoding:'utf8',timeout:6000});
 assert.equal(proc.status,2);
 assert.match(proc.stderr,/--confirm-readonly-offline-native-signer-test/);
 assert.doesNotMatch(proc.stdout,/PASS/);
});
