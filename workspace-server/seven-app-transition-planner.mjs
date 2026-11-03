/**
 * DORMANT source-only seven-app subscription transition planner.
 * No database writes, purchase, Stripe request or authorization grant.
 * Caller must independently verify real billing evidence and customer consent.
 * Active six-app subscription flows must continue using their existing planner.
 */
export const FUTURE_DUCKBIO_APPS=Object.freeze([
 'limsman','goflo','methpipe','eel','duckman','mantrain','dataduck'
]);
const SIX=new Set(FUTURE_DUCKBIO_APPS.filter(id=>id!=='dataduck'));
const future=new Set(FUTURE_DUCKBIO_APPS);
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const fail=()=>{throw Error('invalid_seven_app_transition');};

/**
 * Read-only proposal for a trusted future billing integration.
 * approvedCatalogUpgrade MUST come from independently verified explicit
 * customer consent and signed LIVE provider evidence, never from a form.
 * The planner does not authenticate that evidence and always denies grants.
 */
export function planFutureSevenAppTransition({organizationId,subscriptionId,
 knownApps,existing=null,next,approvedCatalogUpgrade=false,now=Date.now()}={}){
 if(!validId(organizationId)||!validId(subscriptionId)||
    !Number.isSafeInteger(now)||now<0||
    typeof approvedCatalogUpgrade!=='boolean'||
    !Array.isArray(knownApps)||knownApps.length!==7)fail();
 const inventory=new Map();
 for(const item of knownApps){
  if(!item||!future.has(item.appId)||inventory.has(item.appId)||
     ![item.purchased,item.assigned,item.reserved].every(count))fail();
  inventory.set(item.appId,item);
 }
 if(inventory.size!==7)fail();
 const parse=(s,isNext,allowLegacyBundle=false)=>{
  if(!s||typeof s!=='object'||Array.isArray(s)||
     !['Single','Mixed','Bundle'].includes(s.plan)||
     !['active','canceled'].includes(s.status)||
     !Array.isArray(s.apps)||!Number.isSafeInteger(s.seats)||
     s.seats<1||s.seats>10000||!Number.isSafeInteger(s.revision)||
     s.revision<1||new Set(s.apps).size!==s.apps.length||
     s.apps.some(id=>!future.has(id)))fail();
  const apps=[...s.apps].sort();
  const isOldBundle=s.plan==='Bundle'&&apps.length===6&&apps.every(id=>SIX.has(id));
  const validPlan=s.plan==='Single'?apps.length===1:
   s.plan==='Mixed'?apps.length>=2&&apps.length<=6:
   (apps.length===7&&FUTURE_DUCKBIO_APPS.every(id=>apps.includes(id)))||
     ((!isNext||allowLegacyBundle)&&isOldBundle);
  if(!validPlan||
     (s.paidThrough!==null&&s.paidThrough!==undefined&&
      (!Number.isSafeInteger(s.paidThrough)||s.paidThrough<1))||
     (s.status==='active'&&(!Number.isSafeInteger(s.paidThrough)||
       (isNext&&s.paidThrough<=Math.floor(now/1000)))))fail();
  return {plan:s.plan,apps,seats:s.seats,revision:s.revision,
    status:s.status,paidThrough:s.paidThrough??null,isOldBundle};
 };
 const old=existing===null?null:parse(existing,false);
 let target=parse(next,true,Boolean(old?.isOldBundle));
 const renewingOldBundle=Boolean(old?.isOldBundle&&target.plan==='Bundle'&&
   target.apps.length===6&&target.apps.every(id=>SIX.has(id)));
 // Existing six-app Bundle remains a valid legacy product at renewal.
 if(renewingOldBundle)target={...target,isOldBundle:true};
 else if(target.plan==='Bundle'&&target.apps.length!==7)fail();
 if(old&&(existing.organizationId!==organizationId||
          existing.subscriptionId!==subscriptionId||
          target.revision<=old.revision||old.status!=='active'))fail();
 if(!old&&target.status!=='active')fail();
 if(target.status==='canceled'&&(!old||target.plan!==old.plan||
    target.apps.join(',')!==old.apps.join(',')||target.seats!==old.seats))fail();
 const addsDataDuck=Boolean(old&&!old.apps.includes('dataduck')&&
   target.status==='active'&&target.apps.includes('dataduck'));
 const upgradeBlocked=addsDataDuck&&!approvedCatalogUpgrade;
 let conflicted=false;
 const changes=[];
 for(const [appId,item] of inventory){
  const previous=old?.status==='active'&&old.apps.includes(appId)?old.seats:0;
  const proposed=target.status==='active'&&target.apps.includes(appId)?target.seats:0;
  const delta=proposed-previous,projected=item.purchased+delta;
  const committed=item.assigned+item.reserved;
  if(!Number.isSafeInteger(projected)||!Number.isSafeInteger(committed)||projected<0)fail();
  const shortfall=Math.max(0,committed-projected);
  if(shortfall)conflicted=true;
  changes.push(Object.freeze({appId,delta,previousSeats:previous,
    proposedSeats:proposed,purchased:item.purchased,targetPurchased:projected,
    assigned:item.assigned,reserved:item.reserved,shortfall}));
 }
 return Object.freeze({organizationId,subscriptionId,
  previousRevision:old?.revision??null,nextRevision:target.revision,
  oldSixAppBundlePreserved:Boolean(renewingOldBundle),
  catalogUpgradeRequiresApproval:upgradeBlocked,
  proposedPlan:target.plan,proposedApps:Object.freeze(target.apps),
  nextStatus:target.status,changes:Object.freeze(changes),
  allowed:!upgradeBlocked&&!conflicted,
  requiresManualReview:upgradeBlocked||conflicted,
  licensesGranted:false,realSeatChanges:false,orderable:false});
}
