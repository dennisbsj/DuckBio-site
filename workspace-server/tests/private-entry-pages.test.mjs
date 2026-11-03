import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createIdentityStore} from '../shared-auth/identity-store.mjs';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
import {createAccountService} from '../shared-auth/account-service.mjs';

test('all private Workspace entry routes resolve to reviewed pages and real same-origin assets',
 {timeout:30000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'duckbio-private-entry-'));
 const identity=createIdentityStore({databasePath:join(dir,'identity.sqlite')});
 const auth=createSqliteAuthStores({databasePath:join(dir,'auth.sqlite')});
 let service;
 const server=http.createServer(async(req,res)=>{
  if(!await service.handle(req,res)){res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  identity.close();auth.close();rmSync(dir,{recursive:true,force:true});
 });
 const origin='http://127.0.0.1:'+server.address().port;
 const ids=['goflo','eel','methpipe','mantrain','duckman','limsman'];
 service=createAccountService({
  origin,issuer:'https://staging-workspace.duckbio.net',
  clients:ids.map(id=>({
   id,appId:id,secret:randomBytes(48).toString('base64url'),
   nativeOrigin:'https://staging-'+id+'.duckbio.net',
   redirectUris:['https://staging-'+id+'.duckbio.net/auth/callback']
  })),
  identityStore:identity,authStore:auth.brokerStore,
  assetRoot:fileURLToPath(new URL('../private-ui/',import.meta.url)),
  buildVersion:'synthetic-private-entry-test'
 });
 const htmlRoutes=[
  '/','/login','/login/','/setup','/invite','/account','/workspace',
  '/owner','/messages'
 ];
 for(const route of htmlRoutes){
  const response=await fetch(origin+route,{redirect:'manual'});
  assert.equal(response.status,200,'private route '+route+' must not 404');
  assert.match(response.headers.get('content-type')||'',/^text\/html/);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  assert.match(response.headers.get('content-security-policy')||'',/default-src 'self'/);
  const html=await response.text();
  assert.match(html,/<title>[\s\S]*DuckBio/i);
  assert.doesNotMatch(html,/celluloidconsulting\.net|github\.io|http:\/\/[a-z]/i,
   'private entry must not point to a retired/external host');
  if(['/', '/login','/login/','/setup','/invite','/account'].includes(route)){
   assert.match(html,/url=\/workspace/);
   assert.match(html,/<a href="\/workspace">/);
  }
  // Every script and stylesheet on a private page must exist in the
  // server's *actual* source allowlist and be served with safe MIME/CSP.
  const assets=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/[^"]+)"/g)]
   .map(match=>match[1]);
  for(const asset of assets){
   const loaded=await fetch(origin+asset,{redirect:'manual'});
   assert.equal(loaded.status,200,route+' references missing asset '+asset);
   assert.match(loaded.headers.get('content-type')||'',
    /^(?:application\/javascript|text\/javascript|text\/css)/,
    'private script/styles must not receive an HTML fallback');
  }
 }
 // /connect is NOT an ordinary public page. Its exact registered native
 // PKCE handoff must be checked before the central login UI can render.
 assert.equal((await fetch(origin+'/connect',{redirect:'manual'})).status,400);
 const handoff=new URLSearchParams({
  appId:'goflo',
  redirectUri:'https://staging-goflo.duckbio.net/auth/callback',
  state:'s'.repeat(43),
  codeChallenge:'c'.repeat(43)
 });
 const permitted=await fetch(origin+'/connect?'+handoff.toString(),{redirect:'manual'});
 assert.equal(permitted.status,200);
 assert.match(await permitted.text(),/Connect an app/);
 const workspace=await (await fetch(origin+'/workspace')).text();
 assert.match(workspace,/id="login-form"/);
 assert.match(workspace,/id="organizations"/);
 assert.match(workspace,/id="role-fields"/);
 // Serving a public login *page* never authorizes private organization APIs.
 assert.equal((await fetch(origin+'/api/suite/organizations')).status,401);
 const status=await (await fetch(origin+'/api/suite/health')).json();
 assert.deepEqual(status,{status:'ok',mode:'local',
  buildVersion:'synthetic-private-entry-test',configured:false});
});
