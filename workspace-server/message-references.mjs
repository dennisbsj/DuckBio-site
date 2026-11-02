import {extractContentMentions} from './content-id-registry.mjs';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export function mentionHandleForUser(userId){
 if(!id(userId))throw Error('invalid_mention_account');
 return 'u-'+Buffer.from(userId,'utf8').toString('hex');
}
export function extractMessageReferences(text){
 if(typeof text!=='string'||text.length>10000)throw Error('invalid_mention_text');
 const participants=new Set();
 const pattern=/(?:^|[^\p{L}\p{N}_])@u-([a-f0-9]{2,256})\b/gu;
 for(const m of text.matchAll(pattern)){
  const candidate=Buffer.from(m[1],'hex').toString('utf8');
  if(id(candidate)&&mentionHandleForUser(candidate)==='u-'+m[1])participants.add(candidate);
 }
 const resources=extractContentMentions(text);
 if(participants.size>30||resources.length>30)throw Error('too_many_mentions');
 return Object.freeze({userIds:Object.freeze([...participants]),
   resourceIds:Object.freeze([...resources])});
}
// Content IDs in messages are merely opaque references. Only app-native
// permission checks can reveal a resource title, type, or clickable link.
export function visibleContentReferences({text,viewerId,contentRegistry}={}){
 if(!id(viewerId)||typeof contentRegistry?.inspect!=='function')
  return [];
 return extractMessageReferences(text).resourceIds.map(contentId=>
   contentRegistry.inspect({contentId,viewerId}))
  .filter(Boolean);
}
