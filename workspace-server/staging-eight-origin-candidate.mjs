/**
 * Source-only EIGHT-service plan (Workspace + all SEVEN DuckBio apps).
 * Does not read credentials, connect to GitHub, install Caddy or enable
 * brokers, seats, native sessions, DataDuck or production deployments.
 *
 * Historical seven-origin/six-app staging locks are deliberately NOT reused.
 */
export const EIGHT_SERVICE_SLOTS=Object.freeze([
 Object.freeze({id:'workspace',name:'Workspace',repo:'dennisbsj/DuckBio-site',port:3407}),
 Object.freeze({id:'goflo',name:'CytoDuck',repo:'dennisbsj/CytoDuck',port:3408}),
 Object.freeze({id:'eel',name:'DuckNote',repo:'dennisbsj/DuckNote',port:3409}),
 Object.freeze({id:'methpipe',name:'DuckPipe',repo:'dennisbsj/DuckPipe',port:3410}),
 Object.freeze({id:'mantrain',name:'DuckTrain',repo:'dennisbsj/DuckTrain',port:3411}),
 Object.freeze({id:'duckman',name:'DuckMan',repo:'dennisbsj/DuckMan',port:3412}),
 Object.freeze({id:'limsman',name:'LabDuck',repo:'dennisbsj/LabDuck',port:3413}),
 Object.freeze({id:'dataduck',name:'DataDuck',repo:'dennisbsj/DataDuck',port:3414})
]);

const SHA=/^[a-f0-9]{40}$/;
const DNS=/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const OWN=Object.hasOwn;
const deny=reason=>Object.freeze({
 ok:false,reason,sourceOnly:true,stagingAuthorized:false,
 deploymentAuthorized:false,accessGranted:false,licensesGranted:false
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;
const expectedKeys=['id','repo','sha','origin','callbackUri','sourceStatus'];
const exactEntry=e=>plain(e)&&Object.keys(e).length===expectedKeys.length&&
 expectedKeys.every(k=>OWN(e,k));
const originOf=(id,domain)=>'https://staging-'+id+'.'+domain;
function validateDomain(domain){
 if(typeof domain!=='string'||domain.length>220||!DNS.test(domain)||
    domain.toLowerCase()!==domain||!domain.includes('.')||
    domain.startsWith('.')||domain.includes('..')||
    domain.split('.').some(label=>label.length<1||label.length>63||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))||
    ['localhost','example.test','example.invalid'].includes(domain)||
    domain.endsWith('.test')||domain.endsWith('.example')||
    domain.endsWith('.invalid')||domain.endsWith('.local'))
  return false;
 return true;
}
function exactOrigin(value,expected){
 if(value!==expected)return false;
 try{
  const url=new URL(value);
  return url.origin===expected&&url.protocol==='https:'&&
    url.username===''&&url.password===''&&
    url.search===''&&url.hash===''&&url.pathname==='/';
 }catch{return false}
}

/**
 * Validates an operator-supplied PROPOSAL only. Source status is an
 * untrusted declaration until the real GitHub CI and a separate reviewer
 * independently confirm every SHA; it is NEVER used as authorization.
 * Required keys exclude client secrets and billing/identity data.
 */
export function buildEightOriginCandidate({stagingDomain,entries}={}){
 if(!validateDomain(stagingDomain))return deny('invalid_staging_domain');
 if(!Array.isArray(entries)||entries.length!==8)
  return deny('exact_eight_source_entries_required');
 const ids=new Set(),sources=new Set(),origins=new Set();
 const candidate=[];
 for(const slot of EIGHT_SERVICE_SLOTS){
  const matching=entries.filter(e=>e?.id===slot.id);
  if(matching.length!==1||!exactEntry(matching[0]))
   return deny('unrecognized_or_duplicate_source');
  const entry=matching[0];
  const expected=originOf(slot.id,stagingDomain);
  if(entry.repo!==slot.repo||!SHA.test(entry.sha)||
     !exactOrigin(entry.origin,expected)||
     entry.callbackUri!==(slot.id==='workspace'?
       null:expected+'/auth/callback')||
     !['draft','merged-main'].includes(entry.sourceStatus))
   return deny('invalid_or_unapproved_source_tuple');
  ids.add(slot.id);
  sources.add(entry.repo);
  origins.add(entry.origin);
  candidate.push(Object.freeze({
    id:slot.id,name:slot.name,repo:slot.repo,sha:entry.sha,
    origin:entry.origin,port:slot.port,
    callbackUri:entry.callbackUri,
    sourceStatus:entry.sourceStatus
  }));
 }
 if(ids.size!==8||sources.size!==8||origins.size!==8||
    entries.some(e=>!ids.has(e?.id)))
  return deny('incorrect_eight_service_inventory');
 const dataduck=candidate.find(item=>item.id==='dataduck');
 const pending=candidate.filter(item=>item.sourceStatus!=='merged-main')
  .map(item=>item.id);
 // This Caddy text is a SOURCE TEMPLATE, not an installable guarantee of
 // endpoint identity, TLS, cookies, authorization or complete systemd units.
 const caddy=[
  '# UNINSTALLED EIGHT-ORIGIN CANDIDATE. NOT REVIEWED STAGING.',
  '# Requires separate source/secret/certificate and native-policy approval.',
  ''
 ];
 for(const item of candidate){
  const host=new URL(item.origin).hostname;
  caddy.push(host+' {',
    '  @wrongHost not host '+host,
    '  respond @wrongHost 421',
    '  reverse_proxy 127.0.0.1:'+item.port+' {',
    '    header_up Host {http.request.host}',
    '    header_up -Forwarded',
    '    header_up -X-Forwarded-For',
    '    header_up -X-Forwarded-Host',
    '    header_up X-Forwarded-Proto https',
    '  }','}','');
 }
 return Object.freeze({
  ok:true,
  kind:'duckbio-eight-origin-uninstalled-candidate-v1',
  sourceOnly:true,
  // Even an all-merged set of proposed strings is not external CI evidence.
  sourceIntegrityExternallyVerified:false,
  nativePermissionsVerified:false,
  genuineEightServiceStagingVerified:false,
  stagingAuthorized:false,deploymentAuthorized:false,
  accessGranted:false,licensesGranted:false,
  appCount:7,serviceCount:8,
  dataduckMergedInThisProposal:dataduck.sourceStatus==='merged-main',
  pendingSourceMerges:Object.freeze(pending),
  entries:Object.freeze(candidate),
  caddyTemplate:caddy.join('\n')
 });
}
