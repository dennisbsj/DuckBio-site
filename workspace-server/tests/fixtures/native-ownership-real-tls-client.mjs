/**
 * Synthetic-only real TLS client. A separate Node process is required
 * because NODE_EXTRA_CA_CERTS is loaded at process startup, never per fetch.
 * This file is NOT imported by the Workspace runtime or any native app.
 */
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import {createSignedNativeOwnershipVerifier}
 from '../../shared-auth/signed-native-ownership-verifier.mjs';

const endpoint=process.env.DUCKBIO_QA_NATIVE_HTTPS_ENDPOINT;
const token=process.env.DUCKBIO_QA_NATIVE_TOKEN;
const publicKeyPem=readFileSync(process.env.DUCKBIO_QA_NATIVE_PUBLIC_KEY,'utf8');
const clock=()=>Number(process.env.DUCKBIO_QA_NATIVE_CLOCK);
const mode=process.argv[2];
const key=mode==='untrusted-signing-key'?
 generateKeyPairSync('ed25519').publicKey.export({format:'pem',type:'spki'}):
 publicKeyPem;
const verifier=createSignedNativeOwnershipVerifier({
 clients:{goflo:{endpoint,keyId:'native-qa-key-1',
  publicKeyPem:key,token:mode==='wrong-bearer'?
   'intentionally-wrong-qa-only-bearer-123456789':token}},
 clock,timeoutMs:mode==='timeout'?350:3000
});
const fields={
 appId:'goflo',workspaceAccountId:'qa-central-account',
 workspaceOrganizationId:'qa-central-tenant',
 nativeUserId:'qa-native-account',nativeOrganizationId:'qa-native-tenant'
};
let results;
if(mode==='replay')results=[
 await verifier.verifyNativeMapping(fields),
 await verifier.verifyNativeMapping(fields)
];
else if(mode==='bind')results=[await verifier.verifyNativeOwnership({
 actorId:'qa-operator',userId:fields.workspaceAccountId,
 appId:fields.appId,
 workspaceOrganizationId:fields.workspaceOrganizationId,
 nativeUserId:fields.nativeUserId,
 nativeOrganizationId:fields.nativeOrganizationId,operation:'bind'
})];
else results=[await verifier.verifyNativeMapping(fields)];
process.stdout.write(JSON.stringify({
 results,accessGranted:false,licensesGranted:false,
 loginEnabled:false
})+'\n');
