import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createOrganizationStore} from '../organization-store.mjs';
import {createCommunicationsStore} from '../communications-store.mjs';
import {createAccountService} from '../shared-auth/account-service.mjs';

async function fixture(t, {multi=false, invitationMailer=null, stripeTestCheckout=null, stripeTestReconciler=null,communications=false}={}) {
 const temp=mkdtempSync(path.join(os.tmpdir(),'duckbio-workspace-browser-'));
 const identity=createIdentityStore({databasePath:path.join(temp,'identity.sqlite')});
 const auth=createSqliteAuthStores({databasePath:path.join(temp,'auth.sqlite')});
 const org=createOrganizationStore({databasePath:path.join(temp,'organizations.sqlite')});
 const token=randomBytes(32).toString('base64url');
 identity.configureBootstrapToken(token);
 const owner=await identity.bootstrap(token,{email:'owner@example.test',displayName:'Lab owner',password:'Example passphrase 123456'});
 const worker=await identity.createUser({email:'worker@example.test',displayName:'Lab worker',password:'Worker passphrase 123456'});
 org.setupOrganization({organizationId:'lab-a',name:'Synthetic laboratory',owner:{accountId:owner.id,name:'Lab owner',nickname:'Owner',email:'owner@example.test'}});
 if(multi)org.setupOrganization({organizationId:'lab-b',name:'Second laboratory',owner:{accountId:owner.id,name:'Lab owner',nickname:'Owner',email:'owner@example.test'}});
 org.applyVerifiedSeatPurchase({reference:'test-purchase-1',organizationId:'lab-a',plan:'Mixed',apps:['eel','goflo'],seats:2});
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:{accountId:worker.id,name:'Lab worker',nickname:'Worker',email:'worker@example.test',admin:false,roles:{eel:'scientist'}}});
 const communicationsStore=communications?createCommunicationsStore({databasePath:path.join(temp,'private','communications.sqlite'),ownerAccountId:owner.id}):null;
 const registrations=['goflo','eel','methpipe','mantrain','duckman','limsman'].map(id=>({id,appId:id,secret:randomBytes(32).toString('base64url'),redirectUris:['https://example.invalid/'+id+'/auth/callback'],nativeOrigin:'https://example.invalid'}));
 let service;
 const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 const errors=[];
 // Register cleanup before service/browser creation, including constructor failures.
 t.after(async()=>{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));identity.close();auth.close();org.close();communicationsStore?.close();rmSync(temp,{recursive:true,force:true});assert.deepEqual(errors,[],'uncaught browser errors');});
 const assetRoot=fileURLToPath(new URL('../private-ui/',import.meta.url));
 service=createAccountService({invitationMailer,stripeTestCheckout,stripeTestReconciler,origin,issuer:'https://login.example.invalid',clients:registrations,identityStore:identity,organizationStore:org,communicationsStore,ownerAccountId:communications?owner.id:null,authStore:auth.brokerStore,assetRoot,getClientAddress:req=>req.socket.remoteAddress});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(origin+'/workspace');
 await page.locator('#sign-in:not([hidden])').waitFor();
 return {page,origin,org,identity,owner,worker,communicationsStore,context};
}
async function signIn(page,email='owner@example.test',password='Example passphrase 123456') {
 await page.locator('#email').fill(email);
 await page.locator('#password').fill(password);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('#portal:not([hidden])').waitFor();
}

test('real Chromium Workspace login shows per-app seats and enforces edits without payment',{timeout:45000},async t=>{
 const f=await fixture(t),page=f.page;
 await signIn(page);
 assert.match(await page.locator('#organization-name').textContent(),/Synthetic laboratory/);
 const seat=page.locator('#seats .seat-card').filter({hasText:'DuckNote'});
 assert.match(await seat.textContent(),/1 \/ 2/);
 const workerRow=page.locator('#members tr').filter({hasText:'worker@example.test'});
 await workerRow.getByRole('button',{name:'Edit permissions'}).click();
 await page.locator('#role-fields select[name=eel]').selectOption('reviewer');
 await page.locator('#member-form button[type=submit]').click();
 await page.locator('#edit-panel[hidden]').waitFor({state:'attached'});
 await page.locator('#members').getByText('DuckNote (reviewer)').waitFor();
 assert.equal(f.org.accessFor({organizationId:'lab-a',accountId:f.worker.id,appId:'eel'}).role,'reviewer');
 await page.getByRole('button',{name:'Buy users'}).click();
 await page.locator('#draft-seats').fill('3');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Review selection'}).click();
 assert.match(await page.locator('#buy-summary').textContent(),/not a purchase/i);
 const after=f.org.overview('lab-a',f.owner.id).apps.find(a=>a.id==='eel');
 assert.equal(after.purchased,2,'browser quote does not mint licences');
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.locator('#sign-in:not([hidden])').waitFor();
 assert.equal(f.org.accessFor({organizationId:'lab-a',accountId:f.worker.id,appId:'eel'}).role,'reviewer');
});

test('responsive Workspace still refuses to create unverified central accounts',{timeout:45000},async t=>{
 const {page,context}=await fixture(t);
 await page.setViewportSize({width:390,height:720});
 await signIn(page);
 const sizes=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
 assert.ok(sizes.width<=sizes.viewport+2,'mobile viewport has no horizontal overflow: '+JSON.stringify(sizes));
 await page.getByRole('button',{name:'Add existing account'}).click();
 await page.locator('#account-id').fill('unverified-person');
 await page.locator('#name').fill('Unknown');
 await page.locator('#nickname').fill('No link');
 await page.locator('#member-email').fill('unknown@example.test');
 await page.locator('#role-fields select[name=eel]').selectOption('scientist');
 await page.locator('#member-form button[type=submit]').click();
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('Check the account, email and app roles.'),null,{timeout:10000});
});

test('two organizations require explicit login-time selection and a fresh login to change',{timeout:45000},async t=>{
 const {page}=await fixture(t,{multi:true});
 await page.locator('#email').fill('owner@example.test');
 await page.locator('#password').fill('Example passphrase 123456');
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('#organization-choice:not([hidden])').waitFor();
 assert.equal(await page.locator('#portal').isVisible(),false);
 await page.getByRole('button',{name:/Synthetic laboratory/}).click();
 await page.locator('#portal:not([hidden])').waitFor();
 assert.equal(await page.locator('#organizations').isDisabled(),true);
 assert.equal(await page.locator('#organization-name').textContent(),'Synthetic laboratory');
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.locator('#sign-in:not([hidden])').waitFor();
 await page.locator('#email').fill('owner@example.test');
 await page.locator('#password').fill('Example passphrase 123456');
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('#organization-choice:not([hidden])').waitFor();
 await page.getByRole('button',{name:/Second laboratory/}).click();
 await page.locator('#portal:not([hidden])').waitFor();
 assert.equal(await page.locator('#organization-name').textContent(),'Second laboratory');
});

test('admin can search and filter a real permission matrix, then persist and revoke a checkbox',{timeout:45000},async t=>{
 const {page,org,worker}=await fixture(t);
 await signIn(page);
 await page.getByRole('button',{name:'Permission matrix'}).click();
 await page.locator('#tab-matrix:not([hidden])').waitFor();
 await page.locator('#matrix-app').selectOption('eel');
 await page.locator('#matrix-search').fill('worker@example.test');
 const toggle=page.getByRole('checkbox',{name:'Lab worker DuckNote document.review'});
 await toggle.waitFor();
 assert.equal(await toggle.isChecked(),false);
 await toggle.check();
 await page.waitForFunction(()=>document.getElementById('matrix-info')?.textContent.includes('Saved document.review (enabled)'));
 assert(org.effectivePermissions({organizationId:'lab-a',accountId:worker.id,appId:'eel'}).includes('document.review'));
 await page.getByRole('checkbox',{name:'Lab worker DuckNote document.review'}).uncheck();
 await page.waitForFunction(()=>document.getElementById('matrix-info')?.textContent.includes('Saved document.review (disabled)'));
 assert(!org.effectivePermissions({organizationId:'lab-a',accountId:worker.id,appId:'eel'}).includes('document.review'));
 await page.locator('#matrix-search').fill('no-such-user');
 assert.equal(await page.locator('#matrix-body tr').count(),0);
 await page.locator('#matrix-search').fill('');
 await page.locator('#matrix-sort').selectOption('app');
 assert(await page.locator('#matrix-body tr').count()>=2);
});

test('admin creates a one-use org invitation and recipient activates new account',{timeout:45000},async t=>{
 const {page,org,identity,owner}=await fixture(t);
 await signIn(page);
 await page.getByRole('button',{name:'Invite user'}).click();
 await page.locator('#invite-name').fill('New scientist');
 await page.locator('#invite-nickname').fill('New');
 await page.locator('#invite-email').fill('new@example.test');
 await page.getByRole('button',{name:'Create invitation'}).click();
 await page.locator('#invite-result:not([hidden])').waitFor();
 const link=await page.locator('#invitation-link').inputValue();
 assert.match(link,/invite=/);
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.goto(link);
 await page.locator('#invite-accept-panel:not([hidden])').waitFor();
 assert.equal(await page.locator('#invite-email-display').inputValue(),'new@example.test');
 await page.locator('#invite-password').fill('Long new password 123456');
 await page.getByRole('button',{name:'Activate invitation'}).click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('invitation accepted'));
 const created=identity.findUserByEmail('new@example.test');
 assert.equal(created.state,'active');
 assert.equal(org.organizationsFor(created.id).length,1);
 assert.equal(org.overview('lab-a',owner.id).users.some(u=>u.accountId===created.id),true);
 assert.equal(org.overview('lab-a',owner.id).users.find(u=>u.accountId===created.id).roles.eel,undefined);
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.goto(link);
 await page.locator('#sign-in:not([hidden])').waitFor();
});

test('pending invitation is listed and can be revoked in the real browser',{timeout:45000},async t=>{
 const {page,org,owner,identity}=await fixture(t);
 await signIn(page);
 await page.getByRole('button',{name:'Invite user'}).click();
 await page.locator('#invite-name').fill('Temporary researcher');
 await page.locator('#invite-nickname').fill('Temp');
 await page.locator('#invite-email').fill('temp@example.test');
 await page.getByRole('button',{name:'Create invitation'}).click();
 await page.locator('#invite-result:not([hidden])').waitFor();
 const link=await page.locator('#invitation-link').inputValue();
 const row=page.locator('#pending-invitations tr').filter({hasText:'temp@example.test'});
 await row.waitFor();
 page.once('dialog',dialog=>dialog.accept());
 await row.getByRole('button',{name:'Revoke invitation'}).click();
 await page.waitForFunction(()=>!document.querySelector('#pending-invitations')?.textContent.includes('temp@example.test'));
 assert.equal(org.listPendingInvitations('lab-a',owner.id).length,0);
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.goto(link);
 await page.locator('#sign-in:not([hidden])').waitFor();
 assert.equal(identity.findUserByEmail('temp@example.test'),null);
});
test('admin selects a DuckNote app role while inviting and it is assigned only after activation',{timeout:45000},async t=>{
 const {page,org,owner,identity}=await fixture(t);
 await signIn(page);
 await page.getByRole('button',{name:'Invite user'}).click();
 await page.locator('#invite-name').fill('Role scientist');
 await page.locator('#invite-nickname').fill('Role');
 await page.locator('#invite-email').fill('role@example.test');
 await page.locator('#invite-role-fields select[name=eel]').selectOption('scientist');
 await page.getByRole('button',{name:'Create invitation'}).click();
 await page.locator('#invite-result:not([hidden])').waitFor();
 const link=await page.locator('#invitation-link').inputValue();
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').reserved,1);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').assigned,1);
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.goto(link);
 await page.locator('#invite-password').fill('Another strong password 12345');
 await page.getByRole('button',{name:'Activate invitation'}).click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('invitation accepted'));
 const created=identity.findUserByEmail('role@example.test');
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:created.id,appId:'eel'}).role,'scientist');
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').reserved,0);
});
test('audit history is visible to admins after invitation changes in the real browser',{timeout:45000},async t=>{
 const {page,org,owner}=await fixture(t);
 await signIn(page);
 await page.getByRole('button',{name:'Invite user'}).click();
 await page.locator('#invite-name').fill('Audit researcher');
 await page.locator('#invite-nickname').fill('Audit');
 await page.locator('#invite-email').fill('audit@example.test');
 await page.getByRole('button',{name:'Create invitation'}).click();
 await page.locator('#invite-result:not([hidden])').waitFor();
 await page.locator('#audit-events').getByText('Invitation Issued').waitFor();
 assert(org.auditLog('lab-a',owner.id).some(event=>event.action==='invitation.issued'));
});
test('removing a member from admin roster revokes their org access without deleting central identity',{timeout:45000},async t=>{
 const {page,org,identity,worker,owner}=await fixture(t);
 await signIn(page);
 page.once('dialog',dialog=>dialog.accept());
 const row=page.locator('#members tr').filter({hasText:'worker@example.test'});
 await row.getByRole('button',{name:'Remove'}).click();
 await page.waitForFunction(()=>!document.querySelector('#members')?.textContent.includes('worker@example.test'));
 assert.equal(org.overview('lab-a',owner.id).users.some(u=>u.accountId===worker.id),false);
 assert.equal(identity.getUser(worker.id).email,'worker@example.test');
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:worker.id,appId:'eel'}),null);
});

test('admin deactivates and reactivates one member from the roster',{timeout:45000},async t=>{
 const {page,org,owner,worker}=await fixture(t);
 await signIn(page);
 const row=page.locator('#members tr').filter({hasText:'worker@example.test'});
 assert.match(await row.textContent(),/Active/);
 page.once('dialog',dialog=>dialog.accept());
 await row.getByRole('button',{name:'Deactivate'}).click();
 await page.waitForFunction(()=>document.querySelector('#members')?.textContent.includes('Deactivated'));
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:worker.id,appId:'eel'}),null);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').assigned,1);
 await page.locator('#audit-events').getByText('Member Deactivated').waitFor();
 const suspended=page.locator('#members tr').filter({hasText:'worker@example.test'});
 page.once('dialog',dialog=>dialog.accept());
 await suspended.getByRole('button',{name:'Reactivate'}).click();
 await page.waitForFunction(()=>document.querySelector('#members')?.textContent.includes('Reactivate')===false);
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:worker.id,appId:'eel'}).role,'scientist');
 await page.locator('#audit-events').getByText('Member Reactivated').waitFor();
});

test('end-to-end administrator lifecycle: two organizations, invitations, rights, suspension and audit',{timeout:90000},async t=>{
 const {page,org,identity,owner}=await fixture(t,{multi:true});
 const email='journey@example.test',password='Journey secret passphrase 123456';
 async function login(emailAddress,passwordText,organization){
  await page.locator('#sign-in:not([hidden])').waitFor();
  await page.locator('#email').fill(emailAddress);
  await page.locator('#password').fill(passwordText);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.locator('#organization-choice:not([hidden])').waitFor();
  await page.getByRole('button',{name:new RegExp(organization)}).click();
 }
 async function signOut(){
  await page.getByRole('button',{name:'Sign out'}).click();
  await page.locator('#sign-in:not([hidden])').waitFor();
 }
 async function invite(name,role){
  await page.getByRole('button',{name:'Invite user'}).click();
  await page.locator('#invite-name').fill(name);
  await page.locator('#invite-nickname').fill('Journey');
  await page.locator('#invite-email').fill(email);
  if(role)await page.locator('#invite-role-fields select[name=eel]').selectOption(role);
  await page.getByRole('button',{name:'Create invitation'}).click();
  await page.locator('#invite-result:not([hidden])').waitFor();
  const link=await page.locator('#invitation-link').inputValue();
  assert.match(link,/invite=/);
  return link;
 }
 // Organization A: pre-allocate the last DuckNote seat while inviting.
 await login('owner@example.test','Example passphrase 123456','Synthetic laboratory');
 await page.locator('#portal:not([hidden])').waitFor();
 const invitationA=await invite('Journey member','reviewer');
 let seats=org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel');
 assert.equal(seats.assigned,1);
 assert.equal(seats.reserved,1);
 assert.equal(seats.purchased,2);
 await signOut();
 // Organization B: independently invite the SAME email, without app grants.
 await login('owner@example.test','Example passphrase 123456','Second laboratory');
 await page.locator('#portal:not([hidden])').waitFor();
 const invitationB=await invite('Journey member',null);
 assert.equal(org.listPendingInvitations('lab-b',owner.id).length,1);
 await signOut();
 // New identity is created from A's single-use invitation; no central app grants.
 await page.goto(invitationA);
 await page.locator('#invite-accept-panel:not([hidden])').waitFor();
 await page.locator('#invite-password').fill(password);
 await page.getByRole('button',{name:'Activate invitation'}).click();
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('invitation accepted'));
 const user=identity.findUserByEmail(email);
 assert.equal(user.state,'active');
 assert.deepEqual(org.organizationsFor(user.id).map(x=>x.id),['lab-a']);
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:user.id,appId:'eel'}).role,'reviewer');
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').reserved,0);
 await signOut();
 // Same verified identity joins B via existing-account sign-in, without being
 // matched to another user's native app account by email.
 await page.goto(invitationB);
 await page.locator('#invite-accept-panel:not([hidden])').waitFor();
 await page.getByRole('button',{name:'I already have a DuckBio account'}).click();
 await page.locator('#email').fill(email);
 await page.locator('#password').fill(password);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('#organization-choice:not([hidden])').waitFor();
 assert.deepEqual(org.organizationsFor(user.id).map(x=>x.id),['lab-b','lab-a']);
 await page.getByRole('button',{name:/Second laboratory/}).click();
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('do not have organization administrator rights'));
 assert.equal(await page.locator('#portal').isVisible(),false);
 const attempts=await page.evaluate(async()=>{
  const session=await (await fetch('/api/suite/auth/session')).json();
  const invoke=async(route,data)=> (await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(data)})).status;
  return {
   otherOrganization:await invoke('/api/suite/organization/select',{organizationId:'lab-a'}),
   unauthorizedAdmin:await invoke('/api/suite/organization/overview',{organizationId:'lab-b'})
  };
 });
 assert.deepEqual(attempts,{otherOrganization:409,unauthorizedAdmin:403},'session is locked and nonadmins cannot administer');
 await signOut();
 // A new login allows the user to choose A; the account is still not an admin.
 await login(email,password,'Synthetic laboratory');
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('do not have organization administrator rights'));
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:user.id,appId:'eel'}).role,'reviewer');
 await signOut();
 // Org A admin changes role (same paid seat), then suspends the member.
 await login('owner@example.test','Example passphrase 123456','Synthetic laboratory');
 await page.locator('#portal:not([hidden])').waitFor();
 const memberRow=()=>page.locator('#members tr').filter({hasText:email});
 await memberRow().getByRole('button',{name:'Edit permissions'}).click();
 await page.locator('#role-fields select[name=eel]').selectOption('scientist');
 await page.locator('#member-form button[type=submit]').click();
 await memberRow().getByText('DuckNote (scientist)').waitFor();
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:user.id,appId:'eel'}).role,'scientist');
 page.once('dialog',dialog=>dialog.accept());
 await memberRow().getByRole('button',{name:'Deactivate'}).click();
 await page.waitForFunction(emailAddress=>[...document.querySelectorAll('#members tr')].some(row=>row.textContent.includes(emailAddress)&&row.textContent.includes('Deactivated')),email);
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:user.id,appId:'eel'}),null);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').assigned,2,'suspended account still reserves its paid seat');
 assert.equal(org.organizationsFor(user.id).length,1,'second organization membership remains');
 await signOut();
 // Suspended member can sign in but may only select B.
 await page.locator('#email').fill(email);
 await page.locator('#password').fill(password);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('do not have organization administrator rights'));
 const visible=await page.evaluate(async()=> (await (await fetch('/api/suite/organizations')).json()).organizations.map(x=>x.id));
 assert.deepEqual(visible,['lab-b']);
 await signOut();
 // Reactivation restores only A's prior role, and a fresh login gives the
 // same user both organization choices.
 await login('owner@example.test','Example passphrase 123456','Synthetic laboratory');
 await page.locator('#portal:not([hidden])').waitFor();
 page.once('dialog',dialog=>dialog.accept());
 await memberRow().getByRole('button',{name:'Reactivate'}).click();
 await page.waitForFunction(emailAddress=>[...document.querySelectorAll('#members tr')].some(row=>row.textContent.includes(emailAddress)&&row.textContent.includes('Active')&&!row.textContent.includes('Deactivated')),email);
 assert.equal(org.accessFor({organizationId:'lab-a',accountId:user.id,appId:'eel'}).role,'scientist');
 const events=org.auditLog('lab-a',owner.id);
 for(const action of ['invitation.issued','invitation.accepted','member.updated','member.deactivated','member.reactivated'])
  assert(events.some(e=>e.action===action),action+' recorded in tenant audit');
 assert(!JSON.stringify(events).includes(new URL(invitationA).searchParams.get('invite')),'audit does not expose invite tokens');
 await signOut();
 await page.locator('#email').fill(email);
 await page.locator('#password').fill(password);
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.locator('#organization-choice:not([hidden])').waitFor();
 assert.equal(await page.locator('#organization-options button').count(),2);
 assert.deepEqual(org.organizationsFor(user.id).map(x=>x.id),['lab-b','lab-a']);
});

test('configured mail delivery creates a pending invitation without displaying a token in Chromium',{timeout:45000},async t=>{
 const mail=[];
 const {page,org,owner}=await fixture(t,{invitationMailer:{async sendInvitation(v){mail.push(v);return {accepted:true}}}});
 await signIn(page);
 await page.getByRole('button',{name:'Invite user'}).click();
 await page.locator('#invite-name').fill('Email scientist');
 await page.locator('#invite-nickname').fill('Email');
 await page.locator('#invite-email').fill('mail@example.test');
 await page.getByRole('button',{name:'Create invitation'}).click();
 await page.waitForFunction(()=>document.getElementById('status')?.textContent.includes('accepted by the mail provider'));
 assert.equal(await page.locator('#invite-result').isVisible(),false);
 assert.equal(await page.locator('#invitation-link').inputValue(),'');
 assert.equal(mail.length,1);
 assert.equal(mail[0].email,'mail@example.test');
 assert.equal(org.listPendingInvitations('lab-a',owner.id).length,1);
});
test('admin prepares Stripe test Checkout from a saved draft with zero entitlement changes',{timeout:45000},async t=>{
 const fake={priceFor:()=> 'price_test123456',async createSession(){return {id:'cs_test_browser123',url:'https://checkout.stripe.com/c/pay/browser'}}};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:fake});
 await signIn(page);
 const before=org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased;
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Single');
 await page.locator('#draft-seats').fill('2');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.locator('#subscription-drafts').getByText('Single · 2 users per app').waitFor();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Open Stripe test checkout'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Check Stripe TEST status'}).count(),0,'no billing check without private opt-in');
 assert.equal(org.listSubscriptionDrafts('lab-a',owner.id)[0].checkoutState,'ready');
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,before);
});
test('admin saves and cancels subscription drafts without minting paid seats',{timeout:45000},async t=>{
 const {page,org,owner}=await fixture(t);
 await signIn(page);
 const before=org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased;
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Mixed');
 await page.locator('#draft-seats').fill('4');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.locator('#buy-fields input[name=goflo]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.locator('#subscription-drafts').getByText('Mixed · 4 users per app').waitFor();
 assert.equal(org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased,before);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Cancel draft'}).click();
 await page.locator('#subscription-drafts').getByText(/canceled/).waitFor();
 assert.equal(org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased,before);
});

test('admin checks and reloads Stripe TEST billing observation without licensing changes',{timeout:45000},async t=>{
 const checkout={priceFor:()=> 'price_test123456',async createSession(){
  return {id:'cs_test_browser123',url:'https://checkout.stripe.com/c/pay/browser'};
 }};
 const observations=[];
 const checker={async inspect(snapshot){
  observations.push(snapshot);
  return {state:'pending',reason:'payment_unpaid',licensesGranted:false};
 }};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:checkout,stripeTestReconciler:checker});
 await signIn(page);
 const before=org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased;
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Single');
 await page.locator('#draft-seats').fill('2');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).waitFor();
 await page.locator('#subscription-drafts').getByText('Stripe TEST status: not checked', {exact:false}).waitFor();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 await page.locator('#subscription-drafts').getByText('Stripe TEST status: Payment not verified', {exact:false}).waitFor();
 assert.equal(observations.length,1);
 assert.equal(observations[0].checkout.sessionId,'cs_test_browser123');
 const saved=org.listSubscriptionDrafts('lab-a',owner.id)[0];
 assert.equal(saved.testReconciliation.state,'pending');
 assert.equal(saved.testReconciliation.reason,'payment_unpaid');
 assert.equal(saved.testReconciliation.attempt,1);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,before);
 await page.reload();
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.locator('#subscription-drafts').getByText('Stripe TEST status: Payment not verified', {exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Check Stripe TEST status'}).count(),1);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,before);
});

test('admin sees renewal and cancellation lifecycle as TEST observations only',{timeout:45000},async t=>{
 const checkout={priceFor:()=> 'price_test123456',async createSession(){
  return {id:'cs_test_browser123',url:'https://checkout.stripe.com/c/pay/browser'};
 }};
 let state='renewal';
 const checker={async inspect(snapshot){
  const lifecycle={subscriptionStatus:state==='renewal'?'active':'canceled',
   cancelAtPeriodEnd:state==='renewal',cancelAt:state==='renewal'?1790000000:null,
   periodEnd:1790000000,invoiceStatus:'paid',billingReason:'subscription_cycle'};
  if(state==='renewal')return {state:'paid_test_verified',sessionId:snapshot.checkout.sessionId,
   subscriptionId:'sub_test_browser123',invoiceId:'in_test_browser123',
   organizationId:snapshot.draft.organizationId,draftId:snapshot.draft.id,
   price:snapshot.checkout.price,seats:snapshot.draft.seats,licensesGranted:false,lifecycle};
  return {state:'pending',reason:'subscription_not_active',licensesGranted:false,lifecycle};
 }};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:checkout,stripeTestReconciler:checker});
 await signIn(page);
 const original=org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased;
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Single');
 await page.locator('#draft-seats').fill('2');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 await page.locator('#subscription-drafts').getByText(/Paid TEST invoice observed.*Renewal invoice.*Cancellation scheduled for period end/).waitFor();
 assert.equal(org.listSubscriptionDrafts('lab-a',owner.id)[0].testReconciliation.lifecycle.billingReason,'subscription_cycle');
 state='canceled';
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 await page.locator('#subscription-drafts').getByText(/Payment not verified.*Subscription: Canceled/).waitFor();
 assert.equal(org.listSubscriptionDrafts('lab-a',owner.id)[0].testReconciliation.state,'pending');
 await page.getByRole('button',{name:'View TEST history'}).click();
 const entries=page.locator('#subscription-drafts .test-billing-history li');
 await entries.first().waitFor();
 assert.equal(await entries.count(),2);
 assert.match(await entries.first().textContent(),/#2.*pending.*canceled/);
 assert.match(await entries.nth(1).textContent(),/#1.*paid_test_verified.*active/);
 assert(!String(await page.locator('#subscription-drafts').textContent()).includes('sub_test_browser123'),
  'provider IDs must remain private');
 await page.getByRole('button',{name:'Hide TEST history'}).click();
 assert.equal(await page.locator('#subscription-drafts .test-billing-history').isVisible(),false);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,original);
});

test('admin sees isolated TEST candidate seat counts, then cancellation review, without activation',{timeout:45000},async t=>{
 const checkout={priceFor:()=> 'price_test123456',async createSession(){
  return {id:'cs_test_simulation123',url:'https://checkout.stripe.com/c/pay/browser'};
 }};
 let state='paid';
 const checker={async inspect(snapshot){
  const lifecycle={subscriptionStatus:state==='paid'?'active':'canceled',
   cancelAtPeriodEnd:state==='paid',cancelAt:state==='paid'?1900000000:null,
   periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_cycle'};
  if(state==='paid')return {state:'paid_test_verified',sessionId:snapshot.checkout.sessionId,
   subscriptionId:'sub_test_simulation123',invoiceId:'in_test_simulation123',
   organizationId:snapshot.draft.organizationId,draftId:snapshot.draft.id,
   price:snapshot.checkout.price,seats:snapshot.draft.seats,licensesGranted:false,lifecycle};
  return {state:'pending',reason:'subscription_not_active',licensesGranted:false,lifecycle};
 }};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:checkout,stripeTestReconciler:checker});
 await signIn(page);
 const original=org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased;
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Mixed');
 await page.locator('#draft-seats').fill('3');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.locator('#buy-fields input[name=goflo]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 const summary=page.locator('#test-seat-projection');
 await summary.getByText(/DuckNote: 3 TEST candidate seats/).waitFor();
 assert.match(await summary.textContent(),/CytoDuck: 3 TEST candidate seats/);
 const preview=summary.locator('.test-entitlement-preview');
 await preview.getByText(/DuckNote: Possible increase, not activated/).waitFor();
 assert.match(await preview.textContent(),/CytoDuck: Possible increase, not activated/);
 assert.match(await preview.textContent(),/3 TEST candidates/);
 assert.match(await summary.textContent(),/not purchased or activated/);
 assert.equal(org.testSeatCapacity('lab-a',owner.id).apps.find(x=>x.appId==='eel').candidateTestSeats,3);
 assert.equal(org.testSeatImpact('lab-a',owner.id).apps.find(x=>x.appId==='eel').status,'test_only_candidate');
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,original);
 state='canceled';
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 await page.locator('#subscription-drafts').getByText('TEST seat simulation: Cancellation requires review',{exact:false}).waitFor();
 await summary.getByText(/no eligible candidate seats/).waitFor();
 await summary.getByText(/DuckNote: billing status requires manual review/).waitFor();
 await summary.getByText(/CytoDuck: billing status requires manual review/).waitFor();
 await summary.locator('.test-entitlement-preview').getByText(/DuckNote: Billing status requires manual review/).waitFor();
 assert.equal(org.testSubscriptionEntitlementPlan('lab-a',owner.id).apps.find(x=>x.appId==='eel').status,'manual_review');
 assert.equal(org.testSeatImpact('lab-a',owner.id).apps.find(x=>x.appId==='eel').status,'manual_review');
 assert.equal(org.testSeatCapacity('lab-a',owner.id).apps.find(x=>x.appId==='eel').candidateTestSeats,0);
 assert.equal(org.overview('lab-a',owner.id).apps.find(x=>x.id==='eel').purchased,original);
});

test('in-progress Stripe TEST recheck removes stale seat previews and warns admin in Chromium',{timeout:45000},async t=>{
 const checkout={priceFor:()=> 'price_test123456',async createSession(){
  return {id:'cs_test_freshbrowser123',url:'https://checkout.stripe.com/c/pay/browser'};
 }};
 const checker={async inspect(snapshot){
  return {state:'paid_test_verified',sessionId:snapshot.checkout.sessionId,
   subscriptionId:'sub_test_freshbrowser123',invoiceId:'in_test_freshbrowser123',
   organizationId:snapshot.draft.organizationId,draftId:snapshot.draft.id,
   price:snapshot.checkout.price,seats:snapshot.draft.seats,licensesGranted:false,
   lifecycle:{subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
    periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_create'}};
 }};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:checkout,stripeTestReconciler:checker});
 const purchasedBefore=org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased;
 await signIn(page);
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Single');
 await page.locator('#draft-seats').fill('2');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 const summary=page.locator('#test-seat-projection');
 await summary.getByText(/DuckNote: 2 TEST candidate seats/).waitFor();
 const draft=org.listSubscriptionDrafts('lab-a',owner.id)[0];
 org.beginTestReconciliation({organizationId:'lab-a',actorId:owner.id,draftId:draft.id});
 await page.reload();
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await summary.getByText(/no eligible candidate seats/).waitFor();
 await summary.locator('.test-entitlement-readiness').getByText(/DuckNote: 0 unverified Checkout\(s\).*1 billing status/).waitFor();
 await summary.locator('.test-entitlement-preview').getByText(/DuckNote: Billing status requires manual review/).waitFor();
 assert.equal(org.testSeatCapacity('lab-a',owner.id).apps.find(a=>a.appId==='eel').candidateTestSeats,0);
 assert.equal(org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased,purchasedBefore);
});

test('another unverified TEST Checkout blocks positive per-app plan preview',{timeout:45000},async t=>{
 const checkout={priceFor:()=> 'price_test123456',async createSession(){
  return {id:'cs_test_partialbrowser123',url:'https://checkout.stripe.com/c/pay/browser'};
 }};
 const checker={async inspect(snapshot){
  return {state:'paid_test_verified',sessionId:snapshot.checkout.sessionId,
   subscriptionId:'sub_test_partialbrowser123',invoiceId:'in_test_partialbrowser123',
   organizationId:snapshot.draft.organizationId,draftId:snapshot.draft.id,
   price:snapshot.checkout.price,seats:snapshot.draft.seats,licensesGranted:false,
   lifecycle:{subscriptionStatus:'active',cancelAtPeriodEnd:false,cancelAt:null,
    periodEnd:1900000000,invoiceStatus:'paid',billingReason:'subscription_create'}};
 }};
 const {page,org,owner}=await fixture(t,{stripeTestCheckout:checkout,stripeTestReconciler:checker});
 const original=org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased;
 await signIn(page);
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await page.getByRole('button',{name:'Prepare subscription'}).click();
 await page.locator('#draft-plan').selectOption('Single');
 await page.locator('#draft-seats').fill('3');
 await page.locator('#buy-fields input[name=eel]').check();
 await page.getByRole('button',{name:'Save subscription draft'}).click();
 await page.getByRole('button',{name:'Start test checkout'}).click();
 await page.getByRole('button',{name:'Check Stripe TEST status'}).click();
 const summary=page.locator('#test-seat-projection');
 await summary.locator('.test-entitlement-preview').getByText(/DuckNote: Possible increase, not activated/).waitFor();
 const second=org.createSubscriptionDraft({organizationId:'lab-a',actorId:owner.id,
  plan:'Single',apps:['eel'],seats:2});
 const params={organizationId:'lab-a',actorId:owner.id,draftId:second.id};
 org.prepareTestCheckout({...params,price:'price_test_other123'});
 org.completeTestCheckout({...params,session:{
  id:'cs_test_otherbrowser123',url:'https://checkout.stripe.com/c/pay/other'}});
 await page.getByRole('button',{name:'Subscriptions'}).click();
 await summary.locator('.test-entitlement-readiness').getByText(/DuckNote: 1 unverified Checkout\(s\)/).waitFor();
 await summary.locator('.test-entitlement-preview').getByText(/DuckNote: Billing status requires manual review/).waitFor();
 assert.equal(org.testSubscriptionEntitlementPlan('lab-a',owner.id).apps.find(x=>x.appId==='eel').status,'manual_review');
 assert.equal(org.testSeatImpact('lab-a',owner.id).apps.find(x=>x.appId==='eel').status,'manual_review');
 assert.equal(org.overview('lab-a',owner.id).apps.find(a=>a.id==='eel').purchased,original);
});

test('Chromium private Messaging UI supports owner chat, virtual mail and mobile contacts',{timeout:65000},async t=>{
 const {page,origin,worker,owner,communicationsStore}=await fixture(t,{communications:true});
 await signIn(page);
 await page.getByRole('link',{name:'Messaging'}).click();
 await page.locator('#comms-app:not([hidden])').waitFor();
 assert.match(await page.locator('#my-address').textContent(),/^duck-[a-f0-9]{24}@duckbio\.internal$/);
 assert.equal(await page.locator('#owner-addresses').isVisible(),true);
 await page.locator('#organization-contacts').getByRole('button',{name:/Lab worker/}).click();
 await page.locator('#chat-body').fill('Hello from DuckBio');
 await page.locator('#chat-form button[type=submit]').click();
 await page.locator('#chat-history').getByText('Hello from DuckBio').waitFor();
 assert.equal(communicationsStore.chatHistory(worker.id,owner.id).length,1);
 await page.getByRole('button',{name:'Internal mail'}).click();
 await page.getByRole('button',{name:'Compose mail'}).click();
 const workerAddress=communicationsStore.addressFor(worker.id);
 await page.locator('#mail-to').fill(workerAddress);
 await page.locator('#mail-subject').fill('Meeting');
 await page.locator('#mail-body').fill('See you tomorrow');
 await page.locator('#mail-form button[type=submit]').click();
 await page.locator('#mail-list').getByText(/Meeting/).waitFor();
 assert.equal(communicationsStore.listMail(worker.id)[0].subject,'Meeting');
 await page.goto(origin+'/workspace');
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.locator('#sign-in:not([hidden])').waitFor();
 await page.locator('#email').fill('worker@example.test');
 await page.locator('#password').fill('Worker passphrase 123456');
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('do not have organization administrator'));
 await page.goto(origin+'/messages');
 await page.locator('#comms-app:not([hidden])').waitFor();
 assert.equal(await page.locator('#owner-addresses').isVisible(),false);
 assert.equal(await page.locator('#organization-contacts').getByText(/Lab owner/).count(),0);
 await page.locator('#contact-search').fill('Lab owner');
 await page.getByRole('button',{name:'Search all organizations'}).click();
 await page.locator('#search-results').getByText('No users found.').waitFor();
 await page.getByRole('button',{name:'Internal mail'}).click();
 await page.getByRole('button',{name:'Mail DuckBio support'}).click();
 assert.equal(await page.locator('#mail-to').inputValue(),'support@duckbio.internal');
 await page.locator('#mail-subject').fill('Request');
 await page.locator('#mail-body').fill('Need assistance');
 await page.locator('#mail-form button[type=submit]').click();
 await page.locator('#mail-list').getByText(/Request/).waitFor();
 assert(communicationsStore.listMail(owner.id).some(x=>x.subject==='Request'));
 await page.setViewportSize({width:390,height:720});
 const sizes=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
 assert(sizes.width<=sizes.viewport+2,'private messages remain responsive: '+JSON.stringify(sizes));
});

test('Chromium owner creates a cross-contact group and safely tags a user and resource',{timeout:65000},async t=>{
 const {page,origin,org,identity,owner,worker,communicationsStore}=await fixture(t,{communications:true});
 const third=await identity.createUser({email:'second@example.test',
   displayName:'Second teammate',password:'Second password 12345'});
 org.saveMember({organizationId:'lab-a',actorId:owner.id,member:{
  accountId:third.id,name:'Second teammate',nickname:'Second',
  email:'second@example.test',admin:false,roles:{}}});
 await signIn(page);
 await page.goto(origin+'/messages');
 await page.locator('#comms-app:not([hidden])').waitFor();
 await page.getByRole('button',{name:'New group chat'}).click();
 await page.locator('#group-name').fill('Cross-team work');
 await page.locator('#group-available').getByRole('button',{name:'Add Lab worker'}).click();
 await page.locator('#group-available').getByRole('button',{name:'Add Second teammate'}).click();
 await page.locator('#group-create-form button[type=submit]').click();
 await page.locator('#chat-title').getByText('Cross-team work').waitFor();
 const group=communicationsStore.groupsFor(owner.id)[0];
 assert.equal(group.kind,'chat');
 assert.equal(group.memberCount,3);
 await page.locator('#chat-mentions').getByRole('button',{name:'Tag Lab worker'}).click();
 await page.locator('#chat-body').fill('Please examine @ld000001 with @'+
   Buffer.from(worker.id).toString('hex').replace(/^/,'u-'));
 await page.locator('#chat-form button[type=submit]').click();
 await page.locator('#chat-history').getByText('Please examine').waitFor();
 assert.equal(communicationsStore.groupHistory({groupId:group.id,actorId:worker.id}).messages.length,1);
 assert.equal(await page.locator('#chat-history code.comms-reference').count(),2);
 assert.equal(await page.locator('#chat-history a[href]').count(),0,
   'resource mentions must not become unchecked deep-links');
 await page.getByRole('button',{name:'Internal mail'}).click();
 await page.getByRole('button',{name:'New group mail'}).click();
 await page.locator('#group-name').fill('Project mail');
 await page.locator('#group-available').getByRole('button',{name:'Add Lab worker'}).click();
 await page.locator('#group-available').getByRole('button',{name:'Add Second teammate'}).click();
 await page.locator('#group-create-form button[type=submit]').click();
 await page.locator('#mail-group-title').getByText('Project mail').waitFor();
 await page.locator('#mail-group-subject').fill('New sample');
 await page.locator('#mail-group-body').fill('Sample @ld000001 is ready.');
 await page.locator('#mail-group-form button[type=submit]').click();
 await page.locator('#mail-group-history code.comms-reference').getByText('@ld000001').waitFor();
 assert.equal(communicationsStore.groupsFor(worker.id).length,2);
 await page.setViewportSize({width:390,height:720});
 const sizes=await page.evaluate(()=>({viewport:innerWidth,
  width:document.documentElement.scrollWidth,
  offenders:[...document.querySelectorAll('body *')].filter(x=>
    !x.hidden&&x.getBoundingClientRect().right>innerWidth+2)
    .slice(0,16).map(x=>({tag:x.tagName,id:x.id,
      className:typeof x.className==='string'?x.className:'',
      right:Math.round(x.getBoundingClientRect().right),
      width:Math.round(x.getBoundingClientRect().width)}))}));
 assert(sizes.width<=sizes.viewport+2,JSON.stringify(sizes));
 await page.goto(origin+'/workspace');
 await page.getByRole('button',{name:'Sign out'}).click();
 await page.locator('#sign-in:not([hidden])').waitFor();
 await page.locator('#email').fill('worker@example.test');
 await page.locator('#password').fill('Worker passphrase 123456');
 await page.getByRole('button',{name:'Sign in'}).click();
 await page.waitForFunction(()=>document.getElementById('status')
   .textContent.includes('do not have organization administrator'));
 await page.goto(origin+'/messages');
 await page.locator('#comms-app:not([hidden])').waitFor();
 const tagAlert=page.locator('#notifications-list').getByRole('button',{
  name:/Lab owner tagged you in group chat/});
 await tagAlert.waitFor();
 await tagAlert.click();
 await page.locator('#chat-title').getByText('Cross-team work').waitFor();
 assert.equal(await page.locator('#send-chat').isDisabled(),true,
  'workers can read owner-initiated group messages but cannot reply over chat');
});
