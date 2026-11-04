// Two independently validated immutable QA evidence snapshots for exactly
// the same SIX original native apps. Never treat either as deployment approval.
import {validateQaLock} from './six-app-source-qa-audit.mjs';
import {validateCurrentCompatLock}
 from './six-native-current-compat-audit.mjs';

// These duplicate the exact MERGED-MAIN, six-app-reviewed SSO evidence on
// purpose: editing the lock JSON alone must never silently authorize another
// app commit, run ID or workflow for service-plan generation. A new release
// candidate requires a separate reviewed change to this code as well.
const CURRENT_APPROVED=Object.freeze({
 central:Object.freeze({runId:41681059383,workflowId:403711277}),
 apps:Object.freeze({
  goflo:Object.freeze({sha:'79b1d76cb1aae9233c93f0d18cca46e560ddc2ae',
   runId:41690621438,workflowId:406043715}),
  eel:Object.freeze({sha:'c4db3b2ebe9fe9ab2423c376d19966732bd4bcce',
   runId:41691039724,workflowId:406043818}),
  methpipe:Object.freeze({sha:'cda0f784a4e4d968a92215a1acb8d97bfc5104c2',
   runId:41690527942,workflowId:406043868}),
  mantrain:Object.freeze({sha:'c8928d221cf4d08f190002610b0a5793f4caa58e',
   runId:41690516300,workflowId:406042373}),
  duckman:Object.freeze({sha:'9e024fccb33efe9f9f4174becded7e2a35297891',
   runId:41690730348,workflowId:406043909}),
  limsman:Object.freeze({sha:'716ec4a316f199bc3c6ee752ba517b1d04fdc18a',
   runId:41690541378,workflowId:406043938})
 })
});

// New reviewed 2026-11-04 main-push native SSO builds. Historical (233ca)
// and previous 2026-11-03 current (1a3b) evidence stay immutable. This
// second allowlist prevents promoting a random SHA by editing a JSON lock.
const POST_PKCE_APPROVED=Object.freeze({
 goflo:Object.freeze({sha:'2e1008a9b6d2a4c43efcf41aabf4d25ab1fd8e40',
  runId:41786859215,workflowId:406043715}),
 methpipe:Object.freeze({sha:'76fdae938d854af59ef98f19858c800f66896cdc',
  runId:41786886411,workflowId:406043868}),
 mantrain:Object.freeze({sha:'7fd90350965d0c2d0b4df6a73bb9088fe826ccd7',
  runId:41786905381,workflowId:406042373})
});
function reviewedSnapshot(lock,approved){
 return lock.central.runId===CURRENT_APPROVED.central.runId&&
  lock.central.workflowId===CURRENT_APPROVED.central.workflowId&&
  lock.apps.every(row=>{
   const pinned=approved[row.id]||CURRENT_APPROVED.apps[row.id];
   return pinned&&row.sha===pinned.sha&&
    row.runId===pinned.runId&&row.workflowId===pinned.workflowId;
  });
}
export function validateSixNativeStagingSnapshot(lock){
 const historical=validateQaLock(lock);
 if(historical.ok)return Object.freeze({ok:true,kind:'historical'});
 const current=validateCurrentCompatLock(lock);
 if(current.ok&&reviewedSnapshot(lock,CURRENT_APPROVED.apps))
  return Object.freeze({ok:true,kind:'current'});
 if(current.ok&&reviewedSnapshot(lock,POST_PKCE_APPROVED))
  return Object.freeze({ok:true,kind:'post-pkce'});
 return Object.freeze({ok:false,kind:null});
}

// Optional CLI selection is an explicit, closed-world value. Historical
// invocations continue using the old historical lock without changing.
export function stagingSnapshotFile(choice='historical'){
 if(choice==='historical')return 'six-app-source-qa-lock.json';
 if(choice==='current')return 'six-native-current-compat-lock.json';
 if(choice==='post-pkce')return 'six-native-post-pkce-compat-lock.json';
 throw Error('unsupported_staging_snapshot');
}
