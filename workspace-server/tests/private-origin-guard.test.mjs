import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createSuiteRuntime} from '../shared-auth/runtime.mjs';

test('production shared broker refuses to start without private organization licensing store',()=>{
 assert.throws(()=>createSuiteRuntime({env:{NODE_ENV:'production',SUITE_MODE:'broker'}}),/private organization database/i);
});
test('shared identity service cannot fall back to retired app hostnames',()=>{
 const content=readFileSync(fileURLToPath(new URL('../shared-auth/account-service.mjs',import.meta.url)),'utf8');
 assert(!content.includes('celluloidconsulting.net'));
 assert(content.includes("const expected = client.nativeOrigin"));
});
