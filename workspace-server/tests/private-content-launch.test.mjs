import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedContentDestination} from '../private-content-launch.mjs';

const clients=[
 {appId:'limsman',nativeOrigin:'https://labduck.duckbio.net'},
 {appId:'duckman',nativeOrigin:'https://duckman.duckbio.net'}
];

function fixture(){
 const live={
  parent:true,org:'org1',sessionEpoch:1,
  membership:true,paid:true,permission:true,authorityEpoch:4,
  linked:true,linkEpoch:9,nativeUser:'native-alice',nativeOrg:'native-org1'
 };
 let resolveCalls=0;
 const identityStore={
  getParentSession:id=>live.parent&&id==='sess1'
   ?{id:'sess1',subject:'alice1'}:null,
  getOrganizationNativeLink:({userId,appId,workspaceOrganizationId})=>
   live.linked&&userId==='alice1'&&appId==='limsman'&&
   workspaceOrganizationId==='org1'?{
    userId,appId,workspaceOrganizationId,
    nativeUserId:live.nativeUser,nativeOrganizationId:live.nativeOrg,
    linkRevision:live.linkEpoch,linkOnly:true,
    accessGranted:false,licensesGranted:false,loginEnabled:false
   }:null
 };
 const organizationStore={
  currentSessionOrganization:({sessionId,accountId})=>
   live.membership&&sessionId==='sess1'&&accountId==='alice1'
   ?{id:live.org,sessionSelectionRevision:live.sessionEpoch}:null,
  verifiedNativePermissionCandidate:({organizationId,accountId,appId,permission})=>
   live.membership&&live.paid&&live.permission&&
   organizationId===live.org&&accountId==='alice1'&&
   appId==='limsman'&&permission==='workspace.view'
    ?{organizationId,accountId,appId,permission,
      source:'verified_live_subscription_ledger',
      nativeEnforcementRequired:true,accessGranted:false,licensesGranted:false,
      verifiedPaidThroughMs:1900000000000,
      authorizationAuditRevision:live.authorityEpoch}:null
 };
 const resolveResource=async input=>{
  resolveCalls++;
  assert.deepEqual(input,{
   contentId:'ld000001',viewerId:'alice1',appId:'limsman',
   organizationId:live.org,nativeUserId:live.nativeUser,
   nativeOrganizationId:live.nativeOrg
  });
  return {
   authorized:true,appId:'limsman',organizationId:live.org,
   nativeUserId:live.nativeUser,nativeOrganizationId:live.nativeOrg,
   url:'https://labduck.duckbio.net/content/ld000001'
  };
 };
 const args=()=>({
  contentId:'ld000001',viewerId:'alice1',sessionId:'sess1',
  identityStore,organizationStore,clients,resolveResource
 });
 return {live,identityStore,organizationStore,args,
  resolveCalls:()=>resolveCalls,resolveResource};
}

test('exact scoped native identity and current verified-live authorization allow only URL navigation',async()=>{
 const f=fixture();
 assert.equal(await authorizedContentDestination(f.args()),
  'https://labduck.duckbio.net/content/ld000001');
 assert.equal(f.resolveCalls(),1);
 // Even this positive private redirect is never a bearer token or API grant.
 assert.equal(f.organizationStore.verifiedNativePermissionCandidate({
  organizationId:'org1',accountId:'alice1',appId:'limsman',permission:'workspace.view'
 }).accessGranted,false);
 assert.equal(await authorizedContentDestination({...f.args(),viewerId:'other'}),null);
 assert.equal(await authorizedContentDestination({...f.args(),sessionId:'other'}),null);
 assert.equal(await authorizedContentDestination({...f.args(),contentId:'not-valid'}),null);
});

test('wrong app/org/native identities, unsafe URLs and unverifiable content never redirect',async()=>{
 const f=fixture();
 const valid=await f.resolveResource({
  contentId:'ld000001',viewerId:'alice1',appId:'limsman',
  organizationId:'org1',nativeUserId:'native-alice',nativeOrganizationId:'native-org1'
 });
 const invalid=[
  {...valid,authorized:false},
  {...valid,appId:'duckman'},
  {...valid,organizationId:'org2'},
  {...valid,nativeUserId:'another'},
  {...valid,nativeOrganizationId:'another'},
  {...valid,url:'https://evil.example/content/ld000001'},
  {...valid,url:'https://labduck.duckbio.net@evil.example/content/ld000001'},
  {...valid,url:'https://labduck.duckbio.net/content/ld000002'},
  {...valid,url:'https://labduck.duckbio.net/content/ld000001?access=public'},
  {...valid,url:'https://labduck.duckbio.net/content/ld000001#token'},
  {...valid,url:'http://labduck.duckbio.net/content/ld000001'}
 ];
 for(const resolved of invalid)
  assert.equal(await authorizedContentDestination({
   ...f.args(),resolveResource:async()=>resolved
  }),null,JSON.stringify(resolved));
});

test('revoke role, paid entitlement, active membership, parent or verified native link denies before lookup',async()=>{
 for(const key of ['permission','paid','membership','parent','linked']){
  const f=fixture();
  f.live[key]=false;
  assert.equal(await authorizedContentDestination(f.args()),null,key);
  assert.equal(f.resolveCalls(),0,key);
 }
 const f=fixture();
 f.live.org='org2';
 assert.equal(await authorizedContentDestination(f.args()),null);
 assert.equal(f.resolveCalls(),0);
});

test('during awaited native lookup role ABA, org clear/reselect, native rebind and parent logout all deny',async()=>{
 const scenarios=[
  live=>{live.authorityEpoch+=2;}, // revoke and regrant identical role
  live=>{live.sessionEpoch+=2;}, // clear + same-org reselect
  live=>{live.linkEpoch+=2;}, // native unlink + same tuple rebind
  live=>{live.parent=false;},
  live=>{live.paid=false;},
  live=>{live.nativeUser='native-after-rebind';}
 ];
 for(const mutate of scenarios){
  const f=fixture();
  const result=await authorizedContentDestination({
   ...f.args(),resolveResource:async input=>{
    mutate(f.live);
    return {authorized:true,appId:'limsman',organizationId:input.organizationId,
     nativeUserId:input.nativeUserId,nativeOrganizationId:input.nativeOrganizationId,
     url:'https://labduck.duckbio.net/content/ld000001'};
   }
  });
  assert.equal(result,null,'stale native lookup result must never cause redirect');
 }
});

test('missing org-native trust adapters or a legacy global grant alone cannot produce deep link',async()=>{
 const f=fixture();
 assert.equal(await authorizedContentDestination({
  ...f.args(),identityStore:{getParentSession:f.identityStore.getParentSession,
   getAccess:()=>({localIdentity:{userId:'native-alice'}})}
 }),null);
 assert.equal(await authorizedContentDestination({
  ...f.args(),organizationStore:{accessFor:()=>({role:'Admin'})}
 }),null);
 assert.equal(await authorizedContentDestination({
  ...f.args(),resolveResource:null
 }),null);
 assert.equal(await authorizedContentDestination({
  ...f.args(),clients:[]
 }),null);
 assert.equal(await authorizedContentDestination({
  ...f.args(),resolveResource:async()=>{throw Error('native offline')}
 }),null);
});

test('ambiguous native client configuration denies before resource resolution',async()=>{
 const f=fixture();
 const a={appId:'limsman',nativeOrigin:'https://labduck.duckbio.net'};
 const b={appId:'limsman',nativeOrigin:'https://other.example'};
 for(const clients of [[a,b],[b,a],[a,a]]){
  assert.equal(await authorizedContentDestination({...f.args(),clients}),null);
  assert.equal(f.resolveCalls(),0);
 }
 assert.equal(await authorizedContentDestination({
  ...f.args(),clients:[null,a]
 }),'https://labduck.duckbio.net/content/ld000001');
});
