// Private Stripe test webhook ingress: signatures, not browser sessions, authenticate Stripe.
// This handler only records verified metadata; it never changes entitlements.
export function createStripeTestWebhookHandler({verifier,record,host}={}){
 if(typeof verifier?.verify!=='function'||typeof record!=='function'||
    typeof host!=='string'||!host||host.includes('/'))throw Error('Invalid test webhook handler configuration');
 const endpoint='/api/suite/billing/stripe-test-webhook',maxBody=65536;
 const send=(res,status,payload)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
   'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
 };
 return async function handleTestWebhook(req,res){
  if(req.method!=='POST'){send(res,405,{error:'method_not_allowed'});return;}
  if(String(req.headers.host||'').toLowerCase()!==host.toLowerCase()||
    req.headers.origin!==undefined){send(res,400,{error:'invalid_request'});return;}
  let url;
  try{url=new URL(req.url,'https://'+host);}catch{send(res,400,{error:'invalid_request'});return;}
  if(url.pathname!==endpoint||url.search||url.hash||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']||''))||
    typeof req.headers['stripe-signature']!=='string'){
   send(res,400,{error:'invalid_request'});return;
  }
  const length=req.headers['content-length'];
  if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>maxBody)){
   send(res,413,{error:'payload_too_large'});return;
  }
  const chunks=[];let size=0,oversized=false;
  try{
   for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBody){oversized=true;continue;}
    chunks.push(chunk);
   }
  }catch{send(res,400,{error:'invalid_request'});return;}
  if(oversized){send(res,413,{error:'payload_too_large'});return;}
  let verified;
  try{verified=verifier.verify({rawBody:Buffer.concat(chunks),signature:req.headers['stripe-signature']});}
  catch{send(res,400,{error:'invalid_signature'});return;}
  try{record(verified);}
  catch(error){
   send(res,error?.code==='stripe_event_conflict'?409:503,
    {error:error?.code==='stripe_event_conflict'?'event_conflict':'unavailable'});
   return;
  }
  // Acknowledgement means "stored", NOT paid, reconciled or licensed.
  send(res,200,{received:true,licensesGranted:false});
 };
}
