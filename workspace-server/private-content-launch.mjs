// Strict private gateway for globally registered DuckBio resource IDs.
// Resolver must come from a trusted native app integration, NEVER a browser.
const prefixes={ld:'limsman',dm:'duckman',dn:'eel',cd:'goflo',md:'methpipe',dt:'mantrain'};
const contentPattern=/^(ld|dm|dn|cd|md|dt)[0-9]{6,}$/;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export async function authorizedContentDestination({
 contentId,viewerId,resolveResource,clients,organizationStore
}={}){
 if(!safeId(viewerId)||typeof contentId!=='string'||!contentPattern.test(contentId)||
    typeof resolveResource!=='function'||!Array.isArray(clients)||
    !organizationStore||typeof organizationStore.accessFor!=='function')
  return null;
 const expectedApp=prefixes[contentId.slice(0,2)];
 // Ambiguous native client registrations must never resolve via array order.
 // Fail closed rather than selecting an arbitrary origin for an app prefix.
 const matchingClients=clients.filter(x=>x?.appId===expectedApp);
 if(matchingClients.length!==1)return null;
 const client=matchingClients[0];
 if(typeof client.nativeOrigin!=='string')return null;
 let origin;
 try{origin=new URL(client.nativeOrigin);}catch{return null;}
 if(origin.origin!==client.nativeOrigin||origin.protocol!=='https:'||
    origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)
  return null;
 let resolved;
 try{resolved=await resolveResource({contentId,viewerId,appId:expectedApp});}
 catch{return null;}
 if(!resolved||resolved.authorized!==true||resolved.appId!==expectedApp||
    !safeId(resolved.organizationId)||typeof resolved.url!=='string')
  return null;
 if(!organizationStore.accessFor({
   organizationId:resolved.organizationId,accountId:viewerId,appId:expectedApp}))
  return null;
 let target;
 try{target=new URL(resolved.url);}catch{return null;}
 // Only a deep-link on the configured app's HTTPS origin. No redirects
 // to arbitrary addresses, URLs with credentials, queries or hash tokens.
 if(target.origin!==origin.origin||target.protocol!=='https:'||
    target.username||target.password||target.search||target.hash||
    target.pathname!=='/content/'+contentId)return null;
 return target.href;
}
