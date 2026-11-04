/**
 * SIX dormant native ownership signers -> REAL LOOPBACK TLS -> actual central
 * signed-native verifier. TEST-ONLY. This never mounts an app route, calls
 * public network services, provisions a native account or issues SSO grants.
 *
 * Real native signer/lookup exports can be injected ONLY by the operator
 * CLI after verification of six pinned clean private source checkouts.
 * Public CI uses synthetic factories and synthetic native datastore rows.
 */
import {createServer,request as httpsRequest} from 'node:https';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSignedNativeOwnershipVerifier}
 from './shared-auth/signed-native-ownership-verifier.mjs';
import {SIX_NATIVE_SIGNER_CHECKOUTS}
 from './six-native-signer-interoperability.mjs';

const IDS=Object.freeze(SIX_NATIVE_SIGNER_CHECKOUTS.map(x=>x.id));
const NOW=1_800_000_000_000;
const WORKSPACE_ACCOUNT='synthetic-workspace-account';
const WORKSPACE_ORG='synthetic-workspace-org-a';
const NATIVE_USER='synthetic-native-user-a';
const NATIVE_ORG='synthetic-native-org-a';
const ROUTE='/private/native-ownership';
const MAX_REQUEST=2048;
const MAX_RESPONSE=12288;
const deny=(reason,checks=[])=>Object.freeze({
 ok:false,reason,checks,deploymentAuthorized:false
});
const field=id=>({
 appId:id,workspaceAccountId:WORKSPACE_ACCOUNT,
 workspaceOrganizationId:WORKSPACE_ORG,nativeUserId:NATIVE_USER,
 nativeOrganizationId:NATIVE_ORG
});
const isMap=x=>x instanceof Map&&x.size===6&&
 IDS.every(id=>typeof x.get(id)==='function');
const controlsValid=x=>x instanceof Map&&x.size===6&&IDS.every(id=>
 ['revoke','restore','expire','unexpire','removeAccount','restoreAccount',
  'duplicate','unduplicate'].every(fn=>typeof x.get(id)?.[fn]==='function')
);
const reply=(res,status,body,contentType='application/json')=>{
 res.writeHead(status,{'content-type':contentType,'cache-control':'no-store'});
 res.end(typeof body==='string'?body:JSON.stringify(body));
};

/**
 * HTTPS transport with exact ephemeral local certificate CA pinning. No
 * downgrade, redirects, DNS names, proxy or public network destinations.
 * Node's actual TLS stack validates the certificate SAN. This is a test
 * adapter only; it is NOT the Workspace production fetch transport.
 */
function pinnedLoopbackFetch(cert,approved,wrongCa=false){
 return async function fetchLocal(url,init){
  if(!approved.has(url)||!url.startsWith('https://127.0.0.1:')||
     !url.endsWith(ROUTE)||init?.method!=='POST'||
     init.redirect!=='error'||init.credentials!=='omit'||
     init.cache!=='no-store'||typeof init.body!=='string'||
     Buffer.byteLength(init.body)>MAX_REQUEST)
   throw Error('unapproved_loopback_native_request');
  return await new Promise((resolve,reject)=>{
   const rq=httpsRequest(url,{
    method:'POST',headers:init.headers,
    ca:wrongCa?'':cert,rejectUnauthorized:true,
    signal:init.signal,agent:false
   },rsp=>{
    const chunks=[];let size=0;
    rsp.on('data',piece=>{
     size+=piece.byteLength;
     if(size>MAX_RESPONSE){
      rq.destroy(Error('oversized_synthetic_native_tls_reply'));
      return;
     }
     chunks.push(piece);
    });
    rsp.on('error',reject);
    rsp.on('end',()=>{
     try{
      resolve(new Response(Buffer.concat(chunks),{
       status:rsp.statusCode,
       headers:rsp.headers
      }));
     }catch(reject)
    });
   });
   rq.on('error',reject);
   rq.end(init.body);
  });
 };
}

async function localService(id,options){
 const {key,cert,secret,signer,events,scenarios}=options;
 let server;
 server=createServer({key,cert},async(req,res)=>{
  events.set(id,(events.get(id)||0)+1);
  const scenario=scenarios.get(id);
  if(scenario.mode==='timeout')return;
  if(req.url!==ROUTE||req.method!=='POST'||
     req.headers.authorization!=='Bearer '+secret||
     req.headers.host!=='127.0.0.1:'+server.address().port||
     !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){
   reply(res,403,{error:'denied'});return;
  }
  if(scenario.mode==='redirect'){
   res.writeHead(302,{'location':'https://127.0.0.1/other'});
   res.end();return;
  }
  if(scenario.mode==='nonjson'){
   reply(res,200,'untrusted', 'text/html');return;
  }
  if(scenario.mode==='oversized'){
   reply(res,200,{garbage:'a'.repeat(9500)});return;
  }
  try{
   const chunks=[];let bytes=0;
   for await(const piece of req){
    bytes+=piece.byteLength;
    if(bytes>MAX_REQUEST)throw Error('oversized_native_request');
    chunks.push(piece);
   }
   const signed=await signer.prove(JSON.parse(
    Buffer.concat(chunks).toString('utf8')
   ));
   if(!signed){reply(res,403,{error:'not_owned'});return}
   if(scenario.mode==='replay'){
    if(!scenario.saved)scenario.saved=signed;
    reply(res,200,scenario.saved);return;
   }
   if(scenario.mode==='tamper'){
    reply(res,200,{...signed,payload:{
     ...signed.payload,nativeOrganizationId:'synthetic-tampered-org'
    }});return;
   }
   reply(res,200,signed);
  }catch{
   reply(res,403,{error:'invalid_native_request'});
  }
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 return {server,endpoint:'https://127.0.0.1:'+
  server.address().port+ROUTE};
}

/**
 * Actual TLS handshake for six isolated localhost HTTPS services. Native
 * signers are supplied as real exports in operator mode, but they work ONLY
 * against disposable native mapping fixture lookups, never a native app DB.
 * Every positive signed response remains an OWNERSHIP assertion, not a grant.
 */
export async function rehearseSixNativeOwnershipOverRealTls({
 signerFactories,nativeLookups,syntheticControls,now=NOW
}={}){
 if(!isMap(signerFactories)||!isMap(nativeLookups)||
    !controlsValid(syntheticControls)||
    !Number.isSafeInteger(now)||now<=0)
  return deny('invalid_six_native_tls_fixture');
 const root=mkdtempSync(join(tmpdir(),'duckbio-six-native-tls-'));
 chmodSync(root,0o700);
 const checks=[],servers=[],events=new Map(),scenarios=new Map();
 let source,clientKey;
 try{
  const certFile=join(root,'loopback-cert.pem');
  const keyFile=join(root,'loopback-key.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048',
   '-nodes','-days','1','-sha256','-keyout',keyFile,'-out',certFile,
   '-subj','/CN=127.0.0.1',
   '-addext','subjectAltName=IP:127.0.0.1',
   '-addext','basicConstraints=critical,CA:TRUE'
  ],{timeout:14000,stdio:'ignore'});
  chmodSync(keyFile,0o600);
  source=readFileSync(certFile,'utf8');
  clientKey=readFileSync(keyFile,'utf8');
  const clients=Object.create(null);
  for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
   const pair=generateKeyPairSync('ed25519');
   const keyId='synthetic-'+row.id+'-tls';
   const token=randomBytes(48).toString('base64url');
   const signer=signerFactories.get(row.id)({
    privateKeyPem:pair.privateKey.export({format:'pem',type:'pkcs8'}),
    keyId,clock:()=>now,
    lookupOwnership:nativeLookups.get(row.id)
   });
   if(typeof signer?.prove!=='function')
    return deny('invalid_'+row.id+'_signed_native_factory',checks);
   scenarios.set(row.id,{mode:'valid',saved:null});
   const running=await localService(row.id,{
    key:clientKey,cert:source,secret:token,signer,events,scenarios
   });
   servers.push(running.server);
   clients[row.id]={
    endpoint:running.endpoint,
    token,keyId,
    publicKeyPem:pair.publicKey.export({format:'pem',type:'spki'})
   };
  }
  const allowed=new Set(Object.values(clients).map(c=>c.endpoint));
  const fetchLocal=pinnedLoopbackFetch(source,allowed);
  const makeVerifier=(registry=clients,fetchImpl=fetchLocal)=>createSignedNativeOwnershipVerifier({
   clients:registry,fetchImpl,clock:()=>now,timeoutMs:350
  });
  const verifier=makeVerifier();
  for(const row of SIX_NATIVE_SIGNER_CHECKOUTS){
   const id=row.id,access=field(id),controls=syntheticControls.get(id);
   const scenario=scenarios.get(id);
   const inspect=()=>verifier.verifyNativeMapping(access);
   for(const purpose of ['inspect','bind','migrate']){
    const good=purpose==='inspect'?await inspect():
     await verifier.verifyNativeOwnership({
      actorId:'synthetic-operator',userId:WORKSPACE_ACCOUNT,
      workspaceOrganizationId:WORKSPACE_ORG,
      appId:id,nativeUserId:NATIVE_USER,
      nativeOrganizationId:NATIVE_ORG,operation:purpose
     });
    if(good!==true)return deny('native_tls_signed_'+purpose+'_failed_'+id,checks);
   }
   for(const bad of [
    {workspaceAccountId:'synthetic-unrelated-workspace-user'},
    {workspaceOrganizationId:'synthetic-unrelated-workspace-org'},
    {nativeUserId:'synthetic-unrelated-native-user'},
    {nativeOrganizationId:'synthetic-unrelated-native-org'}
   ]){
    if(await verifier.verifyNativeMapping({...access,...bad})!==false)
     return deny('native_tls_wrong_identity_accepted_'+id,checks);
   }
   for(const [off,on] of [
    ['revoke','restore'],['expire','unexpire'],
    ['removeAccount','restoreAccount'],['duplicate','unduplicate']
   ]){
    controls[off]();
    if(await inspect()!==false)
     return deny('native_tls_invalid_mapping_accepted_'+id,checks);
    controls[on]();
    if(await inspect()!==true)
     return deny('native_tls_restored_mapping_denied_'+id,checks);
   }
   for(const mode of ['tamper','redirect','nonjson','oversized','timeout']){
    scenario.mode=mode;
    if(await inspect()!==false)
     return deny('native_tls_bad_'+mode+'_accepted_'+id,checks);
   }
   scenario.mode='replay';scenario.saved=null;
   if(await inspect()!==true||await inspect()!==false)
    return deny('native_tls_nonce_replay_accepted_'+id,checks);
   scenario.mode='valid';
   const wrongSecret=Object.fromEntries(Object.entries(clients).map(
    ([name,c])=>[name,name===id?{...c,token:
      'synthetic-incorrect-private-bearer-token-123456789'}:c]
   ));
   if(await makeVerifier(wrongSecret).verifyNativeMapping(access)!==false)
    return deny('native_tls_wrong_bearer_accepted_'+id,checks);
   const wrongTrust=pinnedLoopbackFetch(source,allowed,true);
   if(await makeVerifier(clients,wrongTrust).verifyNativeMapping(access)!==false)
    return deny('native_tls_untrusted_ca_accepted_'+id,checks);
   if(await inspect()!==true)
    return deny('native_tls_valid_recovery_denied_'+id,checks);
   checks.push(Object.freeze({id,ok:true,code:'real_loopback_tls_only'}));
  }
  if(checks.length!==6||IDS.some(id=>(events.get(id)||0)<15))
   return deny('native_tls_evidence_incomplete',checks);
  return Object.freeze({
   ok:true,checks,category:'six-real-loopback-https-native-owned-only',
   deploymentAuthorized:false
  });
 }catch{
  return deny('native_tls_fixture_unavailable_or_failed',checks);
 }finally{
  await Promise.allSettled(servers.map(s=>new Promise(resolve=>{
   s.closeAllConnections?.();
   s.close(()=>resolve());
  })));
  rmSync(root,{recursive:true,force:true});
 }
}
