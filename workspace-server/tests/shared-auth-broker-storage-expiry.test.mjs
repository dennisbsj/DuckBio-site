import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createAuthBroker,createMemoryBrokerStore} from '../shared-auth/broker.mjs';

const START=1_800_000_000_000;
const token=()=>randomBytes(32).toString('base64url');

async function fixture(t,{parentUntil=START+60_000,afterCodeWrite,afterProofWrite}={}){
 let now=START;
 const secret=token(),state=token(),verifier=token();
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const redirectUri='https://goflo.example.test/auth/callback';
 const parent={id:'storage-delay-parent',subject:'storage-delay-subject',
  displayName:'Private Fixture User',expiresAt:parentUntil,passwordChangeRequired:false};
 const localIdentity={userId:'native-fixture-user',organizationId:'native-fixture-tenant'};
 const store=createMemoryBrokerStore();
 let codeWrites=0,proofWrites=0,proofDeletes=0;
 const putCode=store.putCode.bind(store),putProof=store.putProof.bind(store);
 const deleteProof=store.deleteProof.bind(store);
 store.putCode=async(...args)=>{
  codeWrites++;
  const result=await putCode(...args);
  if(afterCodeWrite!==undefined) now=afterCodeWrite;
  return result;
 };
 store.putProof=async(...args)=>{
  proofWrites++;
  const result=await putProof(...args);
  if(afterProofWrite!==undefined) now=afterProofWrite;
  return result;
 };
 store.deleteProof=async(...args)=>{proofDeletes++;return deleteProof(...args);};
 const identity={
  getSession:async()=>parent,
  authenticate:async()=>parent,
  getParentSession:async id=>id===parent.id?parent:null,
  getAccess:async()=>({localIdentity,bindingRevision:'epoch:1'}),
  logout:async()=>{}
 };
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 broker=createAuthBroker({origin,issuer:'https://identity.example.test',
  clients:[{id:'goflo',appId:'goflo',secret,redirectUris:[redirectUri]}],
  identity,store,clock:()=>now});
 const preflight=await fetch(origin+'/api/suite/auth/session');
 assert.equal(preflight.status,200);
 const csrf=(await preflight.json()).csrfToken;
 const browserCookie=preflight.headers.get('set-cookie').split(';')[0];
 const target={appId:'goflo',state,codeChallenge:challenge,
  codeChallengeMethod:'S256',redirectUri,returnPath:'/analysis'};
 async function authorize(){
  const response=await fetch(origin+'/api/suite/auth/authorize',{
   method:'POST',headers:{'Content-Type':'application/json',
    Cookie:browserCookie,Origin:origin,'X-CSRF-Token':csrf},
   body:JSON.stringify(target)});
  return {status:response.status,body:await response.json()};
 }
 async function exchange(code){
  const response=await fetch(origin+'/api/suite/auth/exchange',{
   method:'POST',headers:{'Content-Type':'application/json',
    Authorization:'Basic '+Buffer.from('goflo:'+secret).toString('base64')},
   body:JSON.stringify({clientId:'goflo',code,state,codeVerifier:verifier,redirectUri})});
  return {status:response.status,body:await response.json()};
 }
 return {authorize,exchange,
  codeWrites:()=>codeWrites,proofWrites:()=>proofWrites,proofDeletes:()=>proofDeletes};
}

test('slow durable code write cannot yield a browser redirect after parent expiry',async t=>{
 const f=await fixture(t,{parentUntil:START+1000,afterCodeWrite:START+2000});
 const result=await f.authorize();
 assert.deepEqual(result,{status:401,body:{error:'invalid_credentials'}});
 assert.equal(f.codeWrites(),1);
});

test('slow durable proof write denies expired PKCE grant and removes stale proof',async t=>{
 const f=await fixture(t,{parentUntil:START+1000,afterProofWrite:START+2000});
 const authorized=await f.authorize();
 assert.equal(authorized.status,200);
 const code=new URL(authorized.body.redirectUrl).searchParams.get('code');
 const result=await f.exchange(code);
 assert.deepEqual(result,{status:401,body:{error:'invalid_grant'}});
 assert.equal(f.proofWrites(),1);
 assert.equal(f.proofDeletes(),1);
});

test('proof remains available when durable storage completes before parent expiry',async t=>{
 const f=await fixture(t,{parentUntil:START+60_000,afterProofWrite:START+200});
 const authorized=await f.authorize();
 assert.equal(authorized.status,200);
 const code=new URL(authorized.body.redirectUrl).searchParams.get('code');
 const result=await f.exchange(code);
 assert.equal(result.status,200);
 assert.equal(result.body.expiresAt,START+60_000);
 assert.match(result.body.sessionToken,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(f.proofWrites(),1);
 assert.equal(f.proofDeletes(),0);
});
