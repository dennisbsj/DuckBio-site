/**
 * Local, non-deploying Workspace QA runner. Does not contact GitHub or Stripe.
 * Exact-head validation is only claimed on a clean git checkout.
 */
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir=dirname(dirname(fileURLToPath(import.meta.url)));
const TIMEOUT=20*60*1000;

export function parseLocalQaArgs(argv){
 const allowed=new Set(['--browser','--json','--allow-dirty','--help']);
 if(argv.some(arg=>!allowed.has(arg)))throw Error('unknown_argument');
 return {browser:argv.includes('--browser'),json:argv.includes('--json'),
  allowDirty:argv.includes('--allow-dirty'),help:argv.includes('--help')};
}
function run(command,args,{cwd=projectDir,timeout=TIMEOUT}={}){
 const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout,
  maxBuffer:16*1024*1024,shell:process.platform==='win32'&&/\.cmd$/i.test(command),
  env:{...process.env,FORCE_COLOR:'0'}});
 return {ok:result.status===0&&!result.error,exitCode:result.status,
  stdout:result.stdout||'',stderr:result.stderr||'',
  error:result.error?.code||null};
}
export function browserFiles(directory){
 return readdirSync(directory).filter(name=>name.endsWith('.test.mjs'))
  .sort().map(name=>join(directory,name));
}
export function summarizeQaStage(name,outcome,durationMs){
 return {name,status:outcome.error?'blocked':outcome.ok?'passed':'failed',
  exitCode:outcome.exitCode,durationMs};
}
export function runLocalWorkspaceQa(argv=process.argv.slice(2),{
 cwd=projectDir,execute=run,log=console.error
}={}){
 const options=parseLocalQaArgs(argv);
 if(options.help){
  return {exitCode:0,help:'Usage: npm run qa:local -- [--browser] [--json] [--allow-dirty]'};
 }
 const head=execute('git',['rev-parse','--verify','HEAD'],{cwd,timeout:10000});
 const status=execute('git',['status','--porcelain','--untracked-files=normal'],{cwd,timeout:10000});
 const sha=head.stdout.trim();
 const clean=Boolean(head.ok&&/^[0-9a-f]{40}$/.test(sha)&&status.ok&&!status.stdout.trim());
 const report={schema:'duckbio.workspace.local-qa.v1',sha:head.ok?sha:null,
  exactHead:clean,allowDirty:options.allowDirty,stages:[],
  outcome:'blocked'};
 if(!head.ok||!status.ok||!(/^[0-9a-f]{40}$/.test(sha))){
  log('Cannot resolve an exact git HEAD and working-tree status.');
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
   "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(2))"],
   {cwd,timeout:15000});
  if(!dependency.ok){
   report.stages.push({name:'browser',status:'blocked',exitCode:2,durationMs:0});
   log('Browser QA blocked: install Playwright and Chromium locally, then retry.');
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
 const endStatus=execute('git',['status','--porcelain','--untracked-files=normal'],{cwd,timeout:10000});
 if(!endStatus.ok||endStatus.stdout!==status.stdout){
  report.stages.push({name:'working-tree-integrity',status:'failed',exitCode:1,durationMs:0});
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
