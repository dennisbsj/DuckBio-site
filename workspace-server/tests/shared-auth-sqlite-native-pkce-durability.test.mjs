import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteAuthStores} from '../shared-auth/sqlite-store.mjs';
const NOW=1_800_000_000_000;
const setup=(t)=>{const root=mkdtempSync(join(tmpdir(),'duckbio-real-auth-sqlite-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return join(root,'private','auth.sqlite')};
const input=Object.freeze({clientId:'goflo',state:'exact-state',challenge:'pkce-S256',redirectUri:'https://goflo.example.test/auth/callback',now:NOW});
const code=Object.freeze({clientId:input.clientId,state:input.state,challenge:input.challenge,redirectUri:input.redirectUri,expiresAt:NOW+60_000,parentSessionId:'parent1',subject:'user1'});

test('actual exact GitHub SQLite broker store: concurrent separate connections redeem one code exactly once',async t=>{
 const file=setup(t),a=createSqliteAuthStores({databasePath:file,clock:()=>NOW}),b=createSqliteAuthStores({databasePath:file,clock:()=>NOW});t.after(()=>{a.close();b.close()});
 await a.brokerStore.putCode('hash-code',code);
 const results=await Promise.all([a.brokerStore.consumeCode('hash-code',input),b.brokerStore.consumeCode('hash-code',input)]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(results.filter(Boolean)[0].parentSessionId,'parent1');
 assert.equal(await b.brokerStore.consumeCode('hash-code',input),null);
});

test('actual exact GitHub SQLite broker store: second connection reads independently persisted child proof',async t=>{
 const file=setup(t),a=createSqliteAuthStores({databasePath:file,clock:()=>NOW}),b=createSqliteAuthStores({databasePath:file,clock:()=>NOW});t.after(()=>{a.close();b.close()});
 const proof={clientId:'goflo',appId:'goflo',parentSessionId:'parent1',subject:'user1',localIdentity:{userId:'native-user',organizationId:'native-org'},expiresAt:NOW+3600_000};
 await a.brokerStore.putProof('sha256token',proof);
 assert.deepEqual(await b.brokerStore.getProof('sha256token'),proof);
 await b.brokerStore.deleteProof('sha256token');
 assert.equal(await a.brokerStore.getProof('sha256token'),null);
});

test('actual exact GitHub SQLite broker store: incorrect exchange does not consume valid code',async t=>{
 const file=setup(t),a=createSqliteAuthStores({databasePath:file,clock:()=>NOW});t.after(()=>a.close());
 await a.brokerStore.putCode('hash-code',code);
 assert.equal(await a.brokerStore.consumeCode('hash-code',{...input,challenge:'wrong'}),null);
 assert.deepEqual(await a.brokerStore.consumeCode('hash-code',input),code);
});

test('actual exact GitHub SQLite broker store: expired code cannot be consumed',async t=>{
 const file=setup(t),a=createSqliteAuthStores({databasePath:file,clock:()=>NOW});t.after(()=>a.close());
 await a.brokerStore.putCode('hash-code',code);
 assert.equal(await a.brokerStore.consumeCode('hash-code',{...input,now:NOW+120000}),null);
});

test('actual exact GitHub SQLite broker store: proof survives database close and reopen',async t=>{
 const file=setup(t);let a=createSqliteAuthStores({databasePath:file,clock:()=>NOW});
 await a.brokerStore.putProof('reopen',{clientId:'goflo',expiresAt:NOW+300000,parentSessionId:'parent'});a.close();
 a=createSqliteAuthStores({databasePath:file,clock:()=>NOW});t.after(()=>a.close());
 assert.equal((await a.brokerStore.getProof('reopen')).parentSessionId,'parent');
});
