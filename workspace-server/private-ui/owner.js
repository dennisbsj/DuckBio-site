// Central-owner read-only dashboard. Server enforces exact pinned owner ID.
const $=id=>document.getElementById(id);
let latest=null;
const make=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);return x;};
function row(values){
 const tr=make('tr');
 for(const value of values)tr.append(make('td',value??'—'));
 return tr;
}
function fill(id,rows,empty='No records'){
 const root=$(id);root.replaceChildren();
 if(!rows.length){const tr=make('tr'),td=make('td',empty);td.colSpan=6;tr.append(td);root.append(tr);return;}
 for(const values of rows)root.append(row(values));
}
function stat(label,value){
 const card=make('div');card.className='seat-card';
 card.append(make('div',label),make('strong',value));return card;
}
const date=ms=>Number.isFinite(ms)&&ms>0?new Date(ms).toLocaleString('en-GB'):'—';
const day=seconds=>Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toLocaleDateString('en-GB'):'—';
const appNames={limsman:'LabDuck',goflo:'CytoDuck',methpipe:'DuckPipe',
 eel:'DuckNote',duckman:'DuckMan',mantrain:'DuckTrain',dataduck:'DataDuck'};
const apps=ids=>Array.isArray(ids)?ids.map(id=>appNames[id]||id).join(', '):'—';
function renderUsers(){
 if(!latest)return;
 const filter=$('owner-filter').value.trim().toLowerCase();
 const summary=latest.summary;
 const identities=new Map(latest.identities.map(x=>[x.id,x]));
 const users=summary.memberships.map(m=>{
  const u=identities.get(m.accountId);
  return [u?.displayName||m.name,
   m.organizationName,m.admin?'Organization admin':'Member',
   (u?.state||'Unknown')+' · '+(m.active?'membership active':'membership inactive'),
   m.appRoles+' app(s)',u?.email||m.email];
 });
 const included=users.filter(r=>r.join(' ').toLowerCase().includes(filter));
 // Names and emails are rendered as text only; email belongs in the first column.
 fill('owner-users',included.map(r=>[r[0]+' · '+r[5],...r.slice(1,5)]),'No matching organization members');
}
function render(data){
 latest=data;
 const {summary,identities}=data;
 const stats=[
  ['Organizations',summary.totals.organizations],
  ['Central identities',identities.length],
  ['Active memberships',summary.totals.activeMemberships],
  ['Active verified subscriptions',summary.totals.activeVerifiedSubscriptions],
  ['Pending invitations',summary.totals.pendingInvitations],
  ['Unpaid subscription drafts',summary.totals.unpaidDrafts],
  ['Signed LIVE events (unassigned)',summary.totals.liveWebhookEvents]
 ];
 $('owner-stats').replaceChildren(...stats.map(([label,value])=>stat(label,value)));
 $('owner-snapshot-time').textContent='Snapshot: '+date(summary.snapshotAt);
 const alertCounts=summary.alerts?.counts||{};
 $('owner-notifications').textContent=data.ownerAlertsConfigured===true
  ?'Owner email alerts enabled · '+(alertCounts.pending||0)+' pending · '+
   (alertCounts.sending||0)+' in progress · '+(alertCounts.sent||0)+
   ' accepted by mail provider · '+(alertCounts.failed||0)+
   ' failed. Delivery to inbox is not guaranteed by provider acceptance.'
  :'Owner email alerts disabled. To enable, configure the private owner recipient, verified sender, Resend key and explicit server opt-in.';
 fill('owner-organizations',summary.organizations.map(x=>[
  x.name+' · '+x.id,x.activeMembers+' / '+x.memberships,x.admins,
  x.pendingInvitations,x.verifiedSubscriptions,x.unpaidDrafts]));
 renderUsers();
 fill('owner-subscriptions',summary.subscriptions.map(x=>[
  x.organizationName,x.plan+' · '+apps(x.apps),x.seats,x.state,
  x.revision,day(x.paidThrough)]));
 $('owner-capacity').replaceChildren(...summary.capacity.map(x=>stat(
  (appNames[x.appId]||x.appId)+' · assigned / purchased',x.assigned+' / '+x.purchased)));
 fill('owner-drafts',summary.testDrafts.map(x=>[
  x.organizationId,x.plan,apps(x.apps),x.seats,'Unpaid · '+x.state]));
 fill('owner-live-events',(summary.liveWebhookEvents||[]).map(x=>[
  x.type,date(x.occurredAt),date(x.receivedAt),'Not reconciled']));
 fill('owner-activity',summary.activity.map(x=>[
  date(x.at),x.organizationName,x.actorId,
  x.action+(x.mode==='test'?' · TEST':''),x.subject,
  x.revision===undefined?'—':'Revision '+x.revision+
    (x.deltas?.length?' · '+x.deltas.map(d=>(appNames[d.appId]||d.appId)+
      ' '+(d.delta>0?'+':'')+d.delta).join(', '):'')]));
 const truncated=Object.entries(summary.truncated).filter(([,value])=>value).map(([name])=>name);
 $('owner-truncation').textContent=truncated.length
  ?'Preview limits reached ('+truncated.join(', ')+'). This is a bounded operations snapshot.':'';
 $('owner-content').hidden=false;
 $('owner-status').textContent='Private owner access verified. Displaying read-only operations snapshot.';
}
async function refresh(){
 $('owner-status').textContent='Loading owner-only operations snapshot…';
 try{
  const response=await fetch('/api/suite/owner/overview',{credentials:'same-origin',
   cache:'no-store',redirect:'error'});
  if(response.status===401){$('owner-content').hidden=true;
   $('owner-status').textContent='Sign in to DuckBio Workspace, then return to /owner.';return;}
  if(response.status===403){$('owner-content').hidden=true;
   $('owner-status').textContent='Access denied. This page requires the designated central owner account.';return;}
  if(!response.ok)throw Error('Private owner data is unavailable.');
  const payload=await response.json();
  if(payload.ownerOnly!==true||!payload.summary)throw Error('Unexpected owner data.');
  render(payload);
 }catch(error){$('owner-content').hidden=true;$('owner-status').textContent=error.message;}
}
$('refresh').addEventListener('click',refresh);
$('owner-filter').addEventListener('input',renderUsers);
refresh();
