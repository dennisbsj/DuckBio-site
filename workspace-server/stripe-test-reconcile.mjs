// Read-only test-mode Stripe payment attestation. Never call seat-purchase or app-grant APIs.
// A Checkout success URL or signed webhook alone does not prove that an invoice is paid.
const id=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'[A-Za-z0-9_]{4,128}$').test(value);
const ref=value=>typeof value==='string'?value:null;
const notBlank=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\s\u0000-\u001f]/.test(value);
const invalid=()=>{throw Error('Stripe test billing identity mismatch');};
export function createStripeTestReconciler({secretKey,fetchImpl=globalThis.fetch}={}){
 if(typeof secretKey!=='string'||!/^sk_test_[A-Za-z0-9_]{12,}$/.test(secretKey))
  throw Error('Private Stripe test secret key required');
 if(typeof fetchImpl!=='function')throw Error('Invalid Stripe HTTP provider');
 async function get(collection,objectId){
  const url='https://api.stripe.com/v1/'+collection+'/'+encodeURIComponent(objectId);
  const response=await fetchImpl(url,{
   method:'GET',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
   signal:AbortSignal.timeout(10000),
   headers:{Authorization:'Bearer '+secretKey,Accept:'application/json'}
  });
  if(!response?.ok||!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||''))
   throw Error('Stripe test billing lookup unavailable');
  const body=await response.text();
  if(body.length>131072)throw Error('Oversized Stripe billing response');
  let result;
  try{result=JSON.parse(body);}catch{throw Error('Malformed Stripe billing response');}
  if(!result||typeof result!=='object'||Array.isArray(result)||result.livemode!==false)
   invalid();
  return result;
 }
 return Object.freeze({
  async inspect({draft,checkout}={}){
   if(!draft||!notBlank(draft.id)||!notBlank(draft.organizationId)||
     !Number.isSafeInteger(draft.seats)||draft.seats<1||draft.seats>10000||
     !id(checkout?.sessionId,'cs_test_')||!id(checkout?.price,'price_'))
    throw Error('Invalid local test billing record');
   const pending=(reason)=>Object.freeze({state:'pending',reason,licensesGranted:false});
   const session=await get('checkout/sessions',checkout.sessionId);
   if(session.object!=='checkout.session'||session.id!==checkout.sessionId||
     session.mode!=='subscription'||session.client_reference_id!==draft.id||
     session.metadata?.organization_id!==draft.organizationId||
     session.metadata?.draft_id!==draft.id)invalid();
   if(session.status==='open'||session.status==='expired')return pending('checkout_not_completed');
   if(session.status!=='complete')invalid();
   if(session.payment_status==='unpaid')return pending('payment_unpaid');
   if(session.payment_status!=='paid')invalid();
   const subscriptionId=ref(session.subscription),customerId=ref(session.customer);
   if(!id(subscriptionId,'sub_')||!id(customerId,'cus_'))invalid();
   const subscription=await get('subscriptions',subscriptionId);
   if(subscription.object!=='subscription'||subscription.id!==subscriptionId||
     ref(subscription.customer)!==customerId||
     subscription.metadata?.organization_id!==draft.organizationId||
     subscription.metadata?.draft_id!==draft.id||
     subscription.pause_collection!=null||subscription.pending_update!=null||
     !Array.isArray(subscription.items?.data)||subscription.items.has_more!==false||
     subscription.items.data.length!==1)invalid();
   const item=subscription.items.data[0];
   if(ref(item.price?.id)!==checkout.price||item.price?.livemode!==false||
     item.quantity!==draft.seats||item.price?.recurring?.usage_type!=='licensed')invalid();
   // Stripe's newer API versions put the billing period on subscription items.
   // Legacy versions also exposed it on the parent subscription.
   const statuses=['incomplete','incomplete_expired','trialing','active','past_due',
     'canceled','unpaid','paused'];
   if(!statuses.includes(subscription.status)||
      (subscription.cancel_at_period_end!==undefined&&
        typeof subscription.cancel_at_period_end!=='boolean'))invalid();
   const periodEnd=item.current_period_end??subscription.current_period_end??null;
   const cancelAt=subscription.cancel_at??null;
   if((periodEnd!==null&&(!Number.isSafeInteger(periodEnd)||periodEnd<1))||
      (cancelAt!==null&&(!Number.isSafeInteger(cancelAt)||cancelAt<1)))invalid();
   const info={subscriptionStatus:subscription.status,
     cancelAtPeriodEnd:subscription.cancel_at_period_end===true,
     cancelAt,periodEnd,invoiceStatus:null,billingReason:null};
   const withLifecycle=(reason)=>Object.freeze({...pending(reason),lifecycle:Object.freeze({...info})});
   const invoiceId=ref(subscription.latest_invoice);
   if(!id(invoiceId,'in_')){
    if(invoiceId!==null)invalid();
    return subscription.status==='active'?withLifecycle('invoice_unavailable'):
      withLifecycle('subscription_not_active');
   }
   const invoice=await get('invoices',invoiceId);
   // In newer Stripe API versions, the subscription link moved to parent.subscription_details.
   const invoiceSubscription=ref(invoice.parent?.subscription_details?.subscription)??ref(invoice.subscription);
   if(invoice.object!=='invoice'||invoice.id!==invoiceId||
     invoiceSubscription!==subscriptionId||ref(invoice.customer)!==customerId||
     !['draft','open','paid','uncollectible','void'].includes(invoice.status))invalid();
   const billingReason=invoice.billing_reason??null;
   if(billingReason!==null&&!['subscription','subscription_create','subscription_cycle',
     'subscription_threshold','subscription_update'].includes(billingReason))invalid();
   info.invoiceStatus=invoice.status;info.billingReason=billingReason;
   if(subscription.status!=='active')return withLifecycle('subscription_not_active');
   if(invoice.status!=='paid')return withLifecycle('invoice_not_paid');
   if(invoice.paid!==true||invoice.paid_out_of_band!==false||
     !Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<=0||
     invoice.amount_remaining!==0||
     !Number.isSafeInteger(invoice.status_transitions?.paid_at)||
     invoice.status_transitions.paid_at<1)invalid();
   // Paid test invoices can be initial or subscription-cycle renewals;
   // a cancellation scheduled for period end is not an immediately revoked seat.
   // This is historical TEST evidence only, never entitlement authority.
   return Object.freeze({state:'paid_test_verified',sessionId:session.id,
    subscriptionId,invoiceId,organizationId:draft.organizationId,draftId:draft.id,
    price:checkout.price,seats:draft.seats,licensesGranted:false,
    lifecycle:Object.freeze({...info})});
  }
 });
}
