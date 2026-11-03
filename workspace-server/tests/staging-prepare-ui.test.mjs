import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,
 statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSyntheticStagingConfig,writeSyntheticStagingConfig}
 from '../staging-generate-config.mjs';
import {preparePrivateStagingUi,verifyStagingSourceCommit}
 from '../staging-prepare-ui.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const head=()=>execFileSync('git',['rev-parse','HEAD'],
 {cwd:repo,encoding:'utf8'}).trim();
const tmp=t=>{
 const root=mkdtempSync(join(tmpdir(),'duckbio-prepare-ui-'));
 chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
};
const cfg=root=>createSyntheticStagingConfig({
 baseDomain:'duckbio.net',privateRoot:root,buildSha:head()
});
const checksum=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

test('pinned reviewed Workspace source installs exact private pages, scripts and six icons once',t=>{
 const root=tmp(t),config=cfg(root);
 const report=preparePrivateStagingUi(config);
 assert.equal(report.reviewedGitSha,head());
 assert.equal(report.fileCount,20);
 const target=config.SUITE_ASSET_ROOT;
 assert.equal(statSync(target).mode&0o777,0o700);
 const manifest=JSON.parse(readFileSync(join(target,'source-manifest.json'),'utf8'));
 assert.equal(manifest.reviewedGitSha,head());
 assert.equal(manifest.format,'duckbio-private-staging-ui-v1');
 assert.equal(Object.keys(manifest.files).length,20);
 for(const [name,hash] of Object.entries(manifest.files)){
  const path=join(target,name);
  assert.ok(existsSync(path),'missing packaged asset '+name);
  assert.equal(checksum(path),hash);
  assert.equal(statSync(path).mode&0o777,0o600);
 }
 for(const entry of ['index.html','admin.html','workspace.html','connect.html',
  'owner.html','communications.html']){
  const html=readFileSync(join(target,entry),'utf8');
  assert.match(html,/DuckBio/);
 }
 for(const id of ['goflo','eel','methpipe','mantrain','duckman','limsman'])
  assert.ok(existsSync(join(target,'assets',id+'.svg')));
 for(const name of ['auth.sqlite','identity.sqlite','organizations.sqlite',
  'communications.sqlite'])assert.equal(existsSync(join(root,name)),false,
   'packaging must not create or read databases');
 const before=readFileSync(join(target,'workspace.html'));
 assert.throws(()=>preparePrivateStagingUi(config),
  /EEXIST|file already exists/i,'never overwrite an existing stage package');
 assert.deepEqual(readFileSync(join(target,'workspace.html')),before);
});
test('a mismatched reviewed build is rejected BEFORE staging files are created',t=>{
 const root=tmp(t),config={...cfg(root),SUITE_BUILD_SHA:'b'.repeat(40)};
 assert.throws(()=>preparePrivateStagingUi(config),/reviewed_source_mismatch/);
 assert.deepEqual(readdirSync(root),[]);
});
test('dirty/unrelated Git source and unsafe destination cannot be packaged',t=>{
 const root=tmp(t),config=cfg(root);
 const match=(_exe,args)=>{
  if(args.includes('--show-toplevel'))return repo+'\n';
  if(args.includes('--verify'))return head()+'\n';
  return ' M workspace-server/private-ui/workspace.js\n';
 };
 assert.throws(()=>verifyStagingSourceCommit(config,{runGit:match}),
  /reviewed_source_dirty/);
 const alternate={...config,SUITE_ASSET_ROOT:join(root,'alternate')};
 assert.throws(()=>preparePrivateStagingUi(alternate),
  /unexpected_ui_destination/);
 const existing=join(root,'private-ui'),victim=join(root,'keep');
 writeFileSync(victim,'do not touch',{mode:0o600});
 symlinkSync(victim,existing);
 assert.throws(()=>preparePrivateStagingUi(config));
 assert.equal(readFileSync(victim,'utf8'),'do not touch');
 assert.deepEqual(readdirSync(root).sort(),['keep','private-ui']);
});
test('packaging CLI requires explicit opt-in and does not print credentials',t=>{
 const root=tmp(t);
 const conf=writeSyntheticStagingConfig({
  baseDomain:'duckbio.net',privateRoot:root,buildSha:head()
 }).filename;
 const command=fileURLToPath(new URL('../staging-prepare-ui.mjs',import.meta.url));
 const insufficient=spawnSync(process.execPath,[command,'--config',conf],
  {encoding:'utf8',timeout:10000});
 assert.equal(insufficient.status,2);
 assert.equal(existsSync(join(root,'private-ui')),false);
 const run=spawnSync(process.execPath,[command,'--config',conf,'--confirm-first-install'],
  {encoding:'utf8',timeout:10000});
 assert.equal(run.status,0,run.stderr);
 assert.match(run.stdout,/PASS private staging UI source package/);
 const contents=readFileSync(conf,'utf8');
 const secrets=JSON.parse(JSON.parse(contents).SUITE_CLIENTS).map(c=>c.secret);
 secrets.push(JSON.parse(contents).SUITE_SETUP_TOKEN);
 for(const secret of secrets){
  assert.equal(run.stdout.includes(secret),false);
  assert.equal(run.stderr.includes(secret),false);
 }
 const rerun=spawnSync(process.execPath,[command,'--config',conf,'--confirm-first-install'],
  {encoding:'utf8',timeout:10000});
 assert.equal(rerun.status,1,'repeat package cannot overwrite existing files');
});
