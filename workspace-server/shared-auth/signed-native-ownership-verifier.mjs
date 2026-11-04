/**
 * UNMOUNTED Workspace -> native proof verifier for six existing apps.
 *
 * PRIVATE SERVER ONLY. A browser cannot supply endpoint, bearer token or
 * native signing key. A signed native ownership statement is NOT proof of a
 * Workspace paid seat, role, SSO token, or native resource authorization.
 *
 * This adapter does not register an HTTP handler and is not imported into
 * the active Workspace broker/runtime.
 */
import {createPublicKey,randomBytes,verify as verifySignature} from 'node:crypto';

const VERSION='duckbio.native-ownership.v1';
const APPS=new Set(['limsman','eel','methpipe','mantrain','duckman','goflo']);
const PURPOSES=new Set(['inspect','bind','migrate']);
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_KEY=/^[A-Za-z0-9_.-]{1,64}$/;
const SAFE_TOKEN=/^[A-Za-z0-9._~-]{32,256}$/;
const PROOF_KEYS=Object.freeze([
 'version','keyId','purpose','nonce','appId','workspaceAccountId',
 'workspaceOrganizationId','nativeUserId','nativeOrganizationId',
 'issuedAt','expiresAt','active','ownershipVerified'
]);
const REQUEST_KEYS=Object.freeze([
 'appId','workspaceAccountId','workspaceOrganizationId',
 'nativeUserId','nativeOrganizationId'
]);
const MAX_BYTES=8192;
const MAX_PROOF_AGE_MS=30000;
const FUTURE_SKEW_MS=5000;
const isId=x=>typeof x==='string'&&SAFE_ID.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isExact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));

/**
 * Signature bytes are Ed25519 over UTF-8 JSON.stringify of this EXACT
 * ordered array. This deliberately does not depend on JSON object key order.
 * Both native signer and Workspace verifier must use the same v1 format.
 */
export function canonicalNativeOwnershipProofBytes(proof){
 return Buffer.from(JSON.stringify([
  proof.version,proof.keyId,proof.purpose,proof.nonce,
  proof.appId,proof.workspaceAccountId,proof.workspaceOrganizationId,
  proof.nativeUserId,proof.nativeOrganizationId,
  proof.issuedAt,proof.expiresAt,proof.active,proof.ownershipVerified
 ]),'utf8');
}

async function readLimitedJson(response){
 if(!response||response.ok!==true||response.status!==200||
    !/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type')||''))
   return null;
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))return null;
 if(!response.body||typeof response.body.getReader!=='function')return null;
 const reader=response.body.getReader();
 const chunks=[];
 let bytes=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))return null;
   bytes+=value.byteLength;
   if(bytes>MAX_BYTES){
    await reader.cancel();
    return null;
   }
   chunks.push(Buffer.from(value));
  }
 }finally{reader.releaseLock();}
 if(!bytes)return null;
 return JSON.parse(new TextDecoder('utf-8',{fatal:true})
  .decode(Buffer.concat(chunks,bytes)));
}

/**
 * Each configured client must specify an exact HTTPS endpoint and PINNED
 * Ed25519 native public keys. A private bearer authenticates Workspace to
 * the endpoint; the signed reply authenticates the native answer.
 * Unknown, premature, retired or cross-app key IDs always deny.
 *
 * Legacy one-key config:
 * clients: {goflo:{endpoint:'https://.../private/...',keyId:'...',
 *                   publicKeyPem:'-----BEGIN PUBLIC KEY-----...',token:'...'}}
 *
 * Opt-in key rotation (maximum two pinned keys with explicit UTC epoch-ms
 * acceptance windows; overlap allows deployment without unpinned fallback):
 * clients: {goflo:{endpoint:'https://.../private/...',token:'...',
 *   signingKeys:[
 *    {keyId:'old',publicKeyPem:'...',notBeforeMs:123,notAfterMs:456},
 *    {keyId:'next',publicKeyPem:'...',notBeforeMs:345,notAfterMs:789}
 *   ]}}
 */
export function createSignedNativeOwnershipVerifier({
 clients,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=5000
}={}){
 if(!clients||typeof clients!=='object'||Array.isArray(clients)||
    typeof fetchImpl!=='function'||typeof clock!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>15000)
   throw Error('private_native_verifier_config_required');
 const registered=new Map();
 for(const [appId,raw] of Object.entries(clients)){
  if(!APPS.has(appId)||registered.has(appId)||!raw||
     typeof raw!=='object'||Array.isArray(raw)||
     typeof raw.token!=='string'||!SAFE_TOKEN.test(raw.token)||
     typeof raw.endpoint!=='string')
    throw Error('invalid_private_native_client');
  let endpoint;
  try{endpoint=new URL(raw.endpoint);}
  catch{throw Error('invalid_private_native_client');}
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||
     endpoint.hash||endpoint.search||!endpoint.hostname||
     endpoint.href!==raw.endpoint)
    throw Error('invalid_private_native_client');

  const rotating=own(raw,'signingKeys');
  // Never silently mix old and new trust configuration during a rotation.
  if(rotating&&(own(raw,'keyId')||own(raw,'publicKeyPem')))
   throw Error('invalid_private_native_client');
  const descriptors=rotating?raw.signingKeys:[{
   keyId:raw.keyId,publicKeyPem:raw.publicKeyPem,
   notBeforeMs:0,notAfterMs:Number.MAX_SAFE_INTEGER
  }];
  if(!Array.isArray(descriptors)||descriptors.length<1||
     descriptors.length>2)throw Error('invalid_private_native_client');
  const keys=new Map();
  for(const descriptor of descriptors){
   if(!isExact(descriptor,['keyId','publicKeyPem','notBeforeMs','notAfterMs'])||
      typeof descriptor.keyId!=='string'||!SAFE_KEY.test(descriptor.keyId)||
      typeof descriptor.publicKeyPem!=='string'||
      !Number.isSafeInteger(descriptor.notBeforeMs)||
      !Number.isSafeInteger(descriptor.notAfterMs)||
      descriptor.notBeforeMs<0||
      descriptor.notAfterMs<=descriptor.notBeforeMs||
      keys.has(descriptor.keyId))
    throw Error('invalid_private_native_client');
   let key;
   try{key=createPublicKey(descriptor.publicKeyPem);}
   catch{throw Error('invalid_private_native_client');}
   if(key.asymmetricKeyType!=='ed25519')
    throw Error('invalid_private_native_client');
   keys.set(descriptor.keyId,Object.freeze({
    key,notBeforeMs:descriptor.notBeforeMs,
    notAfterMs:descriptor.notAfterMs
   }));
  }
  registered.set(appId,Object.freeze({
   endpoint:endpoint.href,keys,token:raw.token
  }));
 }
 if(!registered.size)throw Error('private_native_clients_required');

 async function verify(fields,purpose){
  if(!PURPOSES.has(purpose)||!fields||typeof fields!=='object'||
     !isExact(fields,REQUEST_KEYS)||
     REQUEST_KEYS.some(k=>!isId(fields[k])))return false;
  const client=registered.get(fields.appId);
  if(!client)return false;
  const start=clock();
  if(!Number.isSafeInteger(start)||start<=0)return false;
  const nonce=randomBytes(32).toString('base64url');
  const body={version:VERSION,purpose,nonce,...fields};
  let result;
  try{
   // Caller-supplied fetchImpl is only for isolated tests or a private
   // server's audited transport. Never pass browser-controlled clients.
   const response=await fetchImpl(client.endpoint,{
    method:'POST',headers:{
     'authorization':'Bearer '+client.token,
     'content-type':'application/json',
     'accept':'application/json',
     'cache-control':'no-store'
    },
    redirect:'error',credentials:'omit',cache:'no-store',
    signal:AbortSignal.timeout(timeoutMs),
    body:JSON.stringify(body)
   });
   result=await readLimitedJson(response);
  }catch{return false;}
  if(!result||!isExact(result,['payload','signature'])||
     !isExact(result.payload,PROOF_KEYS)||typeof result.signature!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(result.signature))
   return false;
  const proof=result.payload;
  // The reply chooses only among SERVER-PINNED, time-bounded keys.
  // It cannot introduce a trust key or prolong a retired key's lifetime.
  const signingKey=client.keys.get(proof.keyId);
  if(!signingKey||proof.version!==VERSION||
     proof.purpose!==purpose||proof.nonce!==nonce||
     proof.active!==true||proof.ownershipVerified!==true||
     REQUEST_KEYS.some(k=>proof[k]!==fields[k])||
     !Number.isSafeInteger(proof.issuedAt)||
     !Number.isSafeInteger(proof.expiresAt))
    return false;
  const finish=clock();
  if(!Number.isSafeInteger(finish)||finish<start||
     finish<signingKey.notBeforeMs||finish>=signingKey.notAfterMs||
     proof.issuedAt<signingKey.notBeforeMs||
     proof.expiresAt>signingKey.notAfterMs||
     proof.issuedAt<start-MAX_PROOF_AGE_MS||
     proof.issuedAt>finish+FUTURE_SKEW_MS||
     proof.expiresAt<=finish||
     proof.expiresAt<=proof.issuedAt||
     proof.expiresAt-proof.issuedAt>MAX_PROOF_AGE_MS)
    return false;
  const signature=Buffer.from(result.signature,'base64url');
  if(signature.byteLength!==64||signature.toString('base64url')!==result.signature)
   return false;
  try{
   return verifySignature(null,canonicalNativeOwnershipProofBytes(proof),
    signingKey.key,signature)===true;
  }catch{return false;}
 }
 return Object.freeze({
  // Directly satisfies PR #145 inspector's private callback contract.
  verifyNativeMapping(input={}){
   return verify(input,'inspect');
  },
  // Private opt-in PR #141 link/migration ownership adapter. Actor authority
  // is still separately verified via orgNativeLinks.authorizeMutation().
  verifyNativeOwnership(input={}){
   const {actorId,userId,appId,workspaceOrganizationId,nativeUserId,
    nativeOrganizationId,operation}=input;
   if(!isId(actorId)||!isId(userId)||
      !['bind','migrate'].includes(operation))return Promise.resolve(false);
   return verify({appId,workspaceAccountId:userId,workspaceOrganizationId,
    nativeUserId,nativeOrganizationId},operation);
  }
 });
}
