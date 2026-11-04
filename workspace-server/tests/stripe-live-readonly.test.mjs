import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeLiveBillingReader} from '../stripe-live-readonly.mjs';

const secretKey='sk_live_fixture_key_123456789';
const now=1800000000000;
const binding=()=>({organizationId:'lab-one',subscriptionId:'sub_live_ABCD1234',
 customerId:'cus_live_ABCD1234',priceId:'price_live_ABCD1234',
 plan:'Single',apps:['eel'],seats:3});
const subscription=()=>({
 object:'subscription',id:'sub_live_ABCD1234',livemode:true,
 customer:'cus_live_ABCD1234',metadata:{organization_id:'lab-one'},
 status:'active',cancel_at_period_end:false,cancel_at:null,
 pause_collection:null,pending_update:null,latest_invoice:'in_live_ABCD1234',
 items:{has_more:false,data:[{quantity:3,
  current_period_end:1900000000,
  price:{id:'price_live_ABCD1234',livemode:true,recurring:{usage_type:'licensed'}}}]}
});
const invoice=()=>({
 object:'invoice',id:'in_live_ABCD1234',livemode:true,
 customer:'cus_live_ABCD1234',parent:{subscription_details:{subscription:'sub_live_ABCD1234'}},
 status:'paid',paid:true,paid_out_of_band:false,
 amount_paid:3000,amount_remaining:0,
 status_transitions:{paid_at:1790000000},billing_reason:'subscription_cycle',
 lines:{has_more:false,data:[{
  pricing:{price_details:{price:'price_live_ABCD1234'}},
  quantity:3,period:{end:1900000000},
  parent:{subscription_item_details:{subscription:'sub_live_ABCD1234'}}
 }]}
});
function fixture({sub=subscription(),inv=invoice(),at=now,responseChange=response=>response}={}){
 const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});
  const isSub=url==='https://api.stripe.com/v1/subscriptions/sub_live_ABCD1234';
  const isInvoice=url==='https://api.stripe.com/v1/invoices/in_live_ABCD1234';
  if(!isSub&&!isInvoice)throw Error('Unexpected Stripe endpoint');
  const response=new Response(JSON.stringify(isSub?sub:inv),{
   status:200,headers:{'content-type':'application/json; charset=utf-8'}
  });
  return responseChange(response,isSub?sub:inv);
 };
 return {calls,reader:createStripeLiveBillingReader({
  secretKey,fetchImpl,clock:()=>at})};
}
test('only a private LIVE key is accepted; TEST keys or invalid bindings fail before HTTP',async()=>{
 assert.throws(()=>createStripeLiveBillingReader({secretKey:'sk_test_123456789012'}),
  /Private Stripe LIVE secret key required/);
 assert.throws(()=>createStripeLiveBillingReader({secretKey:'sk_live_short'}),/Private Stripe LIVE/);
 const f=fixture();
 for(const bad of [
  {...binding(),apps:['eel','goflo']},
  {...binding(),plan:'Mixed'},
  {...binding(),apps:['eel','eel']},
  {...binding(),subscriptionId:'sub_live_bad id'},
  {...binding(),customerId:'cus_test123',seats:0},
  {...binding(),priceId:'invalid-price'},
  {...binding(),apps:['unknown']},
  {...binding(),seats:10001},
 ])await assert.rejects(()=>f.reader.inspect(bad),/Invalid pinned/);
 assert.equal(f.calls.length,0);
});
test('pinned LIVE subscription and paid invoice are read-only observations, never seat grants',async()=>{
 const f=fixture();
 const out=await f.reader.inspect(binding());
 assert.deepEqual(out,{
  subscriptionStatus:'active',cancelAtPeriodEnd:false,periodEnd:1900000000,
  licensesGranted:false,authorizesSeatChanges:false,
  state:'candidate_for_manual_review',
  billingReason:'subscription_cycle',checkedAt:now
 });
 assert.equal(f.calls.length,2);
 for(const call of f.calls){
  assert.equal(call.init.method,'GET');
  assert.equal(call.init.redirect,'error');
  assert.equal(call.init.cache,'no-store');
  assert.equal(call.init.headers.Authorization,'Bearer '+secretKey);
  assert(!JSON.stringify(out).includes('sk_live'));
  assert(!JSON.stringify(out).includes('sub_live'));
 }
});
test('mismatched tenant, customer, price, quantity, modes or extra items fail closed',async()=>{
 const tweaks=[
  s=>s.metadata.organization_id='lab-other',
  s=>s.customer='cus_other12345',
  s=>s.id='sub_other12345',
  s=>s.livemode=false,
  s=>s.items.data[0].price.id='price_wrong1234',
  s=>s.items.data[0].price.livemode=false,
  s=>s.items.data[0].quantity=4,
  s=>s.items.data[0].price.recurring.usage_type='metered',
  s=>s.items.has_more=true,
  s=>s.items.data.push({...s.items.data[0]}),
 ];
 for(const edit of tweaks){
  const sub=subscription();edit(sub);
  const f=fixture({sub});
  await assert.rejects(()=>f.reader.inspect(binding()),/Stripe LIVE billing identity mismatch/);
  assert.equal(f.calls.length,1,'subscription mismatch should prevent invoice fetch');
 }
});
test('unpaid, inactive, paused or unresolved subscriptions cannot produce a positive candidate',async()=>{
 for(const status of ['past_due','unpaid','canceled','trialing','incomplete','paused']){
  const sub=subscription();sub.status=status;
  const o=await fixture({sub}).reader.inspect(binding());
  assert.equal(o.state,'manual_review');
  assert.equal(o.reason,'subscription_not_active');
  assert.equal(o.licensesGranted,false);
 }
 for(const prop of ['pause_collection','pending_update']){
  const sub=subscription();sub[prop]={behavior:'keep_as_draft'};
  const o=await fixture({sub}).reader.inspect(binding());
  assert.equal(o.reason,'subscription_change_unresolved');
 }
 const sub=subscription();sub.latest_invoice=null;
 assert.equal((await fixture({sub}).reader.inspect(binding())).reason,'invoice_unavailable');
});
test('invoice association and paid-on-Stripe conditions are validated',async()=>{
 const bad=[
  i=>i.livemode=false,
  i=>i.customer='cus_other12345',
  i=>i.parent.subscription_details.subscription='sub_other12345',
  i=>i.id='in_other12345',
  i=>i.paid=false,
  i=>i.paid_out_of_band=true,
  i=>i.amount_paid=0,
  i=>i.amount_remaining=99,
  i=>i.status_transitions.paid_at=null,
  i=>i.status_transitions.paid_at=1900000000
 ];
 for(const tweak of bad){
  const inv=invoice();tweak(inv);
  await assert.rejects(()=>fixture({inv}).reader.inspect(binding()),
    /Stripe LIVE billing identity mismatch/);
 }
 const inv=invoice();inv.status='open';
 const o=await fixture({inv}).reader.inspect(binding());
 assert.equal(o.state,'manual_review');
 assert.equal(o.reason,'invoice_unpaid');
});
test('old-price invoice, old quantity or missing full invoice line data require review',async()=>{
 for(const tweak of [
  i=>i.lines.data[0].pricing.price_details.price='price_old1234',
  i=>i.lines.data[0].quantity=2,
  i=>i.lines.data[0].period.end=1790000000,
  i=>i.lines.data[0].parent.subscription_item_details.subscription='sub_other1234',
  i=>i.lines.has_more=true,
  i=>i.lines=null,
 ]){
  const inv=invoice();tweak(inv);
  const o=await fixture({inv}).reader.inspect(binding());
  assert.equal(o.state,'manual_review');
  assert(['invoice_lineage_unavailable','invoice_lineage_mismatch'].includes(o.reason));
 }
 const inv=invoice();inv.billing_reason='manual';
 assert.equal((await fixture({inv}).reader.inspect(binding())).reason,
  'invoice_not_subscription_billing');
});
test('scheduled cancellation uses the earliest effective date, never an expired term',async()=>{
 const sub=subscription();
 sub.cancel_at=1850000000;
 sub.cancel_at_period_end=false;
 let o=await fixture({sub}).reader.inspect(binding());
 assert.equal(o.periodEnd,1850000000);
 assert.equal(o.state,'candidate_for_manual_review');
 const expired={...sub,cancel_at:1799999999};
 o=await fixture({sub:expired}).reader.inspect(binding());
 assert.equal(o.state,'manual_review');
 assert.equal(o.reason,'period_not_active');
 const past=subscription();past.items.data[0].current_period_end=1790000000;
 o=await fixture({sub:past}).reader.inspect(binding());
 assert.equal(o.reason,'period_not_active');
});
test('Stripe lookup failures and malformed responses fail closed without returning data',async()=>{
 for(const change of [
  ()=>new Response('Unavailable',{status:503,
   headers:{'content-type':'application/json'}}),
  ()=>new Response('{}',{headers:{'content-type':'text/html'}}),
  ()=>new Response('not-json',{headers:{'content-type':'application/json'}}),
  ()=>new Response('x'.repeat(131073),{headers:{'content-type':'application/json'}}),
 ]){
  const f=fixture({responseChange:change});
  await assert.rejects(()=>f.reader.inspect(binding()),
   /Stripe LIVE lookup unavailable|Malformed Stripe LIVE response|Stripe LIVE response exceeds safe limit/);
  assert.equal(f.calls.length,1);
 }
});

test('Stripe LIVE reader accepts exactly 131072 UTF-8 bytes without seat authorization',async()=>{
 const empty=JSON.stringify({...subscription(),padding:''});
 const body=JSON.stringify({...subscription(),padding:'x'.repeat(131072-Buffer.byteLength(empty))});
 assert.equal(Buffer.byteLength(body),131072);
 const f=fixture({responseChange:(response,resource)=>
  resource.object==='subscription'?new Response(body,{
   headers:{'content-type':'application/json','content-length':'131072'}
  }):response});
 const out=await f.reader.inspect(binding());
 assert.equal(out.state,'candidate_for_manual_review');
 assert.equal(out.licensesGranted,false);
 assert.equal(out.authorizesSeatChanges,false);
});

test('Stripe LIVE rejects misleading Content-Length and cancels oversized stream promptly',async()=>{
 for(const length of ['131073','000123','-1','NaN','18446744073709551616']){
  const g=fixture({responseChange:()=>new Response(JSON.stringify(subscription()),{
   headers:{'content-type':'application/json','content-length':length}
  })});
  await assert.rejects(()=>g.reader.inspect(binding()),/exceeds safe limit/);
  assert.equal(g.calls.length,1);
 }
 let pulls=0,canceled=false;
 const stream=new ReadableStream({
  pull(controller){pulls++;controller.enqueue(new Uint8Array(65536));},
  cancel(){canceled=true;}
 },{highWaterMark:0});
 const g=fixture({responseChange:()=>new Response(stream,{
  headers:{'content-type':'application/json','content-length':'2'}
 })});
 await assert.rejects(()=>g.reader.inspect(binding()),/exceeds safe limit/);
 assert.equal(g.calls.length,1);
 assert.equal(pulls,3);
 assert.equal(canceled,true);
});

test('UTF-8 bytes and truncated or malformed upstream data fail closed',async()=>{
 const body=JSON.stringify({...subscription(),padding:'🦆'.repeat(32769)});
 assert(body.length<131072);
 assert(Buffer.byteLength(body)>131072);
 const values=[body,new Uint8Array([123,34,120,34,58,34,195,40,34,125]),
  '', '{"livemode":true'];
 for(const value of values){
  const f=fixture({responseChange:()=>new Response(value,{
   headers:{'content-type':'application/json'}
  })});
  await assert.rejects(()=>f.reader.inspect(binding()),/exceeds safe limit|Malformed/);
  assert.equal(f.calls.length,1);
 }
});
