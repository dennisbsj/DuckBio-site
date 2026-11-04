/**
 * DORMANT, SERVER-ONLY Stripe LIVE onboarding evidence gate.
 *
 * A DuckBio-controlled offline Ed25519 approval binds the tenant to a
 * customer/subscription/price/plan. Independent read-only Stripe customer
 * and subscription requests must corroborate the exact tuple. Successful
 * verification produces an opaque ONE-USE token for the canonical private
 * organization-store pin callback. This is NOT payment evidence or licensing.
 */
import {createPublicKey,verify as verifyEd25519} from 'node:crypto';

const VERSION='duckbio.stripe-live-binding-approval.v1';
const KEYS=Object.freeze([
 'version','keyId','eventKey','organizationId','subscriptionId',
 'customerId','priceId','plan','apps','seats','revision','issuedAt','expiresAt'
]);
const APPS=new Set(['limsman','goflo','methpipe','eel','duckman','mantrain']);
const SAFE=/^[A-Za-z0-9_.:-]{1,128}$/;
const KEY=/^[A-Za-z0-9_.-]{1,64}$/;
const STRIPE=(s,p)=>typeof s==='string'&&
 new RegExp('^'+p+'[A-Za-z0-9_]{4,128}$').test(s);
const equalKeys=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const MAX_AGE=300000;
const SKEW=5000;

export function canonicalStripeLiveBindingApprovalBytes(p){
 return Buffer.from(JSON.stringify(KEYS.map(k=>p[k])),'utf8');
}

export function createStripeLiveApprovalGate({
 approvalKeyId,approvalPublicKeyPem,customerReader,subscriptionReader,
 clock=Date.now
}={}){
 if(typeof approvalKeyId!=='string'||!KEY.test(approvalKeyId)||
    typeof approvalPublicKeyPem!=='string'||
    typeof customerReader?.verify!=='function'||
    typeof subscriptionReader?.inspect!=='function'||
    typeof clock!=='function')
  throw Error('private_stripe_binding_approval_config_required');
 let publicKey;
 try{publicKey=createPublicKey(approvalPublicKeyPem);}
 catch{throw Error('invalid_stripe_binding_approval_key');}
 if(publicKey.asymmetricKeyType!=='ed25519')
  throw Error('invalid_stripe_binding_approval_key');
 const pending=new WeakMap();

 function validate(p,sig,at){
  if(!equalKeys(p,KEYS)||p.version!==VERSION||
     p.keyId!==approvalKeyId||typeof p.eventKey!=='string'||
     !SAFE.test(p.eventKey)||typeof p.organizationId!=='string'||
     !SAFE.test(p.organizationId)||
     !STRIPE(p.subscriptionId,'sub_')||
     !STRIPE(p.customerId,'cus_')||!STRIPE(p.priceId,'price_')||
     !['Single','Mixed','Bundle'].includes(p.plan)||
     !Array.isArray(p.apps)||p.apps.length<1||
     p.apps.some(id=>!APPS.has(id))||
     new Set(p.apps).size!==p.apps.length||
     p.apps.join(',')!==[...p.apps].sort().join(',')||
     (p.plan==='Single'&&p.apps.length!==1)||
     (p.plan==='Mixed'&&(p.apps.length<2||p.apps.length>5))||
     (p.plan==='Bundle'&&p.apps.length!==6)||
     !Number.isSafeInteger(p.seats)||p.seats<1||p.seats>10000||
     !Number.isSafeInteger(p.revision)||p.revision<1||
     !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
     p.issuedAt<at-MAX_AGE||p.issuedAt>at+SKEW||
     p.expiresAt<=at||p.expiresAt<=p.issuedAt||
     p.expiresAt-p.issuedAt>MAX_AGE||
     typeof sig!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(sig))return false;
  const bytes=Buffer.from(sig,'base64url');
  if(bytes.length!==64||bytes.toString('base64url')!==sig)return false;
  return verifyEd25519(null,canonicalStripeLiveBindingApprovalBytes(p),
   publicKey,bytes)===true;
 }

 const toVerified=p=>({
  source:'stripe_live',eventKey:p.eventKey,organizationId:p.organizationId,
  subscriptionId:p.subscriptionId,customerId:p.customerId,
  priceId:p.priceId,plan:p.plan,apps:[...p.apps],
  seats:p.seats,revision:p.revision
 });
 return Object.freeze({
  // Pass THIS bound callback into createOrganizationStore at startup.
  // Only in-memory objects created by this gate can carry evidence.
  verifyLiveBillingBindingEvidence(token){
   if(!token||typeof token!=='object')throw Error('untrusted_stripe_pin_token');
   const value=pending.get(token);
   if(!value)throw Error('untrusted_stripe_pin_token');
   pending.delete(token);
   return structuredClone(value);
  },
  // Invoke from a reviewed PRIVATE onboarding / provisioning service only,
  // never from a browser request using user-controlled approval material.
  async verifyAndPin({organizationStore,approval,signature}={}){
   try{
    if(typeof organizationStore?.pinVerifiedStripeLiveBinding!=='function')
     return false;
    const start=clock();
    if(!Number.isSafeInteger(start)||start<=0||
       !validate(approval,signature,start))return false;
    const binding=toVerified(approval);
    // Stripe customer and subscription are checked by separate private
    // Stripe API readers; signed metadata alone is never sufficient.
    if((await customerReader.verify({
       organizationId:binding.organizationId,customerId:binding.customerId
      }))!==true)return false;
    const observation=await subscriptionReader.inspect(binding);
    if(!observation||observation.licensesGranted!==false||
       observation.authorizesSeatChanges!==false||
       !['manual_review','candidate_for_manual_review'].includes(observation.state))
     return false;
    const end=clock();
    if(!Number.isSafeInteger(end)||end<start||
       !validate(approval,signature,end))return false;
    const token=Object.freeze({});
    pending.set(token,binding);
    // Token is consumed synchronously by the organization store; it cannot
    // be replayed by an untrusted caller or serialized into JSON.
    try{
     const applied=organizationStore.pinVerifiedStripeLiveBinding(token);
     return applied?.licensesGranted===false&&
       (applied.pinned===true||applied.idempotent===true)
       ?Object.freeze({...applied,authorizesSeatChanges:false}):false;
    }finally{pending.delete(token);}
   }catch{return false;}
  }
 });
}
