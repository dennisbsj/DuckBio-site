/**
 * DORMANT, PRIVATE Stripe LIVE read-only tenant-bound observation.
 *
 * The organization store owns a verified, revisioned subscription/customer/
 * price pin. This adapter rechecks that exact binding after the external
 * network await. It never makes an entitlement, paid seat or access grant.
 * Do not mount directly on a browser route.
 */
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const safeSubscription=x=>typeof x==='string'&&/^sub_[A-Za-z0-9_]{4,128}$/.test(x);
const deny=reason=>Object.freeze({state:'unavailable',reason,
 licensesGranted:false,authorizesSeatChanges:false});

export function createPinnedStripeLiveObserver({organizationStore,liveReader}={}){
 if(typeof organizationStore?.readPinnedStripeLiveBinding!=='function'||
    typeof liveReader?.inspect!=='function')
  throw Error('private_pinned_live_observer_requires_stores');
 const load=(organizationId,subscriptionId)=>{
  const pin=organizationStore.readPinnedStripeLiveBinding({
   organizationId,subscriptionId
  });
  if(!pin||pin.source!=='pinned_stripe_live'||
     pin.organizationId!==organizationId||pin.subscriptionId!==subscriptionId||
     pin.licensesGranted!==false||pin.authorizesSeatChanges!==false||
     !Number.isSafeInteger(pin.revision)||pin.revision<1)
   return null;
  return pin;
 };
 const identity=p=>JSON.stringify([
  p.organizationId,p.subscriptionId,p.customerId,p.priceId,p.plan,
  p.apps,p.seats,p.revision
 ]);
 return Object.freeze({
  async inspect({organizationId,subscriptionId}={}){
   if(!safeId(organizationId)||!safeSubscription(subscriptionId))
    return deny('invalid_pinned_live_binding');
   let before;
   try{before=load(organizationId,subscriptionId);}
   catch{return deny('pinned_live_binding_unavailable');}
   if(!before)return deny('pinned_live_binding_missing');
   let observed;
   try{observed=await liveReader.inspect(before);}
   catch{return deny('stripe_live_lookup_unavailable');}
   let after;
   try{after=load(organizationId,subscriptionId);}
   catch{return deny('pinned_live_binding_unavailable');}
   if(!after||identity(before)!==identity(after))
    return deny('pinned_live_binding_changed_during_lookup');
   // A private LIVE reader returns observations, NEVER authorizations.
   if(!observed||typeof observed!=='object'||Array.isArray(observed)||
      observed.licensesGranted!==false||
      observed.authorizesSeatChanges!==false||
      !['manual_review','candidate_for_manual_review'].includes(observed.state))
    return deny('stripe_live_observation_invalid');
   return Object.freeze({...observed,
    bindingRevision:after.revision,
    licensesGranted:false,authorizesSeatChanges:false});
  }
 });
}
