import {createHash} from 'node:crypto';

// Opt-in, PRIVATE DuckBio owner alerts. Resend idempotency is based solely
// on the persisted organization audit ID, so provider retries cannot multiply mail.
const email=value=>typeof value==='string'&&value.length<=254&&
 /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&!/[\r\n]/.test(value);
const sender=value=>typeof value==='string'&&value.length<=254&&
 !/[\r\n]/.test(value)&&/^(?:[^<>]+ <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value);
const messages={
 'organization.created':'New organization created',
 'subscription.entitlement.transition':'Verified subscription allocation changed',
 'member.added':'Organization member added',
 'member.updated':'Member roles or administration status changed',
 'member.removed':'Member removed from organization',
 'member.deactivated':'Organization member deactivated',
 'member.reactivated':'Organization member reactivated',
 'invitation.accepted':'Organization invitation accepted',
 'permission.updated':'App permission changed'
};
export function createResendOwnerAlertMailer({apiKey,from,to,origin,fetchImpl=globalThis.fetch}={}){
 if(typeof apiKey!=='string'||apiKey.length<16||/[\s\r\n]/.test(apiKey)||
    !sender(from)||!email(to)||typeof fetchImpl!=='function')
  throw Error('Private owner alert email configuration required');
 let base;
 try{base=new URL(origin);}catch{throw Error('HTTPS owner panel origin required');}
 if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||
    base.search||base.hash)throw Error('HTTPS owner panel origin required');
 return Object.freeze({
  async send(alert){
   if(!alert||!Number.isSafeInteger(alert.id)||alert.id<1||
      typeof alert.action!=='string'||!Object.hasOwn(messages,alert.action)||
      typeof alert.organizationName!=='string'||alert.organizationName.length>200||
      typeof alert.organizationId!=='string'||alert.organizationId.length>128||
      typeof alert.actorId!=='string'||alert.actorId.length>128||
      typeof alert.subject!=='string'||alert.subject.length>254||
      !Number.isSafeInteger(alert.at)||alert.at<1||
      alert.idempotencyKey!=='duckbio-owner-audit-'+alert.idempotencyKey?.replace(/^duckbio-owner-audit-/,'')||
      !/^duckbio-owner-audit-[0-9]+$/.test(alert.idempotencyKey))
    throw Error('Invalid private owner alert');
   const changes=Array.isArray(alert.changes)?alert.changes:[];
   if(changes.length>6||changes.some(x=>typeof x.appId!=='string'||
      !/^[a-z]+$/.test(x.appId)||!Number.isSafeInteger(x.delta)))
    throw Error('Invalid owner alert changes');
   const description=messages[alert.action];
   const text=[
    'An important change was recorded in DuckBio Workspace.','',
    'Change: '+description,
    'Organization: '+alert.organizationName+' ('+alert.organizationId+')',
    'When: '+new Date(alert.at).toISOString(),
    'Performed by account: '+alert.actorId,
    'Affected reference: '+alert.subject,
    ...(Number.isSafeInteger(alert.revision)?['Subscription revision: '+alert.revision]:[]),
    ...(changes.length?['Seat changes: '+changes.map(x=>x.appId+' '+(x.delta>0?'+':'')+x.delta).join(', ')]:[]),
    '',
    'Review changes securely in your private control panel:',
    new URL('/owner',base).href,
    '',
    'No passwords, invitation URLs or payment credentials are included.'
   ].join('\n');
   const body={from,to:[to],subject:'DuckBio alert: '+description,text};
   const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
    signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',
     'Idempotency-Key':alert.idempotencyKey},
    body:JSON.stringify(body)
   });
   if(!response?.ok)throw Error('Owner alert email provider unavailable');
   const result=await response.json();
   if(typeof result?.id!=='string'||!result.id.trim())
    throw Error('Invalid owner alert provider receipt');
   return {accepted:true};
  }
 });
}
export async function dispatchOwnerAlerts({store,mailer,limit=10}={}){
 if(!store||typeof store.claimOwnerAlert!=='function'||
    typeof store.finishOwnerAlert!=='function'||typeof mailer?.send!=='function'||
    !Number.isSafeInteger(limit)||limit<1||limit>30)
  throw Error('Invalid private alert dispatcher');
 const result={accepted:0,retried:0};
 for(let i=0;i<limit;i++){
  const item=store.claimOwnerAlert();
  if(!item)break;
  let success=false;
  try{await mailer.send(item);success=true;}
  catch{/* Retry with backoff; never log provider secrets or account details. */}
  store.finishOwnerAlert({id:item.id,leaseToken:item.leaseToken,success});
  if(success)result.accepted++;else result.retried++;
 }
 return result;
}
