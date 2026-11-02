// PRIVATE, read-only Stripe LIVE billing inspection.
// An observation here is NOT a trusted entitlement transition or authorization.
// There is deliberately no browser route and no connection to purchased seats.
const apps=new Set(['limsman','goflo','methpipe','eel','duckman','mantrain']);
const ident=(value,prefix)=>typeof value==='string'&&
 new RegExp('^'+prefix+'[A-Za-z0-9_]{4,128}$').test(value);
const orgId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const ref=value=>typeof value==='string'?value:null;
const mismatch=()=>{throw Error('Stripe LIVE billing identity mismatch');};
function validateBinding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    !orgId(value.organizationId)||!ident(value.subscriptionId,'sub_')||
    !ident(value.customerId,'cus_')||!ident(value.priceId,'price_')||
    !['Single','Mixed','Bundle'].includes(value.plan)||
    !Array.isArray(value.apps)||new Set(value.apps).size!==value.apps.length||
    value.apps.some(id=>!apps.has(id))||
    (value.plan==='Single'&&value.apps.length!==1)||
    (value.plan==='Mixed'&&(value.apps.length<2||value.apps.length>5))||
    (value.plan==='Bundle'&&value.apps.length!==6)||
    !Number.isSafeInteger(value.seats)||value.seats<1||value.seats>10000)
  throw Error('Invalid pinned Stripe LIVE billing binding');
}
export function createStripeLiveBillingReader({
 secretKey,fetchImpl=globalThis.fetch,clock=Date.now
}={}){
 if(typeof secretKey!=='string'||!/^sk_live_[A-Za-z0-9_]{12,}$/.test(secretKey))
  throw Error('Private Stripe LIVE secret key required');
 if(typeof fetchImpl!=='function'||typeof clock!=='function')
  throw Error('Invalid private Stripe LIVE provider');
 async function get(collection,id){
  const response=await fetchImpl(
   'https://api.stripe.com/v1/'+collection+'/'+encodeURIComponent(id),{
    method:'GET',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+secretKey,Accept:'application/json'}
   });
  if(!response?.ok||!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||''))
   throw Error('Stripe LIVE lookup unavailable');
  const body=await response.text();
  if(typeof body!=='string'||body.length>131072)
   throw Error('Stripe LIVE response exceeds safe limit');
  let resource;
  try{resource=JSON.parse(body);}catch{throw Error('Malformed Stripe LIVE response');}
  if(!resource||typeof resource!=='object'||Array.isArray(resource)||
     resource.livemode!==true)mismatch();
  return resource;
 }
 return Object.freeze({
  async inspect(binding){
   // Caller must load the binding from an independently authenticated PRIVATE
   // organization/customer/price record, never browser-submitted selection.
   validateBinding(binding);
   const now=clock();
   if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid Stripe LIVE check clock');
   const nowSecs=Math.floor(now/1000);
   const subscription=await get('subscriptions',binding.subscriptionId);
   if(subscription.object!=='subscription'||
      subscription.id!==binding.subscriptionId||
      ref(subscription.customer)!==binding.customerId||
      subscription.metadata?.organization_id!==binding.organizationId||
      !Array.isArray(subscription.items?.data)||
      subscription.items.has_more!==false||
      subscription.items.data.length!==1)mismatch();
   const item=subscription.items.data[0];
   if(item?.price?.livemode!==true||ref(item.price.id)!==binding.priceId||
      item.price?.recurring?.usage_type!=='licensed'||
      item.quantity!==binding.seats)mismatch();
   const knownStatuses=new Set(['incomplete','incomplete_expired','trialing',
    'active','past_due','canceled','unpaid','paused']);
   if(!knownStatuses.has(subscription.status)||
      (subscription.cancel_at_period_end!==undefined&&
       typeof subscription.cancel_at_period_end!=='boolean'))mismatch();
   const periodEnd=item.current_period_end??subscription.current_period_end??null;
   const cancelAt=subscription.cancel_at??null;
   if((periodEnd!==null&&(!Number.isSafeInteger(periodEnd)||periodEnd<1))||
      (cancelAt!==null&&(!Number.isSafeInteger(cancelAt)||cancelAt<1)))mismatch();
   const effectiveEnd=periodEnd===null?null:
      cancelAt===null?periodEnd:Math.min(periodEnd,cancelAt);
   const basic={subscriptionStatus:subscription.status,
    cancelAtPeriodEnd:subscription.cancel_at_period_end===true,
    periodEnd:effectiveEnd,licensesGranted:false,
    authorizesSeatChanges:false};
   const manual=reason=>Object.freeze({...basic,state:'manual_review',reason});
   if(subscription.pause_collection!=null||subscription.pending_update!=null)
    return manual('subscription_change_unresolved');
   // A missing invoice is never a paid subscription attestation.
   const invoiceId=ref(subscription.latest_invoice);
   if(invoiceId===null)return manual('invoice_unavailable');
   if(!ident(invoiceId,'in_'))mismatch();
   const invoice=await get('invoices',invoiceId);
   const invoiceSubscription=ref(invoice.parent?.subscription_details?.subscription)??
      ref(invoice.subscription);
   if(invoice.object!=='invoice'||invoice.id!==invoiceId||
      invoiceSubscription!==binding.subscriptionId||
      ref(invoice.customer)!==binding.customerId||
      !['draft','open','paid','uncollectible','void'].includes(invoice.status))
    mismatch();
   if(subscription.status!=='active')return manual('subscription_not_active');
   if(!Number.isSafeInteger(effectiveEnd)||effectiveEnd<=nowSecs)
    return manual('period_not_active');
   if(invoice.status!=='paid')return manual('invoice_unpaid');
   if(invoice.paid!==true||invoice.paid_out_of_band!==false||
      !Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<=0||
      invoice.amount_remaining!==0||
      !Number.isSafeInteger(invoice.status_transitions?.paid_at)||
      invoice.status_transitions.paid_at<1||
      invoice.status_transitions.paid_at>nowSecs)mismatch();
   const reasons=new Set(['subscription','subscription_create','subscription_cycle',
    'subscription_threshold','subscription_update']);
   if(!reasons.has(invoice.billing_reason))return manual('invoice_not_subscription_billing');
   // A paid invoice for the OLD price cannot support a newer price or seat change.
   // Stripe invoice line shapes differ by API version; require an explicit match.
   if(!Array.isArray(invoice.lines?.data)||invoice.lines.has_more!==false)
    return manual('invoice_lineage_unavailable');
   const match=invoice.lines.data.some(line=>
     (ref(line?.pricing?.price_details?.price)??ref(line?.price?.id))===binding.priceId&&
     line.quantity===binding.seats&&
     line.period?.end===periodEnd&&
     (line.parent?.subscription_item_details?.subscription===binding.subscriptionId||
      line.subscription===binding.subscriptionId));
   if(!match)return manual('invoice_lineage_mismatch');
   // Still NOT sufficient for live billing authorization: separate checks for
   // charge/refund/disputes, event provenance, tenant binding and revisions required.
   return Object.freeze({...basic,state:'candidate_for_manual_review',
    billingReason:invoice.billing_reason,checkedAt:now});
  }
 });
}
