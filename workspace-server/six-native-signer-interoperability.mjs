/**
 * OFFLINE, opt-in integration rehearsal using the six REAL native signer
 * modules from six independent, private, commit-pinned Git checkouts.
 *
 * NO browser route, SSO grant, startup import, network request, staging
 * deployment, billing API, native database access, or production credentials.
 * Synthetic ephemeral keys and an explicitly synthetic ownership lookup only.
 * A green result confirms v1 signed wire protocol compatibility, NOT live
 * native ownership, authenticated service-to-service HTTPS or authorization.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { approvedPrivateRoot } from './staging-generate-config.mjs';
import { createSignedNativeOwnershipVerifier }
 from './shared-auth/signed-native-ownership-verifier.mjs';

export const SIX_NATIVE_SIGNER_CHECKOUTS = Object.freeze([
 Object.freeze({id:'goflo',repo:'CytoDuck',
  sha:'0626d6d192e478cead5fcb4f2549a31dd8674a14',
  file:'server/workspace-native-ownership.cjs',
  factory:'createCytoDuckNativeOwnershipSigner'}),
 Object.freeze({id:'eel',repo:'DuckNote',
  sha:'f3bd11abf4d7ff14c555b53bdb34b5eb69412a70',
  file:'server/workspace-native-ownership.js',
  factory:'createDuckNoteNativeOwnershipSigner'}),
 Object.freeze({id:'methpipe',repo:'DuckPipe',
  sha:'522f196dfdb1d0676519be23a95327ab0aad9171',
  file:'server/workspace-native-ownership.cjs',
  factory:'createDuckPipeNativeOwnershipSigner'}),
 Object.freeze({id:'mantrain',repo:'DuckTrain',
  sha:'00a88cb531015c09a20070cf645194bdc9450ef1',
  file:'server/workspace-native-ownership.cjs',
  factory:'createDuckTrainNativeOwnershipSigner'}),
 Object.freeze({id:'duckman',repo:'DuckMan',
  sha:'216cb7c7bee1c24d0588cf55d73ebb1d2bb8d41e',
  file:'server/workspace-native-ownership.cjs',
  factory:'createDuckManNativeOwnershipSigner'}),
 Object.freeze({id:'limsman',repo:'LabDuck',
  sha:'084c192ec200f813b95466fd0a9232b864560ff1',
  file:'server/workspace-native-ownership.cjs',
  factory:'createLabDuckNativeOwnershipSigner'})
]);
const deny=(reason,checks=[])=>Object.freeze({
 ok:false,reason,checks,deploymentAuthorized:false
});
const passed=(checks,id)=>checks.push(Object.freeze({
 id,ok:true,reason:'verified_offline_protocol_only'
}));
const ID='synthetic-workspace-account';
const ORG='synthetic-workspace-org-a';
const NATIVE_ORG='synthetic-native-org-a';
const NATIVE_USER='synthetic-native-user-a';
const NOW=1_800_000_000_000;
const inputs=id=>Object.freeze({
 appId:id,workspaceAccountId:ID,workspaceOrganizationId:ORG,
 nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
});
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===keys.length&&
 keys.every(k=>Object.hasOwn(value,k));
const response=body=>new Response(JSON.stringify(body),{
 headers:{'content-type':'application/json','cache-control':'no-store'}
});
const git=(dir,args)=>execFileSync('git',['-C',dir,...args],{
 encoding:'utf8',timeout:8000,maxBuffer:32768,
 stdio:['ignore','pipe','ignore']
}).trim();

/** Only accept the exact reviewed clean checkout and exact Git-tracked module.
 * A local user cannot swap paths, apps, SHA, remote, symlinks or working copy.
 * No source bytes, Git URLs or private paths appear in the output report.
 */
export function verifySixNativeSignerSources(sourcesRoot,{runGit=git}={}){
 let root;
 try{root=approvedPrivateRoot(sourcesRoot)}
 catch{return deny('private_source_root_required')}
 if(typeof runGit!=='function')return deny('invalid_git_inspector');
 const checks=[];
 for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
  const dir=join(root,row.repo),filename=join(dir,row.file);
  try{
   const checkout=lstatSync(dir);
   const signer=lstatSync(filename);
   if(!checkout.isDirectory()||checkout.isSymbolicLink()||
      realpathSync(dir)!==dir||!signer.isFile()||
      signer.isSymbolicLink()||realpathSync(filename)!==filename)
    throw Error('unsafe_checkout');
   const remote=runGit(dir,['remote','get-url','origin']);
   if(!['https://github.com/dennisbsj/'+row.repo+'.git',
     'https://github.com/dennisbsj/'+row.repo,
     'git@github.com:dennisbsj/'+row.repo+'.git'].includes(remote))
    throw Error('wrong_native_repository');
   if(runGit(dir,['rev-parse','--show-toplevel'])!==dir||
      runGit(dir,['rev-parse','--verify','HEAD'])!==row.sha||
      runGit(dir,['status','--porcelain=v1','--untracked-files=all'])!=='')
    throw Error('unreviewed_native_source');
   const pinned=runGit(dir,['rev-parse','HEAD:'+row.file]);
   const disk=runGit(dir,['hash-object','--',row.file]);
   if(!/^[a-f0-9]{40}$/.test(pinned)||disk!==pinned)
    throw Error('native_signer_source_changed');
   passed(checks,row.id);
  }catch{return deny('unverified_'+row.id+'_native_source',checks)}
 }
 return Object.freeze({ok:true,checks,
  category:'six-clean-private-commit-pinned-native-modules',
  deploymentAuthorized:false});
}

/**
 * Exercise the actual native factories against the actual Workspace verifier.
 * The factory map comes only from exact-source-verified native checkouts in
 * the CLI path. A pure factory-map seam permits isolated no-private-repo CI.
 */
export async function rehearseSixNativeSignerFactories({
 factories,now=NOW
}={}){
 const checks=[];
 if(!factories||!(factories instanceof Map)||
    factories.size!==SIX_NATIVE_SIGNER_CHECKOUTS.length||
    !Number.isSafeInteger(now)||now<=0)
  return deny('invalid_private_native_factory_matrix');
 const clients=Object.create(null);
 const signers=new Map(),nativeActive=new Map();
 for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
  const factory=factories.get(row.id);
  if(typeof factory!=='function')return deny('missing_'+row.id+'_native_signer');
  try{
   const keys=generateKeyPairSync('ed25519');
   const keyId='synthetic-'+row.id+'-signer';
   const token='synthetic-'+row.id+'-offline-token-only-123456789';
   const privateKeyPem=keys.privateKey.export({
    type:'pkcs8',format:'pem'
   });
   clients[row.id]={
    endpoint:'https://staging-'+row.id+'.example.test/private/workspace/verify-ownership',
    keyId,
    publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
    token
   };
   nativeActive.set(row.id,true);
   const signer=factory({
    privateKeyPem,keyId,clock:()=>now,
    lookupOwnership:async binding=>
      exact(binding,['appId','workspaceAccountId',
       'workspaceOrganizationId','nativeUserId',
       'nativeOrganizationId','purpose'])&&
      binding.appId===row.id&&
      binding.workspaceAccountId===ID&&
      binding.workspaceOrganizationId===ORG&&
      binding.nativeUserId===NATIVE_USER&&
      binding.nativeOrganizationId===NATIVE_ORG&&
      ['inspect','bind','migrate'].includes(binding.purpose)&&
      nativeActive.get(row.id)===true
       ?{active:true,ownershipVerified:true}:null
   });
   if(typeof signer?.prove!=='function')
    throw Error('invalid_native_signer');
   signers.set(row.id,signer);
  }catch{return deny('invalid_'+row.id+'_native_signer',checks)}
 }
 let mode='normal',savedReply=null,networkRequests=0;
 const transport=async(url,request)=>{
  networkRequests++;
  const row=SIX_NATIVE_SIGNER_CHECKOUTS.find(
   r=>url===clients[r.id].endpoint);
  if(!row||request.method!=='POST'||request.redirect!=='error'||
     request.credentials!=='omit'||request.cache!=='no-store'||
     request.headers.authorization!=='Bearer '+clients[row.id].token)
   throw Error('invalid_private_synthetic_transport');
  if(mode==='outage')throw Error('synthetic_offline_connection_refused');
  if(mode==='replay'&&savedReply)return response(savedReply);
  const signed=await signers.get(row.id).prove(JSON.parse(request.body));
  if(!signed)return response({error:'synthetic_native_binding_unverified'});
  if(mode==='capture')savedReply=signed;
  if(mode==='tamper')return response({...signed,payload:{
   ...signed.payload,nativeOrganizationId:'synthetic-other-native-org'
  }});
  return response(signed);
 };
 let verifier;
 try{verifier=createSignedNativeOwnershipVerifier({
  clients,fetchImpl:transport,clock:()=>now
 })}
 catch{return deny('workspace_native_verifier_initialization_failed')}
 for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
  const item=inputs(row.id);
  try{
   mode='normal';
   if(await verifier.verifyNativeMapping(item)!==true)
    throw Error('valid_inspect_failed');
   for(const purpose of ['bind','migrate']){
    if(await verifier.verifyNativeOwnership({
     actorId:'synthetic-operator',userId:ID,appId:row.id,
     workspaceOrganizationId:ORG,nativeUserId:NATIVE_USER,
     nativeOrganizationId:NATIVE_ORG,operation:purpose
    })!==true)throw Error('valid_mutation_proof_failed');
   }
   for(const diff of [
    {nativeUserId:'synthetic-other-native-user'},
    {nativeOrganizationId:'synthetic-other-native-org'},
    {workspaceOrganizationId:'synthetic-other-workspace-org'},
    {workspaceAccountId:'synthetic-other-workspace-account'}
   ]){
    if(await verifier.verifyNativeMapping({...item,...diff})!==false)
     throw Error('tenant_or_user_mismatch_accepted');
   }
   nativeActive.set(row.id,false);
   if(await verifier.verifyNativeMapping(item)!==false)
    throw Error('native_revocation_not_observed');
   nativeActive.set(row.id,true);
   mode='tamper';
   if(await verifier.verifyNativeMapping(item)!==false)
    throw Error('tampered_signed_payload_accepted');
   mode='capture';savedReply=null;
   if(await verifier.verifyNativeMapping(item)!==true||!savedReply)
    throw Error('fresh_challenge_failed');
   mode='replay';
   if(await verifier.verifyNativeMapping(item)!==false)
    throw Error('replayed_native_signature_accepted');
   mode='outage';
   if(await verifier.verifyNativeMapping(item)!==false)
    throw Error('unavailable_native_verifier_accepted');
   passed(checks,row.id);
  }catch{return deny('interop_failed_'+row.id,checks)}
 }
 if(networkRequests<6*10)return deny('missing_six_app_negative_probes',checks);
 return Object.freeze({
  ok:true,checks,category:'six-real-signer-abi-with-synthetic-ownership-only',
  networkRequests, deploymentAuthorized:false
 });
}

/** Opt-in offline operator runner. Never import native modules until all six
 * tracked private checkout identities have passed the exact Git verification.
 */
export async function auditSixGenuineNativeSignerInterop({sourcesRoot}={}){
 const before=verifySixNativeSignerSources(sourcesRoot);
 if(!before.ok)return before;
 const factories=new Map();
 try{
  for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
   const filename=join(sourcesRoot,row.repo,row.file);
   const loaded=await import(pathToFileURL(filename).href);
   const factory=loaded[row.factory]??loaded.default?.[row.factory];
   if(typeof factory!=='function')
    return deny('missing_'+row.id+'_native_export');
   factories.set(row.id,factory);
  }
 }catch{return deny('unloadable_pinned_native_source')}
 const result=await rehearseSixNativeSignerFactories({factories});
 if(!result.ok)return result;
 // Reject a changed checkout or untracked modification during dynamic import.
 const after=verifySixNativeSignerSources(sourcesRoot);
 if(!after.ok)return deny('native_sources_changed_during_rehearsal');
 return Object.freeze({...result,
  category:'six-reviewed-real-native-signers-offline-interoperable',
  sourceCommitPinned:true,deploymentAuthorized:false});
}

if(process.argv[1]&&resolve(process.argv[1])===
 fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--sources-root'||
    args[2]!=='--confirm-readonly-offline-native-signer-test'){
  console.error('Usage: node six-native-signer-interoperability.mjs --sources-root PRIVATE_SIX_REPO_CHECKOUTS --confirm-readonly-offline-native-signer-test');
  process.exitCode=2;
 }else{
  const report=await auditSixGenuineNativeSignerInterop({
   sourcesRoot:args[1]
  });
  for(const check of report.checks??[])
   console.log((check.ok?'PASS ':'FAIL ')+check.id);
  if(!report.ok){
   console.error('BLOCKED six real native signer interop: '+report.reason);
   process.exitCode=1;
  }else{
   console.log('PASS six real native signer modules and central Ed25519 verifier (OFFLINE, SYNTHETIC OWNERSHIP ONLY; NOT live SSO, billing or deployment)');
  }
 }
}
