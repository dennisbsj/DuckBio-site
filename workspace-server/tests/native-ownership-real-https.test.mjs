/**
 * Localhost real HTTPS/TLS and Ed25519 ownership protocol test only.
 * Generates a one-day disposable self-signed QA certificate and signing key,
 * keeps ephemeral bearer credentials private to a child Node process and
 * never invokes any native backend, Stripe, broker, browser or public DNS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {createServer} from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalNativeOwnershipProofBytes}
 from '../shared-auth/signed-native-ownership-verifier.mjs';

const NOW=1800000000000;
const TOKEN='synthetic-qa-only-secret-bearer-token-123456789';
const CLIENT=fileURLToPath(new URL('./fixtures/native-ownership-real-tls-client.mjs',import.meta.url));

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-real-https-'));
 const cert=path.join(root,'localhost-cert.pem');
 const key=path.join(root,'localhost-key.pem');
 const publicKeyPath=path.join(root,'ephemeral-signer-public.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048',
  '-nodes','-days','1','-sha256','-keyout',key,'-out',cert,
  '-subj','/CN=127.0.0.1',
  '-addext','subjectAltName=IP:127.0.0.1',
  '-addext','basicConstraints=critical,CA:TRUE'],
 {timeout:12000,stdio:'ignore'});
 chmodSync(key,0o600);
 const ephemeral=generateKeyPairSync('ed25519');
 writeFileSync(publicKeyPath,
  ephemeral.publicKey.export({format:'pem',type:'spki'}),{mode:0o600});
 let scenario='good',requests=[],cached=null;
 const server=createServer({
  key:readFileSync(key),cert:readFileSync(cert)
 },async(req,res)=>{
  const chunks=[];
  try{
   for await(const piece of req)chunks.push(piece);
   requests.push({
    path:req.url,method:req.method,auth:req.headers.authorization,
    input:JSON.parse(Buffer.concat(chunks).toString('utf8'))
   });
   if(req.url!=='/private/native-ownership'||req.method!=='POST'||
      req.headers.authorization!=='Bearer '+TOKEN){
    res.writeHead(403);res.end('denied');return;
   }
   if(scenario==='timeout')return; // Child abort must end request.
   if(scenario==='redirect'){
    res.writeHead(302,{location:'https://127.0.0.1/other-native'});
    res.end();return;
   }
   if(scenario==='non-json'){
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<html>not a proof</html>');return;
   }
   if(scenario==='oversized'){
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({garbage:'a'.repeat(10000)}));return;
   }
   const last=requests.at(-1).input;
   let payload={
    ...last,keyId:'native-qa-key-1',issuedAt:NOW,
    expiresAt:NOW+15000,active:true,ownershipVerified:true
   };
   if(scenario==='wrong-tenant')
    payload={...payload,nativeOrganizationId:'synthetic-other-native-tenant'};
   let envelope={payload,signature:sign(null,
    canonicalNativeOwnershipProofBytes(payload),ephemeral.privateKey)
    .toString('base64url')};
   if(scenario==='tampered')
    envelope={...envelope,payload:{...payload,active:false}};
   if(scenario==='replay'){
    if(!cached)cached=envelope;
    envelope=cached;
   }
   res.writeHead(200,{'content-type':'application/json',
    'cache-control':'no-store'});
   res.end(JSON.stringify(envelope));
  }catch{
   try{res.writeHead(400);res.end('invalid synthetic request');}catch{}
  }
 });
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 t.after(async()=>{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(()=>resolve()));
  rmSync(root,{recursive:true,force:true});
 });
 const port=server.address().port;
 const endpoint='https://127.0.0.1:'+port+'/private/native-ownership';
 async function call(mode='inspect',{trustCa=true}={}){
  const env={...process.env,
   NODE_EXTRA_CA_CERTS:trustCa?cert:'',
   DUCKBIO_QA_NATIVE_HTTPS_ENDPOINT:endpoint,
   DUCKBIO_QA_NATIVE_TOKEN:TOKEN,
   DUCKBIO_QA_NATIVE_PUBLIC_KEY:publicKeyPath,
   DUCKBIO_QA_NATIVE_CLOCK:String(NOW)
  };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  return await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--no-warnings',CLIENT,mode],{
    env,stdio:['ignore','pipe','pipe']
   });
   let stdout='',stderr='';
   const deadline=setTimeout(()=>child.kill('SIGKILL'),8000);
   child.stdout.on('data',b=>{stdout+=b.toString();});
   child.stderr.on('data',b=>{stderr+=b.toString();});
   child.once('error',error=>{clearTimeout(deadline);reject(error);});
   child.once('close',(code,signal)=>{
    clearTimeout(deadline);
    if(code!==0)return reject(Error('HTTPS client failed '+code+'/'+signal+' '+stderr));
    try{resolve(JSON.parse(stdout));}catch(error){reject(Error('invalid child output: '+stdout+' '+stderr));}
   });
  });
 }
 return {
  call,requests:()=>requests,
  use:value=>{scenario=value;requests=[];cached=null}
 };
}

test('real loopback TLS + pinned native Ed25519 signer accepts exact inspect and bind, never issues grants',async t=>{
 const f=await fixture(t);
 const inspection=await f.call();
 assert.deepEqual(inspection,{results:[true],
  accessGranted:false,licensesGranted:false,loginEnabled:false});
 const binding=await f.call('bind');
 assert.deepEqual(binding.results,[true]);
 assert.equal(binding.accessGranted,false);
 assert.equal(f.requests().length,2);
 const [a,b]=f.requests();
 assert.equal(a.path,'/private/native-ownership');
 assert.equal(a.method,'POST');
 assert.equal(a.auth,'Bearer '+TOKEN);
 assert.equal(a.input.purpose,'inspect');
 assert.equal(b.input.purpose,'bind');
 assert.equal(a.input.nonce.length,43);
 assert.notEqual(a.input.nonce,b.input.nonce);
 assert.equal(a.input.workspaceOrganizationId,'qa-central-tenant');
 assert.equal(a.input.nativeOrganizationId,'qa-native-tenant');
});

test('actual TLS certificate trust, native Ed25519 key pin and private bearer independently fail closed',async t=>{
 const f=await fixture(t);
 assert.deepEqual((await f.call('inspect',{trustCa:false})).results,[false],
  'self-signed server without trusted CA must be rejected by Node fetch');
 assert.deepEqual((await f.call('untrusted-signing-key')).results,[false]);
 assert.deepEqual((await f.call('wrong-bearer')).results,[false]);
 assert.equal(f.requests().filter(x=>x.auth!=='Bearer '+TOKEN).length,1);
});

test('HTTPS signed but wrong-tenant, tampered payload and reused nonce all fail',async t=>{
 const f=await fixture(t);
 f.use('wrong-tenant');
 assert.deepEqual((await f.call()).results,[false]);
 f.use('tampered');
 assert.deepEqual((await f.call()).results,[false]);
 f.use('replay');
 assert.deepEqual((await f.call('replay')).results,[true,false],
  'a second HTTPS request cannot reuse the original signed nonce');
 assert.equal(f.requests().length,2);
 assert.notEqual(f.requests()[0].input.nonce,f.requests()[1].input.nonce);
});

test('real TLS redirect, unexpected content type, >8 KiB response and timeout fail closed',async t=>{
 const f=await fixture(t);
 for(const scenario of ['redirect','non-json','oversized','timeout']){
  f.use(scenario);
  assert.deepEqual((await f.call(scenario==='timeout'?'timeout':'inspect')).results,[false],
   scenario+' must fail closed on real HTTPS transport');
 }
});
