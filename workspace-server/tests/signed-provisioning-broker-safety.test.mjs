/**
 * FULLY SYNTHETIC, private SSO safety integration:
 * signed native Ed25519 ownership -> session-bound org-admin provisioning
 * -> canonical two-store native preflight -> real HTTP/PKCE broker DENIAL.
 *
 * No real native endpoint, live Stripe charge, customer or production runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync,rmSync } from 'node:fs';
import { createHash,randomBytes,randomUUID,generateKeyPairSync,sign } from 'node:crypto';
import { createIdentityStore } from '../shared-auth/identity-store.mjs';
import { createOrganizationStore } from '../organization-store.mjs';
import { createWorkspaceNativeLinkProvisioner } from '../shared-auth/session-native-link-provisioning.mjs';
import { createSignedNativeOwnershipVerifier,
 canonicalNativeOwnershipProofBytes } from '../shared-auth/signed-native-ownership-verifier.mjs';
import { createWorkspaceNativeAccessInspector } from '../workspace-native-access-inspector.mjs';
import { createWorkspaceNativeBrokerDenyAdapter } from '../shared-auth/native-broker-deny-adapter.mjs';
import { createAuthBroker,createMemoryBrokerStore } from '../shared-auth/broker.mjs';

const START=1800000000000;
const APP='goflo';
const PASSWORD='synthetic-only-native-sso-rehearsal-password';
const REDIRECT='https://goflo.example.test/auth/callback';

async function fixture(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-signed-provision-broker-'));
 let now=START,mode='valid',duringNative=null;
 const keys=generateKeyPairSync('ed25519');
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:{
   endpoint:'https://synthetic-native.example.test/private/ownership',
   keyId:'fixture-ed25519',publicKeyPem:keys.publicKey.export({
    format:'pem',type:'spki'}),
   token:'synthetic-private-ownership-token-123456789012345'
  }},clock:()=>now,
  fetchImpl:async(_url,request)=>{
   const challenge=JSON.parse(request.body);
   if(duringNative)await duringNative(challenge);
   const payload={...challenge,keyId:'fixture-ed25519',
    issuedAt:now,expiresAt:now+15000,active:true,
    ownershipVerified:mode!=='inactive'};
   if(mode==='bad-nonce')payload.nonce='untrusted-or-replayed-nonce';
   if(mode==='bad-tenant')payload.workspaceOrganizationId='foreign-tenant';
   const signature=sign(null,canonicalNativeOwnershipProofBytes(payload),
    keys.privateKey).toString('base64url');
   return new Response(JSON.stringify({payload,signature}),{
    status:200,headers:{'content-type':'application/json'}
   });
  }
 });
 const org=createOrganizationStore({
  databasePath:path.join(root,'private','org.sqlite'),clock:()=>now,
  nativeProvisioningSessionEpochs:true,
  // Synthetic shape only; this is not evidence of any real paid subscription.
  verifyLiveSubscriptionEvidence:value=>value
 });
 let identity;
 const provisioner=createWorkspaceNativeLinkProvisioner({
  getIdentityStore:()=>identity,organizationStore:org,
  verifyNativeOwnership:verifier.verifyNativeOwnership,clock:()=>now
 });
 identity=createIdentityStore({
  databasePath:path.join(root,'private','identities.sqlite'),clock:()=>now,
  orgNativeLinks:provisioner.adapters
 });
 const admin=await identity.createUser({
  id:randomUUID(),email:'operator@example.test',
  displayName:'Synthetic Operator',password:PASSWORD
 });
 const scientist=await identity.createUser({
  id:randomUUID(),email:'scientist@example.test',
  displayName:'Synthetic Scientist',password:PASSWORD
 });
 org.setupOrganization({
  organizationId:'alpha',name:'Synthetic Laboratory Alpha',
  owner:{accountId:admin.id,name:'Operator',nickname:'Operator',
   email:'operator@example.test'}
 });
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-ledger-event',
  organizationId:'alpha',subscriptionId:'synthetic-subscription',
  revision:1,plan:'Single',apps:[APP],seats:3,
  status:'active',paidThrough:1800000060
 });
 org.saveMember({
  organizationId:'alpha',actorId:admin.id,
  member:{accountId:scientist.id,name:'Scientist',
   nickname:'Scientist',email:'scientist@example.test',
   admin:false,roles:{goflo:'Analyst'}}
 });
 const adminSession=identity.createSession(admin.id).parent;
 const scientistSession=identity.createSession(scientist.id).parent;
 org.selectSessionOrganization({
  sessionId:adminSession.id,accountId:admin.id,organizationId:'alpha'
 });
 org.selectSessionOrganization({
  sessionId:scientistSession.id,accountId:scientist.id,organizationId:'alpha'
 });
 // An old global app mapping exists but is expressly NOT trusted in new path.
 identity.grantAppAccess({userId:scientist.id,appId:APP,
  localUserId:'old-unscoped-native-user',
  organizationId:'old-unscoped-native-org'});
 const input={sessionId:adminSession.id,userId:scientist.id,
  appId:APP,workspaceOrganizationId:'alpha',
  nativeUserId:'native-scientist-alpha',
  nativeOrganizationId:'native-laboratory-alpha'
 };
 const inspector=createWorkspaceNativeAccessInspector({
  identityStore:identity,organizationStore:org,
  verifyNativeMapping:verifier.verifyNativeMapping,clock:()=>now
 });
 let currentSession=scientistSession;
 const parentIdentity={
  async getSession(){return identity.getParentSession(currentSession.id)},
  async authenticate(_req,_res,credentials){
   const result=await identity.authenticatePassword({
    email:credentials.email,password:credentials.password
   });
   if(!result)return null;
   currentSession=result.parent;
   org.selectSessionOrganization({
    sessionId:currentSession.id,accountId:scientist.id,
    organizationId:'alpha'
   });
   return result.parent;
  },
  async getParentSession(id){return identity.getParentSession(id)},
  async logout(id){identity.revokeSession(id)}
 };
 const guarded=createWorkspaceNativeBrokerDenyAdapter({
  identity:parentIdentity,organizationStore:org,inspector,
  permissions:{goflo:'workspace.view'}
 });
 let codeCount=0,proofCount=0;
 const store=createMemoryBrokerStore();
 const putCode=store.putCode.bind(store),putProof=store.putProof.bind(store);
 store.putCode=async(...args)=>{codeCount++;return putCode(...args)};
 store.putProof=async(...args)=>{proofCount++;return putProof(...args)};
 const secret=randomBytes(32).toString('base64url');
 const state=randomBytes(32).toString('base64url');
 const codeVerifier=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(codeVerifier).digest('base64url');
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 broker=createAuthBroker({
  origin,issuer:'https://identity.example.test',
  clients:[{id:APP,appId:APP,secret,redirectUris:[REDIRECT]}],
  identity:guarded,store,clock:()=>now
 });
 const init=await fetch(origin+'/api/suite/auth/session');
 const browserCookie=init.headers.get('set-cookie').split(';')[0];
 const csrfToken=(await init.json()).csrfToken;
 t.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  identity.close();org.close();
  rmSync(root,{recursive:true,force:true});
 });
 const target={appId:APP,state,returnPath:'/work',
  codeChallenge:challenge,codeChallengeMethod:'S256',redirectUri:REDIRECT};
 async function post(route,body,{nativeClient=false}={}){
  const response=await fetch(origin+'/api/suite/auth/'+route,{
   method:'POST',
   headers:{'Content-Type':'application/json',...(nativeClient
    ?{Authorization:'Basic '+Buffer.from(APP+':'+secret).toString('base64')}
    :{Origin:origin,Cookie:browserCookie,'X-CSRF-Token':csrfToken})},
   body:JSON.stringify(body)
  });
  return {status:response.status,
   body:response.status===204?null:await response.json()};
 }
 return {identity,org,scientist,admin,adminSession,scientistSession,
  input,provisioner,guarded,inspector,post,target,
  authWrites:()=>({codes:codeCount,proofs:proofCount}),
  setMode:x=>{mode=x},duringNative:x=>{duringNative=x},
  currentSession:()=>currentSession,
  setNow:x=>{now=x},now:()=>now};
}

test('signed bind -> canonical preflight -> real broker authorize/login still DENY',async t=>{
 const f=await fixture(t);
 const linked=await f.provisioner.bind(f.input);
 assert.equal(linked.applied,true);
 assert.equal(linked.link.nativeUserId,'native-scientist-alpha');
 assert.equal(linked.link.accessGranted,false);
 assert.equal(linked.link.loginEnabled,false);
 assert.equal(f.identity.getAccess(f.scientist.id,APP).localIdentity.userId,
  'old-unscoped-native-user');
 const checked=await f.guarded.inspectCandidate(f.scientistSession,APP);
 assert.equal(checked.candidateReady,true);
 assert.equal(checked.workspaceOrganizationId,'alpha');
 assert.equal(checked.nativeOrganizationId,'native-laboratory-alpha');
 assert.equal(checked.accessGranted,false);
 assert.deepEqual(await f.post('authorize',f.target),{
  status:403,body:{error:'access_denied'}
 });
 assert.deepEqual(await f.post('login',{...f.target,
  email:'scientist@example.test',password:PASSWORD}),{
  status:403,body:{error:'access_denied'}
 });
 const ghost=await f.post('introspect',{
  sessionToken:randomBytes(32).toString('base64url')
 },{nativeClient:true});
 assert.deepEqual(ghost.body,{active:false});
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('signed-but-wrong tenant/nonce or disabled native user never provisions a link',async t=>{
 const f=await fixture(t);
 for(const mode of ['bad-tenant','bad-nonce','inactive']){
  f.setMode(mode);
  await assert.rejects(f.provisioner.bind(f.input),/native_ownership_unverified/);
  assert.equal(f.identity.getOrganizationNativeLink({
   userId:f.scientist.id,appId:APP,workspaceOrganizationId:'alpha'
  }),null);
  assert.equal((await f.guarded.inspectCandidate(f.scientistSession,APP)).candidateReady,false);
 }
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('signed inspect rejects a native proof invalidated after successful provisioning',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 assert.equal((await f.guarded.inspectCandidate(f.scientistSession,APP)).candidateReady,true);
 f.setMode('bad-nonce');
 assert.equal((await f.guarded.inspectCandidate(f.scientistSession,APP)).candidateReady,false);
 assert.equal((await f.post('authorize',f.target)).status,403);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('active admin can revoke signed native link; legacy grant cannot resurrect candidate',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 const revoked=await f.provisioner.revoke({
  sessionId:f.adminSession.id,userId:f.scientist.id,appId:APP,
  workspaceOrganizationId:'alpha'
 });
 assert.equal(revoked.applied,true);
 assert.equal(f.identity.getAccess(f.scientist.id,APP).localIdentity.userId,
  'old-unscoped-native-user');
 assert.equal((await f.guarded.inspectCandidate(f.scientistSession,APP)).candidateReady,false);
 assert.equal((await f.post('authorize',f.target)).status,403);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('revoked app permission during signed inspect cannot become broker access',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 f.duringNative(async challenge=>{
  if(challenge.purpose==='inspect')f.org.setPermission({
   organizationId:'alpha',actorId:f.admin.id,
   accountId:f.scientist.id,appId:APP,
   permission:'workspace.view',enabled:false
  });
 });
 const checked=await f.guarded.inspectCandidate(f.scientistSession,APP);
 assert.equal(checked.candidateReady,false);
 assert.equal((await f.post('authorize',f.target)).status,403);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});


function addBeta(t,f,{member='scientist'}={}){
 const account=member==='scientist'?f.scientist:f.admin;
 f.org.setupOrganization({
  organizationId:'beta',name:'Synthetic Laboratory Beta',
  owner:{accountId:account.id,name:'Beta Owner',nickname:'Beta',
   email:member==='scientist'?'scientist@example.test':'operator@example.test'}
 });
}

test('signed inspect rejects same-tick A -> cleared -> A tenant-lock ABA even after native proof',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 const before=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 f.duringNative(async proof=>{
  if(proof.purpose!=='inspect')return;
  f.org.clearSessionOrganization(f.scientistSession.id);
  f.org.selectSessionOrganization({
   sessionId:f.scientistSession.id,accountId:f.scientist.id,organizationId:'alpha'
  });
 });
 const checked=await f.guarded.inspectCandidate(f.scientistSession,APP);
 const after=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 assert(after.sessionLockEpoch>before.sessionLockEpoch);
 assert.equal(checked.candidateReady,false);
 assert.equal(checked.reason,'session_or_policy_changed_during_inspection');
 assert.equal(checked.loginEnabled,false);
 assert.equal((await f.post('authorize',f.target)).status,403);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('signed inspect rejects same-tick A -> B -> A tenant ABA even though final tenant matches',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 addBeta(t,f);
 const before=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 f.duringNative(async proof=>{
  if(proof.purpose!=='inspect')return;
  f.org.clearSessionOrganization(f.scientistSession.id);
  f.org.selectSessionOrganization({
   sessionId:f.scientistSession.id,accountId:f.scientist.id,organizationId:'beta'
  });
  f.org.clearSessionOrganization(f.scientistSession.id);
  f.org.selectSessionOrganization({
   sessionId:f.scientistSession.id,accountId:f.scientist.id,organizationId:'alpha'
  });
 });
 const checked=await f.guarded.inspectCandidate(f.scientistSession,APP);
 const after=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 assert(after.sessionLockEpoch>before.sessionLockEpoch);
 assert.equal(checked.candidateReady,false);
 assert.equal(checked.reason,'session_or_policy_changed_during_inspection');
 assert.equal(checked.accessGranted,false);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('signed provisioner rejects operator A -> B -> A during bind even at identical timestamps',async t=>{
 const f=await fixture(t);
 addBeta(t,f,{member:'admin'});
 const before=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.admin.id,sessionId:f.adminSession.id
 });
 f.duringNative(async proof=>{
  if(proof.purpose!=='bind')return;
  f.org.clearSessionOrganization(f.adminSession.id);
  f.org.selectSessionOrganization({
   sessionId:f.adminSession.id,accountId:f.admin.id,organizationId:'beta'
  });
  f.org.clearSessionOrganization(f.adminSession.id);
  f.org.selectSessionOrganization({
   sessionId:f.adminSession.id,accountId:f.admin.id,organizationId:'alpha'
  });
 });
 await assert.rejects(f.provisioner.bind(f.input),/native_ownership_unverified/);
 const after=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.admin.id,sessionId:f.adminSession.id
 });
 assert(after.sessionLockEpoch>before.sessionLockEpoch);
 assert.equal(f.identity.getOrganizationNativeLink({
  userId:f.scientist.id,appId:APP,workspaceOrganizationId:'alpha'
 }),null);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});

test('signed inspect rejects permission deny -> allow policy ABA after native await',async t=>{
 const f=await fixture(t);
 await f.provisioner.bind(f.input);
 const before=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 f.duringNative(async proof=>{
  if(proof.purpose!=='inspect')return;
  for(const enabled of [false,true])f.org.setPermission({
   organizationId:'alpha',actorId:f.admin.id,
   accountId:f.scientist.id,appId:APP,
   permission:'workspace.view',enabled
  });
 });
 const checked=await f.guarded.inspectCandidate(f.scientistSession,APP);
 const after=f.org.nativeProvisioningAuditRevision({
  organizationId:'alpha',accountId:f.scientist.id,
  sessionId:f.scientistSession.id
 });
 assert(after.organizationAuditRevision>before.organizationAuditRevision);
 assert.equal(checked.candidateReady,false);
 assert.equal(checked.reason,'session_or_policy_changed_during_inspection');
 assert.equal(checked.licensesGranted,false);
 assert.deepEqual(f.authWrites(),{codes:0,proofs:0});
});
