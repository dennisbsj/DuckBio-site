// Private same-origin Workspace UI. Server owns roles, license counts and identity.
const $=id=>document.getElementById(id);
const state={csrf:'',orgs:[],selected:null,overview:null,matrix:null,busy:false,inviteToken:null,inviteDetails:null};
const errorMessage=(status)=>status===401?'Sign in again.':status===403?'Your role does not allow this action.':status===409?'There are not enough app licences, or the data changed. Reload the organization.':status===400?'Check the account, email and app roles.':'The private Workspace service is unavailable.';
function status(message){$('status').textContent=message;}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function button(text,fn){const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b;}
async function request(route,data){
 const res=await fetch(route,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:data===undefined?undefined:JSON.stringify(data)});
 let body={};try{body=await res.json();}catch{}
 if(!res.ok)throw Object.assign(new Error(errorMessage(res.status)),{status:res.status});
 return body;
}
function showPortal(visible){$('portal').hidden=!visible;$('sign-in').hidden=visible;$('organization-choice').hidden=true;$('invite-accept-panel').hidden=true;$('logout').hidden=!visible;}
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
  const card=el('div',undefined,'seat-card');card.append(el('div',app.name),el('strong',app.assigned+' / '+app.purchased),el('small','Assigned / purchased'));
  root.append(card);
  const copy=card.cloneNode(true);subscriptions.append(copy);
 }
}
function renderMembers(){
 const root=$('members');root.replaceChildren();
 for(const user of state.overview.users){
  const row=el('tr'),name=el('td'),roles=el('td'),controls=el('td');
  name.append(el('strong',user.name),el('small',user.email));
  roles.textContent=Object.entries(user.roles).map(([id,role])=>state.overview.apps.find(a=>a.id===id)?.name+' ('+role+')').join(', ')||'No access';
  controls.append(button('Edit permissions',()=>edit(user)));
  controls.append(button('Remove',()=>removeUser(user)));
  row.append(name,el('td',user.nickname),el('td',user.admin?'Organization admin':'User'),roles,controls);root.append(row);
 }
}
function renderInvitations(invitations){
 const root=$('pending-invitations');root.replaceChildren();
 if(!invitations.length){const row=el('tr'),cell=el('td','No pending invitations.');cell.colSpan=4;row.append(cell);root.append(row);return;}
 for(const invite of invitations){
  const row=el('tr'),name=el('td'),controls=el('td');
  name.append(el('strong',invite.name),el('small',invite.email));
  controls.append(button('Revoke invitation',()=>revokeInvitation(invite)));
  row.append(name,el('td',invite.admin?'Organization admin':'User'),el('td',new Date(invite.expiresAt).toLocaleDateString('en-GB')),controls);
  root.append(row);
 }
}
async function refreshInvitations(){
 const data=await request('/api/suite/organization/invite/list',{organizationId:state.selected});
 renderInvitations(data.invitations);
}
async function revokeInvitation(invite){
 if(!window.confirm('Revoke the invitation for '+invite.email+'? The activation link will stop working.'))return;
 try{
  const result=await request('/api/suite/organization/invite/revoke',{organizationId:state.selected,email:invite.email});
  await refreshInvitations();
  status(result.revoked?'Invitation revoked for '+invite.email+'.':'This invitation was already inactive.');
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
  select.name=app.id;select.setAttribute('aria-label',app.name+' role');
  const none=el('option','No access');none.value='';select.append(none);
  for(const role of app.roles){const option=el('option',role);option.value=role;select.append(option);}
  select.value=user?.roles?.[app.id]||'';label.append(select);
  card.append(label,el('small',app.assigned+' assigned / '+app.purchased+' purchased'));root.append(card);
 }
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
 renderSeats();renderMembers();await refreshInvitations();$('edit-panel').hidden=true;$('buy-panel').hidden=true;$('invite-panel').hidden=true;
 state.matrix=null;
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
 try{
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
  await request('/api/suite/account/login',{email:$('email').value.trim(),password:$('password').value});
  $('password').value='';
  if(state.inviteToken){
   await request('/api/suite/organization/invite/accept',{token:state.inviteToken});
   state.inviteToken=null;state.inviteDetails=null;
   history.replaceState(null,'','/workspace');
  }
  await load();
 }catch(e){status(e.message);}finally{state.busy=false;}
});
$('logout').addEventListener('click',async()=>{try{await request('/api/suite/account/logout',{});state.overview=null;state.selected=null;showPortal(false);status('Signed out. Sign in again to choose an organization.');}catch(e){status(e.message);}});
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
 $('buy-summary').textContent='No real payment or licence change is possible yet.';
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
async function refreshSubscriptions(){
 if(!state.selected)return;
 const result=await request('/api/suite/organization/subscriptions',{organizationId:state.selected});
 const root=$('subscription-drafts');root.replaceChildren();
 if(!result.drafts.length){root.append(el('p','No subscription drafts.'));return;}
 for(const draft of result.drafts){
  const card=el('div',undefined,'role-card');
  const labels=draft.apps.map(id=>state.overview.apps.find(a=>a.id===id)?.name||id);
  card.append(el('strong',draft.plan+' · '+draft.seats+' users per app'),el('small',labels.join(', ')+' · '+draft.status));
  if(draft.status==='draft'){
   card.append(button('Cancel draft',async()=>{
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
 for(const name of ['users','subscriptions','matrix'])$('tab-'+name).hidden=name!==tab;
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
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>showTab(btn.dataset.tab)));
$('matrix-search').addEventListener('input',renderMatrix);
$('matrix-app').addEventListener('change',renderMatrix);
$('matrix-sort').addEventListener('change',renderMatrix);


$('invite').addEventListener('click',()=>{
 showTab('users');$('edit-panel').hidden=true;
 $('invite-panel').hidden=false;$('invite-result').hidden=true;
 $('invite-form').reset();$('invite-panel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('close-invite').addEventListener('click',()=>{$('invite-panel').hidden=true;});
$('invite-form').addEventListener('submit',async event=>{
 event.preventDefault();
 if(state.busy||!event.currentTarget.reportValidity())return;
 state.busy=true;
 try{
  const result=await request('/api/suite/organization/invite',{
   organizationId:state.selected,name:$('invite-name').value.trim(),nickname:$('invite-nickname').value.trim(),
   email:$('invite-email').value.trim(),admin:$('invite-admin').checked});
  $('invitation-link').value=result.invitationUrl;
  $('invite-result').hidden=false;await refreshInvitations();status('Invitation created. Share the link securely with the invited person.');
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
 if(!token){await load();return;}
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
