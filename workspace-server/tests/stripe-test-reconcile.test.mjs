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
  pause_collection:null,pending_update:null,latest_invoice:'in_test1234',
  items:{has_more:false,data:[{quantity:draft.seats,price:{id:checkout.price,livemode:false,
   recurring:{usage_type:'licensed'}}}]}},
 invoices:{id:'in_test1234',object:'invoice',livemode:false,customer:'cus_test1234',
  parent:{subscription_details:{subscription:'sub_test1234'}},
  status:'paid',amount_paid:900,amount_remaining:0,status_transitions:{paid_at:1783090000}}
});
function fixture(objects=good(),config={}){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(url);
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+secret);
  assert.equal(options.headers.Accept,'application/json');
  assert.match(url,/^https:\/\/api\.stripe\.com\/v1\//);
  const collection=url.split('/')[4];
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
  price:checkout.price,seats:3,licensesGranted:false
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
  ['subscription_incomplete','subscriptions','status','incomplete','subscription_not_active',2],
  ['subscription_past_due','subscriptions','status','past_due','subscription_not_active',2],
  ['unpaid_invoice','invoices','status','open','invoice_not_paid',3]
 ];
 for(const [name,resource,field,value,reason,calls] of cases){
  const data=good();data[resource][field]=value;
  const result=fixture(data);
  assert.deepEqual(await result.client.inspect({draft,checkout}),
   {state:'pending',reason,licensesGranted:false},name);
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
