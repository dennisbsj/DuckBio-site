import test from 'node:test';
import assert from 'node:assert/strict';
import {createResendInvitationMailer} from '../invitation-mailer.mjs';

const invitation={email:'scientist@example.test',name:'Scientist',organizationName:'Test Laboratory',invitationUrl:'https://workspace.example.test/workspace?invite=abc123',expiresAt:1790000000000};
test('transactional email uses the official API, no HTML injection and a hashed idempotency key',async()=>{
 const sent=[];
 const mailer=createResendInvitationMailer({
  apiKey:'re_testing_key_never_real',from:'DuckBio <invites@example.test>',
  fetchImpl:async(url,options)=>{sent.push({url,options});return new Response(JSON.stringify({id:'accepted'}),{status:200})}
 });
 assert.deepEqual(await mailer.sendInvitation(invitation),{accepted:true});
 assert.equal(sent.length,1);
 assert.equal(sent[0].url,'https://api.resend.com/emails');
 assert.equal(sent[0].options.redirect,'error');
 assert.match(sent[0].options.headers['Idempotency-Key'],/^workspace-invite-[a-f0-9]{64}$/);
 assert(!sent[0].options.headers['Idempotency-Key'].includes('abc123'));
 const payload=JSON.parse(sent[0].options.body);
 assert.deepEqual(payload.to,['scientist@example.test']);
 assert.equal(payload.from,'DuckBio <invites@example.test>');
 assert(payload.text.includes(invitation.invitationUrl));
 assert(!Object.hasOwn(payload,'html'));
});
test('outgoing email refuses insecure URLs, invalid config or provider rejection',async()=>{
 assert.throws(()=>createResendInvitationMailer({apiKey:'wrong',from:'sender@example.test'}));
 assert.throws(()=>createResendInvitationMailer({apiKey:'re_testing_key_never_real',from:'sender\nBcc: bad@example.test'}));
 const mailer=createResendInvitationMailer({apiKey:'re_testing_key_never_real',from:'sender@example.test',fetchImpl:async()=>new Response('denied',{status:403})});
 await assert.rejects(()=>mailer.sendInvitation({...invitation,invitationUrl:'http://workspace.example.test/workspace?invite=abc123'}),/HTTPS/);
 await assert.rejects(()=>mailer.sendInvitation(invitation),/did not accept/);
});
