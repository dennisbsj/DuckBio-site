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
import {createAccountService} from '../shared-auth/account-service.mjs';

async function fixture(t, {multi=false}={}) {
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
 const registrations=['goflo','eel','methpipe','mantrain','duckman','limsman'].map(id=>({id,appId:id,secret:randomBytes(32).toString('base64url'),redirectUris:['https://example.invalid/'+id+'/auth/callback'],nativeOrigin:'https://example.invalid'}));
 let service;
 const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 const errors=[];
 // Register cleanup before service/browser creation, including constructor failures.
 t.after(async()=>{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));identity.close();auth.close();org.close();rmSync(temp,{recursive:true,force:true});assert.deepEqual(errors,[],'uncaught browser errors');});
 const assetRoot=fileURLToPath(new URL('../private-ui/',import.meta.url));
 service=createAccountService({origin,issuer:'https://login.example.invalid',clients:registrations,identityStore:identity,organizationStore:org,authStore:auth.brokerStore,assetRoot,getClientAddress:req=>req.socket.remoteAddress});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(origin+'/workspace');
 await page.locator('#sign-in:not([hidden])').waitFor();
 return {page,origin,org,identity,owner,worker,context};
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
 await page.locator('#buy-fields input[name=eel]').fill('3');
 await page.getByRole('button',{name:'Review selection'}).click();
 assert.match(await page.locator('#buy-summary').textContent(),/Checkout is not connected/i);
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
 await page.getByRole('button',{name:'Create account access'}).click();
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
