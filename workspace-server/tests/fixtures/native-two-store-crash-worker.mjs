/** Synthetic-only hard-crash subprocess for private two-store native bind. */
import {createIdentityStore} from '../../shared-auth/identity-store.mjs';
import {createOrganizationStore} from '../../organization-store.mjs';
import {createWorkspaceNativeLinkProvisioner} from '../../shared-auth/session-native-link-provisioning.mjs';
const [mode,identityPath,organizationPath,sessionId,userId]=process.argv.slice(2);
if(!['pre','post','normal'].includes(mode)||!identityPath||!organizationPath||!sessionId||!userId)
 throw Error('synthetic_crash_fixture_arguments_required');
const NOW=1800000000000;
let identity;
const org=createOrganizationStore({databasePath:organizationPath,clock:()=>NOW,
 nativeProvisioningSessionEpochs:true,
 verifyLiveSubscriptionEvidence:record=>record});
let fences=0;
const wrapped=Object.freeze({...org,
 nativeProvisioningAcquireCommitFence(input){
  const lease=org.nativeProvisioningAcquireCommitFence(input);
  if(!lease)return lease;
  fences++;
  if(mode==='pre')process.exit(71);
  if(mode==='post')return Object.freeze({release(){process.exit(72);}});
  return lease;
 }
});
const controller=createWorkspaceNativeLinkProvisioner({
 getIdentityStore:()=>identity,organizationStore:wrapped,
 verifyNativeOwnership:async()=>true,clock:()=>NOW
});
identity=createIdentityStore({databasePath:identityPath,clock:()=>NOW,
 orgNativeLinks:controller.adapters});
const result=await controller.bind({
 sessionId,userId,appId:'goflo',workspaceOrganizationId:'alpha',
 nativeUserId:'synthetic-native-member',nativeOrganizationId:'synthetic-native-alpha'
});
if(mode==='normal'){
 if(result.link?.accessGranted!==false||result.link?.licensesGranted!==false||
  result.link?.loginEnabled!==false)throw Error('native_crash_test_must_never_grant_access');
 process.stdout.write(JSON.stringify({applied:result.applied,fences})+'\n');
 identity.close();
 org.close();
}
