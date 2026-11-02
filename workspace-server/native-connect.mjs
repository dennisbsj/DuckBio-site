// Only exact, pre-registered native app callbacks may begin browser SSO.
// This validates the GET handoff before exposing the first-party login page.
// The broker independently enforces these same client boundaries on POST.
const statePattern=/^[A-Za-z0-9_-]{32,128}$/;
const challengePattern=/^[A-Za-z0-9_-]{43}$/;
const allowed=new Set(['appId','redirectUri','state','codeChallenge']);
export function nativeConnectRequest(searchParams,clients){
 if(!searchParams||typeof searchParams.keys!=='function')return null;
 const keys=[...searchParams.keys()];
 if(keys.length!==allowed.size||new Set(keys).size!==allowed.size||
    keys.some(key=>!allowed.has(key)))return null;
 const appId=searchParams.get('appId'),redirectUri=searchParams.get('redirectUri');
 const state=searchParams.get('state'),codeChallenge=searchParams.get('codeChallenge');
 if(!/^[a-z][a-z0-9_-]{0,63}$/.test(appId??'')||
    !statePattern.test(state??'')||!challengePattern.test(codeChallenge??'')||
    typeof redirectUri!=='string'||redirectUri.length>2048)return null;
 const registrations=(clients??[]).filter(client=>client.appId===appId&&
   Array.isArray(client.redirectUris)&&client.redirectUris.includes(redirectUri));
 if(registrations.length!==1)return null;
 return Object.freeze({appId,redirectUri,state,codeChallenge,
    codeChallengeMethod:'S256',returnPath:'/'});
}
