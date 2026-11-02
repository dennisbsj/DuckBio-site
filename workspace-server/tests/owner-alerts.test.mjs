import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';
import {createResendOwnerAlertMailer,dispatchOwnerAlerts} from '../owner-alert-mailer.mjs';
const at=1800000000000;
function fixture(t,{optedIn=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'duckbio-owner-alert-'));
 const databasePath=join(dir,'secure','organizations.sqlite');
 let now=at;
 const options={databasePath,clock:()=>now,ownerAlertsOptIn:optedIn,
  verifyLiveSubscriptionEvidence:value=>{
   if(value?.proof!=='SYNTHETIC_PRIVATE_ONLY')throw Error('invalid');
   return value.payload;
  }};
 let store=createOrganizationStore(options);
 t.after(()=>{store?.close();rmSync(dir,{recursive:true,force:true});});
 const reopen=()=>{store.close();store=createOrganizationStore(options);};
 return {get store(){return store;},setTime(value){now=value;},reopen};
}
const owner={accountId:'owner1',name:'DuckBio Owner',nickname:'Owner',email:'owner@example.test'};
const subscription=()=>({proof:'SYNTHETIC_PRIVATE_ONLY',payload:{
 source:'stripe_live',eventKey:'evt_private_owner1',organizationId:'lab-one',
 subscriptionId:'sub_private_owner123',revision:1,plan:'Single',
 apps:['eel'],seats:2,status:'active',paidThrough:1900000000
}});
test('alerts are opt-in; ordinary organization changes remain in owner audit without sending',t=>{
 const f=fixture(t,{optedIn:false});
 f.store.setupOrganization({organizationId:'lab-one',name:'Lab One',owner});
 assert.equal(f.store.ownerAlertSummary().optedIn,false);
 assert.deepEqual(f.store.ownerAlertSummary().counts,{});
 assert.throws(()=>f.store.claimOwnerAlert(),/owner_alerts_disabled/);
 assert(f.store.ownerSnapshot().activity.some(x=>x.action==='organization.created'));
});
test('major organization, user, permission and paid subscription changes enqueue with redacted metadata',t=>{
 const f=fixture(t);
 f.store.setupOrganization({organizationId:'lab-one',name:'Lab One',owner});
 f.store.applyVerifiedSeatPurchase({reference:'verified_purchase_fixture123',
  organizationId:'lab-one',plan:'Single',apps:['eel'],seats:2});
 f.store.saveMember({organizationId:'lab-one',actorId:'owner1',member:{
  accountId:'scientist1',name:'Scientist',nickname:'S',
  email:'scientist@example.test',admin:false,roles:{eel:'scientist'}}});
 f.store.applyVerifiedSubscriptionTransition(subscription());
 const out=f.store.ownerSnapshot();
 assert.equal(out.alerts.optedIn,true);
 assert.equal(out.alerts.counts.pending,3,'organization creation, member addition and seat change');
 assert(out.activity.some(x=>x.action==='subscription.entitlement.transition'));
 const first=f.store.claimOwnerAlert();
 assert.equal(first.action,'organization.created');
 assert.equal(first.organizationName,'Lab One');
 assert.equal(first.actorId,'owner1');
 assert.equal(first.idempotencyKey,'duckbio-owner-audit-1');
 assert.equal(Object.hasOwn(first,'details'),false);
 assert(!JSON.stringify(first).includes('scientist@example.test'));
 assert.throws(()=>f.store.finishOwnerAlert({id:first.id,leaseToken:'wrong',success:true}),
  /owner_alert_lease_conflict/);
 assert.equal(f.store.finishOwnerAlert({id:first.id,leaseToken:first.leaseToken,
  success:true}).state,'sent');
 assert.equal(f.store.ownerAlertSummary().counts.sent,1);
 f.reopen();
 assert.equal(f.store.ownerAlertSummary().counts.pending,2);
 const second=f.store.claimOwnerAlert();
 assert.equal(second.action,'member.added');
 assert.equal(second.subject,'scientist1');
 f.store.finishOwnerAlert({id:second.id,leaseToken:second.leaseToken,success:true});
 const third=f.store.claimOwnerAlert();
 assert.equal(third.action,'subscription.entitlement.transition');
 assert.deepEqual(third.changes,[{appId:'eel',delta:2}]);
 f.store.finishOwnerAlert({id:third.id,leaseToken:third.leaseToken,success:true});
 assert.equal(f.store.claimOwnerAlert(),null);
 const renewal=subscription();
 renewal.payload.eventKey='evt_private_owner2';
 renewal.payload.revision=2;
 renewal.payload.paidThrough=1910000000;
 f.store.applyVerifiedSubscriptionTransition(renewal);
 assert.equal(f.store.claimOwnerAlert(),null,'renewal with no seat changes stays in audit only');
 assert.equal(f.store.ownerAlertSummary().counts.sent,3);
 assert.equal(f.store.overview('lab-one','owner1').apps.find(x=>x.id==='eel').purchased,4);
});
test('leased alerts are retried and not lost on provider timeout or process restart',async t=>{
 const f=fixture(t);
 f.store.setupOrganization({organizationId:'lab-one',name:'Lab One',owner});
 const first=f.store.claimOwnerAlert();
 assert.equal(f.store.claimOwnerAlert(),null,'a competing worker cannot claim an active lease');
 f.reopen();
 assert.equal(f.store.claimOwnerAlert(),null,'lease survives restart');
 f.setTime(at+120001);
 const reclaimed=f.store.claimOwnerAlert();
 assert.equal(reclaimed.id,first.id);
 assert.notEqual(reclaimed.leaseToken,first.leaseToken);
 assert.throws(()=>f.store.finishOwnerAlert({id:first.id,leaseToken:first.leaseToken,success:true}),
  /owner_alert_lease_conflict/);
 assert.equal(f.store.finishOwnerAlert({id:reclaimed.id,leaseToken:reclaimed.leaseToken,
  success:false}).state,'pending');
 assert.equal(f.store.claimOwnerAlert(),null,'retry backoff applies');
 f.setTime(at+120001+240001);
 let attempts=0;
 const result=await dispatchOwnerAlerts({store:f.store,mailer:{async send(item){
  attempts++;
  assert.equal(item.idempotencyKey,'duckbio-owner-audit-1');
 }}});
 assert.equal(result.accepted,1);
 assert.equal(attempts,1);
 assert.equal(f.store.ownerAlertSummary().counts.sent,1);
});
test('mailer emits minimal description and deterministic provider idempotency key',async()=>{
 let call;
 const mailer=createResendOwnerAlertMailer({
  apiKey:'re_synthetic_private_api_key12345',from:'DuckBio <updates@example.test>',
  to:'owner@example.test',origin:'https://duckbio.net',
  fetchImpl:async(url,options)=>{
   call={url,options};
   return {ok:true,json:async()=>({id:'mail_fixture123'})};
  }
 });
 const input={id:1,idempotencyKey:'duckbio-owner-audit-17',
  organizationName:'Lab One',organizationId:'lab-one',
  action:'subscription.entitlement.transition',category:'subscription',
  actorId:'verified-billing',subject:'sub_private_owner123',at,
  revision:3,changes:[{appId:'eel',delta:-2}]};
 assert.deepEqual(await mailer.send(input),{accepted:true});
 assert.equal(call.url,'https://api.resend.com/emails');
 assert.equal(call.options.method,'POST');
 assert.equal(call.options.headers['Idempotency-Key'],'duckbio-owner-audit-17');
 const body=JSON.parse(call.options.body);
 assert.equal(body.to[0],'owner@example.test');
 assert.match(body.text,/Lab One/);
 assert.match(body.text,/Subscription revision: 3/);
 assert.match(body.text,/Seat changes: eel -2/);
 assert.match(body.text,/https:\/\/duckbio.net\/owner/);
 assert(!body.text.includes('re_synthetic_private_api_key'));
 assert(!body.text.includes('re_synthetic_private_api_key12345'));
 assert.equal(body.subject,'DuckBio alert: Verified subscription allocation changed');
});
test('invalid email configuration and provider failures fail closed, dispatch retries without leaking',async t=>{
 assert.throws(()=>createResendOwnerAlertMailer({apiKey:'bad',from:'updates@example.test',
  to:'owner@example.test',origin:'https://duckbio.net'}),/Private owner alert/);
 assert.throws(()=>createResendOwnerAlertMailer({
  apiKey:'re_private_key12345678',from:'updates@example.test',to:'owner@example.test',
  origin:'http://example.test'}),/HTTPS owner panel/);
 const f=fixture(t);
 f.store.setupOrganization({organizationId:'lab-one',name:'Lab One',owner});
 const r=await dispatchOwnerAlerts({store:f.store,mailer:{async send(){throw Error('temporary');}}});
 assert.equal(r.retried,1);
 assert.equal(f.store.ownerAlertSummary().counts.pending,1);
 assert.equal(f.store.claimOwnerAlert(),null);
 assert.equal(f.store.overview('lab-one','owner1').users.length,1);
});
