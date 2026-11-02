import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedContentDestination} from '../private-content-launch.mjs';
const clients=[
 {appId:'limsman',nativeOrigin:'https://labduck.duckbio.net'},
 {appId:'duckman',nativeOrigin:'https://duckman.duckbio.net'}
];
const access=({organizationId,accountId,appId})=>
 organizationId==='org1'&&accountId==='alice1'&&appId==='limsman'?{role:'scientist'}:null;
const owner={accessFor:access};
const args=()=>({contentId:'ld000001',viewerId:'alice1',organizationStore:owner,clients,
 resolveResource:async()=>({authorized:true,appId:'limsman',organizationId:'org1',
  url:'https://labduck.duckbio.net/content/ld000001'})});
test('a native-authenticated resource link resolves to exact matching app origin only',async()=>{
 assert.equal(await authorizedContentDestination(args()),
  'https://labduck.duckbio.net/content/ld000001');
 assert.equal(await authorizedContentDestination({...args(),viewerId:'another'}),null);
 assert.equal(await authorizedContentDestination({...args(),resolveResource:async()=>null}),null);
 assert.equal(await authorizedContentDestination({...args(),contentId:'not-valid'}),null);
});
test('wrong app, org or unverifiable content always denies the deep link',async()=>{
 const invalid=[
  {authorized:false,appId:'limsman',organizationId:'org1',url:'https://labduck.duckbio.net/content/ld000001'},
  {authorized:true,appId:'duckman',organizationId:'org1',url:'https://duckman.duckbio.net/content/ld000001'},
  {authorized:true,appId:'limsman',organizationId:'org2',url:'https://labduck.duckbio.net/content/ld000001'},
  {authorized:true,appId:'limsman',organizationId:'org1',url:'https://evil.example/content/ld000001'},
  {authorized:true,appId:'limsman',organizationId:'org1',url:'https://labduck.duckbio.net@evil.example/content/ld000001'},
  {authorized:true,appId:'limsman',organizationId:'org1',url:'https://labduck.duckbio.net/content/ld000002'},
  {authorized:true,appId:'limsman',organizationId:'org1',url:'https://labduck.duckbio.net/content/ld000001?access=public'},
  {authorized:true,appId:'limsman',organizationId:'org1',url:'http://labduck.duckbio.net/content/ld000001'}
 ];
 for(const result of invalid)assert.equal(await authorizedContentDestination({
  ...args(),resolveResource:async()=>result}),null,JSON.stringify(result));
});
test('no configured trusted native verifier cannot open content',async()=>{
 assert.equal(await authorizedContentDestination({...args(),resolveResource:null}),null);
 assert.equal(await authorizedContentDestination({...args(),clients:[]}),null);
 assert.equal(await authorizedContentDestination({...args(),organizationStore:null}),null);
 assert.equal(await authorizedContentDestination({...args(),resolveResource:async()=>{
  throw Error('provider offline');}}),null);
});
