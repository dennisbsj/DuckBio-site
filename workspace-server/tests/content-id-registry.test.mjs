import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContentIdRegistry,extractContentMentions} from '../content-id-registry.mjs';
const appIds=['limsman','duckman','eel','goflo','methpipe','mantrain'];
const prefix={limsman:'ld',duckman:'dm',eel:'dn',goflo:'cd',methpipe:'md',mantrain:'dt'};
function fixture(t){
 const folder=mkdtempSync(join(tmpdir(),'duckbio-contentid-'));
 const databasePath=join(folder,'secure','registry.sqlite');
 const config={databasePath,clock:()=>1800000000000,
  verifyRegistration:({proof,operation,record})=>proof==='trusted-app-backend'&&
   (operation==='register'||operation==='archive')&&Boolean(record),
  canView:({viewerId,organizationId})=>viewerId==='owner1'||
   (viewerId==='alice1'&&organizationId==='org1')};
 let store=createContentIdRegistry(config);
 t.after(()=>{store.close();rmSync(folder,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=createContentIdRegistry(config);}};
}
const add=(f,appId,name,sourceKey,org='org1')=>
 f.store.register({proof:'trusted-app-backend',organizationId:org,appId,
  type:appId==='limsman'?'sample':appId==='goflo'?'workspace':'document',
  sourceKey,name});
test('all six apps share one globally increasing sequence and unique prefixed IDs',t=>{
 const f=fixture(t);
 const ids=appIds.map((appId,i)=>add(f,appId,'Resource '+(i+1),'native-'+(i+1)).id);
 assert.deepEqual(ids,appIds.map((x,i)=>prefix[x]+String(i+1).padStart(6,'0')));
 assert.equal(new Set(ids).size,6);
 assert.equal(new Set(ids.map(x=>Number(x.slice(2)))).size,6,
  'numeric suffixes must never collide across apps');
 const linked=extractContentMentions('See @ld000001, @dm000002 and (@cd000004).');
 assert.deepEqual(linked,['ld000001','dm000002','cd000004']);
 assert.deepEqual(extractContentMentions('mail@example.test @ld000001 @ld000001 and @LD000001'),['ld000001']);
});
test('names cannot be duplicated across apps or organizations, even after archive',t=>{
 const f=fixture(t);
 const x=add(f,'limsman',' Sample  ABC ','sourceA');
 assert.equal(x.id,'ld000001');
 assert.throws(()=>add(f,'duckman','sample   abc','otherA','org2'),/resource_name_conflict/);
 assert.throws(()=>add(f,'eel','Ｓａｍｐｌｅ ＡＢＣ','otherB'),/resource_name_conflict/);
 assert.equal(f.store.archive({proof:'trusted-app-backend',contentId:x.id}).changed,true);
 assert.equal(f.store.inspect({contentId:x.id,viewerId:'alice1'}),null);
 assert.throws(()=>add(f,'mantrain','Sample ABC','later'),/resource_name_conflict/,
  'archiving must not silently recycle old names');
 assert.equal(add(f,'mantrain','New Name','later').id,'dt000002',
  'aborted inserts do not consume IDs');
});
test('a duplicate source is idempotent; same source with a new name or type conflicts',t=>{
 const f=fixture(t);
 const a=add(f,'goflo','Flow workspace 1','workspace-1');
 assert.equal(add(f,'goflo','Flow workspace 1','workspace-1').created,false);
 assert.throws(()=>add(f,'goflo','Flow workspace 2','workspace-1'),/resource_source_conflict/);
 assert.equal(add(f,'duckman','Document 2','document-2').id,'dm000002');
});
test('one shared private database maintains sequential IDs after restart',t=>{
 const f=fixture(t);
 assert.equal(add(f,'limsman','Sample 1','sample1').id,'ld000001');
 f.reopen();
 assert.equal(add(f,'duckman','Document 1','document1').id,'dm000002');
 assert.equal(f.store.inspect({contentId:'dm000002',viewerId:'owner1'}).name,'Document 1');
});
test('native permission resolver prevents existence and metadata leaks',t=>{
 const f=fixture(t);
 const x=add(f,'limsman','Secret Sample','sample-secret','org2');
 assert.equal(f.store.inspect({contentId:x.id,viewerId:'alice1'}),null);
 assert.equal(f.store.inspect({contentId:'ld999999',viewerId:'alice1'}),null);
 assert.deepEqual(f.store.inspect({contentId:x.id,viewerId:'owner1'}),{
  id:x.id,appId:'limsman',organizationId:'org2',
  type:'sample',name:'Secret Sample',archived:false
 });
 assert.throws(()=>f.store.register({proof:'browser',
   organizationId:'org1',appId:'duckman',type:'document',
   sourceKey:'untrusted',name:'Spoof'}),/resource_registration_denied/);
 assert.equal(add(f,'duckman','Real Document','trusted1').id,'dm000002');
});
test('rejects invalid app prefixes, invalid types and unsafe private DB locations',t=>{
 const f=fixture(t);
 for(const invalid of [
  {appId:'labduck'},
  {type:'image-tag'},
  {sourceKey:'bad key'},
  {name:'  '},
  {organizationId:'bad/id'}
 ]){
  assert.throws(()=>f.store.register({proof:'trusted-app-backend',
   organizationId:'org1',appId:'limsman',type:'document',sourceKey:'s1',
   name:'Valid',...invalid}),/invalid_resource_registration/);
 }
 assert.throws(()=>createContentIdRegistry({
  databasePath:'/tmp/public_html/registry.sqlite',
  verifyRegistration:()=>true,canView:()=>true}),/private_resource_registry_configuration_required/);
});
