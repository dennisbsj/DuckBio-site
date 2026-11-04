/**
 * End-to-end PRIVATE synthetic native signing adapter across BOTH actual
 * Workspace SQLite stores. No network, production credentials or app servers.
 * The current six-app SSO broker remains untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomBytes,createHash} from 'node:crypto';
import http from 'node:http';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeAccessInspector} from '../workspace-native-access-inspector.mjs';
import {createWorkspaceNativeBrokerDenyAdapter} from '../shared-auth/native-broker-deny-adapter.mjs';
import {createAuthBroker,createMemoryBrokerStore} from '../shared-auth/broker.mjs';
import {
 createSignedNativeOwnershipVerifier,canonicalNativeOwnershipProofBytes
} from '../shared-auth/signed-native-ownership-verifier.mjs';

const NOW=1800000000000;
const ACCOUNT='7854ab6c-6c8f-40ed-ac88-671a4d1ae101';
const NATIVE_ACCOUNT='native-account-a';
const NATIVE_TENANT='native-tenant-a';
const WORKSPACE_TENANT='workspace-a';

async function setup(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-real-native-proof-'));
 const keys=generateKeyPairSync('ed25519');
 const publicKeyPem=keys.publicKey.export({type:'spki',format:'pem'});
 let mode='valid',requests=[],onNativeRequest=null;
 const transport=async(url,init)=>{
  const body=JSON.parse(init.body);
  requests.push({url,body});
  if(onNativeRequest)await onNativeRequest(body);
  if(mode==='offline')throw Error('synthetic native service offline');
  const proof={...body,keyId:'native-key-a',issuedAt:NOW,
   expiresAt:NOW+20_000,active:true,ownershipVerified:true};
  if(mode==='wrong-tenant')proof.nativeOrganizationId='native-tenant-b';
  if(mode==='wrong-user')proof.workspaceAccountId='other-central-account';
  if(mode==='inactive')proof.active=false;
  if(mode==='wrong-purpose')proof.purpose=body.purpose==='bind'?'inspect':'bind';
  const signature=sign(null,canonicalNativeOwnershipProofBytes(proof),
   keys.privateKey).toString('base64url');
  return new Response(JSON.stringify({payload:proof,signature}),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
 const verifier=createSignedNativeOwnershipVerifier({
  clients:{goflo:{
   endpoint:'https://native.example.test/private/workspace/ownership',
   token:'synthetic-pinned-private-bearer-12345678',
   keyId:'native-key-a',publicKeyPem
  }},clock:()=>NOW,fetchImpl:transport
 });
 const org=createOrganizationStore({
  databasePath:path.join(root,'private','org.sqlite'),
  clock:()=>NOW,verifyLiveSubscriptionEvidence:value=>value
 });
 const identity=createIdentityStore({
  databasePath:path.join(root,'private','identity.sqlite'),
  clock:()=>NOW,
  orgNativeLinks:{
   authorizeMutation:async({actorId,userId,appId,workspaceOrganizationId})=>
    actorId===ACCOUNT&&userId===ACCOUNT&&
    org.organizationsFor(actorId).some(row=>
     row.id===workspaceOrganizationId&&row.admin) &&
    org.accessFor({organizationId:workspaceOrganizationId,
     accountId:userId,appId})!==null,
   verifyNativeOwnership:verifier.verifyNativeOwnership
  }
 });
 t.after(()=>{identity.close();org.close();
  rmSync(root,{force:true,recursive:true})});
 const user=await identity.createUser({
  id:ACCOUNT,email:'synthetic@example.test',displayName:'Synthetic',
  password:'private-synthetic-test-passphrase-only'
 });
 org.setupOrganization({organizationId:WORKSPACE_TENANT,
  name:'Synthetic laboratory',
  owner:{accountId:user.id,name:'Synthetic',nickname:'S',
   email:'synthetic@example.test'}});
 org.applyVerifiedSubscriptionTransition({
  source:'stripe_live',eventKey:'synthetic-live-event-a',
  organizationId:WORKSPACE_TENANT,subscriptionId:'synthetic-live-sub-a',
  revision:1,plan:'Single',apps:['goflo'],
  seats:2,status:'active',paidThrough:1900000000
 });
 org.saveMember({
  organizationId:WORKSPACE_TENANT,actorId:user.id,
  member:{accountId:user.id,name:'Synthetic',nickname:'S',
   email:'synthetic@example.test',admin:true,roles:{goflo:'Analyst'}}
 });
 const parent=identity.createSession(user.id).parent;
 org.selectSessionOrganization({sessionId:parent.id,accountId:user.id,
  organizationId:WORKSPACE_TENANT});
 const map={actorId:user.id,userId:user.id,appId:'goflo',
  workspaceOrganizationId:WORKSPACE_TENANT,
  nativeUserId:NATIVE_ACCOUNT,nativeOrganizationId:NATIVE_TENANT};
 const input={sessionId:parent.id,organizationId:WORKSPACE_TENANT,
  appId:'goflo',permission:'workspace.view'};
 const inspector=createWorkspaceNativeAccessInspector({
  identityStore:identity,organizationStore:org,
  verifyNativeMapping:verifier.verifyNativeMapping,clock:()=>NOW
 });
 return {identity,org,parent,verifier,inspector,map,input,
  setMode:v=>{mode=v},onRequest:fn=>{onNativeRequest=fn},requests:()=>requests};
}

test('signed native bind + real SQLite session, tenant, role and verified-live-shaped seat yields NON-authorizing candidate',async t=>{
 const f=await setup(t);
 const missing=await f.inspector.inspect(f.input);
 assert.equal(missing.candidateReady,false);
 assert.equal(f.requests().length,0,'no native call without central mapping');
 const linked=await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 assert.equal(linked.applied,true);
 assert.equal(f.identity.getAccess(ACCOUNT,'goflo'),null,
  'org scoped bind does not automatically grant the old SSO broker');
 const linkedWire=f.requests()[0].body;
 assert.equal(linkedWire.purpose,'bind');
 assert.equal(linkedWire.workspaceAccountId,ACCOUNT);
 assert.equal(linkedWire.workspaceOrganizationId,WORKSPACE_TENANT);
 const result=await f.inspector.inspect(f.input);
 assert.equal(result.candidateReady,true);
 assert.equal(result.accessGranted,false);
 assert.equal(result.licensesGranted,false);
 assert.equal(result.loginEnabled,false);
 assert.equal(result.nativeUserId,NATIVE_ACCOUNT);
 assert.equal(result.nativeOrganizationId,NATIVE_TENANT);
 assert.equal(f.requests()[1].body.purpose,'inspect');
 assert.notEqual(f.requests()[0].body.nonce,f.requests()[1].body.nonce);
});

test('cryptographically valid but wrong tenant or native account status denies the real SQLite candidate',async t=>{
 const f=await setup(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 for(const mode of ['wrong-tenant','wrong-user','inactive','wrong-purpose','offline']){
  f.setMode(mode);
  const denied=await f.inspector.inspect(f.input);
  assert.equal(denied.candidateReady,false,mode);
  assert.equal(denied.accessGranted,false);
  assert.equal(denied.licensesGranted,false);
  assert.equal(denied.loginEnabled,false);
 }
 f.setMode('valid');
 assert.equal((await f.inspector.inspect(f.input)).candidateReady,true);
});

test('signed native answer alone cannot bypass revoked central session or per-organization permission',async t=>{
 const f=await setup(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 assert.equal((await f.inspector.inspect(f.input)).candidateReady,true);
 const before=f.requests().length;
 f.org.setPermission({organizationId:WORKSPACE_TENANT,
  actorId:ACCOUNT,accountId:ACCOUNT,appId:'goflo',
  permission:'workspace.view',enabled:false});
 const denied=await f.inspector.inspect(f.input);
 assert.equal(denied.candidateReady,false);
 assert.equal(f.requests().length,before,
  'native signer should not be called when central role denies');
 f.org.setPermission({organizationId:WORKSPACE_TENANT,
  actorId:ACCOUNT,accountId:ACCOUNT,appId:'goflo',
  permission:'workspace.view',enabled:true});
 f.identity.revokeSession(f.parent.id);
 assert.equal((await f.inspector.inspect(f.input)).candidateReady,false);
});

test('a native proof cannot provision an unlicensed, unassigned or unreleased app',async t=>{
 const f=await setup(t);
 const old=f.requests().length;
 assert.equal((await f.inspector.inspect({...f.input,appId:'dataduck'})).reason,
  'dataduck_not_released');
 assert.equal((await f.inspector.inspect({...f.input,appId:'eel'})).candidateReady,false);
 assert.equal(f.requests().length,old);
 await assert.rejects(f.identity.bindVerifiedOrganizationNativeLink({
  ...f.map,appId:'dataduck'
 }),/invalid_org_native_link/);
});


test('a VALID signed native proof cannot outlive tenant permission revocation while the signature is being prepared',async t=>{
 const f=await setup(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 f.onRequest(async body=>{
  if(body.purpose!=='inspect')return;
  f.org.setPermission({organizationId:WORKSPACE_TENANT,
   actorId:ACCOUNT,accountId:ACCOUNT,appId:'goflo',
   permission:'workspace.view',enabled:false});
 });
 const after=await f.inspector.inspect(f.input);
 assert.equal(after.candidateReady,false);
 assert.equal(after.accessGranted,false);
 assert.equal(after.licensesGranted,false);
 assert.equal(after.loginEnabled,false);
 assert.equal(f.requests().at(-1).body.purpose,'inspect');
});

function signedNativeDenyGuard(f){
 const identity={
  async getSession(){return f.identity.getParentSession(f.parent.id)},
  async authenticate(){return f.parent},
  async getParentSession(id){return f.identity.getParentSession(id)},
  async logout(id){f.identity.revokeSession(id)}
 };
 return createWorkspaceNativeBrokerDenyAdapter({
  identity,organizationStore:f.org,inspector:f.inspector,
  permissions:{goflo:'workspace.view'}
 });
}

test('combined signed native proof + real SQLite roles + live-shaped seat yields candidate but zero broker PKCE codes',async t=>{
 const f=await setup(t);
 const linked=await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 assert.equal(linked.applied,true);
 const guarded=signedNativeDenyGuard(f);
 const candidate=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(candidate.candidateReady,true);
 assert.equal(candidate.accessGranted,false);
 assert.equal(candidate.loginEnabled,false);
 assert.match(candidate.preflightBindingRevision,/^[a-f0-9]{64}$/);
 assert.equal(await guarded.getAccess(f.parent,'goflo'),null);
 const store=createMemoryBrokerStore();
 let codes=0,proofs=0;
 const originalCode=store.putCode.bind(store);
 const originalProof=store.putProof.bind(store);
 store.putCode=async(...args)=>{codes++;return originalCode(...args)};
 store.putProof=async(...args)=>{proofs++;return originalProof(...args)};
 const clients=[{
  id:'goflo',appId:'goflo',secret:randomBytes(32).toString('base64url'),
  redirectUris:['https://goflo.example.test/auth/callback']
 }];
 let broker;
 const server=http.createServer(async(req,res)=>{
  if(!await broker.handle(req,res)){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve))});
 broker=createAuthBroker({
  origin,issuer:'https://identity.example.test',clients,
  identity:guarded,store,clock:()=>NOW
 });
 const csr=await fetch(origin+'/api/suite/auth/session');
 assert.equal(csr.status,200);
 const csrfToken=(await csr.json()).csrfToken;
 const cookie=csr.headers.get('set-cookie')?.split(';')[0];
 assert(cookie);
 const authorize=await fetch(origin+'/api/suite/auth/authorize',{
  method:'POST',
  headers:{'Content-Type':'application/json',Origin:origin,
   Cookie:cookie,'X-CSRF-Token':csrfToken},
  body:JSON.stringify({
   appId:'goflo',returnPath:'/analysis',
   state:randomBytes(32).toString('base64url'),
   codeChallenge:createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url'),
   codeChallengeMethod:'S256',redirectUri:clients[0].redirectUris[0]
  })
 });
 assert.equal(authorize.status,403);
 assert.deepEqual(await authorize.json(),{error:'access_denied'});
 assert.deepEqual([codes,proofs],[0,0],
  'positive cryptographic proof is never a login entitlement');
});

test('combined signed native verifier detects in-flight permission revoke/regrant ABA and refuses broker access',async t=>{
 const f=await setup(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 const guarded=signedNativeDenyGuard(f);
 const before=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(before.candidateReady,true);
 let changed=false;
 f.onRequest(async body=>{
  if(body.purpose!=='inspect'||changed)return;
  changed=true;
  f.org.setPermission({organizationId:WORKSPACE_TENANT,
   actorId:ACCOUNT,accountId:ACCOUNT,appId:'goflo',
   permission:'workspace.view',enabled:false});
  f.org.setPermission({organizationId:WORKSPACE_TENANT,
   actorId:ACCOUNT,accountId:ACCOUNT,appId:'goflo',
   permission:'workspace.view',enabled:true});
 });
 const denied=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(changed,true);
 assert.equal(denied.candidateReady,false);
 assert.equal(denied.loginEnabled,false);
 assert.equal(await guarded.getAccess(f.parent,'goflo'),null);
 f.onRequest(null);
 const after=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(after.candidateReady,true);
 assert.equal(after.role,before.role);
 assert.equal(after.nativeUserId,before.nativeUserId);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
 assert.equal(await guarded.getAccess(f.parent,'goflo'),null);
});

test('combined signed native verifier denies in-flight same-user/tenant native link revoke-rebind ABA',async t=>{
 const f=await setup(t);
 await f.identity.bindVerifiedOrganizationNativeLink(f.map);
 const guarded=signedNativeDenyGuard(f);
 const before=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(before.candidateReady,true);
 let changed=false;
 f.onRequest(async body=>{
  if(body.purpose!=='inspect'||changed)return;
  changed=true;
  await f.identity.revokeVerifiedOrganizationNativeLink({
   actorId:ACCOUNT,userId:ACCOUNT,appId:'goflo',
   workspaceOrganizationId:WORKSPACE_TENANT
  });
  const rebound=await f.identity.bindVerifiedOrganizationNativeLink(f.map);
  assert.equal(rebound.applied,true);
 });
 const denied=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(changed,true);
 assert.equal(denied.candidateReady,false);
 assert.equal(denied.loginEnabled,false);
 f.onRequest(null);
 const after=await guarded.inspectCandidate(f.parent,'goflo');
 assert.equal(after.candidateReady,true);
 assert.equal(after.nativeUserId,before.nativeUserId);
 assert.equal(after.nativeOrganizationId,before.nativeOrganizationId);
 assert.notEqual(after.preflightBindingRevision,before.preflightBindingRevision);
 assert.equal(await guarded.getAccess(f.parent,'goflo'),null);
});
