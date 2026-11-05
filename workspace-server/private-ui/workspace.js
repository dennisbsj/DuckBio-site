// Private same-origin Workspace UI. Server owns roles, license counts and identity.
const $=id=>document.getElementById(id);
const state={csrf:'',orgs:[],selected:null,overview:null,matrix:null,rolePolicies:null,busy:false,inviteToken:null,inviteDetails:null};
const errorMessage=(status)=>status===401?'Sign in again.':status===403?'Your role does not allow this action.':status===409?'There are not enough app licences, or the data changed. Reload the organization.':status===400?'Check the account, email and app roles.':'The private Workspace service is unavailable.';
function status(message){$('status').textContent=message;}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function button(text,fn){const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;}
// User/invite application dropdown is presentation-only: keep all role selects
// mounted so switching a filter never discards unsaved role assignments.
// Unreleased DataDuck is intentionally absent from overview.apps.
function appRolePicker(pickerId,fieldsId){
 const picker=$(pickerId),fields=$(fieldsId);
 picker.replaceChildren();
 const all=el('option','All current applications');all.value='';
 picker.append(all);
 for(const app of state.overview.apps){
  const option=el('option',app.name);option.value=app.id;picker.append(option);
 }
 picker.value='';
 picker.onchange=()=>{
  for(const card of fields.children)
   card.hidden=picker.value!==''&&card.dataset.appId!==picker.value;
 };
 picker.onchange();
}
async function request(route,data){
 const res=await fetch(route,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:data===undefined?undefined:JSON.stringify(data)});
 let body={};try{body=await res.json();}catch{}
 if(!res.ok)throw Object.assign(new Error(errorMessage(res.status)),{status:res.status});
 return body;
}
function showPortal(visible){$('portal').hidden=!visible;$('sign-in').hidden=visible;$('organization-choice').hidden=true;$('invite-accept-panel').hidden=true;$('logout').hidden=!visible;}
// Only an app-prefixed content ID can survive a login handoff. Never accept
// arbitrary URLs or user-controlled destination origins.
const continuationPattern=/^(?:ld|dm|dn|cd|md|dt)[0-9]{6,}$/;
async function resumeContentAfterLogin(){
 const entries=new URLSearchParams(location.search).getAll('content');
 if(entries.length!==1||!continuationPattern.test(entries[0]))return false;
 // Check the central session; the gateway then checks native permissions.
 await request('/api/suite/account');
 location.replace('/content/'+entries[0]);
 return true;
}
// Messaging continuations have a fixed view allowlist; this is not an
// arbitrary post-login redirect and never accepts an external URL.
const messageViews=new Set(['chat','mail','notifications']);
async function resumeMessagesAfterLogin(){
 const values=new URLSearchParams(location.search).getAll('messages');
 if(values.length!==1||!messageViews.has(values[0]))return false;
 await request('/api/suite/account');
 location.replace('/messages?view='+values[0]);
 return true;
}
async function csrf(){
 const response=await fetch('/api/suite/auth/session',{credentials:'same-origin',cache:'no-store'});
 const body=await response.json();
 state.csrf=body.csrfToken||'';
 if(!state.csrf)throw new Error('Session protection is unavailable.');
}
function renderSeats(){
 const root=$('seats');root.replaceChildren();
 const subscriptions=$('subscription-seats');subscriptions.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'seat-card');card.append(el('div',app.name),el('strong',app.assigned+' / '+app.purchased),el('small','Assigned / purchased · '+(app.reserved||0)+' pending reservations'));
  root.append(card);
  const copy=card.cloneNode(true);subscriptions.append(copy);
 }
 // Distinguish the seventh candidate from purchasable, role-assignable apps.
 // No dropdown/seat grant is shown until DataDuck's native SSO + licensing pass.
 for(const app of state.overview.upcomingApps||[]){
  const card=el('div',undefined,'seat-card');
  card.append(el('div',app.name),
   el('strong','Integration in progress'),
   el('small','Coming soon · no licenses or user access available yet'));
  root.append(card);
 }
}
function renderMembers(){
 const root=$('members');root.replaceChildren();
 for(const user of state.overview.users){
  const row=el('tr'),name=el('td'),roles=el('td'),controls=el('td');
  name.append(el('strong',user.name),el('small',user.email));
  roles.textContent=Object.entries(user.roles).map(([id,role])=>state.overview.apps.find(a=>a.id===id)?.name+' ('+role+')').join(', ')||'No access';
  controls.append(button('Edit permissions',()=>edit(user)));
  controls.append(button(user.active?'Deactivate':'Reactivate',()=>changeUserStatus(user)));
  controls.append(button('Remove',()=>removeUser(user)));
  row.append(name,el('td',user.nickname),el('td',user.admin?'Organization admin':'User'),el('td',user.active?'Active':'Deactivated'),roles,controls);root.append(row);
 }
}
function renderInvitations(invitations){
 const root=$('pending-invitations');root.replaceChildren();
 if(!invitations.length){const row=el('tr'),cell=el('td','No pending invitations.');cell.colSpan=5;row.append(cell);root.append(row);return;}
 for(const invite of invitations){
  const row=el('tr'),name=el('td'),controls=el('td');
  name.append(el('strong',invite.name),el('small',invite.email));
  controls.append(button('Revoke invitation',()=>revokeInvitation(invite)));
  const labels=Object.entries(invite.roles||{}).map(([id,role])=>state.overview.apps.find(a=>a.id===id)?.name+' ('+role+')');
  row.append(name,el('td',invite.admin?'Organization admin':'User'),el('td',labels.join(', ')||'No access'),el('td',new Date(invite.expiresAt).toLocaleDateString('en-GB')),controls);
  root.append(row);
 }
}
function renderInviteRoleFields(){
 const root=$('invite-role-fields');root.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'role-card'),label=el('label',app.name),select=el('select');
  card.dataset.appId=app.id;
  select.name=app.id;select.setAttribute('aria-label',app.name+' invitation role');
  const none=el('option','No access');none.value='';select.append(none);
  for(const role of app.roles){const option=el('option',role);option.value=role;select.append(option);}
  label.append(select);
  card.append(label,el('small',app.assigned+' assigned · '+(app.reserved||0)+' reserved · '+app.purchased+' purchased'));
  root.append(card);
 }
 appRolePicker('invite-app-picker','invite-role-fields');
}
function renderAudit(events){
 const root=$('audit-events');root.replaceChildren();
 for(const event of events){
  const action=event.action.split('.').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ');
  const actor=state.overview.users.find(u=>u.accountId===event.actorId)?.name||event.actorId;
  const subject=state.overview.users.find(u=>u.accountId===event.subject)?.name||event.subject;
  const row=el('tr');
  row.append(el('td',new Date(event.at).toLocaleString('en-GB')),el('td',actor),el('td',action),el('td',subject));
  root.append(row);
 }
 if(!events.length){const row=el('tr'),cell=el('td','No recorded changes yet.');cell.colSpan=4;row.append(cell);root.append(row);}
}
async function refreshAudit(){
 const data=await request('/api/suite/organization/audit',{organizationId:state.selected});
 renderAudit(data.events);
}
async function refreshInvitations(){
 const data=await request('/api/suite/organization/invite/list',{organizationId:state.selected});
 renderInvitations(data.invitations);
}
async function revokeInvitation(invite){
 if(!window.confirm('Revoke the invitation for '+invite.email+'? The activation link will stop working.'))return;
 try{
  const result=await request('/api/suite/organization/invite/revoke',{organizationId:state.selected,email:invite.email});
  await overview(state.selected);
  status(result.revoked?'Invitation revoked for '+invite.email+'.':'This invitation was already inactive.');
 }catch(e){status(e.message);}
}
async function changeUserStatus(user){
 const verb=user.active?'deactivate':'reactivate';
 if(!window.confirm('Do you want to '+verb+' '+user.name+' in this organization? Their other organization memberships are unaffected.'))return;
 try{
  await request('/api/suite/organization/user/active',{organizationId:state.selected,accountId:user.accountId,active:!user.active});
  await overview(state.selected);
  status(user.name+(user.active?' deactivated. Existing app seats remain reserved.':' reactivated.') );
 }catch(e){status(e.message);}
}
async function removeUser(user){
 if(!window.confirm('Remove '+user.name+' from '+state.overview.organization.name+'? This does not delete their DuckBio account or any other organization memberships.'))return;
 try{await request('/api/suite/organization/user/remove',{organizationId:state.selected,accountId:user.accountId});await overview(state.selected);status('Removed '+user.name+' from this organization.');}
 catch(e){status(e.message);}
}
function roleFields(user){
 const root=$('role-fields');root.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'role-card'),label=el('label',app.name),select=el('select');
  card.dataset.appId=app.id;
  select.name=app.id;select.setAttribute('aria-label',app.name+' role');
  const none=el('option','No access');none.value='';select.append(none);
  for(const role of app.roles){const option=el('option',role);option.value=role;select.append(option);}
  select.value=user?.roles?.[app.id]||'';label.append(select);
  card.append(label,el('small',app.assigned+' assigned / '+app.purchased+' purchased'));root.append(card);
 }
 appRolePicker('account-app-picker','role-fields');
}
function edit(user){
 $('buy-panel').hidden=true;$('invite-panel').hidden=true;$('edit-panel').hidden=false;
 $('edit-title').textContent=user?'Edit user permissions':'Create account access';
 $('account-id').readOnly=Boolean(user);
 for(const [id,value] of [['account-id',user?.accountId||''],['name',user?.name||''],['nickname',user?.nickname||''],['member-email',user?.email||'']])$(id).value=value;
 $('org-admin').checked=Boolean(user?.admin);
 roleFields(user);$('edit-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function overview(orgId){
 const view=await request('/api/suite/organization/overview',{organizationId:orgId});
 state.overview=view;$('organization-name').textContent=view.organization.name;
 renderSeats();renderMembers();await refreshInvitations();await refreshAudit();$('edit-panel').hidden=true;$('buy-panel').hidden=true;$('invite-panel').hidden=true;
 state.matrix=null;state.rolePolicies=null;
 status('Workspace data loaded from the private server.');
}
async function chooseOrganization(orgId){
 try {
  const chosen=await request('/api/suite/organization/select',{organizationId:orgId});
  if(!chosen.selectedOrganization?.id)throw new Error('Could not select this organization.');
  state.selected=chosen.selectedOrganization.id;
  $('organizations').replaceChildren();
  const option=el('option',chosen.selectedOrganization.name);option.value=chosen.selectedOrganization.id;
  $('organizations').append(option);
  $('organization-choice').hidden=true;$('invite-accept-panel').hidden=true;
  if(!chosen.selectedOrganization.admin){
   $('portal').hidden=true;$('sign-in').hidden=true;$('logout').hidden=false;
   status('Signed in. You do not have organization administrator rights.');return;
  }
  showPortal(true);await overview(state.selected);
 }catch(e){status(e.message);}
}
async function load(){
 await csrf();
 $('owner-control-link').hidden=true;
 try{
  const accountInfo=await request('/api/suite/account');
  $('owner-control-link').hidden=accountInfo.ownerPanel!==true;
  const data=await request('/api/suite/organizations');
  state.orgs=data.organizations||[];
  $('logout').hidden=false;
  $('sign-in').hidden=true;$('invite-accept-panel').hidden=true;
  $('portal').hidden=true;
  if(data.selectedOrganization){
   state.selected=data.selectedOrganization.id;
   $('organizations').replaceChildren();
   const option=el('option',data.selectedOrganization.name);option.value=data.selectedOrganization.id;
   $('organizations').append(option);
   if(data.selectedOrganization.admin){showPortal(true);await overview(state.selected);}
   else status('Signed in. You do not have organization administrator rights.');
   return;
  }
  if(!state.orgs.length){status('This account does not belong to an organization. Contact your administrator.');return;}
  if(state.orgs.length===1){await chooseOrganization(state.orgs[0].id);return;}
  const root=$('organization-options');root.replaceChildren();
  for(const org of state.orgs){
   const btn=button(org.name+(org.admin?' · Admin':''),()=>chooseOrganization(org.id));
   btn.className='role-card';root.append(btn);
  }
  $('organization-choice').hidden=false;
  status('Choose one organization for this login session.');
 }catch(e){if(e.status===401){showPortal(false);status('Sign in to your private DuckBio account.');}else{showPortal(false);status(e.message);}}
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;
 if(!form.reportValidity()||state.busy)return;state.busy=true;
 try{
  await csrf();
  await request('/api/suite/account/login',{email:$('email').value.trim(),password:$('password').value,rememberMe:$('remember-me').checked});
  $('password').value='';
  if(state.inviteToken){
   await request('/api/suite/organization/invite/accept',{token:state.inviteToken});
   state.inviteToken=null;state.inviteDetails=null;
   history.replaceState(null,'','/workspace');
  }
  if(await resumeContentAfterLogin())return;
  if(await resumeMessagesAfterLogin())return;
  await load();
 }catch(e){status(e.message);}finally{state.busy=false;}
});
$('logout').addEventListener('click',async()=>{try{await request('/api/suite/account/logout',{});state.overview=null;state.selected=null;$('owner-control-link').hidden=true;showPortal(false);status('Signed out. Sign in again to choose an organization.');}catch(e){status(e.message);}});
// Organization switching is intentionally not available during an authenticated session.
$('create').addEventListener('click',()=>edit(null));
$('cancel-edit').addEventListener('click',()=>{$('edit-panel').hidden=true;});
$('member-form').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!e.currentTarget.reportValidity())return;
 const roles={};for(const select of $('role-fields').querySelectorAll('select'))if(select.value)roles[select.name]=select.value;
 const member={accountId:$('account-id').value.trim(),name:$('name').value.trim(),nickname:$('nickname').value.trim(),email:$('member-email').value.trim(),admin:$('org-admin').checked,roles};
 state.busy=true;
 try{await request('/api/suite/organization/user/save',{organizationId:state.selected,member});await overview(state.selected);status('App permissions updated. Native app-account mapping remains separately controlled.');}
 catch(err){status(err.message);}finally{state.busy=false;}
});

function draftSelection(){
 const plan=$('draft-plan').value,seats=Number($('draft-seats').value);
 const apps=[...$('buy-fields').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.name);
 if(!Number.isSafeInteger(seats)||seats<1||seats>10000)return null;
 if((plan==='Single'&&apps.length!==1)||(plan==='Mixed'&&(apps.length<2||apps.length>5))||(plan==='Bundle'&&apps.length!==6))return null;
 return {organizationId:state.selected,plan,apps,seats};
}
function applyPlan(){
 const bundle=$('draft-plan').value==='Bundle';
 for(const input of $('buy-fields').querySelectorAll('input')){
  if(bundle)input.checked=true;
  input.disabled=bundle;
 }
}
$('draft-plan').addEventListener('change',applyPlan);
$('buy').addEventListener('click',()=>{
 showTab('subscriptions');$('edit-panel').hidden=true;$('buy-panel').hidden=false;
 $('draft-plan').value='Single';$('draft-seats').value='1';
 const root=$('buy-fields');root.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'role-card'),label=el('label',app.name),input=el('input');
  input.type='checkbox';input.name=app.id;input.checked=false;input.setAttribute('aria-label',app.name+' for subscription');
  label.className='inline';label.append(input);
  card.append(label,el('small',app.purchased+' purchased · '+app.assigned+' assigned'));root.append(card);
 }
 applyPlan();
 $('buy-summary').textContent='Only Stripe TEST Checkout can be prepared from saved drafts. Live payments and licence activation remain disabled.';
 $('buy-panel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('review-buy').addEventListener('click',()=>{
 const draft=draftSelection();
 if(!draft){$('buy-summary').textContent='Single requires 1 app, Mixed 2–5, Bundle all six; choose 1–10,000 users per app.';return;}
 $('buy-summary').textContent=draft.plan+' · '+draft.apps.map(id=>state.overview.apps.find(a=>a.id===id).name).join(', ')+' · '+draft.seats+' users/app. This is not a purchase.';
});
$('save-draft').addEventListener('click',async()=>{
 const draft=draftSelection();
 if(!draft){$('buy-summary').textContent='Select a valid plan, apps and number of users.';return;}
 try{
  await request('/api/suite/organization/subscription/draft',draft);
  $('buy-panel').hidden=true;await refreshSubscriptions();
  status('Subscription draft saved. No checkout, payment or licence assignment occurred.');
 }catch(e){$('buy-summary').textContent=e.message;}
});
$('cancel-buy').addEventListener('click',()=>{$('buy-panel').hidden=true;});
$('open-buy').addEventListener('click',()=>$('buy').click());
const testBillingStatusText=(observation)=>{
 if(!observation)return 'Stripe TEST status: not checked. No licences are granted.';
 const labels={checking:'Checking (possibly interrupted)',pending:'Payment not verified',
  paid_test_verified:'Paid TEST invoice observed',unavailable:'Stripe check unavailable',
  superseded:'Superseded by a newer check'};
 const reasons={checkout_not_completed:'Checkout not completed',payment_unpaid:'Payment unpaid',
  subscription_not_active:'Subscription not active',invoice_unavailable:'Invoice unavailable',
  invoice_not_paid:'Invoice not paid'};
 const label=labels[observation.state]||'Unknown status';
 const reason=Object.hasOwn(reasons,observation.reason)?' · '+reasons[observation.reason]:'';
 const last=Number.isFinite(observation.checkedAt)&&observation.checkedAt>0
  ?' · Last checked '+new Date(observation.checkedAt).toLocaleString('en-GB'):'';
 const lifecycle=observation.lifecycle;
 let detail='';
 if(lifecycle&&typeof lifecycle==='object'){
  const states={active:'Active',past_due:'Past due',unpaid:'Unpaid',
   canceled:'Canceled',paused:'Paused',trialing:'Trialing',
   incomplete:'Incomplete',incomplete_expired:'Incomplete expired'};
  const stateLabel=states[lifecycle.subscriptionStatus]||'Unknown';
  const kind=lifecycle.billingReason==='subscription_cycle'?' · Renewal invoice':
   lifecycle.billingReason==='subscription_create'?' · Initial invoice':'';
  const end=Number.isSafeInteger(lifecycle.periodEnd)&&lifecycle.periodEnd>0
   ?' · Period ends '+new Date(lifecycle.periodEnd*1000).toLocaleDateString('en-GB'):'';
  detail=' · Subscription: '+stateLabel+kind+
   (lifecycle.cancelAtPeriodEnd?' · Cancellation scheduled for period end':'')+end;
 }
 return 'Stripe TEST status: '+label+reason+detail+last+'. No licences are granted.';
};
async function refreshSubscriptions(){
 if(!state.selected)return;
 const result=await request('/api/suite/organization/subscriptions',{organizationId:state.selected});
 const simulation=$('test-seat-projection');
 simulation.replaceChildren();
 if(result.testReconciliationEnabled&&result.testSeatCapacity?.testOnly===true&&
    result.testSeatCapacity.licensesGranted===false){
  const projected=result.testSeatCapacity.apps.filter(x=>x.candidateTestSeats>0);
  const byApp=projected.map(x=>(state.overview.apps.find(a=>a.id===x.appId)?.name||x.appId)+
    ': '+x.candidateTestSeats+' TEST candidate seats');
  simulation.append(el('p',projected.length
   ?'Stripe TEST seat projection (not purchased or activated): '+byApp.join(' · ')+
    '. This is a simulation; no real seats or app access have changed.'
   :'Stripe TEST seat projection: no eligible candidate seats. Real purchased seats and permissions remain unchanged.'));
  const readiness=result.testEntitlementReadiness;
  if(readiness?.testOnly===true&&readiness.realSeatChanges===false&&readiness.licensesGranted===false){
   const blockers=readiness.apps.filter(a=>a.unboundCheckouts>0||a.reviewRequired>0);
   if(blockers.length){
    const warning=el('div',undefined,'test-entitlement-readiness');
    warning.append(el('strong','TEST subscription inventory requires manual review:'));
    const list=el('ul');
    for(const app of blockers)list.append(el('li',app.appName+': '+
     app.unboundCheckouts+' unverified Checkout(s) · '+
     app.reviewRequired+' billing status(es) requiring review. No access changes.'));
    warning.append(list);simulation.append(warning);
   }
  }
  const plan=result.testEntitlementPlan;
  if(plan?.testOnly===true&&plan.licensesGranted===false&&
     plan.realSeatChanges===false&&Array.isArray(plan.apps)){
   const evaluated=plan.apps.filter(a=>a.subscriptionCount>0||a.unboundCheckouts>0);
   if(evaluated.length){
    const preview=el('div',undefined,'test-entitlement-preview');
    preview.append(el('strong','Subscription-based TEST entitlement preview (no real seat changes):'));
    const descriptions={
     increase_candidate:'Possible increase, not activated',
     unchanged:'No simulated change',
     decrease_requires_review:'Downgrade requires manual review',
     assignment_conflict:'Assigned and reserved users exceed simulated seats',
     manual_review:'Billing status requires manual review'
    };
    const list=el('ul');
    for(const app of evaluated){
     const decision=Object.hasOwn(descriptions,app.status)?descriptions[app.status]:'Not evaluated';
     list.append(el('li',app.appName+': '+decision+' · '+app.candidateTestSeats+
      ' TEST candidates · '+app.livePurchased+' real purchased · '+
      app.assigned+' assigned, '+app.reserved+' reserved. No licences granted.'));
    }
    preview.append(list);
    simulation.append(preview);
   }
  }
  if(result.testSeatImpact?.testOnly===true&&result.testSeatImpact.licensesGranted===false&&
     result.testSeatImpact.realSeatChanges===false){
   const list=el('ul');
   for(const impact of result.testSeatImpact.apps){
    if(impact.status==='assignment_conflict')
     list.append(el('li',impact.appName+': manual action required — '+
      impact.assigned+' assigned and '+impact.reserved+' reserved, but only '+
      impact.candidateTestSeats+' candidate TEST seats ('+
      impact.hypotheticalShortfall+' hypothetical shortfall).'));
    else if(impact.status==='manual_review')
     list.append(el('li',impact.appName+': billing status requires manual review. '+
      impact.assigned+' assigned and '+impact.reserved+' reserved users remain unchanged.'));
   }
   if(list.childElementCount){
    simulation.append(el('strong','TEST transition review (no access will be removed):'),list);
   }
  }
 }
 const root=$('subscription-drafts');root.replaceChildren();
 if(!result.drafts.length){root.append(el('p','No subscription drafts.'));return;}
 for(const draft of result.drafts){
  const card=el('div',undefined,'role-card');
  const labels=draft.apps.map(id=>state.overview.apps.find(a=>a.id===id)?.name||id);
  card.append(el('strong',draft.plan+' · '+draft.seats+' users per app'),el('small',labels.join(', ')+' · '+draft.status));
  if(draft.status==='draft'){
   if(draft.checkoutState==='ready'&&draft.checkoutUrl){
    card.append(button('Open Stripe test checkout',()=>window.location.assign(draft.checkoutUrl)));
   }else if(result.testCheckoutEnabled){
    card.append(button(draft.checkoutState==='pending'?'Retry test checkout':'Start test checkout',async()=>{
     try{
      const checkout=await request('/api/suite/organization/subscription/test-checkout',{organizationId:state.selected,draftId:draft.id});
      if(checkout.mode!=='test'||checkout.licensesGranted!==false)throw new Error('Unexpected checkout state');
      await refreshSubscriptions();
      status('Stripe test Checkout prepared. No real payment or licence activation.');
     }catch(e){status(e.message);}
    }));
   }
   if(result.testReconciliationEnabled&&draft.checkoutState==='ready'){
    card.append(el('small',testBillingStatusText(draft.testReconciliation)));
    if(draft.testSeatProjection){
     const p=draft.testSeatProjection;
     const decisions={candidate_paid:'Eligible TEST seat candidate',payment_review:'Payment requires review',
      cancellation_review:'Cancellation requires review',awaiting_payment:'Awaiting payment',
      unavailable:'Test status unavailable'};
     const label=Object.hasOwn(decisions,p.decision)?decisions[p.decision]:'Unknown TEST state';
     card.append(el('small','TEST seat simulation: '+label+
      (p.decision==='candidate_paid'?' · '+p.seatsPerApp+' candidate seats per selected app':'')+
      '. No real user licences granted.'));
    }

    const check=button('Check Stripe TEST status',async()=>{
     check.disabled=true;
     check.textContent='Checking Stripe TEST status…';
     try{
      const value=await request('/api/suite/organization/subscription/test-reconcile',{
       organizationId:state.selected,draftId:draft.id});
      if(value.mode!=='test'||value.licensesGranted!==false||
         value.observation?.licensesGranted!==false)throw new Error('Unexpected test billing state');
      await refreshSubscriptions();
      status('Stripe TEST status recorded. No licences have been activated.');
     }catch(e){
      await refreshSubscriptions().catch(()=>{});
      status('Stripe TEST check: '+e.message+' No licences have been activated.');
     }
    });
    card.append(check);
    const historyPanel=el('div',undefined,'test-billing-history');
    historyPanel.hidden=true;
    const historyButton=button('View TEST history',async()=>{
     if(!historyPanel.hidden){
      historyPanel.hidden=true;
      historyButton.textContent='View TEST history';
      return;
     }
     historyButton.disabled=true;
     try{
      const response=await request('/api/suite/organization/subscription/test-history',{
       organizationId:state.selected,draftId:draft.id});
      if(response.mode!=='test'||response.licensesGranted!==false||
         !Array.isArray(response.history)||response.history.length>10||
         response.history.some(row=>row.licensesGranted!==false))
       throw new Error('Unexpected test billing history');
      const list=el('ol');
      if(!response.history.length)historyPanel.replaceChildren(el('small','No recorded TEST checks.'));
      else{
       for(const item of response.history){
        const when=Number.isFinite(item.checkedAt)&&item.checkedAt>0
         ?new Date(item.checkedAt).toLocaleString('en-GB'):'Not finished';
        const detail=item.lifecycle?.subscriptionStatus?' · '+item.lifecycle.subscriptionStatus:'';
        list.append(el('li','#'+item.attempt+' · '+item.state+detail+' · '+when));
       }
       historyPanel.replaceChildren(list);
      }
      historyPanel.hidden=false;
      historyButton.textContent='Hide TEST history';
     }catch(e){status(e.message);}
     finally{historyButton.disabled=false;}
    });
    card.append(historyButton,historyPanel);
   }
   if(!draft.checkoutState)card.append(button('Cancel draft',async()=>{
    if(!window.confirm('Cancel this draft? This does not change purchased subscriptions or licences.'))return;
    try{await request('/api/suite/organization/subscription/cancel',{organizationId:state.selected,draftId:draft.id});await refreshSubscriptions();}
    catch(e){status(e.message);}
   }));
  }
  root.append(card);
 }
}

function showTab(tab){
 for(const button of document.querySelectorAll('[data-tab]')){
  const active=button.dataset.tab===tab;
  button.classList.toggle('active',active);
  button.setAttribute('aria-selected',String(active));
 }
 for(const name of ['users','subscriptions','matrix','roles'])$('tab-'+name).hidden=name!==tab;
 if(tab==='roles')loadRolePolicies().catch(e=>{$('roles-status').textContent=e.message;});
 if(tab==='matrix')loadMatrix().catch(e=>{$('matrix-info').textContent=e.message;});
 if(tab==='subscriptions')refreshSubscriptions().catch(e=>status(e.message));
}
async function loadMatrix(){
 if(!state.selected)return;
 const result=await request('/api/suite/organization/matrix',{organizationId:state.selected});
 state.matrix=result;
 const list=$('matrix-app'),old=list.value;
 list.replaceChildren();
 const all=el('option','All apps');all.value='';list.append(all);
 for(const app of result.apps){const o=el('option',app.name);o.value=app.id;list.append(o);}
 list.value=old;renderMatrix();
}
function renderMatrix(){
 if(!state.matrix)return;
 const query=$('matrix-search').value.trim().toLowerCase(),selectedApp=$('matrix-app').value,sort=$('matrix-sort').value;
 const apps=state.matrix.apps.filter(app=>!selectedApp||selectedApp===app.id);
 const users=state.matrix.users.filter(user=>(user.name+' '+user.nickname+' '+user.email).toLowerCase().includes(query));
 const permissions=[...new Set(apps.flatMap(app=>app.permissions))].sort();
 const head=$('matrix-head'),body=$('matrix-body');head.replaceChildren();body.replaceChildren();
 const row=el('tr');
 for(const label of ['User','App','Role',...permissions])row.append(el('th',label));
 head.append(row);
 const entries=apps.flatMap(app=>users.map(user=>({app,user})));
 entries.sort((a,b)=>sort==='app' ? a.app.name.localeCompare(b.app.name)||a.user.name.localeCompare(b.user.name)
   : sort==='email' ? a.user.email.localeCompare(b.user.email)||a.app.name.localeCompare(b.app.name)
   : a.user.name.localeCompare(b.user.name)||a.app.name.localeCompare(b.app.name));
 for(const {app,user} of entries){
  const tr=el('tr');
  tr.append(el('td',user.name+' · '+user.email),el('td',app.name),el('td',user.roles[app.id]||'No access'));
  const permissionsByRole=app.rolePermissions[user.roles[app.id]]||[];
  const wildcard=permissionsByRole.includes('*'), overrides=user.overrides?.[app.id]||{};
  for(const permission of permissions){
   const td=el('td');
   if(user.roles[app.id]&&app.permissions.includes(permission)){
    const base=wildcard||permissionsByRole.includes(permission);
    const checkbox=el('input');checkbox.type='checkbox';checkbox.checked=Object.hasOwn(overrides,permission)?overrides[permission]:base;
    checkbox.setAttribute('aria-label',user.name+' '+app.name+' '+permission);
    checkbox.addEventListener('change',async()=>{
     checkbox.disabled=true;
     try{
      const enabled=checkbox.checked;
      await request('/api/suite/organization/permission/set',{organizationId:state.selected,accountId:user.accountId,appId:app.id,permission,enabled});
      // Re-read server state first; show an enduring confirmation for browser users and tests.
      await loadMatrix();
      $('matrix-info').textContent='Saved '+permission+' ('+(enabled?'enabled':'disabled')+') for '+user.name+' in '+app.name+'.';
     }catch(e){checkbox.checked=!checkbox.checked;checkbox.disabled=false;$('matrix-info').textContent=e.message;}
    });
    td.append(checkbox);
   }else td.textContent='—';
   tr.append(td);
  }
  body.append(tr);
 }
 $('matrix-info').textContent=entries.length+' user/app rows shown. Changes are stored in Workspace; native app enforcement is not connected.';
}

async function loadRolePolicies(preferredRole){
 if(!state.selected||!state.overview)return;
 const select=$('roles-app'),previous=select.value;
 select.replaceChildren();
 for(const app of state.overview.apps){
  const opt=el('option',app.name);opt.value=app.id;select.append(opt);
 }
 if(state.overview.apps.some(app=>app.id===previous))select.value=previous;
 const appId=select.value,org=state.selected;
 if(!appId)return;
 const response=await request('/api/suite/organization/roles/list',{organizationId:org,appId});
 if(org!==state.selected||appId!==select.value)return;
 state.rolePolicies=response;
 const roles=$('roles-role'),prior=preferredRole??roles.value;
 roles.replaceChildren();
 for(const row of response.roles){
  const opt=el('option',row.name+(row.custom?' (custom)':' (standard)'));
  opt.value=row.name;roles.append(opt);
 }
 const create=el('option','+ New custom role');create.value='__new__';roles.append(create);
 if(response.roles.some(row=>row.name===prior)||prior==='__new__')roles.value=prior;
 renderRolePolicy();
}
function renderRolePolicy(){
 if(!state.rolePolicies)return;
 const name=$('roles-role').value,newRole=name==='__new__';
 const record=state.rolePolicies.roles.find(row=>row.name===name);
 $('new-role-field').hidden=!newRole;
 $('roles-new-name').required=newRole;
 $('roles-delete').hidden=!record?.custom;
 const enabled=new Set(record?.permissions||[]);
 const container=$('roles-permissions');container.replaceChildren();
 for(const permission of state.rolePolicies.availablePermissions){
  const label=el('label',undefined,'role-card');
  const check=el('input');check.type='checkbox';check.value=permission;
  check.checked=enabled.has(permission);
  label.append(check,document.createTextNode(' '+permission));
  container.append(label);
 }
 $('roles-status').textContent=newRole
  ?'New roles start without any permissions.'
  :'Changes apply to all members assigned this role in this organization.';
}
$('roles-app').addEventListener('change',()=>{
 state.rolePolicies=null;
 loadRolePolicies().catch(e=>{$('roles-status').textContent=e.message;});
});
$('roles-role').addEventListener('change',renderRolePolicy);
$('role-policy-form').addEventListener('submit',async event=>{
 event.preventDefault();
 if(!state.selected||!state.rolePolicies)return;
 const appId=$('roles-app').value;
 const role=$('roles-role').value==='__new__'
  ?$('roles-new-name').value.trim():$('roles-role').value;
 const permissions=[...$('roles-permissions').querySelectorAll('input:checked')].map(x=>x.value);
 try{
  const saved=await request('/api/suite/organization/role/save',{
   organizationId:state.selected,appId,role,permissions
  });
  state.overview=await request('/api/suite/organization/overview',{organizationId:state.selected});
  renderSeats();renderMembers();await loadRolePolicies(saved.role.role);
  await refreshAudit();
  $('roles-status').textContent='Saved '+saved.role.role+
   '. Native backend permission enforcement is not connected yet.';
 }catch(e){$('roles-status').textContent=e.message;}
});
$('roles-delete').addEventListener('click',async()=>{
 if(!state.selected||!state.rolePolicies)return;
 const role=$('roles-role').value,appId=$('roles-app').value;
 if(!state.rolePolicies.roles.some(r=>r.name===role&&r.custom))return;
 if(!window.confirm('Delete '+role+'? Reassign users and pending invitations first.'))return;
 try{
  await request('/api/suite/organization/role/delete',{organizationId:state.selected,appId,role});
  state.overview=await request('/api/suite/organization/overview',{organizationId:state.selected});
  renderSeats();renderMembers();await loadRolePolicies();await refreshAudit();
  $('roles-status').textContent='Custom role deleted.';
 }catch(e){$('roles-status').textContent=e.message;}
});

document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
$('matrix-search').addEventListener('input',renderMatrix);
$('matrix-app').addEventListener('change',renderMatrix);
$('matrix-sort').addEventListener('change',renderMatrix);


$('invite').addEventListener('click',()=>{
 showTab('users');$('edit-panel').hidden=true;
 $('invite-panel').hidden=false;$('invite-result').hidden=true;
 $('invite-form').reset();renderInviteRoleFields();$('invite-panel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('close-invite').addEventListener('click',()=>{$('invite-panel').hidden=true;});
$('invite-form').addEventListener('submit',async event=>{
 event.preventDefault();
 if(state.busy||!event.currentTarget.reportValidity())return;
 state.busy=true;
 try{
  const roles={};
  for(const select of $('invite-role-fields').querySelectorAll('select'))if(select.value)roles[select.name]=select.value;
  const result=await request('/api/suite/organization/invite',{
   organizationId:state.selected,name:$('invite-name').value.trim(),nickname:$('invite-nickname').value.trim(),
   email:$('invite-email').value.trim(),admin:$('invite-admin').checked,roles});
  if(result.delivery==='email'){
   $('invitation-link').value='';$('invite-result').hidden=true;
  }else{
   $('invitation-link').value=result.invitationUrl||'';$('invite-result').hidden=false;
  }
  await refreshInvitations();
  state.overview=await request('/api/suite/organization/overview',{organizationId:state.selected});renderSeats();await refreshAudit();
  status(result.delivery==='email'?'Invitation accepted by the mail provider for delivery.':'Invitation created. Share its activation link securely.');
 }catch(e){status(e.message);}finally{state.busy=false;}
});
$('copy-invitation').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText($('invitation-link').value);status('Invitation link copied.');}
 catch{status('Copy the invitation link manually from the field.');}
});
$('invite-existing-login').addEventListener('click',()=>{
 showPortal(false);status('Sign in with the invited email address to join this organization.');
});
$('invite-accept-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!e.currentTarget.reportValidity()||state.busy||!state.inviteToken)return;
 state.busy=true;
 try{
  await csrf();
  await request('/api/suite/organization/invite/accept',{token:state.inviteToken,password:$('invite-password').value});
  state.inviteToken=null;state.inviteDetails=null;
  $('invite-password').value='';history.replaceState(null,'','/workspace');
  await load();status('Organization invitation accepted.');
 }catch(e){status(e.message);}finally{state.busy=false;}
});
async function start(){
 const token=new URLSearchParams(location.search).get('invite');
 if(!token){
  // Existing remembered sessions also resume without another login.
  if(new URLSearchParams(location.search).has('content')||
     new URLSearchParams(location.search).has('messages')){
   try{
    if(await resumeContentAfterLogin())return;
    if(await resumeMessagesAfterLogin())return;
   }catch(error){if(error.status!==401){status(error.message);return;}}
  }
  await load();return;
 }
 state.inviteToken=token;
 await csrf();
 try{
  const result=await request('/api/suite/organization/invite/preview?token='+encodeURIComponent(token));
  state.inviteDetails=result.invitation;
  $('invite-description').textContent='You are invited to join '+result.invitation.organizationName+'.';
  $('invite-email-display').value=result.invitation.email;
  $('sign-in').hidden=true;$('portal').hidden=true;$('organization-choice').hidden=true;
  $('invite-accept-panel').hidden=false;
  $('logout').hidden=true;
  status('Use a new password to activate, or sign in with your existing DuckBio account.');
 }catch(e){showPortal(false);status('This invitation is unavailable or expired.');}
}

start().catch(e=>status(e.message));
