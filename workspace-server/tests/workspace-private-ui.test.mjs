import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=new URL('../private-ui/',import.meta.url);
test('private Workspace page is a real same-origin client, not an embedded public Pages demo',()=>{
 const html=readFileSync(fileURLToPath(new URL('workspace.html',base)),'utf8');
 const js=readFileSync(fileURLToPath(new URL('workspace.js',base)),'utf8');
 const css=readFileSync(fileURLToPath(new URL('workspace.css',base)),'utf8');
 for(const id of ['login-form','organizations','members','role-fields','member-form','buy-fields'])assert(html.includes('id="'+id+'"'));
 for(const url of ['/api/suite/auth/session','/api/suite/organizations','/api/suite/organization/overview','/api/suite/organization/user/save'])assert(js.includes(url));
 assert(js.includes("credentials:'same-origin'"));
 assert(js.includes("'X-CSRF-Token':state.csrf"));
 assert(js.includes('.textContent'));
 assert(!js.includes('innerHTML'));
 assert(!/celluloidconsulting\.net|chosting|stripe\.com/i.test(html+js+css));
 assert(html.includes('No live billing or licence activation is enabled.'));
 assert(html.includes('Configured Stripe TEST checkout'));
});

test('user and invitation role forms offer app dropdown filters without changing the server-side assignment model',()=>{
 const html=readFileSync(fileURLToPath(new URL('workspace.html',base)),'utf8');
 const js=readFileSync(fileURLToPath(new URL('workspace.js',base)),'utf8');
 for(const id of ['account-app-picker','invite-app-picker']){
  assert(html.includes('id="'+id+'"'));
  assert(js.includes("'"+id+"'"));
 }
 assert(js.includes('function appRolePicker(pickerId,fieldsId)'));
 assert(js.includes("for(const app of state.overview.apps)"));
 assert(js.includes("card.dataset.appId=app.id"));
 assert(js.includes("card.hidden=picker.value!==''&&card.dataset.appId!==picker.value"));
 // Filtering hides cards only. Each app role <select> stays in the DOM
 // and both existing forms still submit all selected app roles at once.
 assert(js.includes("for(const select of $('role-fields').querySelectorAll('select'))"));
 assert(js.includes("for(const select of $('invite-role-fields').querySelectorAll('select'))"));
 assert(!js.includes('innerHTML'));
 assert(!html.includes('dataduck</option>'));
});


test('Create account uses secure invitation while existing-account assignment stays separate',()=>{
 const html=readFileSync(fileURLToPath(new URL('workspace.html',base)),'utf8');
 const js=readFileSync(fileURLToPath(new URL('workspace.js',base)),'utf8');
 assert(html.includes('id="invite" class="primary">Create account</button>'));
 assert(html.includes('id="create">Add existing account</button>'));
 assert(html.includes('<h2>Create account</h2>'));
 assert(html.includes('The person receiving the invitation creates their own password.'));
 assert(html.includes('app access remains disabled until acceptance.'));
 assert(html.includes('id="account-app-picker"'));
 assert(html.includes('id="invite-app-picker"'));
 assert(js.includes("$('invite').addEventListener('click'"));
 assert(js.includes("request('/api/suite/organization/invite'"));
 assert(js.includes("$('create').addEventListener('click',()=>edit(null))"));
 assert(js.includes("'Add existing account access'"));
 assert(!html.includes('Create an account with a password chosen by an administrator'));
});


test('administrator actions disclose and confirm pending invitation invalidation',()=>{
 const js=readFileSync(fileURLToPath(new URL('workspace.js',base)),'utf8');
 assert(js.includes('Pending invitations issued by this administrator will be revoked and their reserved app seats released.'));
 assert(js.includes('Pending invitations issued by this member will be revoked.'));
 assert(js.includes('Removing organization administrator status also revokes any pending invitations issued by this member.'));
 assert(js.includes('Pending invitations issued by the former administrator were revoked.'));
 assert(js.includes('Their assigned app seats remain reserved.'));
 assert(!js.includes('innerHTML'));
});


test('seats are shown per app after subtracting assignments and pending invites',()=>{
 const js=readFileSync(fileURLToPath(new URL('workspace.js',base)),'utf8');
 assert(js.includes('function appSeatSummary(app)'));
 assert(js.includes('app.purchased-app.assigned-(app.reserved||0)'));
 assert(js.includes('appSeatSummary(app)'));
 assert(js.includes('(Workspace assignments only)'));
 assert(js.includes('Over capacity by '));
 assert(!js.includes('organization-wide available users'));
});
