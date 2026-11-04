/**
 * Synthetic-only HTTP/PKCE integration rehearsal of the REAL Workspace broker.
 * Both identity and organization data use real private disposable SQLite.
 * This never contacts native services, Stripe or a production origin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthBroker, createMemoryBrokerStore } from '../shared-auth/broker.mjs';
import { createIdentityStore } from '../shared-auth/identity-store.mjs';
import { createOrganizationStore } from '../organization-store.mjs';
import { createWorkspaceNativeAccessInspector } from '../workspace-native-access-inspector.mjs';
import { createWorkspaceNativeBrokerDenyAdapter } from '../shared-auth/native-broker-deny-adapter.mjs';

const NOW=1800000000000;
const PAID_THROUGH=1900000000;
const redirectUri='https://goflo.example.test/auth/callback';
const secret=randomBytes(32).toString('base64url');
const state=randomBytes(32).toString('base64url');
const verifier=randomBytes(32).toString('base64url');
const challenge=createHash('sha256').update(verifier).digest('base64url');

async function fixture(t,{historicalSeats=false,nativeCheck=async()=>true}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-broker-deny-'));
 const identityStore=createIdentityStore({
  databasePath:path.join(root,'private','identity.sqlite'),clock:()=>NOW,
  // Synthetic fixture only. No production native ownership or operator proof.
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 const organizationStore=createOrganizationStore({
  databasePath:path.join(root,'private','organization.sqlite'),clock:()=>NOW,
  verifyLiveSubscriptionEvidence:x=>x // synthetic LIVE-shaped test ledger ONLY
 });
 const user=await identityStore.createUser({
  email:'synthetic-scientist@example.test',displayName:'Synthetic Scientist',
  password:'synthetic-only-broker-password'
 });
 for(const name of ['alpha','beta']){
  organizationStore.setupOrganization({
   organizationId:name,name:'Laboratory '+name,
   owner:{accountId:user.id,name:'Scientist',nickname:'Sci',
    email:'synthetic-scientist@example.test'}
  });
  if(historicalSeats)organizationStore.applyVerifiedSeatPurchase({
   reference:'legacy-'+name,organizationId:name,plan:'Single',
   apps:['goflo'],seats:2
  });
  else organizationStore.applyVerifiedSubscriptionTransition({
   source:'stripe_live',eventKey:'synthetic-'+name,
   organizationId:name,subscriptionId:'sub-'+name,
   revision:1,plan:'Single',apps:['goflo'],seats:2,
   status:'active',paidThrough:PAID_THROUGH
  });
  organizationStore.saveMember({
   organizationId:name,actorId:user.id,
   member:{accountId:user.id,name:'Scientist',nickname:'Sci',
    email:'synthetic-scientist@example.test',admin:true,
    roles:{goflo:'Analyst'}}
  });
 }
 const alpha=identityStore.createSession(user.id).parent;
 const beta=identityStore.createSession(user.id).parent;
 organizationStore.selectSessionOrganization({
  sessionId:alpha.id,accountId:user.id,organizationId:'alpha'
 });
 organizationStore.selectSessionOrganization({
  sessionId:beta.id,accountId:user.id,organizationId:'beta'
 });
 identityStore.grantAppAccess({
  userId:user.id,appId:'goflo',
  localUserId:'legacy-native-user',organizationId:'legacy-native-org'
 });
 await identityStore.bindVerifiedOrganizationNativeLink({
  actorId:user.id,userId:user.id,appId:'goflo',
  workspaceOrganizationId:'alpha',
  nativeUserId:'alpha-native-user',nativeOrganizationId:'alpha-native-org'
 });
 await identityStore.bindVerifiedOrganizationNativeLink({
  actorId:user.id,userId:user.id,appId:'goflo',
  workspaceOrganizationId:'beta',
  nativeUserId:'beta-native-user',nativeOrganizationId:'beta-native-org'
 });
 const inspector=createWorkspaceNativeAccessInspector({
  identityStore,organizationStore,verifyNativeMapping:nativeCheck,clock:()=>NOW
 });
 let currentSessionId=alpha.id;
 const parentAdapter={
  async getSession(){return identityStore.getParentSession(currentSessionId)},
  async getParentSession(id){return identityStore.getParentSession(id)},
  async authenticate(_req,_res,credentials){
   if(credentials.email!=='synthetic-scientist@example.test')return null;
   const result=await identityStore.authenticatePassword(credentials);
   if(!result)return null;
   currentSessionId=result.parent.id;
   organizationStore.selectSessionOrganization({
    sessionId:currentSessionId,accountId:user.id,organizationId:'alpha'
   });
   return result.parent;
  },
  async logout(id){identityStore.revokeSession(id)}
 };
 const guarded=createWorkspaceNativeBrokerDenyAdapter({
  identity:parentAdapter,organizationStore,inspector,
  permissions:{goflo:'workspace.view'}
 });
 const authStore=createMemoryBrokerStore();
 let codes=0,proofs=0;
 const oldCode=authStore.putCode.bind(authStore);
 const oldProof=authStore.putProof.bind(authStore);
 authStore.putCode=async(...args)=>{codes++;return oldCode(...args)};
 authStore.putProof=async(...args)=>{proofs++;return oldProof(...args)};
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 broker=createAuthBroker({
  origin,issuer:'https://identity.example.test',
  clients:[{id:'goflo',appId:'goflo',secret,redirectUris:[redirectUri]}],
  identity:guarded,store:authStore,clock:()=>NOW
 });
 const preflightResponse=await fetch(origin+'/api/suite/auth/session');
 const browserCookie=preflightResponse.headers.get('set-cookie').split(';')[0];
 const csrfToken=(await preflightResponse.json()).csrfToken;
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  identityStore.close();organizationStore.close();
  rmSync(root,{recursive:true,force:true});
 });
 const target={appId:'goflo',returnPath:'/analysis',state,
  codeChallenge:challenge,codeChallengeMethod:'S256',redirectUri};
 async function post(route,body,{serverAuth=false}={}){
  const headers=serverAuth
   ?{'Content-Type':'application/json',
     Authorization:'Basic '+Buffer.from('goflo:'+secret).toString('base64')}
   :{'Content-Type':'application/json',Origin:origin,Cookie:browserCookie,
     'X-CSRF-Token':csrfToken};
  const response=await fetch(origin+'/api/suite/auth/'+route,{
   method:'POST',headers,body:JSON.stringify(body)
  });
  return {status:response.status,
   body:response.status===204?null:await response.json()};
 }
 return {guarded,inspector,parentAdapter,organizationStore,identityStore,
  user,alpha,beta,post,target,origin,authWrites:()=>({codes,proofs}),
  setCurrent:id=>{currentSessionId=id}
 };
}

test('positive scoped/paid/native preflight NEVER becomes broker PKCE code or proof',async t=>{
 const f=await fixture(t);
 const candidate=await f.guarded.inspectCandidate(f.alpha,'goflo');
 assert.equal(candidate.candidateReady,true);
 assert.equal(candidate.workspaceOrganizationId,'alpha');
 assert.equal(candidate.nativeUserId,'alpha-native-user');
 assert.equal(candidate.loginEnabled,false);
 assert.equal(await f.guarded.getAccess(f.alpha,'goflo'),null);
 const authorize=await f.post('authorize',f.target);
 assert.deepEqual(authorize,{status:403,body:{error:'access_denied'}});
 const login=await f.post('login',{...f.target,email:'synthetic-scientist@example.test',
  password:'synthetic-only-broker-password'});
 assert.deepEqual(login,{status:403,body:{error:'access_denied'}});
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
 // No fake app code can be exchanged or introspected as a native login.
 const exchange=await f.post('exchange',{
  clientId:'goflo',code:randomBytes(32).toString('base64url'),state,
  codeVerifier:verifier,redirectUri},{serverAuth:true});
 assert.equal(exchange.status,401);
 const introspect=await f.post('introspect',{
  sessionToken:randomBytes(32).toString('base64url')
 },{serverAuth:true});
 assert.deepEqual(introspect.body,{active:false});
});

test('changing locked organization never falls back to old global identity grant',async t=>{
 const f=await fixture(t);
 const alpha=await f.guarded.inspectCandidate(f.alpha,'goflo');
 assert.equal(alpha.candidateReady,true);
 f.setCurrent(f.beta.id);
 const beta=await f.guarded.inspectCandidate(f.beta,'goflo');
 assert.equal(beta.candidateReady,true);
 assert.equal(beta.nativeUserId,'beta-native-user');
 assert.notEqual(alpha.nativeOrganizationId,beta.nativeOrganizationId);
 assert.equal(await f.guarded.getAccess(f.beta,'goflo'),null);
 assert.deepEqual(await f.post('authorize',f.target),{
  status:403,body:{error:'access_denied'}
 });
 f.identityStore.revokeAppAccess(f.user.id,'goflo');
 assert.equal((await f.guarded.inspectCandidate(f.beta,'goflo')).candidateReady,true);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('expired historical seats, wrong app and DataDuck stay blocked',async t=>{
 const f=await fixture(t,{historicalSeats:true});
 assert.equal((await f.guarded.inspectCandidate(f.alpha,'goflo')).candidateReady,false);
 for(const id of ['dataduck','duckman','unknown'])
  assert.equal((await f.guarded.inspectCandidate(f.alpha,id)).candidateReady,false);
 assert.equal(await f.guarded.getAccess(f.alpha,'dataduck'),null);
 assert.deepEqual(await f.post('authorize',f.target),{
  status:403,body:{error:'access_denied'}
 });
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('revoked session or native link cannot produce a candidate or broker code',async t=>{
 const f=await fixture(t);
 await f.identityStore.revokeVerifiedOrganizationNativeLink({
  actorId:f.user.id,userId:f.user.id,appId:'goflo',
  workspaceOrganizationId:'alpha'
 });
 assert.equal((await f.guarded.inspectCandidate(f.alpha,'goflo')).candidateReady,false);
 assert.equal((await f.post('authorize',f.target)).status,403);
 f.identityStore.revokeSession(f.alpha.id);
 assert.equal((await f.guarded.inspectCandidate(f.alpha,'goflo')).candidateReady,false);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('native verifier outage and tenant switch mid-verification fail closed',async t=>{
 let callback=null;
 const f=await fixture(t,{nativeCheck:async()=>callback?callback():true});
 callback=async()=>{
  f.organizationStore.selectSessionOrganization({
   sessionId:f.alpha.id,accountId:f.user.id,organizationId:'beta'
  });
  return true;
 };
 const switched=await f.guarded.inspectCandidate(f.alpha,'goflo');
 assert.equal(switched.candidateReady,false);
 assert.equal(switched.accessGranted,false);
 callback=async()=>{throw Error('synthetic native outage')};
 const unavailable=await f.guarded.inspectCandidate(f.beta,'goflo');
 assert.equal(unavailable.candidateReady,false);
 assert.equal(await f.guarded.getAccess(f.beta,'goflo'),null);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('forged accessGranted=true preflight can never activate the broker',async t=>{
 const f=await fixture(t);
 const forged=createWorkspaceNativeBrokerDenyAdapter({
  identity:f.parentAdapter,organizationStore:f.organizationStore,
  inspector:{inspect:async()=>({
   candidateReady:true,accessGranted:true,licensesGranted:true,
   loginEnabled:true,nativeEnforcementRequired:true,appId:'goflo',
   permission:'workspace.view',workspaceOrganizationId:'alpha',
   workspaceAccountId:f.user.id
  })},permissions:{goflo:'workspace.view'}
 });
 assert.equal((await forged.inspectCandidate(f.alpha,'goflo')).candidateReady,false);
 assert.equal(await forged.getAccess(f.alpha,'goflo'),null);
 assert.equal((await f.post('authorize',f.target)).status,403);
});

test('construction refuses missing trust adapters and unregistered apps',()=>{
 const identity={getSession(){},authenticate(){},getParentSession(){},logout(){}};
 const org={currentSessionOrganization(){}};
 const inspector={inspect(){}};
 assert.throws(()=>createWorkspaceNativeBrokerDenyAdapter(),/trusted_parent/);
 assert.throws(()=>createWorkspaceNativeBrokerDenyAdapter({
  identity,organizationStore:org,inspector,permissions:{dataduck:'workspace.view'}
 }),/explicit_six_app_permission/);
 assert.throws(()=>createWorkspaceNativeBrokerDenyAdapter({
  identity,organizationStore:org,inspector,permissions:{goflo:'*'}
 }),/explicit_six_app_permission/);
});
