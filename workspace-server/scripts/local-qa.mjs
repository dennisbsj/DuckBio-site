/**
 * Local, non-deploying Workspace QA runner. Does not contact GitHub or Stripe.
 * Exact-head validation is only claimed on a clean git checkout.
 */
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir=dirname(dirname(fileURLToPath(import.meta.url)));
const TIMEOUT=20*60*1000;
const unsafeQaOverrideKeys=new Set([
 'NODE_OPTIONS','NODE_PATH','NPM_CONFIG_NODE_OPTIONS',
 'NPM_CONFIG_SCRIPT_SHELL'
]);
/** Host-provided Node test filters/preloads can suppress every test and still
 * return exit 0. Never claim exact-head QA with these inherited settings.
 * Also catches the npm config alias regardless of casing on Windows.
 */
export function unsafeQaNodeEnvironment(environment=process.env){
 return Object.entries(environment).filter(([name,value])=>
  unsafeQaOverrideKeys.has(name.toUpperCase())&&
  typeof value==='string'&&value.trim().length>0).map(([name])=>name);
}

export function parseLocalQaArgs(argv){
 const allowed=new Set(['--browser','--json','--allow-dirty','--help']);
 const pins=argv.filter(arg=>arg.startsWith('--expect-head='));
 if(pins.length>1||argv.some(arg=>!allowed.has(arg)&&
    !/^--expect-head=[0-9a-f]{40}$/i.test(arg)))throw Error('unknown_argument');
 return {browser:argv.includes('--browser'),json:argv.includes('--json'),
  allowDirty:argv.includes('--allow-dirty'),help:argv.includes('--help'),
  expectHead:pins.length?pins[0].slice('--expect-head='.length).toLowerCase():null};
}
function run(command,args,{cwd=projectDir,timeout=TIMEOUT}={}){
 // Node preloads/test filters can make a FAILING test exit 0.
 // npm's overridden script shell can return 0 WITHOUT executing the test.
 // Git overrides can select unrelated trees inside npm and browser scripts.
 // The runner rejects nonempty unsafe Node overrides before QA; independently
 // strip them from EVERY child process, including npm and node.
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>{
  const upper=name.toUpperCase();
  return !upper.startsWith('GIT_')&&!unsafeQaOverrideKeys.has(upper);
 }));
 env.FORCE_COLOR='0';
 const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout,
  maxBuffer:16*1024*1024,shell:process.platform==='win32'&&/\.cmd$/i.test(command),
  env});
 return {ok:result.status===0&&!result.error,exitCode:result.status,
  stdout:result.stdout||'',stderr:result.stderr||'',
  error:result.error?.code||null};
}
export function browserFiles(directory){
 return readdirSync(directory).filter(name=>name.endsWith('.test.mjs'))
  .sort().map(name=>join(directory,name));
}
/**
 * Git status does not reveal dirty tracked files whose index entries carry
 * assume-unchanged or skip-worktree flags. An exact-HEAD QA claim requires
 * ordinary H entries for EVERY tracked source. The NUL output is deliberate
 * so tabs/newlines in filenames cannot spoof an entry.
 */
export function ordinaryTrackedGitIndex(output){
 if(typeof output!=='string'||!output.endsWith('\0'))return false;
 const entries=output.slice(0,-1).split('\0');
 return entries.length>0&&entries.every(entry=>/^H [^\r\n]+$/u.test(entry));
}
/** Reject tracked symlinks/submodules and partial merge stages.
 * A symlink can execute externally mutable code while git status stays clean.
 * All reviewed Workspace files are regular 100644/100755 Git blobs.
 */
export function regularTrackedGitModes(output){
 if(typeof output!=='string'||!output.endsWith('\0'))return false;
 const entries=output.slice(0,-1).split('\0');
 return entries.length>0&&entries.every(entry=>
  /^(?:100644|100755) [0-9a-f]{40} 0\t[^\r\n]+$/u.test(entry));
}
/** Both index readouts must enumerate exactly the same root-level paths.
 * A race or altered index between the flag and mode read is not clean QA.
 */
export function matchingTrackedGitPaths(flags,modes){
 if(!ordinaryTrackedGitIndex(flags)||!regularTrackedGitModes(modes))return false;
 const names=flags.slice(0,-1).split('\0').map(entry=>entry.slice(2));
 const staged=modes.slice(0,-1).split('\0')
  .map(entry=>entry.slice(entry.indexOf('\t')+1));
 return names.length===staged.length&&
  names.every((name,i)=>name===staged[i]);
}
export function validQaNodeVersion(version){
 const parsed=/^(\d+)\.(\d+)\.\d+$/.exec(version);
 if(!parsed)return false;
 const major=Number(parsed[1]),minor=Number(parsed[2]);
 return (major===22&&minor>=16)||major===24;
}
export function summarizeQaStage(name,outcome,durationMs){
 return {name,status:outcome.error?'blocked':outcome.ok?'passed':'failed',
  exitCode:outcome.exitCode,durationMs};
}
export function runLocalWorkspaceQa(argv=process.argv.slice(2),{
 cwd=projectDir,execute=run,log=console.error,nodeVersion=process.versions.node
}={}){
 const options=parseLocalQaArgs(argv);
 if(options.help){
  return {exitCode:0,help:'Usage: npm run qa:local -- [--browser] [--json] [--expect-head=<40-hex-SHA>] [--allow-dirty]'};
 }
 // A nested Git repository inside workspace-server would otherwise make
 // tests appear clean for the wrong source tree. This runner is exclusively
 // for the DuckBio-site/workspace-server checkout layout.
 const sourceRoot=resolve(dirname(cwd));
 const isWorkspaceDirectory=basename(resolve(cwd))==='workspace-server';
 const root=execute('git',['rev-parse','--show-toplevel'],{cwd,timeout:10000});
 const head=execute('git',['rev-parse','--verify','HEAD'],{cwd,timeout:10000});
 const status=execute('git',['status','--porcelain','--untracked-files=normal'],{cwd,timeout:10000});
 // Enumerate from the FULL canonical repository root. Git ls-files run
 // inside workspace-server omits tracked parent configuration (including
 // suite-permissions.json) and could miss its hidden modified bytes.
 const sourceIndex=execute('git',['ls-files','-v','-z'],{cwd:sourceRoot,timeout:10000});
 const sourceModes=execute('git',['ls-files','--stage','-z'],{cwd:sourceRoot,timeout:10000});
 const sha=head.stdout.trim();
 const trustworthyIndex=Boolean(sourceIndex.ok&&ordinaryTrackedGitIndex(sourceIndex.stdout));
 const trustworthyModes=Boolean(sourceModes.ok&&
  matchingTrackedGitPaths(sourceIndex.stdout,sourceModes.stdout));
 const clean=Boolean(head.ok&&/^[0-9a-f]{40}$/.test(sha)&&status.ok&&
  !status.stdout.trim()&&trustworthyIndex&&trustworthyModes);
 const report={schema:'duckbio.workspace.local-qa.v1',sha:head.ok?sha:null,
  exactHead:clean,expectedRoot:sourceRoot,expectedHead:options.expectHead,allowDirty:options.allowDirty,stages:[],
  outcome:'blocked',nodeVersion};
 const unsafeNodeEnvironment=unsafeQaNodeEnvironment();
 if(unsafeNodeEnvironment.length){
  report.exactHead=false;
  log('Unsafe inherited Node/npm test or script-shell overrides detected: '+unsafeNodeEnvironment.join(', ')+
   '. Clear the environment before running Workspace release QA.');
  return {exitCode:2,report};
 }
 if(!validQaNodeVersion(nodeVersion)){
  log('Workspace QA requires Node 22.16+ or Node 24.');
  return {exitCode:2,report};
 }
 if(!isWorkspaceDirectory||!root.ok||resolve(root.stdout.trim())!==sourceRoot){
  report.exactHead=false;
  log('Not the canonical DuckBio-site/workspace-server Git checkout.');
  return {exitCode:2,report};
 }
 if(!head.ok||!status.ok||!(/^[0-9a-f]{40}$/.test(sha))){
  log('Cannot resolve an exact git HEAD and working-tree status.');
  return {exitCode:2,report};
 }
 // This is never overridable by --allow-dirty. A masked index can cause
 // status to falsely report a clean checkout and hide malicious source.
 if(!trustworthyIndex||!trustworthyModes){
  report.exactHead=false;
  log('Tracked Git index contains hidden source flags, symlinks, submodules or unreadable entries.');
  return {exitCode:2,report};
 }
 if(options.expectHead&&sha!==options.expectHead){
  log('Checked-out Git HEAD does not match the pinned expected SHA.');
  return {exitCode:2,report};
 }
 if(!clean&&!options.allowDirty){
  log('Working tree differs from HEAD. Commit the changes first, or use --allow-dirty (non-release QA).');
  return {exitCode:2,report};
 }
 const npm=process.platform==='win32'?'npm.cmd':'npm';
 const stages=[['syntax',npm,['run','check']],['core',npm,['test']]];
 if(options.browser){
  const dependency=execute(process.execPath,['--input-type=module','-e',
   "Promise.all([import('playwright'),import('playwright/package.json',{with:{type:'json'}})]).then(([p,v])=>import('node:fs').then(fs=>process.exit(v.default.version==='1.56.1'&&fs.existsSync(p.chromium.executablePath())?0:2))).catch(()=>process.exit(2))"],
   {cwd,timeout:15000});
  if(!dependency.ok){
   report.stages.push({name:'browser',status:'blocked',exitCode:2,durationMs:0});
   log('Browser QA blocked: install Playwright 1.56.1 and its Chromium binary locally, then retry.');
  }else{
   let files=[];
   try{files=browserFiles(join(cwd,'browser-tests'));}
   catch{ /* no browser tests -> explicit block */ }
   if(files.length){stages.push(['browser',process.execPath,
    ['--test','--test-concurrency=1',...files]]);}
   else report.stages.push({name:'browser',status:'blocked',exitCode:2,durationMs:0});
  }
 }
 for(const [name,command,args] of stages){
  const start=Date.now();
  const outcome=execute(command,args,{cwd,timeout:TIMEOUT});
  const stage=summarizeQaStage(name,outcome,Math.max(0,Date.now()-start));
  report.stages.push(stage);
  if(!options.json){
   log(name+': '+stage.status+(stage.exitCode!==null?' (exit '+stage.exitCode+')':''));
   if(!outcome.ok)log((outcome.stderr+'\n'+outcome.stdout).slice(-5000));
  }
 }
 // Status alone cannot bind a run to the original commit. A second
 // process could switch to a different HEAD and leave the tree clean.
 const endRoot=execute('git',['rev-parse','--show-toplevel'],{cwd,timeout:10000});
 const endHead=execute('git',['rev-parse','--verify','HEAD'],{cwd,timeout:10000});
 const endStatus=execute('git',['status','--porcelain','--untracked-files=normal'],{cwd,timeout:10000});
 const endIndex=execute('git',['ls-files','-v','-z'],{cwd:sourceRoot,timeout:10000});
 const endModes=execute('git',['ls-files','--stage','-z'],{cwd:sourceRoot,timeout:10000});
 if(!endModes.ok||!matchingTrackedGitPaths(endIndex.stdout,endModes.stdout)||
    endModes.stdout!==sourceModes.stdout){
  report.stages.push({name:'git-source-mode-integrity',status:'failed',exitCode:1,durationMs:0});
  report.exactHead=false;
 }
 if(!endIndex.ok||!ordinaryTrackedGitIndex(endIndex.stdout)||
    endIndex.stdout!==sourceIndex.stdout){
  report.stages.push({name:'git-index-integrity',status:'failed',exitCode:1,durationMs:0});
  report.exactHead=false;
 }
 if(!endRoot.ok||resolve(endRoot.stdout.trim())!==sourceRoot){
  report.stages.push({name:'git-root-integrity',status:'failed',exitCode:1,durationMs:0});
  report.exactHead=false;
 }
 if(!endHead.ok||endHead.stdout.trim()!==sha){
  report.stages.push({name:'git-head-integrity',status:'failed',exitCode:1,durationMs:0});
  report.exactHead=false;
 }
 if(!endStatus.ok||endStatus.stdout!==status.stdout){
  report.stages.push({name:'working-tree-integrity',status:'failed',exitCode:1,durationMs:0});
  report.exactHead=false;
 }
 report.outcome=report.stages.every(stage=>stage.status==='passed')&&clean?'passed':
  report.stages.some(stage=>stage.status==='failed')?'failed':'blocked';
 return {exitCode:report.outcome==='passed'?0:report.outcome==='failed'?1:2,report};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const options=parseLocalQaArgs(process.argv.slice(2));
  const result=runLocalWorkspaceQa(process.argv.slice(2));
  if(result.help)console.log(result.help);
  else if(options.json)console.log(JSON.stringify(result.report));
  else console.error('Workspace local QA: '+result.report.outcome+', SHA '+result.report.sha);
  process.exitCode=result.exitCode;
 }catch(error){
  console.error('Invalid QA command: '+error.message);
  process.exitCode=2;
 }
}
