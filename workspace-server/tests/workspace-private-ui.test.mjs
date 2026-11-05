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
