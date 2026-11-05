import test from 'node:test';
import assert from 'node:assert/strict';
import {DATADUCK_APP,EXISTING_DUCKBIO_APP_IDS,
 inspectDataDuckClientCandidate,inspectDataDuckNativeEntitlement,
 inspectFutureSevenAppPlanCandidate}
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

test('future seven-app pricing grammar: Single 1, Mixed 2–6 and Bundle exactly all seven without any purchase',()=>{
 const all=[...EXISTING_DUCKBIO_APP_IDS,'dataduck'];
 const single=inspectFutureSevenAppPlanCandidate({
  plan:'Single',apps:['dataduck'],seats:2
 });
 assert.equal(single.ok,true);
 assert.deepEqual(single.apps,['dataduck']);
 assert.equal(single.licensesGranted,false);
 assert.equal(single.purchaseAuthorized,false);
 assert.equal(single.accessGranted,false);
 for(let count=2;count<=6;count++){
  const mixed=inspectFutureSevenAppPlanCandidate({
   plan:'Mixed',apps:all.slice(0,count),seats:count
  });
  assert.equal(mixed.ok,true,'Mixed should allow '+count+' of seven apps');
  assert.equal(mixed.plan,'Mixed');
  assert.equal(mixed.migrationAuthorized,false);
  assert.equal(mixed.proposalOnly,true);
 }
 const bundle=inspectFutureSevenAppPlanCandidate({
  plan:'Bundle',apps:all.slice().reverse(),seats:5
 });
 assert.equal(bundle.ok,true);
 assert.deepEqual(bundle.apps,[...all].sort());
 assert.equal(bundle.dataduckIncluded,true);
 assert.equal(bundle.legacySixAppBundleAutomaticallyUpgraded,false);
 assert.equal(bundle.grandfatheredSixAppSubscriptionChanges,false);
 assert.equal(bundle.licensesGranted,false);
 assert.equal(bundle.purchaseAuthorized,false);
});

test('historic six-app Bundle can never silently become seven-app Bundle or gain DataDuck',()=>{
 const six=[...EXISTING_DUCKBIO_APP_IDS];
 const old=inspectFutureSevenAppPlanCandidate({
  plan:'Bundle',apps:six,seats:5
 });
 assert.equal(old.ok,false);
 assert.equal(old.reason,'invalid_future_plan_selection');
 assert.equal(old.accessGranted,false);
 const mistaken=inspectFutureSevenAppPlanCandidate({
  plan:'Mixed',apps:[...six,'dataduck'],seats:5
 });
 assert.equal(mistaken.ok,false,'a seven-app selection must be Bundle, not Mixed');
 const standalone=inspectFutureSevenAppPlanCandidate({
  plan:'Mixed',apps:[...six],seats:5
 });
 assert.equal(standalone.ok,true,'six selected apps are Mixed in the new catalog');
 assert.equal(standalone.dataduckIncluded,false);
 assert.equal(standalone.legacySixAppBundleAutomaticallyUpgraded,false);
 assert.equal(standalone.licensesGranted,false);
});

test('unknown app, duplicate app, bad quantity and wrong future plan selections deny without side effects',()=>{
 const all=[...EXISTING_DUCKBIO_APP_IDS,'dataduck'];
 const bad=[
  {plan:'Bundle',apps:[...all,all[0]],seats:1},
  {plan:'Single',apps:[],seats:1},
  {plan:'Single',apps:[all[0],all[1]],seats:1},
  {plan:'Mixed',apps:[all[0]],seats:1},
  {plan:'Mixed',apps:all,seats:1},
  {plan:'Bundle',apps:all.slice(1),seats:1},
  {plan:'Single',apps:['unknown'],seats:1},
  {plan:'Mixed',apps:[all[0],all[0]],seats:1},
  {plan:'Bundle',apps:all,seats:0},
  {plan:'Bundle',apps:all,seats:10001},
  {plan:'Bundle',apps:all,seats:1.5},
  {plan:'free',apps:all,seats:1},
  {plan:'Bundle',apps:'dataduck',seats:1}
 ];
 for(const query of bad){
  const proposal=inspectFutureSevenAppPlanCandidate(query);
  assert.equal(proposal.ok,false,JSON.stringify(query));
  assert.equal(proposal.purchaseAuthorized,false);
  assert.equal(proposal.licensesGranted,false);
  assert.equal(proposal.accessGranted,false);
 }
});
