import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeTestReconciler} from '../stripe-test-reconcile.mjs';

const secret='sk_test_only_synthetic_secret_1234567';
const draft={id:'draft-1234',organizationId:'lab-one',plan:'Single',apps:['eel'],seats:3};
const checkout={sessionId:'cs_test_session1234',price:'price_test_price1234'};
const good=()=>({
 'checkout/sessions':{id:checkout.sessionId,object:'checkout.session',livemode:false,
  mode:'subscription',status:'complete',payment_status:'paid',client_reference_id:draft.id,
  metadata:{organization_id:draft.organizationId,draft_id:draft.id},subscription:'sub_test1234',customer:'cus_test1234'},
 subscriptions:{id:'sub_test1234',object:'subscription',livemode:false,customer:'cus_test1234',
  metadata:{organization_id:draft.organizationId,draft_id:draft.id},status:'active',
  cancel_at_period_end:false,cancel_at:null,
  pause_collection:null,pending_update:null,latest_invoice:'in_test1234',
  items:{has_more:false,data:[{quantity:draft.seats,current_period_end:1790000000,price:{id:checkout.price,livemode:false,
   recurring:{usage_type:'licensed'}}}]}},
 invoices:{id:'in_test1234',object:'invoice',livemode:false,customer:'cus_test1234',
  parent:{subscription_details:{subscription:'sub_test1234'}},
  status:'paid',paid:true,paid_out_of_band:false,billing_reason:'subscription_create',
  amount_paid:900,amount_remaining:0,status_transitions:{paid_at:1783090000}}
});
function fixture(objects=good(),config={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(url);
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+secret);
  assert.equal(options.headers.Accept,'application/json');
  assert.match(url,/^https:\/\/api\.stripe\.com\/v1\//);
  const collection=new URL(url).pathname.split('/').slice(2,-1).join('/');
  if(config.status)return new Response('temporarily unavailable',{status:config.status});
  if(config.nonjson)return new Response('oops',{headers:{'Content-Type':'text/plain'}});
  return Response.json(objects[collection]);
 };
 const client=createStripeTestReconciler({secretKey:secret,fetchImpl});
 return {client,calls};
}
test('read-only attestation requires an exact matching session, active subscription and paid invoice',async()=>{
 const f=fixture();
 assert.deepEqual(await f.client.inspect({draft,checkout}),{
  state:'paid_test_verified',sessionId:checkout.sessionId,subscriptionId:'sub_test1234',
  invoiceId:'in_test1234',organizationId:draft.organizationId,draftId:draft.id,
  price:checkout.price,seats:3,licensesGranted:false,
  lifecycle:{subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
   periodEnd:1790000000,invoiceStatus:'paid',billingReason:'subscription_create'}
 });
 assert.equal(f.calls.length,3);
 assert.deepEqual(f.calls,[
  'https://api.stripe.com/v1/checkout/sessions/cs_test_session1234',
  'https://api.stripe.com/v1/subscriptions/sub_test1234',
  'https://api.stripe.com/v1/invoices/in_test1234']);
});
test('legacy invoice subscription field is supported without weakening strict linkage',async()=>{
 const data=good();
 delete data.invoices.parent;
 data.invoices.subscription='sub_test1234';
 assert.equal((await fixture(data).client.inspect({draft,checkout})).state,'paid_test_verified');
});
test('payment in progress stays pending and cannot appear as paid',async()=>{
 const cases=[
  ['checkout_open','checkout/sessions','status','open','checkout_not_completed',1],
  ['checkout_expired','checkout/sessions','status','expired','checkout_not_completed',1],
  ['session_unpaid','checkout/sessions','payment_status','unpaid','payment_unpaid',1],
  ['subscription_incomplete','subscriptions','status','incomplete','subscription_not_active',3],
  ['subscription_past_due','subscriptions','status','past_due','subscription_not_active',3],
  ['unpaid_invoice','invoices','status','open','invoice_not_paid',3]
 ];
 for(const [name,resource,field,value,reason,calls] of cases){
  const data=good();data[resource][field]=value;
  const result=fixture(data);
  const observed=await result.client.inspect({draft,checkout});
  assert.equal(observed.state,'pending',name);
  assert.equal(observed.reason,reason,name);
  assert.equal(observed.licensesGranted,false,name);
  if(calls>1)assert.deepEqual(observed.lifecycle,{
   subscriptionStatus:data.subscriptions.status,cancelAtPeriodEnd:false,cancelAt:null,
   periodEnd:1790000000,invoiceStatus:data.invoices.status,billingReason:'subscription_create'
  },name);
  else assert.equal(observed.lifecycle,undefined,name);
  assert.equal(result.calls.length,calls,name);
 }
});
test('mismatched tenant, subscription, seats, price or invoice data fail closed',async()=>{
 const cases=[
  ['session organization','checkout/sessions',x=>{x.metadata.organization_id='lab-two';}],
  ['session draft','checkout/sessions',x=>{x.client_reference_id='different';}],
  ['live session','checkout/sessions',x=>{x.livemode=true;}],
  ['wrong mode','checkout/sessions',x=>{x.mode='payment';}],
  ['untrusted payment','checkout/sessions',x=>{x.payment_status='no_payment_required';}],
  ['subscription organization','subscriptions',x=>{x.metadata.organization_id='lab-two';}],
  ['subscription draft','subscriptions',x=>{x.metadata.draft_id='wrong';}],
  ['different customer','subscriptions',x=>{x.customer='cus_other';}],
  ['wrong seat count','subscriptions',x=>{x.items.data[0].quantity=4;}],
  ['wrong price','subscriptions',x=>{x.items.data[0].price.id='price_other';}],
  ['extra price','subscriptions',x=>{x.items.data.push({...x.items.data[0]});}],
  ['truncated list','subscriptions',x=>{x.items.has_more=true;}],
  ['metered seats','subscriptions',x=>{x.items.data[0].price.recurring.usage_type='metered';}],
  ['paused collection','subscriptions',x=>{x.pause_collection={behavior:'keep_as_draft'};}],
  ['pending plan change','subscriptions',x=>{x.pending_update={};}],
  ['live invoice','invoices',x=>{x.livemode=true;}],
  ['unrelated invoice','invoices',x=>{x.parent.subscription_details.subscription='sub_other';}],
  ['unrelated invoice customer','invoices',x=>{x.customer='cus_other';}],
  ['paid out of band','invoices',x=>{x.paid_out_of_band=true;}],
  ['paid flag missing','invoices',x=>{x.paid=false;}],
  ['invalid cancel time','subscriptions',x=>{x.cancel_at=-1;}],
  ['invalid period','subscriptions',x=>{x.items.data[0].current_period_end='tomorrow';}],
  ['unknown status','subscriptions',x=>{x.status='other';}],
  ['unknown billing reason','invoices',x=>{x.billing_reason='manual';}],
  ['no paid amount','invoices',x=>{x.amount_paid=0;}],
  ['remaining balance','invoices',x=>{x.amount_remaining=1;}],
  ['no confirmed paid time','invoices',x=>{x.status_transitions.paid_at=null;}]
 ];
 for(const [name,resource,mutate] of cases){
  const data=good();mutate(data[resource]);
  await assert.rejects(fixture(data).client.inspect({draft,checkout}),/mismatch/,name);
 }
});
test('rejects live keys, arbitrary local IDs and network failures',async()=>{
 assert.throws(()=>createStripeTestReconciler({secretKey:'sk_live_badsecret123456'}),/test secret/);
 const f=fixture();
 await assert.rejects(f.client.inspect({draft:{...draft,seats:0},checkout}),/Invalid local/);
 await assert.rejects(f.client.inspect({draft,checkout:{...checkout,sessionId:'../other'}}),/Invalid local/);
 await assert.rejects(fixture(good(),{status:503}).client.inspect({draft,checkout}),/unavailable/);
 await assert.rejects(fixture(good(),{nonjson:true}).client.inspect({draft,checkout}),/unavailable/);
});

test('read-only lifecycle identifies paid renewal invoice and scheduled cancellation',async()=>{
 const data=good();
 data.subscriptions.cancel_at_period_end=true;
 data.subscriptions.cancel_at=1790000000;
 data.invoices.billing_reason='subscription_cycle';
 const result=await fixture(data).client.inspect({draft,checkout});
 assert.equal(result.state,'paid_test_verified');
 assert.deepEqual(result.lifecycle,{subscriptionStatus:'active',cancelAtPeriodEnd:true,
  cancelAt:1790000000,periodEnd:1790000000,
  invoiceStatus:'paid',billingReason:'subscription_cycle'});
 assert.equal(result.licensesGranted,false);
});
test('past due, unpaid, canceled and paused subscriptions never attest current payment',async()=>{
 for(const subscriptionStatus of ['past_due','unpaid','canceled','paused','incomplete_expired']){
  const data=good();
  data.subscriptions.status=subscriptionStatus;
  data.invoices.status='open';
  const result=await fixture(data).client.inspect({draft,checkout});
  assert.equal(result.state,'pending',subscriptionStatus);
  assert.equal(result.reason,'subscription_not_active',subscriptionStatus);
  assert.equal(result.lifecycle.subscriptionStatus,subscriptionStatus);
  assert.equal(result.lifecycle.invoiceStatus,'open');
  assert.equal(result.licensesGranted,false);
 }
});
test('legacy subscription period field is read when item period is missing',async()=>{
 const data=good();
 delete data.subscriptions.items.data[0].current_period_end;
 data.subscriptions.current_period_end=1791000000;
 const result=await fixture(data).client.inspect({draft,checkout});
 assert.equal(result.lifecycle.periodEnd,1791000000);
});
