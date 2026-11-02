// Same-origin private Workspace communication launchers.
// Cross-origin native apps must use a separately authenticated integration;
// never copy session cookies or credentials to client-side embedded widgets.
const top=document.querySelector('header.top');
const icons={chat:'messages-square',mail:'mail',notifications:'bell'};
const buttons={};
if(top){
 const bar=document.createElement('nav');
 bar.className='duckbio-message-launchers';bar.hidden=true;
 bar.setAttribute('aria-label','DuckBio communications');
 for(const kind of ['chat','mail','notifications']){
  const btn=document.createElement('button');
  btn.type='button';btn.className='duckbio-message-launcher';
  btn.setAttribute('aria-label',kind==='chat'?'Open instant messages':
   kind==='mail'?'Open mailbox window':'Open notifications');
  btn.title=btn.getAttribute('aria-label');
  const symbol=document.createElement('span');symbol.className='duckbio-message-symbol';
  symbol.textContent=kind==='chat'?'💬':kind==='mail'?'✉':'🔔';
  symbol.setAttribute('aria-hidden','true');
  const count=document.createElement('span');count.className='duckbio-unread-count';
  count.hidden=true;count.setAttribute('aria-hidden','true');
  btn.append(symbol,count);
  btn.addEventListener('click',()=>{
   const target='/messages?view='+encodeURIComponent(kind);
   window.open(target,'duckbio-'+kind,'popup,width=850,height=720,noopener,noreferrer');
  });
  bar.append(btn);buttons[kind]=count;
 }
 top.append(bar);
 let working=false;
 async function refresh(){
  if(working||document.hidden)return;
  working=true;
  try{
   const res=await fetch('/api/suite/communications/unread',{
    credentials:'same-origin',cache:'no-store',redirect:'error'});
   if(!res.ok){bar.hidden=true;return;}
   const result=await res.json(),counts=result.counts;
   if(!counts||Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0))
    throw Error('invalid unread counts');
   for(const kind of Object.keys(buttons)){
    const badge=buttons[kind],value=counts[kind]||0;
    badge.textContent=value>99?'99+':String(value);
    badge.hidden=value===0;
    badge.parentElement.setAttribute('aria-label',(kind==='chat'?'Open instant messages':
      kind==='mail'?'Open mailbox window':'Open notifications')+
      (value>0?' ('+value+' unread)':''));
   }
   bar.hidden=false;
  }catch{bar.hidden=true;}
  finally{working=false;}
 }
 void refresh();
 const handle=setInterval(()=>void refresh(),7000);
 window.addEventListener('pagehide',()=>clearInterval(handle),{once:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
}
