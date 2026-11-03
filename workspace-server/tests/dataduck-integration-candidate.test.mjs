import test from 'node:test';
import assert from 'node:assert/strict';
import {DATADUCK_APP,EXISTING_DUCKBIO_APP_IDS,
 inspectDataDuckClientCandidate,inspectDataDuckNativeEntitlement}
 from '../dataduck-integration-candidate.mjs';

const origin='https://staging-workspace.duckbio.net';
const clients=()=>{
 const ids=[...EXISTING_DUCKBIO_APP_IDS,'dataduck'];
 return ids.map((id,i)=>({
  id,appId:id,secret:String(i).repeat(36),
  nativeOrigin:'https://staging-'+id+'.duckbio.net',
  redirectUris:['https://staging-'+id+'.duckbio.net/auth/callback']
 }));
};

test('DataDuck has exact native ID, existing six remain unchanged and new entitlement is disabled',()=>{
 assert.equal(DATADUCK_APP.id,'dataduck');
 assert.equal(DATADUCK_APP.productionEnabled,false);
 assert.equal(DATADUCK_APP.stagingEnabled,false);
 assert.equal(DATADUCK_APP.licenseModel,'independent-per-app-seat');
 assert.deepEqual(DATADUCK_APP.nativeRoles,['Admin','Analyst','Reviewer','ReadOnly']);
 assert.deepEqual(EXISTING_DUCKBIO_APP_IDS,[
  'goflo','eel','methpipe','mantrain','duckman','limsman']);
});

test('separate exact seventh broker client candidate has no launch or grant side effects',()=>{
 const result=inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:clients()});
 assert.deepEqual(result,{ok:true,failures:[],productionAuthorized:false,
  licensesGranted:false,deployable:false});
});
test('six-client history and invalid seventh registrations never pass as seven',()=>{
 assert.equal(inspectDataDuckClientCandidate({
  workspaceOrigin:origin,clients:clients().slice(0,6)}).ok,false);
 const duplicate=clients();duplicate[6].id='eel';duplicate[6].appId='eel';
 assert.equal(inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:duplicate}).ok,false);
 const foreign=clients();foreign[6].nativeOrigin=foreign[0].nativeOrigin;
 assert.equal(inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:foreign}).ok,false);
 const reused=clients();reused[6].secret=reused[0].secret;
 assert.equal(inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:reused}).ok,false);
 const callback=clients();callback[6].redirectUris=['https://somewhere.else/auth/callback'];
 assert.equal(inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:callback}).ok,false);
 const publicish=clients();publicish[6].nativeOrigin='http://localhost:3309';
 assert.equal(inspectDataDuckClientCandidate({workspaceOrigin:origin,clients:publicish}).ok,false);
});
test('native identity must match a separate fresh paid DataDuck entitlement',()=>{
 const identity={userId:'native-uuid-user',organizationId:'native-uuid-org'};
 const good={source:'verified-live',allowed:true,appId:'dataduck',
  ...identity,expiresAt:Date.now()+300000};
 assert.deepEqual(inspectDataDuckNativeEntitlement({localIdentity:identity,entitlement:good}),
  {ready:true,reason:'source-contract-only',accessGranted:false});
 for(const bad of [
  undefined,{...good,appId:'eel'},{...good,userId:'another'},
  {...good,organizationId:'another'},{...good,source:'stripe_test'},
  {...good,allowed:false},{...good,expiresAt:1}
 ])assert.equal(inspectDataDuckNativeEntitlement({
  localIdentity:identity,entitlement:bad}).accessGranted,false);
 assert.equal(inspectDataDuckNativeEntitlement({
  localIdentity:null,entitlement:good}).ready,false);
});
