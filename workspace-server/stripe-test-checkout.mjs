// A private, test-mode-only Checkout adapter. Does not grant licences or handle webhooks.
const owns=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function createStripeTestCheckout({secretKey,priceMap,origin,fetchImpl=globalThis.fetch}={}){
 if(typeof secretKey!=='string'||!/^sk_test_[A-Za-z0-9_]{12,}$/.test(secretKey))throw Error('Only Stripe test secret keys are accepted');
 if(!priceMap||typeof priceMap!=='object'||Array.isArray(priceMap)||!Object.keys(priceMap).length)throw Error('Explicit test price mapping required');
 for(const [key,value] of Object.entries(priceMap)){
  if(!/^(Single|Mixed|Bundle):(?:goflo|eel|methpipe|mantrain|duckman|limsman)(?:,(?:goflo|eel|methpipe|mantrain|duckman|limsman))*$/.test(key)||
     typeof value!=='string'||!/^price_[A-Za-z0-9_]{5,}$/.test(value))throw Error('Invalid test price mapping');
 }
 const base=new URL(origin);
 if(base.protocol!=='https:'&&!((base.protocol==='http:')&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Secure Workspace origin required');
 if(base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Invalid Workspace origin');
 if(typeof fetchImpl!=='function')throw Error('Invalid Stripe fetch provider');
 return Object.freeze({
  priceFor({plan,apps}){
   if(!['Single','Mixed','Bundle'].includes(plan)||!Array.isArray(apps)||new Set(apps).size!==apps.length)return null;
   const key=plan+':'+[...apps].sort().join(',');
   return owns(priceMap,key)?priceMap[key]:null;
  },
  async createSession({draft,price,idempotencyKey}){
   if(!draft||typeof draft.id!=='string'||typeof draft.organizationId!=='string'||!Number.isSafeInteger(draft.seats)||draft.seats<1||draft.seats>10000||
      typeof idempotencyKey!=='string'||!/^[A-Za-z0-9._-]{5,128}$/.test(idempotencyKey)||this.priceFor(draft)!==price)throw Error('Invalid test Checkout request');
   const body=new URLSearchParams({
    mode:'subscription','line_items[0][price]':price,'line_items[0][quantity]':String(draft.seats),
    success_url:new URL('/workspace?checkout=success',base).href,
    cancel_url:new URL('/workspace?checkout=cancel',base).href,
    client_reference_id:draft.id,
    'metadata[organization_id]':draft.organizationId,
    'metadata[draft_id]':draft.id,
    'subscription_data[metadata][organization_id]':draft.organizationId,
    'subscription_data[metadata][draft_id]':draft.id
   });
   const response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{
    method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+secretKey,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':idempotencyKey},
    body:body.toString()
   });
   if(!response.ok)throw Error('Stripe test Checkout request failed');
   const result=await response.json();
   if(!result||!/^cs_test_[A-Za-z0-9_]+$/.test(result.id||'')||result.livemode!==false||result.mode!=='subscription'||
      result.client_reference_id!==draft.id||result.metadata?.organization_id!==draft.organizationId||result.metadata?.draft_id!==draft.id)
      throw Error('Stripe test Checkout response did not match the draft');
   const url=new URL(result.url);
   if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw Error('Invalid Checkout destination');
   return {id:result.id,url:url.href};
  }
 });
}
