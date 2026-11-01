import test from 'node:test';
import assert from 'node:assert/strict';
import {createStripeTestCheckout} from '../stripe-test-checkout.mjs';
const draft={id:'draft-123',organizationId:'lab-1',plan:'Mixed',apps:['goflo','eel'],seats:4};
const config=fetchImpl=>({secretKey:'sk_test_example_secret_123456',priceMap:{'Mixed:eel,goflo':'price_123456789abc'},origin:'https://workspace.example.test',fetchImpl});
test('test Checkout uses configured price, stable idempotency and exact draft metadata',async()=>{
 let call;
 const transport=async(url,options)=>{
  call={url,options};
  return new Response(JSON.stringify({id:'cs_test_example123',url:'https://checkout.stripe.com/c/pay/example',livemode:false,mode:'subscription',client_reference_id:draft.id,metadata:{organization_id:'lab-1',draft_id:draft.id}}),{status:200});
 };
 const adapter=createStripeTestCheckout(config(transport));
 assert.equal(adapter.priceFor(draft),'price_123456789abc');
 assert.equal(adapter.priceFor({...draft,apps:['eel']}),null);
 const session=await adapter.createSession({draft,price:adapter.priceFor(draft),idempotencyKey:'stable-draft-123'});
 assert.equal(session.id,'cs_test_example123');
 assert.equal(call.url,'https://api.stripe.com/v1/checkout/sessions');
 assert.equal(call.options.headers['Idempotency-Key'],'stable-draft-123');
 const form=new URLSearchParams(call.options.body);
 assert.equal(form.get('mode'),'subscription');
 assert.equal(form.get('line_items[0][price]'),'price_123456789abc');
 assert.equal(form.get('line_items[0][quantity]'),'4');
 assert.equal(form.get('client_reference_id'),'draft-123');
 assert.equal(form.get('metadata[organization_id]'),'lab-1');
 assert.equal(form.get('subscription_data[metadata][draft_id]'),'draft-123');
});
test('live Stripe keys and untrusted response destinations are refused',async()=>{
 assert.throws(()=>createStripeTestCheckout({...config(async()=>{}),secretKey:'sk_live_12345678901234'}),/test secret/);
 assert.throws(()=>createStripeTestCheckout({...config(async()=>{}),origin:'http://workspace.example.com'}),/Secure/);
 const adapter=createStripeTestCheckout(config(async()=>new Response(JSON.stringify({id:'cs_test_x',url:'https://other.example/redirect',livemode:false,mode:'subscription',client_reference_id:draft.id,metadata:{organization_id:'lab-1',draft_id:draft.id}}),{status:200})));
 await assert.rejects(()=>adapter.createSession({draft,price:adapter.priceFor(draft),idempotencyKey:'stable-draft-123'}),/Invalid Checkout destination/);
 await assert.rejects(()=>adapter.createSession({draft,price:'price_unconfigured',idempotencyKey:'stable-draft-123'}),/Invalid test Checkout request/);
});
