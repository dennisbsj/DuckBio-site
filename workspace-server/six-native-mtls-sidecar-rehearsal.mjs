/**
 * Six native private mTLS sidecars -> real mutual TLS -> central Workspace
 * Ed25519 proof verifier. NEVER mounted by the application runtime.
 *
 * Operator mode imports the true six private native sidecar, signer and
 * datastore-lookup factories only after exact Git SHA/source pin checks.
 * Public CI injects synthetic sidecar/signer/lookup factories instead.
 * Real app servers and customer native DBs are NEVER accessed.
 */
import {request as httpsRequest} from 'node:https';
import {execFileSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,X509Certificate} from 'node:crypto';
import {mkdtempSync,rmSync,chmodSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSignedNativeOwnershipVerifier}
 from './shared-auth/signed-native-ownership-verifier.mjs';
import {SIX_NATIVE_SIGNER_CHECKOUTS}
 from './six-native-signer-interoperability.mjs';

const IDS=SIX_NATIVE_SIGNER_CHECKOUTS.map(x=>x.id);
const ROUTE='/private/v1/native-ownership';
const NOW=1800000000000;
const SUBJECT={
 workspaceAccountId:'synthetic-workspace-account',
 workspaceOrganizationId:'synthetic-workspace-org-a',
 nativeUserId:'synthetic-native-user-a',
 nativeOrganizationId:'synthetic-native-org-a'
};
const fail=(reason,checks=[])=>Object.freeze({
 ok:false,reason,checks,deploymentAuthorized:false
});
const goodMap=x=>x instanceof Map&&x.size===6&&
 IDS.every(id=>typeof x.get(id)==='function');
const goodControls=x=>x instanceof Map&&x.size===6&&
 IDS.every(id=>['revoke','restore','expire','unexpire','removeAccount',
  'restoreAccount','duplicate','unduplicate'].every(
    fn=>typeof x.get(id)?.[fn]==='function'));
const hostname=id=>'staging-'+id+'.qa.test';
const subject=id=>({appId:id,...SUBJECT});
const generateCert=(root,name,cn,additionalExts=[])=>{
 const key=join(root,name+'-key.pem'),cert=join(root,name+'-cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
  '-days','1','-sha256','-keyout',key,'-out',cert,'-subj','/CN='+cn,
  ...additionalExts.flatMap(x=>['-addext',x])
 ],{timeout:14000,stdio:'ignore'});
 chmodSync(key,0o600);
 return {key:readFileSync(key,'utf8'),cert:readFileSync(cert,'utf8')};
};

/** Real Node TLS handshake with fixed SNI, authenticated client certificate,
 * pinned native server CA and exact closed-world hostname -> 127.0.0.1.
 * No public DNS lookup, redirects, proxy or runtime-wide TLS bypass.
 */
function privateMtlFetch({endpoints,serverCert,clientCert,clientKey}){
 return async(url,init)=>{
  if(!endpoints.has(url)||typeof init?.body!=='string'||
     Buffer.byteLength(init.body)>2048||
     init.method!=='POST'||init.redirect!=='error'||
     init.credentials!=='omit'||init.cache!=='no-store')
   throw Error('unapproved_private_synthetic_mtls_request');
  const expected=new URL(url);
  if(expected.protocol!=='https:'||expected.pathname!==ROUTE||
     !IDS.some(id=>hostname(id)===expected.hostname)||
     !Number.isSafeInteger(Number(expected.port)))
   throw Error('unapproved_private_synthetic_mtls_destination');
  return await new Promise((resolve,reject)=>{
   const request=httpsRequest(url,{
    method:'POST',headers:init.headers,
    ca:serverCert,cert:clientCert,key:clientKey,
    rejectUnauthorized:true,minVersion:'TLSv1.3',agent:false,
    signal:init.signal,
    lookup:(name,_opts,callback)=>{
     if(name!==expected.hostname)
      callback(Error('unapproved_native_host'));
     else callback(null,'127.0.0.1',4);
    }
   },response=>{
    const chunks=[];let bytes=0;
    response.on('data',part=>{
     bytes+=part.byteLength;
     if(bytes>12288){
      request.destroy(Error('oversized_synthetic_native_mtls_response'));
      return;
     }
     chunks.push(part);
    });
    response.on('error',reject);
    response.on('end',()=>{
     try{
      resolve(new Response(Buffer.concat(chunks),{
       status:response.statusCode,headers:response.headers
      }));
     }catch(error){reject(error)}
    });
   });
   request.on('error',reject);
   request.end(init.body);
  });
 };
}

/** Requires externally supplied, test-only sidecar factories. All six native
 * services run real TLS on independent loopback ports and are torn down.
 * Positive signed ownership is not a role, seat, session or SSO grant.
 */
export async function rehearseSixNativeMtlSidecars({
 sidecarFactories,signerFactories,nativeLookups,syntheticControls,now=NOW
}={}){
 if(!goodMap(sidecarFactories)||!goodMap(signerFactories)||
    !goodMap(nativeLookups)||!goodControls(syntheticControls)||
    !Number.isSafeInteger(now)||now<=0)
  return fail('invalid_six_native_mtls_fixture');
 const root=mkdtempSync(join(tmpdir(),'duckbio-six-native-mtls-'));
 chmodSync(root,0o700);
 const checks=[],servers=[];
 try{
  const names=IDS.map(id=>'DNS:'+hostname(id)).join(',');
  const serverCert=generateCert(root,'native-sidecar',hostname(IDS[0]),[
   'subjectAltName='+names,
   'basicConstraints=critical,CA:TRUE'
  ]);
  const clientCert=generateCert(root,'workspace-client','workspace-synthetic-qa',[
   'extendedKeyUsage=clientAuth',
   'basicConstraints=critical,CA:TRUE'
  ]);
  const fingerprint=new X509Certificate(clientCert.cert).fingerprint256;
  const clients=Object.create(null);
  for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
   const pair=generateKeyPairSync('ed25519');
   const keyId='synthetic-'+row.id+'-mTLS-key';
   const bearerToken=randomBytes(48).toString('base64url');
   const signer=signerFactories.get(row.id)({
    privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'}),
    keyId,lookupOwnership:nativeLookups.get(row.id),clock:()=>now
   });
   if(typeof signer?.prove!=='function')
    return fail('invalid_'+row.id+'_signer',checks);
   const sidecar=sidecarFactories.get(row.id)({
    keyPem:serverCert.key,certPem:serverCert.cert,
    clientCaPem:clientCert.cert,
    clientFingerprint256:fingerprint,
    bearerToken,expectedHostname:hostname(row.id),
    signer,clock:()=>now
   });
   if(typeof sidecar?.listen!=='function'||
      typeof sidecar?.close!=='function')
    return fail('invalid_'+row.id+'_mtls_sidecar',checks);
   // A native sidecar may NEVER bind public 0.0.0.0:0.
   await new Promise((resolve,reject)=>{
    sidecar.once('error',reject);
    sidecar.listen(0,'127.0.0.1',resolve);
   });
   servers.push(sidecar);
   const port=sidecar.address()?.port;
   if(!Number.isSafeInteger(port)||port<1)
    return fail('invalid_'+row.id+'_mtls_listener',checks);
   clients[row.id]={
    endpoint:'https://'+hostname(row.id)+':'+port+ROUTE,
    token:bearerToken,keyId,
    publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'})
   };
  }
  const endpoints=new Set(Object.values(clients).map(c=>c.endpoint));
  const makeVerifier=(registry=clients,transport)=>{
   const fetchImpl=transport||privateMtlFetch({
    endpoints,serverCert:serverCert.cert,
    clientCert:clientCert.cert,clientKey:clientCert.key
   });
   return createSignedNativeOwnershipVerifier({
    clients:registry,fetchImpl,clock:()=>now,timeoutMs:2000
   });
  };
  // Safe debugging labels only; never reveal cert/key, identities or URLs.
  let tlsWitness='unattempted';
  const baseTransport=privateMtlFetch({
   endpoints,serverCert:serverCert.cert,
   clientCert:clientCert.cert,clientKey:clientCert.key
  });
  const tracedTransport=async(url,init)=>{
   try{
    const response=await baseTransport(url,init);
    tlsWitness='http_'+response.status;
    return response;
   }catch(error){
    const code=String(error?.code||error?.cause?.code||'unknown');
    tlsWitness='tls_'+(/^[A-Z_]{1,60}$/.test(code)?code:'unknown');
    throw error;
   }
  };
  const verifier=makeVerifier(clients,tracedTransport);
  for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
   const id=row.id,identity=subject(id);
   const controls=syntheticControls.get(id);
   const inspect=()=>verifier.verifyNativeMapping(identity);
   for(const purpose of ['inspect','bind','migrate']){
    const accepted=purpose==='inspect'?await inspect():
     await verifier.verifyNativeOwnership({
      actorId:'synthetic-reviewed-operator',
      userId:SUBJECT.workspaceAccountId,
      appId:id,workspaceOrganizationId:SUBJECT.workspaceOrganizationId,
      nativeUserId:SUBJECT.nativeUserId,
      nativeOrganizationId:SUBJECT.nativeOrganizationId,
      operation:purpose
     });
    if(accepted!==true)
     return fail('native_mtls_signed_'+purpose+'_denied_'+id+'_'+tlsWitness,checks);
   }
   for(const change of [
    {workspaceAccountId:'synthetic-other-workspace-account'},
    {workspaceOrganizationId:'synthetic-other-workspace-org'},
    {nativeUserId:'synthetic-other-native-user'},
    {nativeOrganizationId:'synthetic-other-native-org'}
   ]){
    if(await verifier.verifyNativeMapping({...identity,...change})!==false)
     return fail('native_mtls_wrong_identity_accepted_'+id,checks);
   }
   for(const [off,on] of [
    ['revoke','restore'],['expire','unexpire'],
    ['removeAccount','restoreAccount'],['duplicate','unduplicate']
   ]){
    controls[off]();
    if(await inspect()!==false)
     return fail('native_mtls_invalid_binding_accepted_'+id,checks);
    controls[on]();
    if(await inspect()!==true)
     return fail('native_mtls_binding_restore_denied_'+id,checks);
   }
   const invalidBearer=Object.fromEntries(Object.entries(clients).map(
    ([name,c])=>[name,name===id?{
     ...c,token:'synthetic-invalid-workspace-bearer-123456789'
    }:c]
   ));
   if(await makeVerifier(invalidBearer).verifyNativeMapping(identity)!==false)
    return fail('native_mtls_wrong_bearer_accepted_'+id,checks);
   const noClient=privateMtlFetch({
    endpoints,serverCert:serverCert.cert
   });
   if(await makeVerifier(clients,noClient).verifyNativeMapping(identity)!==false)
    return fail('native_mtls_missing_client_certificate_accepted_'+id,checks);
   const noTrust=privateMtlFetch({
    endpoints,serverCert:'',
    clientCert:clientCert.cert,clientKey:clientCert.key
   });
   if(await makeVerifier(clients,noTrust).verifyNativeMapping(identity)!==false)
    return fail('native_mtls_untrusted_native_ca_accepted_'+id,checks);
   // Native-sidecar nonce replay rejection is distinct from Workspace's
   // verifier replay protection: send the exact same signed request twice.
   const nonce=randomBytes(32).toString('base64url');
   const body=JSON.stringify({
    version:'duckbio.native-ownership.v1',purpose:'inspect',nonce,
    ...identity
   });
   const client=clients[id];
   const directFetch=privateMtlFetch({
    endpoints,serverCert:serverCert.cert,
    clientCert:clientCert.cert,clientKey:clientCert.key
   });
   const rawOptions={
    method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
    headers:{
     authorization:'Bearer '+client.token,
     'content-type':'application/json','accept':'application/json'
    },
    body,signal:AbortSignal.timeout(2000)
   };
   const first=await directFetch(client.endpoint,rawOptions);
   const second=await directFetch(client.endpoint,{
    ...rawOptions,signal:AbortSignal.timeout(2000)
   });
   if(first.status!==200||second.status!==409)
    return fail('native_mtls_sidecar_nonce_replay_accepted_'+id,checks);
   if(await inspect()!==true)
    return fail('native_mtls_final_healthy_proof_denied_'+id,checks);
   checks.push(Object.freeze({id,ok:true,code:'real_native_mtls_sidecar'}));
  }
  return Object.freeze({
   ok:true,checks,
   category:'six-real-loopback-mutual-tls-native-sidecars-only',
   deploymentAuthorized:false
  });
 }catch{
  return fail('native_mtls_fixture_unavailable_or_failed',checks);
 }finally{
  await Promise.allSettled(servers.map(server=>new Promise(resolve=>{
   server.closeAllConnections?.();
   server.close(()=>resolve());
  })));
  rmSync(root,{force:true,recursive:true});
 }
}
