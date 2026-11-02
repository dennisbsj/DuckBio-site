// Private subscription entitlement *planner*. No writes, no activation, no Stripe calls.
// Test-mode evidence is intentionally never authority for real purchased seats.
const decisions=new Set(['candidate_paid','payment_review','cancellation_review','awaiting_payment','unavailable']);
export function buildShadowEntitlementPlan({organizationId,apps,subscriptions,now=Date.now()}={}){
 if(typeof organizationId!=='string'||!organizationId||
    !Array.isArray(apps)||!Array.isArray(subscriptions)||
    !Number.isSafeInteger(now)||now<0)throw Error('invalid_entitlement_plan');
 const ids=new Set(),seen=new Set(),rows=new Map();
 for(const app of apps){
  if(!app||typeof app.id!=='string'||!app.id||ids.has(app.id)||
     ![app.purchased,app.assigned,app.reserved].every(n=>Number.isSafeInteger(n)&&n>=0))
    throw Error('invalid_entitlement_plan');
  ids.add(app.id);
  rows.set(app.id,{appId:app.id,appName:app.name,
   livePurchased:app.purchased,assigned:app.assigned,reserved:app.reserved,
   candidateTestSeats:0,subscriptionCount:0,needsReview:false});
 }
 for(const item of subscriptions){
  if(!item||item.org!==organizationId||typeof item.subscriptionId!=='string'||
     !item.subscriptionId||seen.has(item.subscriptionId)||
     !decisions.has(item.decision)||!Array.isArray(item.apps)||item.apps.length<1||
     new Set(item.apps).size!==item.apps.length||
     !Number.isSafeInteger(item.seats)||item.seats<1||
     !Number.isSafeInteger(item.attempt)||item.attempt<1||
     (item.periodEnd!==null&&(!Number.isSafeInteger(item.periodEnd)||item.periodEnd<1)))
    throw Error('invalid_entitlement_plan');
  seen.add(item.subscriptionId);
  for(const name of item.apps){
   if(!ids.has(name))throw Error('invalid_entitlement_plan');
   const row=rows.get(name);
   row.subscriptionCount++;
   if(item.decision==='candidate_paid'&&item.periodEnd!==null&&
      item.periodEnd>Math.floor(now/1000)){
    row.candidateTestSeats+=item.seats;
    if(!Number.isSafeInteger(row.candidateTestSeats))throw Error('entitlement_overflow');
   }else row.needsReview=true;
  }
 }
 return Object.freeze({testOnly:true,realSeatChanges:false,licensesGranted:false,
  organizationId,apps:[...rows.values()].map(x=>{
   const committed=x.assigned+x.reserved;
   if(!Number.isSafeInteger(committed))throw Error('entitlement_overflow');
   const status=x.subscriptionCount===0?'not_evaluated':
    x.needsReview?'manual_review':
    committed>x.candidateTestSeats?'assignment_conflict':
    x.candidateTestSeats>x.livePurchased?'increase_candidate':
    x.candidateTestSeats<x.livePurchased?'decrease_requires_review':'unchanged';
   return Object.freeze({...x,status,
    hypotheticalShortfall:status==='assignment_conflict'?committed-x.candidateTestSeats:0,
    realSeatChanges:false,licensesGranted:false});
  })});
}
