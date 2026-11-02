// Browser-side app connection UI. The Workspace server and broker enforce
// registered callback URLs, PKCE and one-use authorization codes independently.
const $=id=>document.getElementById(id);
const appNames=Object.freeze({limsman:'LabDuck',eel:'DuckNote',duckman:'DuckMan',
  goflo:'CytoDuck',methpipe:'DuckPipe',mantrain:'DuckTrain'});
const tokens=/^[A-Za-z0-9_-]{32,128}$/;
const challenges=/^[A-Za-z0-9_-]{43}$/;
const keys=new Set(['appId','redirectUri','state','codeChallenge']);
let csrf='',handoff=null,busy=false;
function status(message){$('status').textContent=message;}
function parseHandoff(){
 const params=new URLSearchParams(location.search);
 const names=[...params.keys()];
 if(names.length!==4||new Set(names).size!==4||names.some(x=>!keys.has(x)))return null;
 const appId=params.get('appId'),redirectUri=params.get('redirectUri'),
  state=params.get('state'),codeChallenge=params.get('codeChallenge');
 if(!Object.hasOwn(appNames,appId)||!tokens.test(state||'')||
   !challenges.test(codeChallenge||''))return null;
 let callback;
 try{callback=new URL(redirectUri)}catch{return null}
 if(callback.protocol!=='https:'||callback.username||callback.password||
   callback.search||callback.hash||callback.href!==redirectUri||
   !/^\/(?:[a-z][a-z0-9_-]{0,63}\/)?auth\/callback$/.test(callback.pathname))
  return null;
 return {appId,redirectUri,state,codeChallenge,codeChallengeMethod:'S256',returnPath:'/'};
}
function validatedRedirect(value){
 if(typeof value!=='string'||!handoff)return null;
 try{
  const expected=new URL(handoff.redirectUri),actual=new URL(value);
  if(expected.origin!==actual.origin||expected.pathname!==actual.pathname||
     actual.username||actual.password||actual.hash)return null;
  const entries=[...actual.searchParams.keys()];
  if(entries.length!==2||!entries.includes('code')||!entries.includes('state')||
     actual.searchParams.getAll('state')[0]!==handoff.state||
     actual.searchParams.getAll('code').length!==1||
     !tokens.test(actual.searchParams.get('code')))return null;
  return actual.href;
 }catch{return null}
}
async function post(route,body){
 const response=await fetch(route,{method:'POST',credentials:'same-origin',
  cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},
  body:JSON.stringify(body)});
 let data=null;try{data=await response.json()}catch{}
 if(!response.ok)throw new Error(response.status===401?'Sign-in or app access was denied.':
   response.status===429?'Too many attempts. Try again later.':
   'The app connection could not be authorized.');
 return data;
}
async function continueToApp(credentials){
 if(busy||!handoff)return;
 busy=true;$('continue').disabled=true;$('login').querySelector('button').disabled=true;
 status('Checking app access…');
 try{
  const result=await post(credentials?'/api/suite/auth/login':'/api/suite/auth/authorize',
    credentials?{...handoff,...credentials}:handoff);
  const destination=validatedRedirect(result?.redirectUrl);
  if(!destination)throw Error('Workspace returned an invalid app callback.');
  // Only the exact registered, validated callback can be used as a destination.
  location.assign(destination);
 }catch(error){
  status(error?.message||'Could not complete the app connection.');
 }finally{busy=false;$('continue').disabled=false;$('login').querySelector('button').disabled=false;}
}
async function initialize(){
 handoff=parseHandoff();
 if(!handoff){status('Invalid or expired app connection. Start again from the app.');return;}
 $('app-name').textContent=appNames[handoff.appId];
 $('heading').textContent='Connect '+appNames[handoff.appId];
 $('continue').textContent='Continue to '+appNames[handoff.appId];
 try{
  const response=await fetch('/api/suite/auth/session',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error();
  const data=await response.json();
  if(!tokens.test(data.csrfToken))throw Error();
  csrf=data.csrfToken;
  if(data.authenticated&&!data.passwordChangeRequired){
   $('identity').textContent='Signed in as '+data.user.displayName;
   $('active').hidden=false;
   status('Review the app name and continue when ready.');
  }else if(data.authenticated&&data.passwordChangeRequired){
   status('Change your Workspace password before connecting an app.');
  }else{
   $('login').hidden=false;
   status('Sign in to your Workspace account to continue.');
  }
 }catch{status('Workspace authentication is temporarily unavailable.');}
}
$('continue').addEventListener('click',()=>{void continueToApp(null)});
$('login').addEventListener('submit',event=>{
 event.preventDefault();
 if(!$('login').reportValidity())return;
 const email=$('email').value.trim(),password=$('password').value;
 if(!email||!password)return;
 void continueToApp({email,password});
});
void initialize();
