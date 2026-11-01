// Private same-origin Workspace UI. Server owns roles, license counts and identity.
const $=id=>document.getElementById(id);
const state={csrf:'',orgs:[],selected:null,overview:null,busy:false};
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
function showPortal(visible){$('portal').hidden=!visible;$('sign-in').hidden=visible;$('organization-choice').hidden=true;$('logout').hidden=!visible;}
async function csrf(){
 const response=await fetch('/api/suite/auth/session',{credentials:'same-origin',cache:'no-store'});
 const body=await response.json();
 state.csrf=body.csrfToken||'';
 if(!state.csrf)throw new Error('Session protection is unavailable.');
}
function renderSeats(){
 const root=$('seats');root.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'seat-card');card.append(el('div',app.name),el('strong',app.assigned+' / '+app.purchased),el('small','Assigned / purchased'));
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
  row.append(name,el('td',user.nickname),el('td',user.admin?'Organization admin':'User'),roles,controls);root.append(row);
 }
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
 $('buy-panel').hidden=true;$('edit-panel').hidden=false;
 $('edit-title').textContent=user?'Edit user permissions':'Create account access';
 $('account-id').readOnly=Boolean(user);
 for(const [id,value] of [['account-id',user?.accountId||''],['name',user?.name||''],['nickname',user?.nickname||''],['member-email',user?.email||'']])$(id).value=value;
 $('org-admin').checked=Boolean(user?.admin);
 roleFields(user);$('edit-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function overview(orgId){
 const view=await request('/api/suite/organization/overview',{organizationId:orgId});
 state.overview=view;$('organization-name').textContent=view.organization.name;
 renderSeats();renderMembers();$('edit-panel').hidden=true;$('buy-panel').hidden=true;
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
  $('organization-choice').hidden=true;
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
  $('sign-in').hidden=true;
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
  $('password').value='';await load();
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
$('buy').addEventListener('click',()=>{
 $('edit-panel').hidden=true;$('buy-panel').hidden=false;
 const root=$('buy-fields');root.replaceChildren();
 for(const app of state.overview.apps){
  const card=el('div',undefined,'role-card'),label=el('label',app.name),input=el('input');
  input.type='number';input.name=app.id;input.min='0';input.max='1000';input.step='1';input.value='0';
  label.append(input);card.append(label,el('small',app.purchased+' purchased'));root.append(card);
 }
 $('buy-summary').textContent='No real payment or licence change is possible yet.';
 $('buy-panel').scrollIntoView({behavior:'smooth',block:'start'});
});
$('review-buy').addEventListener('click',()=>{
 const rows=[...$('buy-fields').querySelectorAll('input')];
 if(rows.some(i=>!i.checkValidity())){$('buy-summary').textContent='Select whole numbers between 0 and 1000.';return;}
 const selected=rows.filter(i=>Number(i.value)>0).map(i=>state.overview.apps.find(a=>a.id===i.name).name+': +'+i.value);
 $('buy-summary').textContent=selected.length?'Selection: '+selected.join(' · ')+'. Checkout is not connected; no licences were purchased.':'Choose at least one app.';
});
$('cancel-buy').addEventListener('click',()=>{$('buy-panel').hidden=true;});
load().catch(e=>status(e.message));
