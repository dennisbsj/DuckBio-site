// Two independently validated immutable QA evidence snapshots for exactly
// the same SIX original native apps. Never treat either as deployment approval.
import {validateQaLock} from './six-app-source-qa-audit.mjs';
import {validateCurrentCompatLock}
 from './six-native-current-compat-audit.mjs';

export function validateSixNativeStagingSnapshot(lock){
 const historical=validateQaLock(lock);
 if(historical.ok)return Object.freeze({ok:true,kind:'historical'});
 const current=validateCurrentCompatLock(lock);
 if(current.ok)return Object.freeze({ok:true,kind:'current'});
 return Object.freeze({ok:false,kind:null});
}

// Optional CLI selection is an explicit, closed-world value. Historical
// invocations continue using the old historical lock without changing.
export function stagingSnapshotFile(choice='historical'){
 if(choice==='historical')return 'six-app-source-qa-lock.json';
 if(choice==='current')return 'six-native-current-compat-lock.json';
 throw Error('unsupported_staging_snapshot');
}
