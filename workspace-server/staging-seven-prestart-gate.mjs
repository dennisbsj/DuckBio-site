// One read-only, source-locked synthetic STAGING PRESTART gate.
// Checks private offline artifacts; NEVER starts/installs services or proves
// live application integration, DNS ownership, database readiness or TLS.
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {validateWorkspaceStagingConfig,readPrivateConfiguration}
 from './staging-preflight.mjs';
import {validateSixNativeStagingSnapshot,stagingSnapshotFile}
 from './staging-six-native-snapshot.mjs';
import {auditSevenLocalSources} from './staging-seven-source-gate.mjs';
import {auditSixNativeEnvironmentFiles} from './staging-six-native-env-audit.mjs';
import {buildSevenOriginProxyPlan} from './staging-seven-proxy-plan.mjs';
import {prepareSixNativeServicePlan} from './staging-six-native-services.mjs';

const SCOPES=['sources','private-native-env','seven-proxy-plan','six-native-units'];
const overlaps=(a,b)=>a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
const code=(name,ok)=>Object.freeze({name,ok:Boolean(ok)});
const fail=(name,checks)=>Object.freeze({
 ok:false,checked:checks.length,checks:[...checks,code(name,false)],
 category:'offline_prestart_blocked',deploymentAuthorized:false
});
function fileBundle(root,folder,expected){
 // Never use recursive traversal or read unrelated files. Reject unexpected
 // names, directory symlinks, unsafe modes, modified content, and all extras.
 const dir=join(root,folder);
 const info=lstatSync(dir);
 if(!info.isDirectory()||info.isSymbolicLink()||
    (process.platform!=='win32'&&(info.mode&0o077)!==0))
  throw Error('unsafe_private_artifact');
 const want=Object.keys(expected).sort();
 const actual=readdirSync(dir).sort();
 if(actual.length!==want.length||actual.some((name,i)=>name!==want[i]))
  throw Error('artifact_inventory_mismatch');
 for(const name of want){
  const path=join(dir,name),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024||
     (process.platform!=='win32'&&(stat.mode&0o077)!==0))
   throw Error('unsafe_private_artifact');
  if(readFileSync(path,'utf8')!==expected[name])
   throw Error('artifact_contents_mismatch');
 }
}

// Four **exact source/config** gate checks. Does NOT read app databases,
// install services, fetch GitHub or contact staging/production.
export function auditSevenServicePrestart({
 config,lock,sourcesRoot,dataRoot,proxyOutputRoot,nativeOutputRoot,
 nodeBinary=process.execPath,runGit
}={}){
 const checks=[];
 if(!validateWorkspaceStagingConfig(config).ok||
    !validateSixNativeStagingSnapshot(lock).ok||
    config.SUITE_BUILD_SHA!==lock.central.sha)
  return fail('reviewed-source-configuration',checks);
 let source,data,proxy,native,central;
 try{
  source=approvedPrivateRoot(sourcesRoot);
  data=approvedPrivateRoot(dataRoot);
  proxy=approvedPrivateRoot(proxyOutputRoot);
  native=approvedPrivateRoot(nativeOutputRoot);
  central=resolve(dirname(config.SUITE_AUTH_DB_PATH));
  const roots=[source,data,proxy,native,central];
  if(roots.some((v,i)=>roots.some((other,j)=>j>i&&overlaps(v,other))))
   throw Error('overlapping_private_roots');
 }catch{return fail('isolated-private-roots',checks)}
 checks.push(code('isolated-private-roots',true));
 try{
  const report=auditSevenLocalSources({
   sourcesRoot:source,workspaceBuildSha:config.SUITE_BUILD_SHA,
   lock,...(runGit?{runGit}:{})
  });
  if(!report.ok||report.verified!==7)throw Error('source_mismatch');
 }catch{return fail('seven-exact-source-checkouts',checks)}
 checks.push(code('seven-exact-source-checkouts',true));
 try{
  const report=auditSixNativeEnvironmentFiles(config,data);
  if(!report.ok||report.checked!==6)throw Error('native_env_mismatch');
 }catch{return fail('six-private-native-env-files',checks)}
 checks.push(code('six-private-native-env-files',true));
 let proxyPlan;
 try{
  proxyPlan=buildSevenOriginProxyPlan(config,lock);
  fileBundle(proxy,'seven-origin-proxy-plan',{
   'Caddyfile.seven-origin-staging':proxyPlan.caddy,
   'routing-manifest.json':JSON.stringify(proxyPlan.manifest,null,2)+'\n'
  });
 }catch{return fail('exact-seven-origin-proxy-artifacts',checks)}
 checks.push(code('exact-seven-origin-proxy-artifacts',true));
 try{
  const plan=prepareSixNativeServicePlan({
   config,lock,sourcesRoot:source,dataRoot:data,nodeBinary,
   ...(runGit?{runGit}:{})
  });
  if(plan.manifest.routesSha256!==proxyPlan.manifest.caddySha256)
   throw Error('native_proxy_sha_mismatch');
  const expected=Object.fromEntries(plan.units.map(item=>
   [item.name,item.content]));
  expected['service-manifest.json']=JSON.stringify(plan.manifest,null,2)+'\n';
  fileBundle(native,'six-native-service-plan',expected);
 }catch{return fail('exact-six-native-unit-artifacts',checks)}
 checks.push(code('exact-six-native-unit-artifacts',true));
 return Object.freeze({
  ok:true,checked:checks.length,checks,
  category:'offline-prestart-source-and-policy-only',
  deploymentAuthorized:false
 });
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 const expected=['--config','--sources-root','--private-data-root',
  '--proxy-plan-root','--native-plan-root'];
 const historical=args.length===11&&args[10]==='--confirm-offline-prestart-only';
 const current=args.length===13&&args[10]==='--snapshot'&&
  args[11]==='current'&&args[12]==='--confirm-offline-prestart-only';
 if((!historical&&!current)||!expected.every((key,i)=>args[2*i]===key)){
  console.error('Usage: node staging-seven-prestart-gate.mjs --config PRIVATE_JSON --sources-root PRIVATE_GIT_ROOT --private-data-root PRIVATE_NATIVE_ROOT --proxy-plan-root PRIVATE_PROXY_ROOT --native-plan-root PRIVATE_UNIT_ROOT [--snapshot current] --confirm-offline-prestart-only');
  process.exitCode=2;
 }else try{
  const filename=stagingSnapshotFile(current?'current':'historical');
  const lock=JSON.parse(readFileSync(new URL(
   './'+filename,import.meta.url),'utf8'));
  const result=auditSevenServicePrestart({
   config:readPrivateConfiguration(args[1]),lock,sourcesRoot:args[3],
   dataRoot:args[5],proxyOutputRoot:args[7],nativeOutputRoot:args[9]
  });
  if(result.ok){
   console.log('PASS all reviewed private seven-service source/prestart policies; OFFLINE ONLY, NOT DEPLOYED');
  }else{
   console.error('BLOCKED seven-service prestart: '+
    result.checks.filter(c=>!c.ok).map(c=>c.name).join(','));
   process.exitCode=1;
  }
 }catch{
  console.error('BLOCKED seven-service prestart: unreadable_or_unsafe_input');
  process.exitCode=1;
 }
}
