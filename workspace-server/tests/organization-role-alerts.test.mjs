import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrganizationStore} from '../organization-store.mjs';

function fixture(t,ownerAlertsOptIn){
 const root=mkdtempSync(join(tmpdir(),'duckbio-role-alert-'));
 const store=createOrganizationStore({databasePath:join(root,'private','org.sqlite'),
  clock:()=>1000,ownerAlertsOptIn});
 t.after(()=>{store.close();rmSync(root,{recursive:true,force:true})});
 store.setupOrganization({organizationId:'lab',name:'Synthetic Lab',
  owner:{accountId:'owner',name:'Owner',nickname:'Owner',email:'owner@example.test'}});
 return store;
}
test('privileged built-in and custom role changes appear in owner security feed without raw permissions',t=>{
 const store=fixture(t,true);
 const appId='goflo';
 store.saveRole({organizationId:'lab',actorId:'owner',appId,
  role:'Analyst',permissions:[]});
 store.saveRole({organizationId:'lab',actorId:'owner',appId,
  role:'Scientist Custom',permissions:['workspace.view']});
 store.saveRole({organizationId:'lab',actorId:'owner',appId,
  role:'Scientist Custom',permissions:[]});
 store.deleteRole({organizationId:'lab',actorId:'owner',appId,role:'Scientist Custom'});
 const actions=['role.defaults.updated','role.custom.created',
  'role.custom.updated','role.custom.deleted'];
 const audit=store.auditLog('lab','owner').filter(x=>actions.includes(x.action));
 assert.deepEqual(audit.map(x=>x.action).reverse(),actions);
 const events=store.ownerCommunicationEvents().filter(x=>x.category==='security'&&
  x.description?.includes('role policy changed'));
 assert.equal(events.length,4);
 assert(events.every(x=>x.description.includes('CytoDuck')&&
   x.description.includes('Synthetic Lab')&&
   !x.description.includes('workspace.view')));
 assert.equal(store.ownerAlertSummary().counts.pending,5,
  'four role policy events plus initial organization creation');
 assert.throws(()=>store.saveRole({organizationId:'lab',actorId:'unauthorized',
  appId,role:'Analyst',permissions:[]}),/access_denied/);
 assert.equal(store.ownerAlertSummary().counts.pending,5,
  'denied security mutation must leave no outbox side effect');
});
test('opted-out owner alerts do not send role events to the outbox',t=>{
 const store=fixture(t,false);
 store.saveRole({organizationId:'lab',actorId:'owner',appId:'goflo',
  role:'Analyst',permissions:[]});
 assert.equal(store.ownerAlertSummary().optedIn,false);
 assert.deepEqual(store.ownerAlertSummary().counts,{});
 // Audit remains local, even with outbound alerts disabled.
 assert(store.auditLog('lab','owner').some(x=>x.action==='role.defaults.updated'));
});
