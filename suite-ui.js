(function(){
'use strict';
const VERSION='2026-10-24.1';
const THEME_KEY='cc-suite-theme';
const HEADER_ORDER=['notifications','theme','settings','account','signOut'];
const MENU_ORDER=['profile','password','settings','signOut'];
const labels={profile:'Profile',password:'Change password',settings:'Settings',signOut:'Sign out'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function readStorage(key){try{return localStorage.getItem(key)}catch{return null}}
function writeStorage(key,value){try{localStorage.setItem(key,value)}catch{}}
function normalizeTheme(value){return value==='dark'?'dark':'light'}
function getTheme(legacyKeys=[]){
  const direct=readStorage(THEME_KEY);
  if(direct==='dark'||direct==='light')return direct;
  for(const key of legacyKeys){
    const value=readStorage(key);
    if(value==='dark'||value==='light'){writeStorage(THEME_KEY,value);return value;}
  }
  return 'light';
}
function setTheme(value,legacyKeys=[]){
  const next=normalizeTheme(value);
  writeStorage(THEME_KEY,next);
  for(const key of legacyKeys)writeStorage(key,next);
  document.documentElement.dataset.theme=next;
  document.dispatchEvent(new CustomEvent('celluloid-suite-theme',{detail:{theme:next,version:VERSION}}));
  return next;
}
function toggleTheme(legacyKeys=[]){return setTheme(getTheme(legacyKeys)==='dark'?'light':'dark',legacyKeys)}
function accountInitials(name){
  const value=String(name??'').trim();
  if(/^dennis(?:[\s-]|$)/i.test(value)||/^dsj$/i.test(value))return 'DSJ';
  return value.split(/[\s-]+/).filter(Boolean).map(part=>part[0]||'').join('').slice(0,4).toUpperCase()||'?';
}
function themeIcon(theme){
  return theme==='dark'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
}
function syncThemeButton(button,theme){
  if(!button)return;
  const dark=theme==='dark';
  const label=dark?'Switch to light mode':'Switch to dark mode';
  button.setAttribute('aria-label',label);button.title=label;button.innerHTML=themeIcon(theme);
}

function createAccountUi(defaultActions={}){
  const passwordRecords=new WeakMap();let inputSequence=0,activeMenu=null;
  const menuId='science-account-menu';
  if(!document.getElementById('celluloid-suite-ui-style')){
    const style=document.createElement('style');style.id='celluloid-suite-ui-style';style.textContent=`
      .suite-password-field{position:relative;display:block;width:100%}
      .suite-password-field>input{box-sizing:border-box;width:100%;padding-right:44px!important}
      .suite-password-toggle{position:absolute;right:3px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:34px;height:34px;min-height:34px;padding:5px;border:0;border-radius:4px;background:transparent;color:#526b80;cursor:pointer;line-height:1}
      .suite-password-toggle svg{display:block;width:20px;height:20px;pointer-events:none}.suite-password-toggle .eye-slash[hidden]{display:none}
      .suite-password-toggle:focus-visible,.suite-account-menu button:focus-visible{outline:2px solid #2d6da3;outline-offset:2px}
      .suite-account-menu{box-sizing:border-box;position:fixed;z-index:2147483000;width:224px;max-height:calc(100vh - 16px);overflow:auto;padding:6px;border:1px solid #d2dce6;border-radius:8px;background:#fff;color:#172e44;box-shadow:0 12px 35px #10253830;font:13px Inter,system-ui,sans-serif}
      html[data-theme="dark"] .suite-account-menu{border-color:#394b5a;background:#101b24;color:#e7eef4;box-shadow:0 12px 35px #0008}
      .suite-account-menu [role=menuitem]{box-sizing:border-box;display:block;width:100%;min-height:38px;padding:9px 12px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
      .suite-account-menu [role=menuitem]:hover,.suite-account-menu [role=menuitem]:focus{background:#eaf1f7}
      html[data-theme="dark"] .suite-account-menu [role=menuitem]:hover,html[data-theme="dark"] .suite-account-menu [role=menuitem]:focus{background:#1c2c38}
      .suite-account-menu [data-action=signOut]{color:#ad3343;border-top:1px solid #e3e9ef;border-radius:0;margin-top:3px}
      html[data-theme="dark"] .suite-account-menu [data-action=signOut]{border-color:#394b5a;color:#ff8795}
      .suite-theme svg,.auth-theme-toggle svg,.science-auth-theme svg{width:21px;height:21px;display:block}
    `;document.head.appendChild(style);
  }
  function passwordInputs(container){return [...(container.matches?.('input[data-suite-password]')?[container]:[]),...container.querySelectorAll('input[data-suite-password]')]}
  function setVisibility(record,shown){const{input,button,label}=record;input.type=shown?'text':'password';button.setAttribute('aria-pressed',String(shown));button.setAttribute('aria-label',(shown?'Hide ':'Show ')+label);button.title=(shown?'Hide ':'Show ')+label;button.querySelector('.eye-slash')?.toggleAttribute('hidden',!shown)}
  function maskPasswordFields(container){passwordInputs(container).forEach(input=>{const record=passwordRecords.get(input);if(record)setVisibility(record,false)})}
  function enhancePasswordFields(container){
    container.querySelectorAll('input[type=password]').forEach(input=>{
      if(passwordRecords.has(input))return;let wrapper=input.parentElement;let button=wrapper?.querySelector('button.password-toggle,button.password-eye,button[data-password-target],button[data-password]');
      if(!button){wrapper=document.createElement('span');input.before(wrapper);wrapper.appendChild(input);button=document.createElement('button');wrapper.appendChild(button)}
      wrapper.classList.add('suite-password-field');button.classList.add('suite-password-toggle');button.type='button';button.disabled=input.disabled;
      if(!input.id)input.id='suite-password-'+(++inputSequence);button.setAttribute('aria-controls',input.id);input.dataset.suitePassword='';
      const rawLabel=input.getAttribute('aria-label')||input.closest('label')?.firstChild?.textContent||'password';const label=rawLabel.trim().toLowerCase().replace(/\s*\(.*\)\s*$/,'')||'password';
      const record={input,button,label};passwordRecords.set(input,record);button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18" hidden/></svg>';setVisibility(record,false);
      button.onclick=event=>{if(input.disabled)return;const start=input.selectionStart,end=input.selectionEnd;setVisibility(record,input.type==='password');if(event.detail){input.focus({preventScroll:true});if(start!==null&&end!==null)input.setSelectionRange(start,end)}};
    });
  }
  ['submit','reset','invalid'].forEach(type=>document.addEventListener(type,event=>maskPasswordFields(event.target),true));
  function closeAccountMenu(restoreFocus=false){if(!activeMenu)return;const{anchor,menu}=activeMenu;activeMenu=null;menu.remove();anchor.setAttribute('aria-expanded','false');if(restoreFocus&&anchor.isConnected)anchor.focus({preventScroll:true})}
  function focusItem(index){const items=activeMenu?.menu.querySelectorAll('[role=menuitem]');if(items?.length)items[(index+items.length)%items.length].focus()}
  function accountMenu(anchor,overrides={},lastItem=false){
    if(activeMenu?.anchor===anchor){closeAccountMenu(true);return}closeAccountMenu();const actions={...defaultActions,...overrides};const menu=document.createElement('div');
    menu.id=menuId;menu.className='suite-account-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Account');
    for(const name of MENU_ORDER){const button=document.createElement('button');button.type='button';button.textContent=labels[name];button.dataset.action=name;button.setAttribute('role','menuitem');button.tabIndex=-1;button.disabled=typeof actions[name]!=='function';button.onclick=()=>{closeAccountMenu(true);actions[name]?.()};menu.appendChild(button)}
    const host=anchor.closest('[role="dialog"]')||document.body;host.appendChild(menu);const rect=anchor.getBoundingClientRect(),height=menu.getBoundingClientRect().height,hostRect=host.getBoundingClientRect();
    const leftEdge=host===document.body?8:Math.max(8,hostRect.left+8),rightEdge=host===document.body?innerWidth-8:Math.min(innerWidth-8,hostRect.right-8),topEdge=host===document.body?8:Math.max(8,hostRect.top+8),bottomEdge=host===document.body?innerHeight-8:Math.min(innerHeight-8,hostRect.bottom-8);
    let left=Math.max(leftEdge,Math.min(rect.right-224,rightEdge-224)),top=Math.max(topEdge,rect.bottom+height+6<bottomEdge?rect.bottom+6:rect.top-height-6);
    for(let parent=menu.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.transform!=='none'||style.perspective!=='none'||style.filter!=='none'||(style.backdropFilter&&style.backdropFilter!=='none')){const bounds=parent.getBoundingClientRect();left-=bounds.left+parent.clientLeft-parent.scrollLeft;top-=bounds.top+parent.clientTop-parent.scrollTop;break}}
    menu.style.left=left+'px';menu.style.top=top+'px';anchor.setAttribute('aria-haspopup','menu');anchor.setAttribute('aria-controls',menuId);anchor.setAttribute('aria-expanded','true');activeMenu={anchor,menu};focusItem(lastItem?MENU_ORDER.length-1:0);
  }
  document.addEventListener('pointerdown',event=>{if(activeMenu&&!activeMenu.anchor.contains(event.target)&&!activeMenu.menu.contains(event.target))closeAccountMenu()},true);
  document.addEventListener('keydown',event=>{if(!activeMenu)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeAccountMenu(true);return}if(event.key==='Tab'){closeAccountMenu(true);return}if(activeMenu.menu.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...activeMenu.menu.querySelectorAll('[role=menuitem]')],index=items.indexOf(document.activeElement);focusItem(event.key==='Home'?0:event.key==='End'?items.length-1:index+(event.key==='ArrowDown'?1:-1))}},true);
  return{enhancePasswordFields,maskPasswordFields,accountMenu,closeAccountMenu};
}
window.CelluloidSuiteUI=Object.freeze({version:VERSION,themeKey:THEME_KEY,headerOrder:HEADER_ORDER,menuOrder:MENU_ORDER,getTheme,setTheme,toggleTheme,themeIcon,syncThemeButton,accountInitials,createAccountUi,esc});
})();
