// Public DuckBio marketing contact ingress, opt-in ONLY. The caller must use
// Cloudflare Turnstile and an exact HTTPS Origin; no login credentials/cookies
// are accepted, and private messages never leave the server response.
const email=x=>typeof x==='string'&&x.length<=254&&
 /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)&&!/[\r\n]/.test(x);
const sender=x=>typeof x==='string'&&x.length<=254&&
 !/[\r\n]/.test(x)&&/^(?:[^<>]+ <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(x);
function json(res,status,body,origin=null){
 const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','Vary':'Origin'};
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 res.writeHead(status,headers);res.end(JSON.stringify(body));
}
export function createPublicContactHandler({
 communicationsStore,turnstileSecret,allowedOrigins,host,fetchImpl=globalThis.fetch
}={}){
 if(typeof communicationsStore?.acceptPublicContact!=='function'||
    typeof fetchImpl!=='function'||typeof turnstileSecret!=='string'||
    turnstileSecret.length<20||/[\s\r\n]/.test(turnstileSecret)||
    !Array.isArray(allowedOrigins)||!allowedOrigins.length||
    allowedOrigins.length>5||!allowedOrigins.every(x=>{
     try{const url=new URL(x);return url.origin===x&&url.protocol==='https:'&&
       !url.username&&!url.password;}catch{return false;}
    })||typeof host!=='string'||!host.trim())
   throw Error('Private public contact verification configuration required');
 const origins=new Set(allowedOrigins),hostnames=new Set(allowedOrigins.map(x=>new URL(x).hostname));
 return async (req,res)=>{
  const origin=req.headers.origin;
  if(typeof origin!=='string'||!origins.has(origin)||
     String(req.headers.host||'').toLowerCase()!==host.toLowerCase()){
   json(res,403,{error:'contact_unavailable'});return;
  }
  if(req.method==='OPTIONS'){
   res.writeHead(204,{'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin'});
   res.end();return;
  }
  if(req.method!=='POST'){json(res,405,{error:'method_not_allowed'},origin);return;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){
   json(res,415,{error:'invalid_input'},origin);return;
  }
  const chunks=[];let size=0;
  for await(const chunk of req){
   size+=chunk.length;
   if(size>8192){json(res,413,{error:'invalid_input'},origin);return;}
   chunks.push(chunk);
  }
  let data;
  try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{json(res,400,{error:'invalid_input'},origin);return;}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     typeof data.turnstileToken!=='string'||data.turnstileToken.length<10||
     data.turnstileToken.length>2048||data.honeypot){
   json(res,400,{error:'invalid_input'},origin);return;
  }
  let verified=false;
  try{
   const response=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({secret:turnstileSecret,response:data.turnstileToken}).toString()
   });
   if(response?.ok){
    const answer=await response.json();
    verified=answer?.success===true&&answer?.action==='contact'&&
      hostnames.has(answer.hostname);
   }
  }catch{/* Fail closed. */}
  if(!verified){json(res,403,{error:'contact_verification_failed'},origin);return;}
  try{
   const result=communicationsStore.acceptPublicContact({
    submissionId:data.submissionId,name:data.name,email:data.email,
    organization:data.organisation||'',subject:data.subject,message:data.message
   });
   json(res,202,{accepted:result.accepted,internalDelivered:result.internalDelivered,
    externalStatus:'queued'},origin);
  }catch(error){
   json(res,error.message==='contact_rate_limited'?429:
     error.message==='contact_submission_conflict'?409:400,{error:'contact_unavailable'},origin);
  }
 };
}
export function createResendContactMailer({apiKey,from,to,fetchImpl=globalThis.fetch}={}){
 if(typeof apiKey!=='string'||apiKey.length<16||/[\s\r\n]/.test(apiKey)||
    !sender(from)||!email(to)||typeof fetchImpl!=='function')
  throw Error('Private contact outgoing mail configuration required');
 return Object.freeze({
  async send(item){
   if(typeof item?.idempotencyKey!=='string'||
      !/^duckbio-contact-[A-Za-z0-9_.:-]{1,128}$/.test(item.idempotencyKey)||
      !email(item.email)||typeof item.subject!=='string'||
      typeof item.message!=='string')throw Error('Invalid queued contact mail');
   const body={from,to:[to],reply_to:item.email,
    subject:'DuckBio website: '+item.subject,
    text:['New DuckBio website contact','',
      'From: '+item.name+' <'+item.email+'>',
      'Organization: '+(item.organization||'Not specified'),
      'Subject: '+item.subject,'',item.message].join('\n')};
   const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',
      'Idempotency-Key':item.idempotencyKey},
    body:JSON.stringify(body)
   });
   if(!response?.ok||typeof (await response.json())?.id!=='string')
    throw Error('Contact mail provider unavailable');
   return {accepted:true};
  }
 });
}
export async function dispatchContactMail({communicationsStore,mailer,limit=5}={}){
 if(typeof communicationsStore?.claimPublicContactDelivery!=='function'||
    typeof communicationsStore?.finishPublicContactDelivery!=='function'||
    typeof mailer?.send!=='function'||!Number.isSafeInteger(limit)||limit<1||limit>20)
  throw Error('Invalid contact outbox dispatcher');
 const result={accepted:0,retry:0};
 for(let n=0;n<limit;n++){
  const job=communicationsStore.claimPublicContactDelivery();
  if(!job)break;
  let accepted=false;
  try{await mailer.send(job);accepted=true;}catch{/* Retry privately. */}
  communicationsStore.finishPublicContactDelivery({
   submissionId:job.submissionId,leaseToken:job.leaseToken,accepted});
  if(accepted)result.accepted++;else result.retry++;
 }
 return result;
}
