// Private same-origin messaging UI. No SMTP, WebSocket or external service.
// Chat refreshes with bounded polling; all real permissions are server-side.
const $=id=>document.getElementById(id);
const state={csrf:null,self:null,contacts:[],peer:null,folder:'inbox',busy:false,tab:'chat'};
const node=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);return x;};
const status=text=>{$('comms-status').textContent=text;};
function button(label,action){
 const x=node('button',label);x.type='button';x.addEventListener('click',action);return x;
}
async function request(route,body){
 const res=await fetch(route,{method:body===undefined?'GET':'POST',
  cache:'no-store',credentials:'same-origin',redirect:'error',
  headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},
  body:body===undefined?undefined:JSON.stringify(body)});
 let result={};try{result=await res.json();}catch{}
 if(!res.ok)throw Error(res.status===401?'Please sign in through Workspace.':
  res.status===403?'Access denied for this account.':
  res.status===409?'Message conflict or rate limit; review your message.':
  'The message could not be processed ('+res.status+').');
 return result;
}
const stamp=ms=>new Date(ms).toLocaleString('en-GB');
function showTab(tab){
 state.tab=tab;
 $('chat-view').hidden=tab!=='chat';
 $('mail-view').hidden=tab!=='mail';
 for(const v of ['chat','mail']){
  $('tab-'+v).classList.toggle('active',v===tab);
  $('tab-'+v).setAttribute('aria-selected',String(v===tab));
 }
}
function directoryItem(label,contact){
 return button(label,()=>{
  state.peer={accountId:contact.accountId,displayName:contact.displayName,
   system:contact.system===true};
  $('chat-title').textContent=contact.displayName;
  $('send-chat').disabled=contact.system===true;
  showTab('chat');void refreshChat();
 });
}
function renderContacts(contacts){
 const root=$('organization-contacts');root.replaceChildren();
 state.contacts=contacts;
 if(!contacts.length)root.append(node('p','No other organization contacts yet.'));
 for(const row of contacts)root.append(directoryItem(
  row.displayName+' · '+row.organizationName,row));
}
async function search(){
 const query=$('contact-search').value.trim();
 if(query.length<2){status('Enter at least two characters to search.');return;}
 try{
  const result=await request('/api/suite/communications/search',{query});
  const root=$('search-results');root.replaceChildren();
  if(!result.results.length)root.append(node('p','No users found.'));
  for(const contact of result.results)root.append(directoryItem(
   contact.displayName+' · '+contact.address,contact));
  status('Found '+result.results.length+' matching DuckBio contacts.');
 }catch(error){status(error.message);}
}
async function refreshThreads(){
 const result=await request('/api/suite/communications/threads');
 const root=$('chat-threads');root.replaceChildren();
 for(const t of result.threads){
  const contact=t.peer;
  root.append(directoryItem(contact.displayName+(t.unread?' · '+t.unread+' unread':''),contact));
 }
 if(!result.threads.length)root.append(node('p','No conversations yet.'));
}
async function refreshChat(){
 if(!state.peer)return;
 const peerId=state.peer.accountId;
 const [history]=await Promise.all([
  request('/api/suite/communications/chat/history',{peerId}),
  request('/api/suite/communications/chat/read',{peerId})
 ]);
 if(!state.peer||state.peer.accountId!==peerId)return;
 const root=$('chat-history');root.replaceChildren();
 for(const m of history.messages){
  const x=node('div',m.body);
  x.className='comms-bubble'+(m.senderId===state.self.accountId?' comms-mine':'');
  x.append(node('small',stamp(m.createdAt)));
  root.append(x);
 }
 root.scrollTop=root.scrollHeight;
}
async function sendChat(event){
 event.preventDefault();
 if(state.busy||!state.peer||state.peer.system)return;
 const body=$('chat-body').value.trim();
 if(!body)return;
 state.busy=true;
 try{
  await request('/api/suite/communications/chat/send',{
   recipientId:state.peer.accountId,body,clientId:crypto.randomUUID()});
  $('chat-body').value='';
  await refreshChat();await refreshThreads();
  status('Message sent within DuckBio.');
 }catch(error){status(error.message);}finally{state.busy=false;}
}
function compose(address=''){
 showTab('mail');
 $('mail-detail').hidden=true;$('mail-form').hidden=false;
 $('mail-form').reset();$('mail-to').value=address;
 $('mail-to').focus();
}
function renderMail(message){
 const root=$('mail-detail');root.replaceChildren();
 const card=node('div');card.className='comms-mail-card';
 card.append(node('h2',message.subject),node('p','From: '+message.from),
  node('p','To: '+message.to),node('p','Sent: '+stamp(message.createdAt)),
  node('p',message.body));
 root.append(card);
 $('mail-form').hidden=true;root.hidden=false;
 if(state.folder==='inbox'&&!message.readAt)
  void request('/api/suite/communications/mail/read',{id:message.id})
   .catch(error=>status(error.message));
}
async function refreshMail(){
 const result=await request('/api/suite/communications/mail/'+state.folder);
 const root=$('mail-list');root.replaceChildren();
 for(const m of result.messages){
  root.append(button((m.readAt||state.folder==='sent'?'':'● ')+
   m.subject+' · '+(state.folder==='inbox'?m.from:m.to),
   ()=>renderMail(m)));
 }
 if(!result.messages.length)root.append(node('p','No messages in '+state.folder+'.'));
}
async function sendMail(event){
 event.preventDefault();
 if(state.busy)return;
 const to=$('mail-to').value.trim().toLowerCase();
 const subject=$('mail-subject').value.trim();
 const body=$('mail-body').value.trim();
 if(!to||!subject||!body)return;
 state.busy=true;
 try{
  await request('/api/suite/communications/mail/send',{
   to,subject,body,clientId:crypto.randomUUID()});
  state.folder='sent';$('mail-form').hidden=true;
  $('mail-detail').hidden=false;
  await refreshMail();status('Internal mail sent. No external email was used.');
 }catch(error){status(error.message);}finally{state.busy=false;}
}
async function start(){
 const session=await fetch('/api/suite/auth/session',{credentials:'same-origin',cache:'no-store'});
 if(!session.ok)throw Error('Workspace session is unavailable.');
 state.csrf=(await session.json()).csrfToken;
 const info=await request('/api/suite/communications/self');
 const user=await request('/api/suite/account');
 if(!user.user?.id||!info.address)throw Error('An active Workspace account is required.');
 state.self={accountId:user.user.id,...info};
 $('my-address').textContent=info.address;
 $('owner-addresses').hidden=!info.owner;
 $('owner-link').hidden=!info.owner;
 $('mail-support-button').hidden=info.owner;
 $('comms-app').hidden=false;
 const data=await request('/api/suite/communications/contacts');
 renderContacts(data.contacts);
 await refreshThreads();await refreshMail();
 status('Signed in. Chat messages refresh automatically while this page is open.');
}
$('tab-chat').addEventListener('click',()=>showTab('chat'));
$('tab-mail').addEventListener('click',()=>showTab('mail'));
$('search-users').addEventListener('click',search);
$('contact-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
$('chat-form').addEventListener('submit',sendChat);
$('mail-form').addEventListener('submit',sendMail);
$('new-mail-button').addEventListener('click',()=>compose());
$('mail-support-button').addEventListener('click',()=>compose('support@duckbio.internal'));
$('mail-cancel').addEventListener('click',()=>{
 $('mail-form').hidden=true;$('mail-detail').hidden=false;
});
for(const [id,folder] of [['mail-inbox-button','inbox'],['mail-sent-button','sent']]){
 $(id).addEventListener('click',async()=>{
  state.folder=folder;await refreshMail();
  $('mail-form').hidden=true;$('mail-detail').hidden=false;
 });
}
setInterval(async()=>{
 if(!state.self||document.hidden||state.busy)return;
 try{
  if(state.tab==='chat'){
   await refreshThreads();
   if(state.peer)await refreshChat();
  }else await refreshMail();
 }catch{/* Preserve existing messages through temporary network loss. */}
},5000);
start().catch(error=>{status(error.message);$('comms-app').hidden=true;});
