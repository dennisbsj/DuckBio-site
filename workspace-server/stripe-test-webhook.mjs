import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

// Verify the unmodified raw Stripe event payload before parsing. Test mode only.
export function createStripeTestWebhookVerifier({webhookSecret,clock=Date.now}={}){
 if(typeof webhookSecret!=='string'||!/^whsec_[A-Za-z0-9_]{12,}$/.test(webhookSecret))throw Error('A private Stripe test webhook secret is required');
 if(typeof clock!=='function')throw Error('Invalid verifier clock');
 return Object.freeze({
  verify({rawBody,signature}){
   if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>65536||
      typeof signature!=='string'||signature.length>2048)throw Error('Invalid Stripe webhook input');
   const entries=signature.split(',').map(part=>part.trim().split('='));
   const time=entries.find(([key,value])=>key==='t'&&/^[0-9]{1,12}$/.test(value||''))?.[1];
   const digests=entries.filter(([key,value])=>key==='v1'&&/^[0-9a-f]{64}$/.test(value||'')).map(([,value])=>Buffer.from(value,'hex'));
   if(!time||!digests.length)throw Error('Missing Stripe webhook signature');
   const seconds=Number(time),now=Math.floor(clock()/1000);
   if(!Number.isSafeInteger(seconds)||Math.abs(now-seconds)>300)throw Error('Expired Stripe webhook signature');
   const mac=createHmac('sha256',webhookSecret).update(time+'.').update(rawBody).digest();
   if(!digests.some(d=>timingSafeEqual(d,mac)))throw Error('Unverified Stripe webhook signature');
   let event;
   try{event=JSON.parse(rawBody.toString('utf8'));}catch{throw Error('Invalid Stripe webhook JSON');}
   if(!event||typeof event!=='object'||Array.isArray(event)||event.livemode!==false||
     typeof event.id!=='string'||!/^evt_[A-Za-z0-9_]{4,128}$/.test(event.id)||
     typeof event.type!=='string'||!/^[a-z_.]{3,120}$/.test(event.type)||
     !Number.isSafeInteger(event.created)||event.created<1||
     !event.data||typeof event.data.object?.id!=='string'||event.data.object.id.length>255)
     throw Error('Not a supported Stripe test event');
   return {id:event.id,type:event.type,objectId:event.data.object.id,created:event.created,
     digest:createHash('sha256').update(rawBody).digest('hex')};
  }
 });
}
