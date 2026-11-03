// Source-verified, first-install-only staging bundle for PRIVATE Workspace UI.
// No server start, DNS, network calls, accounts, payment or database access.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {constants,copyFileSync,chmodSync,lstatSync,mkdirSync,readFileSync,
 rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {approvedPrivateRoot} from './staging-generate-config.mjs';
import {readPrivateConfiguration,validateWorkspaceStagingConfig}
 from './staging-preflight.mjs';

const SOURCE_ROOT=fileURLToPath(new URL('./',import.meta.url));
const REPO_ROOT=resolve(SOURCE_ROOT,'..');
const UI_ROOT=join(SOURCE_ROOT,'private-ui');
const ICON_ROOT=join(REPO_ROOT,'assets','app-icons');
export const UI_FILES=Object.freeze([
 'index.html','admin.html','workspace.html','workspace.css','workspace.js',
 'owner.html','owner.js',
 'communications.html','communications.css','communications.js',
 'communications-launchers.js','connect.html','connect.css','connect.js'
]);
export const ICON_FILES=Object.freeze({
 goflo:'goflo-cropped.svg',eel:'eel.svg',methpipe:'methpipe.svg',
 mantrain:'mantrain.svg',duckman:'duckman-cropped.svg',limsman:'limsman.svg'
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function verifyStagingSourceCommit(config,{runGit=execFileSync}={}){
 const reviewed=config?.SUITE_BUILD_SHA;
 if(typeof reviewed!=='string'||!/^[0-9a-f]{40}$/i.test(reviewed))
  throw Error('missing_reviewed_sha');
 const opts={cwd:REPO_ROOT,encoding:'utf8',timeout:10000,
  stdio:['ignore','pipe','ignore']};
 try{
  const top=runGit('git',['rev-parse','--show-toplevel'],opts).trim();
  const actual=runGit('git',['rev-parse','--verify','HEAD'],opts).trim();
  if(resolve(top)!==REPO_ROOT||actual!==reviewed)
   throw Error('reviewed_source_mismatch');
  const changes=runGit('git',
   ['status','--porcelain','--untracked-files=normal'],opts).trim();
  if(changes)throw Error('reviewed_source_dirty');
  return actual;
 }catch(error){
  if(['reviewed_source_mismatch','reviewed_source_dirty'].includes(error.message))
   throw error;
  throw Error('source_verification_unavailable');
 }
}

function reviewedFile(path){
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe_source_asset');
 return readFileSync(path);
}

export function preparePrivateStagingUi(config,{runGit=execFileSync}={}){
 const validation=validateWorkspaceStagingConfig(config);
 if(!validation.ok)throw Error('invalid_synthetic_staging_config');
 const root=approvedPrivateRoot(dirname(config.SUITE_ASSET_ROOT));
 if(config.SUITE_ASSET_ROOT!==join(root,'private-ui'))
  throw Error('unexpected_ui_destination');
 const reviewed=verifyStagingSourceCommit(config,{runGit});
 // Read every source file BEFORE reserving the destination; failed source
 // audits must never create partial private UI directories.
 const files=new Map();
 for(const name of UI_FILES)files.set(name,reviewedFile(join(UI_ROOT,name)));
 for(const [appId,name] of Object.entries(ICON_FILES))
  files.set('assets/'+appId+'.svg',reviewedFile(join(ICON_ROOT,name)));
 // Verify all loaded script and stylesheet paths resolve to reviewed bytes.
 for(const name of UI_FILES.filter(f=>f.endsWith('.html'))){
  const html=files.get(name).toString('utf8');
  const references=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/[^"]+)"/g)]
   .map(match=>match[1].slice(1));
  for(const ref of references){
   if(!files.has(ref))throw Error('unbundled_private_asset');
  }
 }
 const target=config.SUITE_ASSET_ROOT;
 // Exclusive mkdir is both an ownership reservation and no-overwrite guard.
 // This helper never refreshes a live UI directory or edits existing files.
 mkdirSync(target,{mode:0o700});
 try{
  const entries={};
  for(const [name,bytes] of files){
   const path=join(target,name);
   if(name.includes('/'))mkdirSync(dirname(path),{mode:0o700,recursive:true});
   copyFileSync(name.startsWith('assets/')?
    join(ICON_ROOT,ICON_FILES[name.slice(7,-4)]):
    join(UI_ROOT,name),path,constants.COPYFILE_EXCL);
   chmodSync(path,0o600);
   entries[name]=digest(bytes);
  }
  const manifest={format:'duckbio-private-staging-ui-v1',reviewedGitSha:reviewed,
   files:entries};
  writeFileSync(join(target,'source-manifest.json'),
   JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return Object.freeze({reviewedGitSha:reviewed,fileCount:files.size});
 }catch(error){
  // Clean up only the new directory this invocation exclusively created.
  rmSync(target,{recursive:true,force:true});
  throw error;
 }
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const args=process.argv.slice(2);
 if(args.length!==3||args[0]!=='--config'||args[2]!=='--confirm-first-install'){
  console.error('Usage: node staging-prepare-ui.mjs --config /absolute/private/staging.json --confirm-first-install');
  process.exitCode=2;
 }else{
  try{
   const result=preparePrivateStagingUi(readPrivateConfiguration(args[1]));
   console.log('PASS private staging UI source package ('+result.fileCount+
    ' files; source verified; no deployment)');
  }catch{
   // Avoid disclosing repo paths, customer data, secret values or account IDs.
   console.error('FAIL private staging UI package (reviewed_source_or_private_destination_required)');
   process.exitCode=1;
  }
 }
}
