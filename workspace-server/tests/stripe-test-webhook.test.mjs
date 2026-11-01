import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createStripeTestWebhookVerifier} from '../stripe-test-webhook.mjs';
const secret='whsec_synthetic_test_secret_123456',now=1783090000000;
const verifier=createStripeTestWebhookVerifier({webhookSecret:secret,clock:()=>now});
const event={id:'evt_test_1234',type:'checkout.session.completed',created:Math.floor(now/1000),livemode:false,data:{object:{id:'cs_test_12345'}}};
function signed(body=JSON.stringify(event),t=Math.floor(now/1000),key=secret){
 const rawBody=Buffer.from(body);
 const mac=createHmac('sha256',key).update(t+'.').update(rawBody).digest('hex');
 return {rawBody,signature:'t='+t+',v1='+mac};
}
test('verifies raw bytes and returns only minimal Stripe test-event metadata',()=>{
 const result=verifier.verify(signed());
 assert.equal(result.id,'evt_test_1234');
 assert.equal(result.type,'checkout.session.completed');
 assert.equal(result.objectId,'cs_test_12345');
 assert.match(result.digest,/^[a-f0-9]{64}$/);
 assert.equal(Object.hasOwn(result,'data'),false);
});
test('rejects tampering, replay timestamps, invalid signatures and live events',()=>{
 const input=signed();
 assert.throws(()=>verifier.verify({...input,rawBody:Buffer.from(input.rawBody.toString().replace('completed','updated'))}),/Unverified/);
 assert.throws(()=>verifier.verify(signed(undefined,Math.floor(now/1000)-301)),/Expired/);
 assert.throws(()=>verifier.verify(signed(undefined,Math.floor(now/1000)+301)),/Expired/);
 assert.throws(()=>verifier.verify(signed(undefined,Math.floor(now/1000),'whsec_other_test_secret_12345')),/Unverified/);
 assert.throws(()=>verifier.verify(signed(JSON.stringify({...event,livemode:true}))),/Not a supported/);
 assert.throws(()=>verifier.verify(signed('this is not json')),/JSON/);
 assert.throws(()=>verifier.verify({rawBody:Buffer.alloc(65537),signature:input.signature}),/Invalid Stripe webhook input/);
 assert.throws(()=>createStripeTestWebhookVerifier({webhookSecret:'not_a_real_secret'}),/private Stripe test/);
});
