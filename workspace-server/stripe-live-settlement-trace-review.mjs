/**
 * DORMANT Stripe LIVE payment-trace screening for manual review only.
 * This MUST NOT become an entitlement source or a native/SSO access grant.
 * All identifiers originate from a private, revisioned tenant pin or
 * from a freshly checked upstream Stripe parent record.
 */
const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const stripeId=(id,prefix)=>typeof id==='string'&&
 new RegExp('^'+prefix+'[A-Za-z0-9_]{4,128}$').test(id);
const MAX_BYTES=131072;
const deny=(reason,kind='manual_review')=>Object.freeze({
 state:kind,reason,licensesGranted:false,authorizesSeatChanges:false,
 paymentEvidenceAuthoritative:false
});
const ref=id=>typeof id==='string'?id:null;
const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
const pinIdentity=x=>JSON.stringify([
 x.organizationId,x.subscriptionId,x.customerId,x.priceId,
 x.plan,x.apps,x.seats,x.revision
]);

async function limitedStripeJson(reply){
 if(!reply||reply.ok!==true||reply.status!==200||
    !/^application\/json(?:\s*;|$)/i.test(reply.headers?.get?.('content-type')||''))
   throw Error('stripe_unavailable');
 const len=reply.headers.get('content-length');
 if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||
    Number(len)>MAX_BYTES))throw Error('stripe_bad_length');
 if(!reply.body||typeof reply.body.getReader!=='function')
   throw Error('stripe_no_body');
 const reader=reply.body.getReader(),parts=[];
 let bytes=0,overflow=false;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw Error('stripe_bad_body');
   bytes+=value.byteLength;
   if(bytes>MAX_BYTES){overflow=true;break;}
   parts.push(Buffer.from(value));
  }
 }finally{
  if(overflow){try{await reader.cancel();}catch{/* reject regardless */}}
  reader.releaseLock();
 }
 if(overflow||!bytes)throw Error('stripe_bad_length');
 const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true})
  .decode(Buffer.concat(parts,bytes)));
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.livemode===false)
  throw Error('stripe_bad_object');
 return doc;
}

export function createStripeLiveSettlementTraceReview({
 organizationStore,billingReader,secretKey,fetchImpl=globalThis.fetch,
 clock=Date.now,timeoutMs=8000
}={}){
 if(typeof organizationStore?.readPinnedStripeLiveBinding!=='function'||
    typeof billingReader?.inspect!=='function'||
    typeof secretKey!=='string'||!/^sk_live_[A-Za-z0-9_]{12,}$/.test(secretKey)||
    typeof fetchImpl!=='function'||typeof clock!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>15000)
  throw Error('private_stripe_settlement_review_config_required');

 const pinFor=(org,sub)=>{
  const x=organizationStore.readPinnedStripeLiveBinding({
   organizationId:org,subscriptionId:sub
  });
  if(!x||x.source!=='pinned_stripe_live'||
     x.organizationId!==org||x.subscriptionId!==sub||
     x.licensesGranted!==false||x.authorizesSeatChanges!==false||
     !Number.isSafeInteger(x.revision)||x.revision<1||
     !stripeId(x.customerId,'cus_')||!stripeId(x.priceId,'price_'))
    return null;
  return x;
 };
 async function get(path){
  // Path is assembled exclusively from verified Stripe ID grammar.
  const reply=await fetchImpl('https://api.stripe.com/v1/'+path,{
   method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
   referrerPolicy:'no-referrer',
   signal:AbortSignal.timeout(timeoutMs),
   headers:{Authorization:'Bearer '+secretKey,Accept:'application/json'}
  });
  return limitedStripeJson(reply);
 }
 return Object.freeze({
  async inspect({organizationId,subscriptionId}={}){
   if(typeof organizationId!=='string'||!SAFE.test(organizationId)||
      !stripeId(subscriptionId,'sub_'))
    return deny('invalid_pinned_subscription','unavailable');
   try{
    const first=pinFor(organizationId,subscriptionId);
    if(!first)return deny('pin_not_available','unavailable');

    const now=clock();
    if(!Number.isSafeInteger(now)||now<=0)
     return deny('billing_clock_invalid','unavailable');

    // The existing Stripe LIVE reader already checks subscription status,
    // exact tenant, licensed price/quantity and paid-invoice line lineage.
    const prerequisite=await billingReader.inspect(first);
    if(!prerequisite||prerequisite.state!=='candidate_for_manual_review'||
       prerequisite.licensesGranted!==false||
       prerequisite.authorizesSeatChanges!==false)
     return deny('invoice_baseline_not_eligible');

    const subscription=await get('subscriptions/'+subscriptionId);
    if(subscription.object!=='subscription'||subscription.id!==subscriptionId||
       subscription.customer!==first.customerId||
       subscription.metadata?.organization_id!==organizationId||
       subscription.status!=='active'||!Array.isArray(subscription.items?.data)||
       subscription.items.has_more!==false||
       subscription.items.data.length!==1||
       subscription.items.data[0]?.price?.id!==first.priceId||
       subscription.items.data[0]?.price?.livemode!==true||
       subscription.items.data[0]?.price?.recurring?.usage_type!=='licensed'||
       subscription.items.data[0]?.quantity!==first.seats)
     return deny('subscription_trace_mismatch');

    const invoiceId=ref(subscription.latest_invoice);
    if(!stripeId(invoiceId,'in_'))return deny('invoice_not_linked');
    const invoice=await get('invoices/'+invoiceId);
    const invoiceSubscription=ref(invoice.parent?.subscription_details?.subscription)??
      ref(invoice.subscription);
    if(invoice.object!=='invoice'||invoice.id!==invoiceId||
       invoice.customer!==first.customerId||
       invoiceSubscription!==subscriptionId||invoice.status!=='paid'||
       invoice.paid!==true||invoice.paid_out_of_band!==false||
       !safeInt(invoice.amount_paid)||invoice.amount_paid<=0||
       invoice.amount_remaining!==0||
       !safeInt(invoice.pre_payment_credit_notes_amount)||
       !safeInt(invoice.post_payment_credit_notes_amount))
     return deny('invoice_trace_mismatch');
    if(invoice.pre_payment_credit_notes_amount!==0||
       invoice.post_payment_credit_notes_amount!==0)
     return deny('invoice_credit_note_review');
    const currency=invoice.currency;
    if(typeof currency!=='string'||!/^[a-z]{3}$/.test(currency))
     return deny('invoice_currency_unknown');

    // Recent Stripe versions expose invoice_payment allocations. Require
    // one complete, non-paginated, actual PaymentIntent-backed payment.
    // Split payments, balance credits, OOB payments and older API shapes
    // require manual reconciliation rather than inferred settlement.
    const payments=await get('invoices/'+invoiceId+'/payments?limit=100');
    if(payments.object!=='list'||payments.has_more!==false||
       !Array.isArray(payments.data)||payments.data.length!==1)
     return deny('invoice_payment_allocation_ambiguous');
    const allocation=payments.data[0];
    const intentId=allocation?.payment?.payment_intent;
    if(allocation?.object!=='invoice_payment'||allocation.livemode!==true||
       allocation.invoice!==invoiceId||allocation.status!=='paid'||
       allocation.currency!==currency||
       allocation.amount_paid!==invoice.amount_paid||
       allocation.payment?.type!=='payment_intent'||
       !stripeId(intentId,'pi_'))
     return deny('invoice_payment_allocation_mismatch');

    const intent=await get('payment_intents/'+intentId);
    const chargeId=ref(intent.latest_charge);
    if(intent.object!=='payment_intent'||intent.id!==intentId||
       intent.customer!==first.customerId||
       intent.status!=='succeeded'||intent.currency!==currency||
       intent.amount_received!==invoice.amount_paid||
       !stripeId(chargeId,'ch_'))
     return deny('payment_intent_trace_mismatch');

    const charge=await get('charges/'+chargeId);
    if(charge.object!=='charge'||charge.id!==chargeId||
       charge.customer!==first.customerId||
       charge.payment_intent!==intentId||
       charge.currency!==currency||
       charge.status!=='succeeded'||charge.paid!==true||
       charge.captured!==true||charge.disputed!==false||
       charge.refunded!==false||charge.amount_refunded!==0||
       charge.amount!==invoice.amount_paid||
       charge.refunds?.has_more!==false||
       !Array.isArray(charge.refunds?.data)||charge.refunds.data.length!==0)
     return deny('charge_refund_or_dispute_review');

    const second=pinFor(organizationId,subscriptionId);
    if(!second||pinIdentity(first)!==pinIdentity(second))
     return deny('pin_changed_during_settlement_lookup','unavailable');
    // A snapshot with no observed warning STILL needs independent
    // provider event, refund/dispute and financial reconciliation.
    return Object.freeze({
     state:'manual_review',
     reason:'payment_chain_traced_at_check',
     bindingRevision:second.revision,
     checkedAt:now,
     licensesGranted:false,authorizesSeatChanges:false,
     paymentEvidenceAuthoritative:false
    });
   }catch{
    return deny('stripe_settlement_source_unavailable','unavailable');
   }
  }
 });
}
