import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {nativeConnectRequest} from '../native-connect.mjs';

const clients=[
 {id:'eel',appId:'eel',redirectUris:['https://ducknote.example.test/auth/callback']},
 {id:'duckman',appId:'duckman',redirectUris:['https://duckman.example.test/auth/callback']}
];
const base=()=>new URLSearchParams({
 appId:'eel',redirectUri:clients[0].redirectUris[0],
 state:randomBytes(32).toString('base64url'),
 codeChallenge:randomBytes(32).toString('base64url')
});
test('registered SSO handoff accepts only exact app-bound callback and PKCE',()=>{
 const params=base(),value=nativeConnectRequest(params,clients);
 assert.equal(value.appId,'eel');
 assert.equal(value.redirectUri,clients[0].redirectUris[0]);
 assert.equal(value.codeChallengeMethod,'S256');
 assert.equal(value.returnPath,'/');
 assert.equal(Object.isFrozen(value),true);
 assert.deepEqual([...params.keys()].sort(),['appId','codeChallenge','redirectUri','state']);
});
test('native connect rejects duplicate, unknown, wrong app, or unsafe redirect parameters',()=>{
 const invalid=[
  p=>p.append('state',p.get('state')),
  p=>p.append('appId','duckman'),
  p=>p.set('appId','duckman'),
  p=>p.set('appId','unknown'),
  p=>p.set('redirectUri','https://evil.example.test/auth/callback'),
  p=>p.set('redirectUri','https://ducknote.example.test/auth/callback?next=evil'),
  p=>p.set('redirectUri','https://ducknote.example.test@evil.example.test/auth/callback'),
  p=>p.set('state','short'),
  p=>p.set('codeChallenge','wrong'),
  p=>p.set('codeChallenge','!'.repeat(43)),
  p=>p.set('returnPath','https://evil.example.test'),
  p=>p.delete('state')
 ];
 for(const change of invalid){
  const p=base();change(p);
  assert.equal(nativeConnectRequest(p,clients),null,p.toString());
 }
 const duplicate=[clients[0],{...clients[0],id:'other'}];
 assert.equal(nativeConnectRequest(base(),duplicate),null,'ambiguous app registration fails closed');
});
