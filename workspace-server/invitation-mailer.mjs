import {createHash} from 'node:crypto';

// Private, opt-in transactional email transport. Never log credentials or bearer URLs.
export function createResendInvitationMailer({apiKey,from,fetchImpl=globalThis.fetch}={}){
  if(typeof apiKey!=='string'||apiKey.length<16||/[\s\r\n]/.test(apiKey)||
    typeof from!=='string'||from.length>254||/[\r\n]/.test(from)||
    !/^(?:[^<>]+ <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(from)||
    typeof fetchImpl!=='function')throw new Error('A private API key and verified email sender are required');
  return Object.freeze({
    async sendInvitation({email,name,organizationName,invitationUrl,expiresAt}){
      if(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
        typeof name!=='string'||!name.trim()||typeof organizationName!=='string'||!organizationName.trim()||
        !Number.isFinite(expiresAt))throw new Error('Invalid invitation email details');
      const link=new URL(invitationUrl);
      if(link.protocol!=='https:'||!link.searchParams.has('invite')||link.username||link.password)throw new Error('An HTTPS invitation link is required');
      const body={from,to:[email],subject:'Your DuckBio Workspace invitation',text:[
        'Hello '+name+',','','You have been invited to '+organizationName+' in DuckBio Workspace.',
        'Activate your invitation using this one-time link:',invitationUrl,'',
        'Valid until '+new Date(expiresAt).toISOString()+'.',
        'If you did not expect this invitation, you can ignore this message.'
      ].join('\n')};
      const idem='workspace-invite-'+createHash('sha256').update(invitationUrl).digest('hex');
      const response=await fetchImpl('https://api.resend.com/emails',{
        method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
        signal:AbortSignal.timeout(10000),
        headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':idem},
        body:JSON.stringify(body)
      });
      if(!response.ok)throw new Error('Invitation provider did not accept the message');
      const result=await response.json();
      if(typeof result?.id!=='string'||!result.id.trim())throw new Error('Invalid provider confirmation');
      return {accepted:true};
    }
  });
}
