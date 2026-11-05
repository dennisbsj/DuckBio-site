/**
 * Cross-store synthetic integration with REAL Workspace identity and
 * organization SQLite stores. No customer, Stripe or native network access.
 * This suite depends on the dormant inspector proposed in PR #136.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {createAuthBroker,createMemoryBrokerStore} from '../shared-auth/broker.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createWorkspaceNativeAccessInspector} from '../workspace-native-access-inspector.mjs';
import {createNativeOrganizationBrokerAccessAdapter} from '../shared-auth/native-organization-access-adapter.mjs';

const ACCOUNT='2f8164be-4529-48ac-a2cb-a9094019ba01';
const NATIVE_USER='2f8164be-4529-48ac-a2cb-a9094019ba02';
const NATIVE_ORG='2f8164be-4529-48ac-a2cb-a9094019ba03';
const OTHER_NATIVE='2f8164be-4529-48ac-a2cb-a9094019ba04';
const OTHER_ORG='2f8164be-4529-48ac-a2cb-a9094019ba05';
const PAID_THROUGH=1900000000;
const milliseconds=PAID_THROUGH*1000;

async function fixture(t,{onlyHistoricalSeats=false}={}){
 const root=mkdtempSync(path.join(os.tmpdir(),'duckbio-native-cross-store-'));
 let now=1800000000000;
 const identity=createIdentityStore({
  databasePath:path.join(root,'private','identity.sqlite'),clock:()=>now,
  // Synthetic-only private operator/native verifiers (not production).
  orgNativeLinks:{authorizeMutation:async()=>true,verifyNativeOwnership:async()=>true}
 });
 const organization=createOrganizationStore({
  databasePath:path.join(root,'private','organization.sqlite'),clock:()=>now,
  // Synthetic, PRIVATE, deterministic substitute for the separately required
  // real signed LIVE evidence verifier. Not a production billing configuration.
  verifyLiveSubscriptionEvidence: evidence=>evidence
 });
 t.after(()=>{identity.close();organization.close();
  rmSync(root,{force:true,recursive:true})});
 const user=await identity.createUser({id:ACCOUNT,email:'alice@example.test',
  displayName:'Alice',password:'synthetic-offline-password-only'});
 for(const id of ['alpha','beta']){
  organization.setupOrganization({organizationId:id,name:'Lab '+id,
   owner:{accountId:user.id,name:'Alice',nickname:'Alice',
    email:'alice@example.test'}});
  if(onlyHistoricalSeats){
   organization.applyVerifiedSeatPurchase({reference:'old-'+id,
    organizationId:id,plan:'Single',apps:['goflo'],seats:2});
  }else{
   organization.applyVerifiedSubscriptionTransition({
    source:'stripe_live',eventKey:'event-'+id,
    organizationId:id,subscriptionId:'sub-'+id,revision:1,
    plan:'Single',apps:['goflo'],seats:2,status:'active',
    paidThrough:PAID_THROUGH
   });
  }
  organization.saveMember({organizationId:id,actorId:user.id,
   member:{accountId:user.id,name:'Alice',nickname:'Alice',
    email:'alice@example.test',admin:true,roles:{goflo:'Analyst'}}});
 }
 const alpha=identity.createSession(user.id).parent;
 const beta=identity.createSession(user.id).parent;
 organization.selectSessionOrganization({sessionId:alpha.id,
  accountId:user.id,organizationId:'alpha'});
 organization.selectSessionOrganization({sessionId:beta.id,
  accountId:user.id,organizationId:'beta'});
 identity.grantAppAccess({userId:user.id,appId:'goflo',
  localUserId:NATIVE_USER,organizationId:NATIVE_ORG});
 // Legacy (account,app) grants remain untouched, but never qualify.
 await identity.bindVerifiedOrganizationNativeLink({actorId:user.id,
  userId:user.id,appId:'goflo',workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG});
 const expected={
  appId:'goflo',workspaceAccountId:user.id,
  workspaceOrganizationId:'alpha',
  nativeUserId:NATIVE_USER,nativeOrganizationId:NATIVE_ORG
 };
 const verified=x=>Object.keys(expected).every(k=>x[k]===expected[k]);
 const inspector=(check=async x=>verified(x))=>
  createWorkspaceNativeAccessInspector({
   identityStore:identity,organizationStore:organization,
   verifyNativeMapping:check,clock:()=>now
  });
 const alphaRequest=Object.freeze({sessionId:alpha.id,
  organizationId:'alpha',appId:'goflo',permission:'workspace.view'});
 const betaRequest=Object.freeze({...alphaRequest,
  sessionId:beta.id,organizationId:'beta'});
 return {identity,organization,user,alpha,beta,
  alphaRequest,betaRequest,inspector,verified,
  setNow:x=>{now=x}};
}

test('real identity sessions + organization roles + verified LIVE SQLite allocations yield candidate only',async t=>{
 const f=await fixture(t);
 const decision=await f.inspector().inspect(f.alphaRequest);
 assert.equal(decision.candidateReady,true);
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.licensesGranted,false);
 assert.equal(decision.loginEnabled,false);
 assert.equal(decision.workspaceAccountId,f.user.id);
 assert.equal(decision.workspaceOrganizationId,'alpha');
 assert.equal(decision.nativeUserId,NATIVE_USER);
 assert.equal(decision.nativeOrganizationId,NATIVE_ORG);
 assert.equal(decision.verifiedPaidThroughMs,milliseconds);
});

test('multi-organization membership cannot reuse an exact native tenant binding',async t=>{
 const f=await fixture(t),inspect=f.inspector();
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,true);
 assert.equal((await inspect.inspect(f.betaRequest)).reason,'central_session_role_seat_or_link_missing');
 assert.equal((await inspect.inspect({...f.alphaRequest,organizationId:'beta'}))
  .candidateReady,false);
 assert.equal((await inspect.inspect({...f.betaRequest,organizationId:'alpha'}))
  .candidateReady,false);
 // A different user's native tenant must not be inferred from email matches.
 assert.equal((await f.inspector(async x=>x.nativeOrganizationId===OTHER_ORG)
  .inspect(f.alphaRequest)).candidateReady,false);
});

test('unverified historical capacity cannot be mistaken for a current paid seat',async t=>{
 const f=await fixture(t,{onlyHistoricalSeats:true});
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,false);
});

test('central logout and account suspension immediately invalidate the authentic parent session',async t=>{
 const f=await fixture(t),inspect=f.inspector();
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,true);
 f.identity.revokeSession(f.alpha.id);
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
 assert.equal((await inspect.inspect(f.betaRequest)).candidateReady,false);
 f.identity.setUserState(f.user.id,'disabled');
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
});

test('removing a native link during verification denies even with an otherwise valid central session',async t=>{
 const f=await fixture(t);
 const inspect=f.inspector(async x=>{
  if(!f.verified(x))return false;
  await f.identity.revokeVerifiedOrganizationNativeLink({actorId:f.user.id,
   userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
  return true;
 });
 assert.equal((await inspect.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 assert.equal((await inspect.inspect(f.alphaRequest)).candidateReady,false);
});

test('editing an organization role during native verification cannot keep a stale permission',async t=>{
 const f=await fixture(t);
 const inspect=f.inspector(async x=>{
  if(!f.verified(x))return false;
  const policy=f.organization.listRoles({organizationId:'alpha',
   actorId:f.user.id,appId:'goflo'});
  const analyst=policy.roles.find(r=>r.name==='Analyst');
  f.organization.saveRole({organizationId:'alpha',actorId:f.user.id,
   appId:'goflo',role:'Analyst',
   permissions:analyst.permissions.filter(p=>p!=='workspace.view')});
  return true;
 });
 assert.equal((await inspect.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 assert.equal((await f.inspector().inspect(f.alphaRequest)).candidateReady,false);
 assert.equal((await f.inspector().inspect(f.betaRequest)).reason,
  'central_session_role_seat_or_link_missing');
});

test('DataDuck still has no registered production app grant or usable candidate',async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.identity.grantAppAccess({userId:f.user.id,
  appId:'dataduck',localUserId:OTHER_NATIVE,
  organizationId:OTHER_ORG}),/invalid_grant/);
 const decision=await f.inspector().inspect({...f.alphaRequest,appId:'dataduck'});
 assert.equal(decision.reason,'dataduck_not_released');
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.licensesGranted,false);
});

test('same person may map to two distinct native tenants without legacy fallback',async t=>{
 const f=await fixture(t);
 const beta=await f.identity.bindVerifiedOrganizationNativeLink({
  actorId:f.user.id,userId:f.user.id,appId:'goflo',
  workspaceOrganizationId:'beta',nativeUserId:OTHER_NATIVE,
  nativeOrganizationId:OTHER_ORG});
 assert.equal(beta.link.accessGranted,false);
 assert(Number.isSafeInteger(beta.link.linkRevision));
 const check=async x=>x.workspaceAccountId===f.user.id&&x.appId==='goflo'&&(
  (x.workspaceOrganizationId==='alpha'&&x.nativeUserId===NATIVE_USER&&
   x.nativeOrganizationId===NATIVE_ORG)||
  (x.workspaceOrganizationId==='beta'&&x.nativeUserId===OTHER_NATIVE&&
   x.nativeOrganizationId===OTHER_ORG));
 const inspector=f.inspector(check);
 const a=await inspector.inspect(f.alphaRequest);
 const b=await inspector.inspect(f.betaRequest);
 assert.equal(a.candidateReady,true);
 assert.equal(b.candidateReady,true);
 assert.notEqual(a.nativeUserId,b.nativeUserId);
 assert.notEqual(a.nativeOrganizationId,b.nativeOrganizationId);
 assert.equal(a.loginEnabled,false);
 assert.equal(b.licensesGranted,false);
 // Removing an unscoped legacy grant cannot change the canonical link.
 f.identity.revokeAppAccess(f.user.id,'goflo');
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,true);
 assert.equal((await inspector.inspect(f.betaRequest)).candidateReady,true);
 await f.identity.revokeVerifiedOrganizationNativeLink({
  actorId:f.user.id,userId:f.user.id,appId:'goflo',workspaceOrganizationId:'beta'});
 assert.equal((await inspector.inspect(f.betaRequest)).candidateReady,false);
 assert.equal((await inspector.inspect(f.alphaRequest)).candidateReady,true);
});

test('revocation and rebind of same native tuple during await denies via generation (ABA)',async t=>{
 const f=await fixture(t);
 const get=()=>f.identity.getOrganizationNativeLink({
  userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
 const before=get();
 const inspector=f.inspector(async x=>{
  assert.equal(f.verified(x),true);
  await f.identity.revokeVerifiedOrganizationNativeLink({
   actorId:f.user.id,userId:f.user.id,appId:'goflo',workspaceOrganizationId:'alpha'});
  await f.identity.bindVerifiedOrganizationNativeLink({
   actorId:f.user.id,userId:f.user.id,appId:'goflo',
   workspaceOrganizationId:'alpha',nativeUserId:NATIVE_USER,
   nativeOrganizationId:NATIVE_ORG});
  return true;
 });
 assert.equal((await inspector.inspect(f.alphaRequest)).reason,
  'access_changed_during_verification');
 const after=get();
 assert.equal(before.nativeUserId,after.nativeUserId);
 assert.equal(before.verifiedAt,after.verifiedAt);
 assert(after.linkRevision>before.linkRevision);
 assert.equal(after.loginEnabled,false);
});

test('missing scoped generation cannot produce even an inspection candidate',async t=>{
 const f=await fixture(t),source=f.identity;
 const identityStore={
  getParentSession:id=>source.getParentSession(id),
  getUser:id=>source.getUser(id),
  getOrganizationNativeLink:input=>{
   const link=source.getOrganizationNativeLink(input);
   return link?{...link,linkRevision:null}:null;
  }
 };
 const failClosed=createWorkspaceNativeAccessInspector({
  identityStore,organizationStore:f.organization,
  verifyNativeMapping:async()=>true,clock:()=>1800000000000
 });
 const decision=await failClosed.inspect(f.alphaRequest);
 assert.equal(decision.candidateReady,false);
 assert.equal(decision.accessGranted,false);
 assert.equal(decision.reason,'central_session_role_seat_or_link_missing');
});

/** Future broker-compatible org mode. Unmounted. Synthetic signed-owner adapter,
 * but REAL native links, parent sessions, LIVE-ledger schema, roles and SQLite. */
function sourceOnlyBrokerAdapter(f,inspector=f.inspector()){
 const parentIdentity={
  getSession:async()=>null,
  authenticate:async()=>null,
  getParentSession:id=>f.identity.getParentSession(id),
  logout:id=>f.identity.revokeSession(id)
 };
 return createNativeOrganizationBrokerAccessAdapter({
  identity:parentIdentity,identityStore:f.identity,
  organizationStore:f.organization,inspector,clock:()=>1800000000000
 });
}

test('cross-store org broker adapter produces native epoch only for exact LIVE-linked tenant',async t=>{
 const f=await fixture(t);
 const broker=sourceOnlyBrokerAdapter(f);
 const grant=await broker.getAccess(f.alpha,'goflo');
 assert(grant);
 assert.deepEqual(grant.localIdentity,{userId:NATIVE_USER,organizationId:NATIVE_ORG});
 assert.match(grant.bindingRevision,/^org-native-v1:[A-Za-z0-9_-]{43}$/);
 assert.equal((await broker.getAccess(f.alpha,'goflo')).bindingRevision,grant.bindingRevision);
 assert.equal(await broker.getAccess(f.beta,'goflo'),null,
  'a separately paid second org may not reuse alpha native binding');
 assert.equal(await broker.getAccess(f.alpha,'dataduck'),null,
  'DataDuck is still excluded from active six-app organization SSO');
});

test('real SQLite role revoke/regrant changes broker child-proof binding generation',async t=>{
 const f=await fixture(t);
 const broker=sourceOnlyBrokerAdapter(f);
 const initial=await broker.getAccess(f.alpha,'goflo');
 assert(initial);
 const update=enabled=>f.organization.setPermission({
  organizationId:'alpha',actorId:f.user.id,accountId:f.user.id,
  appId:'goflo',permission:'workspace.view',enabled
 });
 update(false);
 assert.equal(await broker.getAccess(f.alpha,'goflo'),null);
 update(true);
 const current=await broker.getAccess(f.alpha,'goflo');
 assert(current);
 assert.notEqual(current.bindingRevision,initial.bindingRevision,
  'revoked and restored identical permission must not resurrect prior proof');
});

test('real SQLite role ABA during awaited signed-owner preflight refuses stale organization grant',async t=>{
 const f=await fixture(t);
 const signed=f.inspector(async request=>{
  assert.equal(f.verified(request),true);
  for(const enabled of [false,true])f.organization.setPermission({
   organizationId:'alpha',actorId:f.user.id,accountId:f.user.id,
   appId:'goflo',permission:'workspace.view',enabled
  });
  return true;
 });
 const broker=sourceOnlyBrokerAdapter(f,signed);
 assert.equal(await broker.getAccess(f.alpha,'goflo'),null);
 assert((await sourceOnlyBrokerAdapter(f).getAccess(f.alpha,'goflo'))?.bindingRevision);
});

test('same-tenant session clear and reselect during native proof is denied',async t=>{
 const f=await fixture(t);
 const inspector=f.inspector(async request=>{
  assert.equal(f.verified(request),true);
  f.organization.clearSessionOrganization(f.alpha.id);
  f.organization.selectSessionOrganization({
   sessionId:f.alpha.id,accountId:f.user.id,organizationId:'alpha'
  });
  return true;
 });
 const broker=sourceOnlyBrokerAdapter(f,inspector);
 assert.equal(await broker.getAccess(f.alpha,'goflo'),null);
 const current=await sourceOnlyBrokerAdapter(f).getAccess(f.alpha,'goflo');
 assert(current);
});

test('unverified legacy seat purchase never qualifies for broker organization access',async t=>{
 const f=await fixture(t,{onlyHistoricalSeats:true});
 const broker=sourceOnlyBrokerAdapter(f);
 assert.equal(await broker.getAccess(f.alpha,'goflo'),null);
 assert.equal(await broker.getAccess(f.beta,'goflo'),null);
});

test('REAL broker HTTP PKCE handoff uses LIVE-org SQLite grant epochs and rejects revoked child proof',async t=>{
 const f=await fixture(t);
 const parentIdentity={
  getSession:async()=>f.alpha,
  authenticate:async()=>f.alpha,
  getParentSession:id=>f.identity.getParentSession(id),
  logout:id=>f.identity.revokeSession(id)
 };
 const signedInspector=f.inspector(async x=>f.verified(x));
 const brokerIdentity=createNativeOrganizationBrokerAccessAdapter({
  identity:parentIdentity,identityStore:f.identity,
  organizationStore:f.organization,inspector:signedInspector,
  clock:()=>1800000000000
 });
 const secret=randomBytes(32).toString('base64url');
 const state=randomBytes(32).toString('base64url');
 const verifier=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const redirectUri='https://cytoduck.example.test/auth/callback';
 // Unlike the earlier synthetic broker tests, this handoff persists PKCE
 // codes and native proof records in the ACTUAL SQLite broker-store.
 const brokerRoot=mkdtempSync(path.join(os.tmpdir(),'duckbio-real-broker-store-'));
 const brokerFile=path.join(brokerRoot,'private','auth.sqlite');
 const brokerStorage=createSqliteAuthStores({
  databasePath:brokerFile,clock:()=>1800000000000
 });
 t.after(()=>{brokerStorage.close();rmSync(brokerRoot,{recursive:true,force:true})});
 let broker;
 const server=http.createServer(async(req,res)=>{
  try{
   if(!await broker.handle(req,res)){res.statusCode=404;res.end();}
  }catch{res.statusCode=500;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 broker=createAuthBroker({origin,issuer:'https://identity.example.test',
  clients:[{id:'goflo',appId:'goflo',secret,redirectUris:[redirectUri]}],
  identity:brokerIdentity,store:brokerStorage.brokerStore,
  clock:()=>1800000000000
 });
 const preflight=await fetch(origin+'/api/suite/auth/session');
 assert.equal(preflight.status,200);
 const csrf=await preflight.json();
 const cookie=preflight.headers.get('set-cookie').split(';')[0];
 const target={appId:'goflo',returnPath:'/analysis',state,
  codeChallenge:challenge,codeChallengeMethod:'S256',redirectUri};
 const post=async(route,payload,native=false)=>{
  const response=await fetch(origin+'/api/suite/auth/'+route,{
   method:'POST',headers:{'Content-Type':'application/json',
    ...(native?{'Authorization':'Basic '+Buffer.from('goflo:'+secret).toString('base64')}:
      {'Origin':origin,'Cookie':cookie,'X-CSRF-Token':csrf.csrfToken})},
   body:JSON.stringify(payload)
  });
  return {status:response.status,data:response.status===204?null:await response.json()};
 };
 const authorize=()=>post('authorize',target);
 const exchange=code=>post('exchange',{clientId:'goflo',code,state,
  codeVerifier:verifier,redirectUri},true);
 const introspect=token=>post('introspect',{sessionToken:token},true);
 const first=await authorize();
 assert.equal(first.status,200,'current LIVE paid seat and exact signed native owner must allow reviewed candidate');
 const code=new URL(first.data.redirectUrl).searchParams.get('code');
 const issued=await exchange(code);
 assert.equal(issued.status,200);
 assert.deepEqual(issued.data.localIdentity,{userId:NATIVE_USER,organizationId:NATIVE_ORG});
 const proof=issued.data.sessionToken;
 assert.equal((await introspect(proof)).data.active,true);
 const peer=createSqliteAuthStores({
  databasePath:brokerFile,clock:()=>1800000000000
 });
 try{
  const hash=createHash('sha256').update(proof).digest('hex');
  const durable=await peer.brokerStore.getProof(hash);
  assert.equal(durable.parentSessionId,f.alpha.id,
   'separate SQLite process can read the exact exchanged native child proof');
  assert.deepEqual(durable.localIdentity,{
   userId:NATIVE_USER,organizationId:NATIVE_ORG
  });
 }finally{peer.close();}
 // Two separate HTTP exchange requests compete for one durable PKCE code.
 const race=await authorize();
 assert.equal(race.status,200);
 const raceCode=new URL(race.data.redirectUrl).searchParams.get('code');
 const results=await Promise.all([exchange(raceCode),exchange(raceCode)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,401],
  'SQLite DELETE ... RETURNING permits exactly one code redemption');
 // Revocation is persistent and must invalidate a previously exchanged
 // child proof even if the exact same role/permission is restored.
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',enabled:false});
 assert.deepEqual((await introspect(proof)).data,{active:false});
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',enabled:true});
 assert.deepEqual((await introspect(proof)).data,{active:false},
  'regranting identical permission must never resurrect old child sessions');
 // A code minted before a same-value revoke/regrant must also fail PKCE
 // exchange, not just a previously issued child-session proof.
 const stale=await authorize();
 assert.equal(stale.status,200);
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',enabled:false});
 f.organization.setPermission({organizationId:'alpha',actorId:f.user.id,
  accountId:f.user.id,appId:'goflo',permission:'workspace.view',enabled:true});
 const staleCode=new URL(stale.data.redirectUrl).searchParams.get('code');
 assert.equal((await exchange(staleCode)).status,401,
  'old authorization code cannot survive a restored identical role');
 const next=await authorize();
 assert.equal(next.status,200);
 const nextProof=await exchange(new URL(next.data.redirectUrl).searchParams.get('code'));
 assert.equal(nextProof.status,200);
 assert.equal((await introspect(nextProof.data.sessionToken)).data.active,true);
 // The separately paid beta tenant cannot reuse the first native link.
 f.organization.clearSessionOrganization(f.alpha.id);
 f.organization.selectSessionOrganization({sessionId:f.alpha.id,accountId:f.user.id,
  organizationId:'beta'});
 assert.deepEqual((await introspect(nextProof.data.sessionToken)).data,{active:false});
 assert.equal((await authorize()).status,403);
});
