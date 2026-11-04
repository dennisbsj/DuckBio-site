/**
 * PRIVATE / DORMANT, read-only Stripe LIVE customer identity check.
 * The customer metadata is NOT independently authoritative for Workspace
 * tenant ownership: a separately signed operator approval is mandatory.
 * This module never authorizes subscriptions, seats, purchases or login.
 */
const ID=/^cus_[A-Za-z0-9_]{4,128}$/;
const ORG=/^[A-Za-z0-9_.:-]{1,128}$/;
const LIMIT=32768;

export function createStripeLiveCustomerReader({
 secretKey,fetchImpl=globalThis.fetch,timeoutMs=5000
}={}){
 if(typeof secretKey!=='string'||!/^sk_live_[A-Za-z0-9_]{12,}$/.test(secretKey)||
    typeof fetchImpl!=='function'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>15000)
  throw Error('private_stripe_live_customer_reader_required');
 return Object.freeze({
  async verify({organizationId,customerId}={}){
   if(typeof customerId!=='string'||!ID.test(customerId)||
      typeof organizationId!=='string'||!ORG.test(organizationId))
    return false;
   try{
    const reply=await fetchImpl('https://api.stripe.com/v1/customers/'+customerId,{
     method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
     referrerPolicy:'no-referrer',signal:AbortSignal.timeout(timeoutMs),
     headers:{Authorization:'Bearer '+secretKey,Accept:'application/json'}
    });
    if(!reply||reply.ok!==true||reply.status!==200||
       !/^application\/json(?:\s*;|$)/i.test(reply.headers?.get?.('content-type')??''))
     return false;
    const declared=reply.headers?.get?.('content-length');
    if(declared!==null&&
       (!/^(0|[1-9][0-9]*)$/.test(declared)||Number(declared)>LIMIT))
     return false;
    if(!reply.body||typeof reply.body.getReader!=='function')
     return false;
    const reader=reply.body.getReader(),chunks=[];
    let bytes=0,oversize=false;
    try{
     for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))return false;
      bytes+=value.byteLength;
      if(bytes>LIMIT){oversize=true;break;}
      chunks.push(Buffer.from(value));
     }
    }finally{
     if(oversize){
      try{await reader.cancel();}catch{/* always reject overflow */}
     }
     reader.releaseLock();
    }
    if(oversize||!bytes)return false;
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true})
     .decode(Buffer.concat(chunks,bytes)));
    return body!==null&&typeof body==='object'&&!Array.isArray(body)&&
      body.object==='customer'&&body.id===customerId&&
      body.livemode===true&&body.deleted!==true&&
      body.metadata?.organization_id===organizationId;
   }catch{return false;}
  }
 });
}
