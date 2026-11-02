// Private same-origin messaging UI. No SMTP, WebSocket or external service.
// Chat refreshes with bounded polling; all real permissions are server-side.
const $=id=>document.getElementById(id);
const state={csrf:null,self:null,contacts:[],directory:new Map(),selectedGroupMembers:new Set(),groupKind:'chat',group:null,peer:null,folder:'inbox',busy:false,tab:'chat'};
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
  state.group=null;
  state.peer={accountId:contact.accountId,displayName:contact.displayName,
   system:contact.system===true};
  $('chat-title').textContent=contact.displayName;
  $('chat-mentions').replaceChildren();
  $('send-chat').disabled=contact.system===true;
  showTab('chat');void refreshChat();
 });
}
function renderContacts(contacts){
 const root=$('organization-contacts');root.replaceChildren();
 state.contacts=contacts;
 for(const contact of contacts)state.directory.set(contact.accountId,contact);
 renderGroupChoices();
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
  for(const contact of result.results){state.directory.set(contact.accountId,contact);root.append(directoryItem(
   contact.displayName+' · '+contact.address,contact));}
  renderGroupChoices();
  status('Found '+result.results.length+' matching DuckBio contacts.');
 }catch(error){status(error.message);}
}
function insertMention(input,mention){
 const start=input.selectionStart,end=input.selectionEnd;
 const extra=(start>0&&!/\s/.test(input.value[start-1])?' ':'')+mention+' ';
 input.setRangeText(extra,start,end,'end');input.focus();
}
function mentionControls(rootId,inputId,members){
 const root=$(rootId);root.replaceChildren();
 for(const contact of members){
  if(contact.accountId===state.self?.accountId)continue;
  const label='Tag '+contact.displayName;
  root.append(button(label,()=>insertMention($(inputId),contact.mention)));
 }
}
function renderMessageText(target,value){
 const re=/@(?:ld|dm|dn|cd|md|dt)[0-9]{6,}\b|@u-[a-f0-9]{2,256}\b/g;
 let previous=0;
 for(const item of value.matchAll(re)){
  target.append(document.createTextNode(value.slice(previous,item.index)));
  const tag=node('code',item[0]);tag.className='comms-reference';tag.title=
   item[0].startsWith('@u-')?'Unique user mention':
   'Content ID · access must be confirmed in the owning app';
  target.append(tag);previous=item.index+item[0].length;
 }
 target.append(document.createTextNode(value.slice(previous)));
}
function renderGroupChoices(){
 const root=$('group-available'),chosen=$('group-selected');
 root.replaceChildren();chosen.replaceChildren();
 if(!state.self)return;
 for(const user of state.directory.values()){
  if(user.accountId===state.self.accountId||user.system)continue;
  const selected=state.selectedGroupMembers.has(user.accountId);
  (selected?chosen:root).append(button((selected?'Remove ':'Add ')+user.displayName,
   ()=>{if(selected)state.selectedGroupMembers.delete(user.accountId);
    else state.selectedGroupMembers.add(user.accountId);
    renderGroupChoices();}));
 }
 if(!state.selectedGroupMembers.size)chosen.append(node('p','No participants selected.'));
}
function newGroup(kind){
 state.groupKind=kind;state.selectedGroupMembers.clear();
 $('group-name').value='';$('group-create-panel').hidden=false;
 $('group-create-title').textContent='Create '+(kind==='chat'?'group chat':'group mail');
 renderGroupChoices();$('group-create-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function refreshMentions(){
 const result=await request('/api/suite/communications/mentions');
 const root=$('mentions-list');root.replaceChildren();
 if(!result.mentions.length){root.append(node('p','No mentions yet.'));return;}
 for(const m of result.mentions){
  const label=(m.readAt?'':'● ')+m.sender.displayName+' tagged you in '+
   ({chat:'chat',mail:'internal mail',group_chat:'group chat',
     group_mail:'group mail'}[m.source]||'a message')+
   ' · '+stamp(m.createdAt);
  root.append(button(label,async()=>{
   try{
    await request('/api/suite/communications/mention/read',{notificationId:m.id});
    await refreshMentions();
    if(m.groupId){
     const groups=await request('/api/suite/communications/groups');
     const group=groups.groups.find(x=>x.id===m.groupId);
     if(group)await openGroup(group);
     else status('That private group is no longer available.');
    }else if(m.source==='chat'){
     state.group=null;
     state.peer={accountId:m.senderId,displayName:m.sender.displayName};
     $('chat-title').textContent=m.sender.displayName;
     $('chat-mentions').replaceChildren();
     $('send-chat').disabled=false;
     showTab('chat');await refreshChat();
    }else{
     showTab('mail');state.folder='inbox';
     $('mail-group-panel').hidden=true;
     await refreshMail();status('Open your internal mail inbox to read the mention.');
    }
   }catch(error){status(error.message);}
  }));
 }
}
async function refreshGroups(){
 const data=await request('/api/suite/communications/groups');
 for(const kind of ['chat','mail']){
  const root=$(kind==='chat'?'chat-groups':'mail-groups');root.replaceChildren();
  const selected=data.groups.filter(g=>g.kind===kind);
  if(!selected.length)root.append(node('p','No group '+(kind==='chat'?'chats':'mail')+' yet.'));
  for(const group of selected)root.append(button(
   group.title+' · '+group.memberCount+' people',()=>void openGroup(group)));
 }
}
async function openGroup(group){
 state.group=group;state.peer=null;
 if(group.kind==='chat'){
  showTab('chat');$('chat-title').textContent=group.title;
  $('send-chat').disabled=false;
 }else{
  showTab('mail');$('mail-form').hidden=true;$('mail-detail').hidden=true;
  $('mail-group-panel').hidden=false;$('mail-group-title').textContent=group.title;
 }
 const {members}=await request('/api/suite/communications/group/members',{groupId:group.id});
 if(state.group?.id!==group.id)return;
 mentionControls(group.kind==='chat'?'chat-mentions':'mail-group-mentions',
  group.kind==='chat'?'chat-body':'mail-group-body',members);
 await refreshGroupHistory();
}
async function refreshGroupHistory(){
 const group=state.group;if(!group)return;
 const response=await request('/api/suite/communications/group/history',{groupId:group.id});
 if(state.group?.id!==group.id)return;
 const root=$(group.kind==='chat'?'chat-history':'mail-group-history');root.replaceChildren();
 for(const m of response.messages){
  const bubble=node('div');bubble.className='comms-bubble'+
    (m.senderId===state.self.accountId?' comms-mine':'');
  const sender=state.directory.get(m.senderId)?.displayName||
    (m.senderId===state.self.accountId?'You':m.senderId);
  bubble.append(node('small',sender+(m.subject?' · '+m.subject:'')));
  const body=node('div');renderMessageText(body,m.body);bubble.append(body);
  bubble.append(node('small',stamp(m.createdAt)));root.append(bubble);
 }
 root.scrollTop=root.scrollHeight;
 const last=response.messages.filter(m=>m.senderId!==state.self.accountId&&!m.readAt).at(-1);
 if(last)void request('/api/suite/communications/group/read',
   {groupId:group.id,messageId:last.id}).catch(()=>{});
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
 if(state.group?.kind==='chat'){await refreshGroupHistory();return;}
 if(!state.peer)return;
 const peerId=state.peer.accountId;
 const [history]=await Promise.all([
  request('/api/suite/communications/chat/history',{peerId}),
  request('/api/suite/communications/chat/read',{peerId})
 ]);
 if(!state.peer||state.peer.accountId!==peerId)return;
 const root=$('chat-history');root.replaceChildren();
 for(const m of history.messages){
  const x=node('div');renderMessageText(x,m.body);
  x.className='comms-bubble'+(m.senderId===state.self.accountId?' comms-mine':'');
  x.append(node('small',stamp(m.createdAt)));
  root.append(x);
 }
 root.scrollTop=root.scrollHeight;
}
async function sendChat(event){
 event.preventDefault();
 if(state.busy||(!state.peer&&!state.group)||state.peer?.system)return;
 const body=$('chat-body').value.trim();
 if(!body)return;
 state.busy=true;
 try{
  if(state.group?.kind==='chat')await request('/api/suite/communications/group/send',{
   groupId:state.group.id,body,clientId:crypto.randomUUID()});
  else await request('/api/suite/communications/chat/send',{
   recipientId:state.peer.accountId,body,clientId:crypto.randomUUID()});
  $('chat-body').value='';
  await refreshChat();await refreshThreads();await refreshGroups();
  status('Message sent within DuckBio.');
 }catch(error){status(error.message);}finally{state.busy=false;}
}
function compose(address=''){
 showTab('mail');
 state.group=null;$('mail-group-panel').hidden=true;
 $('mail-detail').hidden=true;$('mail-form').hidden=false;
 $('mail-form').reset();$('mail-to').value=address;
 $('mail-to').focus();
}
function renderMail(message){
 state.group=null;$('mail-group-panel').hidden=true;
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
 await refreshThreads();await refreshMail();await refreshGroups();await refreshMentions();
 status('Signed in. Chat messages refresh automatically while this page is open.');
}
$('tab-chat').addEventListener('click',()=>showTab('chat'));
$('tab-mail').addEventListener('click',()=>showTab('mail'));
$('search-users').addEventListener('click',search);
$('contact-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
$('chat-form').addEventListener('submit',sendChat);
$('mail-form').addEventListener('submit',sendMail);
$('new-group-chat').addEventListener('click',()=>newGroup('chat'));
$('new-group-mail').addEventListener('click',()=>newGroup('mail'));
$('group-create-cancel').addEventListener('click',()=>{
 $('group-create-panel').hidden=true;state.selectedGroupMembers.clear();
});
$('group-create-form').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!e.currentTarget.reportValidity())return;
 const memberIds=[...state.selectedGroupMembers];
 if(memberIds.length<2){status('Select at least two other group participants.');return;}
 state.busy=true;
 try{
  const response=await request('/api/suite/communications/group/create',{
   title:$('group-name').value.trim(),memberIds,kind:state.groupKind,
   clientId:crypto.randomUUID()});
  $('group-create-panel').hidden=true;
  await refreshGroups();await openGroup(response.group);
  status('Private group created.');
 }catch(error){status(error.message);}finally{state.busy=false;}
});
$('mail-group-form').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||state.group?.kind!=='mail')return;
 const subject=$('mail-group-subject').value.trim(),body=$('mail-group-body').value.trim();
 if(!subject||!body)return;
 state.busy=true;
 try{
  await request('/api/suite/communications/group/send',{
   groupId:state.group.id,subject,body,clientId:crypto.randomUUID()});
  $('mail-group-subject').value='';$('mail-group-body').value='';
  await refreshGroupHistory();status('Internal group mail delivered.');
 }catch(error){status(error.message);}finally{state.busy=false;}
});
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
 try{await refreshMentions();}catch{}
 try{
  if(state.tab==='chat'){
   await refreshThreads();await refreshGroups();
   if(state.peer||state.group?.kind==='chat')await refreshChat();
  }else{
   await refreshMail();await refreshGroups();
   if(state.group?.kind==='mail')await refreshGroupHistory();
  }
 }catch{/* Preserve existing messages through temporary network loss. */}
},5000);
start().catch(error=>{status(error.message);$('comms-app').hidden=true;});
