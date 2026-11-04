import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// No private host, source checkout, secrets, TLS or installed service is used.
// Missing config is intentional. 1 means the opt-in selector parsed and the
// fail-closed private config gate stopped it; 2 means the CLI rejected syntax.
const fake='/path/that/does/not/exist/duckbio-private-staging.json';
const root='/path/that/does/not/exist/duckbio-private-root';
const opts=[
 ['staging-seven-source-gate.mjs',
  ['--config',fake,'--sources-root',root],
  '--confirm-offline-sources'],
 ['staging-seven-proxy-plan.mjs',
  ['--config',fake,'--private-output-root',root],
  '--confirm-uninstalled-only'],
 ['staging-six-native-services.mjs',
  ['--config',fake,'--sources-root',root,'--private-data-root',root,
   '--private-output-root',root],
  '--confirm-uninstalled-only'],
 ['staging-seven-prestart-gate.mjs',
  ['--config',fake,'--sources-root',root,'--private-data-root',root,
   '--proxy-plan-root',root,'--native-plan-root',root],
  '--confirm-offline-prestart-only'],
 ['staging-seven-complete-prestart-gate.mjs',
  ['--config',fake,'--sources-root',root,'--private-data-root',root,
   '--proxy-plan-root',root,'--native-plan-root',root],
  '--confirm-offline-seven-uninstalled-only'],
 ['staging-seven-genuine-runtime-audit.mjs',
  ['--config',fake,'--sources-root',root],
  '--confirm-installed-synthetic-staging-readonly'],
 ['staging-six-native-auth-proof-audit.mjs',
  ['--config',fake,'--sources-root',root,'--proofs',fake],
  '--confirm-synthetic-auth-proof-inspection-only'],
 ['staging-six-native-http-sessions-audit.mjs',
  ['--config',fake,'--sources-root',root,'--broker-proofs',fake,
   '--native-cookies',fake],
  '--confirm-readonly-synthetic-sessions-only']
];
const run=(script,args)=>spawnSync(process.execPath,
 [fileURLToPath(new URL('../'+script,import.meta.url)),...args],
 {encoding:'utf8',timeout:10000,env:{...process.env,DUCKBIO_QA_READ_TOKEN:''}});
test('all eight staging CLIs require explicit supported mTLS snapshot and reject missing host',()=>{
 for(const [script,args,confirm] of opts){
  const newOnly=run(script,[...args,'--snapshot','ownership-mtls',confirm]);
  assert.equal(newOnly.status,1,script+' opt-in must reach private config fail-closed gate: '+newOnly.stderr);
  assert.doesNotMatch(newOnly.stderr,/Usage:/,script);
  for(const unsupported of ['dataduck','main','latest']){
   const bad=run(script,[...args,'--snapshot',unsupported,confirm]);
   assert.equal(bad.status,2,script+' accepted unsupported '+unsupported);
  }
  const accidental=run(script,[...args,'--snapshot','ownership-mtls']);
  assert.equal(accidental.status,2,script+' missing explicit confirmation');
 }
});
