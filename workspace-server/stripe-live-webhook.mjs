import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {STRIPE_LIVE_EVENT_PREFIXES,stripeLiveReviewCategory,
 stripeLiveReviewObjectType,stripeLiveEventIdMatches} from './stripe-live-review-event-catalog.mjs';

// PRIVATE Stripe LIVE signature verification, intentionally detached from billing state.
// Never treat a signed event or Checkout completion as proof that an invoice was paid.

const eventId=value=>typeof value==='string'&&/^evt_[A-Za-z0-9_]{4,128}$/.test(value);
const objectId=(value,prefix)=>typeof value==='string'&&
 new RegExp('^'+prefix+'[A-Za-z0-9_]{4,128}$').test(value);
export function createStripeLiveWebhookVerifier({webhookSecret,clock=Date.now}={}){
 // Stripe test and LIVE endpoint secrets share the whsec_ prefix; production
 // configuration MUST provide the independently provisioned LIVE endpoint secret.
 if(typeof webhookSecret!=='string'||!/^whsec_[A-Za-z0-9_]{12,}$/.test(webhookSecret))
  throw Error('Private Stripe LIVE webhook signing secret required');
 if(typeof clock!=='function')throw Error('Invalid Stripe LIVE webhook clock');
 return Object.freeze({
  verify({rawBody,signature}={}){
   if(!Buffer.isBuffer(rawBody)||rawBody.length<1||rawBody.length>65536||
      typeof signature!=='string'||signature.length>2048)
    throw Error('Invalid Stripe LIVE webhook input');
   const fields=signature.split(',').map(x=>x.trim().split('='));
   const timestamps=fields.filter(([key,value])=>key==='t'&&/^[0-9]{1,12}$/.test(value||''));
   const digests=fields.filter(([key,value])=>key==='v1'&&/^[a-f0-9]{64}$/.test(value||''))
     .map(([,value])=>Buffer.from(value,'hex'));
   if(timestamps.length!==1||digests.length===0)
    throw Error('Missing Stripe LIVE webhook signature');
   const time=timestamps[0][1],seconds=Number(time);
   const now=Math.floor(clock()/1000);
   if(!Number.isSafeInteger(now)||now<1||!Number.isSafeInteger(seconds)||
      seconds<1||Math.abs(now-seconds)>300)
    throw Error('Expired Stripe LIVE webhook signature');
   const mac=createHmac('sha256',webhookSecret).update(time+'.').update(rawBody).digest();
   if(!digests.some(candidate=>timingSafeEqual(candidate,mac)))
    throw Error('Unverified Stripe LIVE webhook signature');
   let event;
   try{event=JSON.parse(rawBody.toString('utf8'));}catch{
    throw Error('Invalid Stripe LIVE webhook JSON');
   }
   if(!event||typeof event!=='object'||Array.isArray(event)||
      event.livemode!==true||event.account!=null||
      !eventId(event.id)||!Object.hasOwn(STRIPE_LIVE_EVENT_PREFIXES,event.type)||
      !Number.isSafeInteger(event.created)||event.created<1||
      !event.data||typeof event.data!=='object'||Array.isArray(event.data)||
      !event.data.object||typeof event.data.object!=='object'||
      Array.isArray(event.data.object)||event.data.object.livemode!==true||
      !stripeLiveEventIdMatches(event.type,event.data.object.id)||
      (stripeLiveReviewObjectType(event.type)!==null&&
       event.data.object.object!==stripeLiveReviewObjectType(event.type)))
    throw Error('Unsupported Stripe LIVE webhook event');
   // Metadata only. No raw payload, Stripe customer data or payment attestation.
   return Object.freeze({
    id:event.id,type:event.type,objectId:event.data.object.id,
    created:event.created,digest:createHash('sha256').update(rawBody).digest('hex'),
    mode:'live',licensesGranted:false,authorizesSeatChanges:false,
    financialReviewRequired:stripeLiveReviewCategory(event.type)!==null
   });
  }
 });
}
