/**
 * PRIVATE, DORMANT source-only Stripe LIVE financial reversal correlation.
 * Connects a SIGNED, persisted reversal event to ONE current, independently
 * pinned Workspace subscription by freshly reading the exact Stripe objects.
 *
 * This is NEVER a payment, ownership, chargeback outcome, grant or license
 * authority. No HTTP routes, background jobs or payment mutations.
 */
import {stripeLiveReviewCategory,stripeLiveEventIdMatches}
 from './stripe-live-review-event-catalog.mjs';

const ORG=/^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_BYTES=131072;
const ID=(id,prefix)=>typeof id==='string'&&
 new RegExp('^'+prefix+'[A-Za-z0-9_]{4,128}$').test(id);
const deny=(reason,state='manual_review')=>Object.freeze({
 state,reason,linksVerifiedForReview:false,licensesGranted:false,
 authorizesSeatChanges:false,paymentEvidenceAuthoritative:false
});
const pinKey=p=>JSON.stringify([
 p.organizationId,p.subscriptionId,p.customerId,p.priceId,
 p.plan,p.apps,p.seats,p.revision
]);
const eventKey=e=>JSON.stringify([
 e.eventId,e.eventType,e.objectId,e.created,e.rawDigest
]);
function verifyPinned(p,org,sub){
 return p!==null&&typeof p==='object'&&!Array.isArray(p)&&
  p.source==='pinned_stripe_live'&&p.organizationId===org&&
  p.subscriptionId===sub&&ID(p.customerId,'cus_')&&
  ID(p.priceId,'price_')&&Array.isArray(p.apps)&&
  Number.isSafeInteger(p.revision)&&p.revision>0&&
  Number.isSafeInteger(p.seats)&&p.seats>0&&
  p.licensesGranted===false&&p.authorizesSeatChanges===false;
}
function verifyEvent(e,eventId){
 return e!==null&&typeof e==='object'&&!Array.isArray(e)&&
  e.eventId===eventId&&
  stripeLiveReviewCategory(e.eventType)!==null&&
  stripeLiveEventIdMatches(e.eventType,e.objectId)&&
  typeof e.rawDigest==='string'&&/^[a-f0-9]{64}$/.test(e.rawDigest)&&
  Number.isSafeInteger(e.created)&&e.created>0&&
  e.licensesGranted===false&&e.authorizesSeatChanges===false;
}
async function json(reply){
 if(!reply||reply.ok!==true||reply.status!==200||
  !/^application\/json(?:\s*;|$)/i.test(reply.headers?.get?.('content-type')||''))
  throw Error('source_unavailable');
 const length=reply.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||
  Number(length)>MAX_BYTES))throw Error('source_oversize');
 if(!reply.body||typeof reply.body.getReader!=='function')
  throw Error('source_body_missing');
 const reader=reply.body.getReader(),parts=[];
 let bytes=0,overflow=false;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw Error('source_chunk_invalid');
   bytes+=value.byteLength;
   if(bytes>MAX_BYTES){overflow=true;break;}
   parts.push(Buffer.from(value));
  }
 }finally{
  if(overflow){
   try{await reader.cancel();}catch{/* denial still occurs */}
  }
  reader.releaseLock();
 }
 if(overflow||!bytes)throw Error('source_oversize');
 const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true})
  .decode(Buffer.concat(parts,bytes)));
 if(!obj||typeof obj!=='object'||Array.isArray(obj))
  throw Error('source_invalid');
 return obj;
}
const objId=x=>typeof x==='string'?x:null;

export function createStripeLiveFinancialEventCorrelator({
 organizationStore,readPinnedSubscription,secretKey,
 fetchImpl=globalThis.fetch,timeoutMs=8000
}={}){
 // During draft integration, the approved pinned-tenant read exists only in
 // the separate #172 branch; it must be explicitly injected from that private
 // canonical store when both PR stacks are reviewed together.
 const readPin=readPinnedSubscription??
  (typeof organizationStore?.readPinnedStripeLiveBinding==='function'
   ?x=>organizationStore.readPinnedStripeLiveBinding(x):null);
 if(typeof organizationStore?.readVerifiedStripeLiveEventPrivate!=='function'||
    typeof readPin!=='function'||
    typeof secretKey!=='string'||!/^sk_live_[A-Za-z0-9_]{12,}$/.test(secretKey)||
    typeof fetchImpl!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>15000)
  throw Error('private_live_event_correlation_config_required');

 async function get(resource,pathId){
  // Every path is built from Stripe-ID-validated values, never a URL from
  // an untrusted event, browser field, or provider response.
  const reply=await fetchImpl('https://api.stripe.com/v1/'+resource+'/'+pathId,{
   method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
   referrerPolicy:'no-referrer',signal:AbortSignal.timeout(timeoutMs),
   headers:{Authorization:'Bearer '+secretKey,Accept:'application/json'}
  });
  return json(reply);
 }
 const source=(e,org,sub)=>({
  organizationId:org,subscriptionId:sub,eventId:e.eventId
 });
 return Object.freeze({
  async inspect({organizationId,subscriptionId,eventId,invoiceId=null}={}){
   if(typeof organizationId!=='string'||!ORG.test(organizationId)||
      !ID(subscriptionId,'sub_')||!ID(eventId,'evt_')||
      (invoiceId!==null&&!ID(invoiceId,'in_')))
    return deny('invalid_private_lookup','unavailable');
   try{
    const pin=readPin({organizationId,subscriptionId});
    if(!verifyPinned(pin,organizationId,subscriptionId))
     return deny('private_subscription_pin_missing','unavailable');
    const event=organizationStore.readVerifiedStripeLiveEventPrivate(eventId);
    if(!verifyEvent(event,eventId))
     return deny('signed_reversal_event_missing','unavailable');
    const category=stripeLiveReviewCategory(event.eventType);
    let attachedInvoiceId=invoiceId;
    let chargeId=null;
    if(event.eventType==='invoice.voided'){
     if(attachedInvoiceId!==null&&attachedInvoiceId!==event.objectId)
      return deny('event_invoice_hint_mismatch');
     attachedInvoiceId=event.objectId;
    }else if(event.eventType.startsWith('credit_note.')){
     const note=await get('credit_notes',event.objectId);
     if(note.id!==event.objectId||note.object!=='credit_note'||
        note.livemode!==true||note.customer!==pin.customerId||
        !ID(note.invoice,'in_'))
      return deny('credit_note_source_mismatch');
     if(attachedInvoiceId!==null&&attachedInvoiceId!==note.invoice)
      return deny('credit_note_invoice_hint_mismatch');
     attachedInvoiceId=note.invoice;
    }else{
     // Charge, refund and dispute objects do not always carry a reliable
     // Invoice ID. An explicit PRIVATE historical invoice candidate is
     // mandatory; it is never trusted without provider confirmation below.
     if(attachedInvoiceId===null)
      return deny('historical_invoice_hint_required');
     if(event.eventType==='charge.refunded'){
      chargeId=event.objectId;
     }else if(event.eventType.startsWith('refund.')){
      const refund=await get('refunds',event.objectId);
      if(refund.id!==event.objectId||refund.object!=='refund'||
         refund.livemode!==true||!ID(refund.charge,'ch_'))
       return deny('refund_source_mismatch');
      chargeId=refund.charge;
     }else if(event.eventType.startsWith('charge.dispute.')){
      const dispute=await get('disputes',event.objectId);
      if(dispute.id!==event.objectId||dispute.object!=='dispute'||
         dispute.livemode!==true||!ID(dispute.charge,'ch_'))
       return deny('dispute_source_mismatch');
      chargeId=dispute.charge;
     }else{return deny('unsupported_financial_event');}
    }
    if(!ID(attachedInvoiceId,'in_'))
     return deny('invoice_source_missing');
    const invoice=await get('invoices',attachedInvoiceId);
    const parent=objId(invoice.parent?.subscription_details?.subscription)??
      objId(invoice.subscription);
    if(invoice.object!=='invoice'||invoice.livemode!==true||
       invoice.id!==attachedInvoiceId||
       invoice.customer!==pin.customerId||
       parent!==subscriptionId)
     return deny('historical_invoice_subscription_mismatch');

    if(chargeId!==null){
     const charge=await get('charges',chargeId);
     if(charge.object!=='charge'||charge.livemode!==true||
        charge.id!==chargeId||charge.customer!==pin.customerId||
        !ID(charge.payment_intent,'pi_'))
      return deny('charge_customer_or_intent_mismatch');
     const intent=await get('payment_intents',charge.payment_intent);
     if(intent.object!=='payment_intent'||intent.livemode!==true||
        intent.id!==charge.payment_intent||
        intent.customer!==pin.customerId||
        intent.latest_charge!==chargeId)
      return deny('payment_intent_source_mismatch');
     // The invoice-payment allocation binds the charge's PaymentIntent
     // to this EXACT historical invoice, not simply the same customer.
     const listing=await get('invoices',attachedInvoiceId+'/payments?limit=100');
     if(listing.object!=='list'||listing.has_more!==false||
        !Array.isArray(listing.data)||listing.data.length>100)
      return deny('invoice_payment_lineage_unavailable');
     const matching=listing.data.filter(x=>
      x?.object==='invoice_payment'&&x.livemode===true&&
      x.invoice===attachedInvoiceId&&
      x.payment?.type==='payment_intent'&&
      x.payment?.payment_intent===charge.payment_intent);
     if(matching.length!==1)
      return deny('invoice_payment_lineage_mismatch');
    }

    // Current pin and event identity MUST remain stable during all network
    // awaits. Reordered or late provider events never become a grant.
    const subscription=await get('subscriptions',subscriptionId);
    if(subscription.object!=='subscription'||subscription.livemode!==true||
       subscription.id!==subscriptionId||
       subscription.customer!==pin.customerId||
       subscription.metadata?.organization_id!==organizationId)
     return deny('subscription_tenant_source_mismatch');
    const finalPin=readPin({organizationId,subscriptionId});
    const finalEvent=organizationStore.readVerifiedStripeLiveEventPrivate(eventId);
    if(!verifyPinned(finalPin,organizationId,subscriptionId)||
       pinKey(pin)!==pinKey(finalPin)||
       !verifyEvent(finalEvent,eventId)||eventKey(event)!==eventKey(finalEvent))
     return deny('correlation_source_changed','unavailable');

    return Object.freeze({
     state:'manual_review',reason:'event_source_linked_to_pinned_subscription',
     reviewCategory:category,bindingRevision:finalPin.revision,
     linksVerifiedForReview:true,licensesGranted:false,
     authorizesSeatChanges:false,paymentEvidenceAuthoritative:false
    });
   }catch{return deny('stripe_correlation_source_unavailable','unavailable');}
  }
 });
}
