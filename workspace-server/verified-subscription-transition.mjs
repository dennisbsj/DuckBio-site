// Pure licensing transition planner for a FUTURE independently verified billing adapter.
// Never feed this function a Stripe TEST observation or unverified browser payload.
// It has no database writes, Stripe calls or native-app access side effects.
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const validCount=value=>Number.isSafeInteger(value)&&value>=0;
const validRevision=value=>Number.isSafeInteger(value)&&value>0;
const plans=new Set(['Single','Mixed','Bundle']);
const states=new Set(['active','canceled']);
// Historic six-app Bundle subscriptions must remain readable and renewable.
// They are NOT valid for creating new Bundle subscriptions after DataDuck joins.
const legacySix=new Set(['limsman','goflo','methpipe','eel','duckman','mantrain']);
const isLegacyBundle=apps=>Array.isArray(apps)&&apps.length===legacySix.size&&apps.every(id=>legacySix.has(id));

export function planVerifiedSubscriptionTransition({
  organizationId,subscriptionId,knownApps,existing=null,next,now=Date.now()
}={}){
 if(!validId(organizationId)||!validId(subscriptionId)||
    !Number.isSafeInteger(now)||now<0||
    !Array.isArray(knownApps)||knownApps.length!==7||
    !next||typeof next!=='object'||Array.isArray(next))
  throw Error('invalid_subscription_transition');
 const inventory=new Map();
 for(const item of knownApps){
  if(!item||!validId(item.appId)||inventory.has(item.appId)||
     ![item.purchased,item.assigned,item.reserved].every(validCount))
   throw Error('invalid_subscription_transition');
  inventory.set(item.appId,item);
 }
 const legacyExisting=existing!==null&&existing?.plan==='Bundle'&&isLegacyBundle(existing.apps);
 const parse=(value,requireFuturePayment,allowLegacyBundle=false)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
     !plans.has(value.plan)||!states.has(value.status)||
     !Array.isArray(value.apps)||!validRevision(value.revision)||
     !Number.isSafeInteger(value.seats)||value.seats<1||value.seats>10000||
     new Set(value.apps).size!==value.apps.length||
     value.apps.some(id=>!inventory.has(id))||
     (value.plan==='Single'&&value.apps.length!==1)||
     (value.plan==='Mixed'&&(value.apps.length<2||value.apps.length>inventory.size-1))||
     (value.plan==='Bundle'&&!(value.apps.length===inventory.size&&
       value.apps.every(id=>inventory.has(id)) ||
       allowLegacyBundle&&isLegacyBundle(value.apps)))||
     (value.paidThrough!==null&&value.paidThrough!==undefined&&
       (!Number.isSafeInteger(value.paidThrough)||value.paidThrough<1))||
     (value.status==='active'&&
       (!Number.isSafeInteger(value.paidThrough)||value.paidThrough<1||
         (requireFuturePayment&&value.paidThrough<=Math.floor(now/1000)))))
   throw Error('invalid_subscription_transition');
  return {plan:value.plan,apps:[...value.apps].sort(),seats:value.seats,
   revision:value.revision,status:value.status,paidThrough:value.paidThrough??null};
 };
 const target=parse(next,true,legacyExisting);
 const old=existing===null?null:parse(existing,false,true);
 if(old&&(existing.organizationId!==organizationId||
          existing.subscriptionId!==subscriptionId||
          target.revision<=old.revision))
  throw Error('stale_subscription_transition');
 if(!old&&target.status!=='active')throw Error('invalid_subscription_transition');
 if(target.status==='canceled'&&
    (old?.status!=='active'||old.plan!==target.plan||
      old.seats!==target.seats||old.apps.join(',')!==target.apps.join(',')))
  throw Error('invalid_subscription_transition');
 const changes=[];
 let blocked=false;
 for(const [appId,app] of inventory){
  const previousSeats=old?.status==='active'&&old.apps.includes(appId)?old.seats:0;
  const proposedSeats=target.status==='active'&&target.apps.includes(appId)?target.seats:0;
  const delta=proposedSeats-previousSeats;
  const newPurchased=app.purchased+delta;
  const committed=app.assigned+app.reserved;
  if(!Number.isSafeInteger(newPurchased)||!Number.isSafeInteger(committed)||
     newPurchased<0)throw Error('subscription_transition_invariant');
  const conflict=newPurchased<committed;
  if(conflict)blocked=true;
  changes.push(Object.freeze({appId,previousSeats,proposedSeats,
   delta,currentPurchased:app.purchased,targetPurchased:newPurchased,
   assigned:app.assigned,reserved:app.reserved,
   shortfall:conflict?committed-newPurchased:0,blocked:conflict}));
 }
 return Object.freeze({organizationId,subscriptionId,
  currentRevision:old?.revision??null,nextRevision:target.revision,
  nextStatus:target.status,nextPlan:target.plan,
  nextApps:target.apps,nextSeats:target.seats,
  paidThrough:target.paidThrough,changes:Object.freeze(changes),
  allowed:!blocked,requiresManualReview:blocked,
  // A proposal is not an entitlement. Only a private verified billing
  // integration may later make any live change transactionally.
  realSeatChanges:false,licensesGranted:false});
}
