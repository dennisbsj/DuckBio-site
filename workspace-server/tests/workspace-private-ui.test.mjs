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
 assert(html.includes('checkout is not connected'));
});
