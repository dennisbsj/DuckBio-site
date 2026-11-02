// Private, independently scoped DuckBio AI adapters. Uses the Responses API,
// never browser credentials. No tools, database retrieval, persistent model
// conversations or entitlement-altering functions are exposed to the model.
const modelId=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{3,100}$/.test(x);
const cleanText=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
const fail=code=>{throw Error(code);};
const ownerSystem=[
 'You are DuckBio Owner AI, a private assistant for the designated DuckBio business owner.',
 'Support owner operations, SaaS subscriptions, support, security review and biotech software decisions.',
 'Any operational context is a read-only, bounded snapshot and is not live financial truth.',
 'Do not invent Stripe payments, audit entries, security incidents or production status.',
 'Do not use other customers personal information, scientific files or credentials unless separately reviewed access is explicitly provided.',
 'You have no tools and cannot change billing, membership, access or infrastructure.'
].join(' ');
const userSystem=[
 'You are DuckBio Assistant for a signed-in member of one selected DuckBio organization.',
 'Help with scientific software usage, general scientific and GMP documentation questions.',
 'You only know the organization context supplied with this individual request.',
 'You have no access to other organizations, the private owner dashboard, billing systems, scientific file contents or secret credentials.',
 'Do not claim that scientific analyses are regulated or validated solely because of this chat.',
 'You have no tools and cannot change user permissions, billing, scientific records or accounts.'
].join(' ');
export function createDuckBioLLM({apiKey,ownerModel,userModel,fetchImpl=globalThis.fetch}={}){
 if(typeof apiKey!=='string'||apiKey.length<20||/[\s\r\n]/.test(apiKey)||
    !modelId(ownerModel)||!modelId(userModel)||typeof fetchImpl!=='function')
  fail('private_ai_configuration_required');
 return Object.freeze({
  async respond({profile,organizationName=null,operationalTotals=null,prompt,history=[]}={}){
   if(!['owner','user'].includes(profile)||!cleanText(prompt,1600)||
      !Array.isArray(history)||history.length>10||
      history.some(x=>!x||!['user','assistant'].includes(x.role)||
       !cleanText(x.content,1200))||
      history.reduce((sum,x)=>sum+x.content.length,0)>5000||
      (profile==='user'&&!cleanText(organizationName,200)))
    fail('invalid_ai_request');
   const input=history.map(x=>({role:x.role,content:x.content.trim()}));
   input.push({role:'user',content:prompt.trim()});
   const context=profile==='owner'
    ?'Read-only owner totals: '+JSON.stringify(operationalTotals&&typeof operationalTotals==='object'?
       Object.fromEntries(Object.entries(operationalTotals).filter(([,v])=>
        typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)):{}).slice(0,1000)
    :'Selected organization: '+organizationName+'. No data from another organization is available.';
   const payload={model:profile==='owner'?ownerModel:userModel,
    instructions:(profile==='owner'?ownerSystem:userSystem)+'\n'+context,
    input,max_output_tokens:512,store:false,tools:[]};
   let response;
   try{
    response=await fetchImpl('https://api.openai.com/v1/responses',{
     method:'POST',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
     signal:AbortSignal.timeout(20000),
     headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',
       Accept:'application/json'},
     body:JSON.stringify(payload)
    });
   }catch{fail('ai_provider_unavailable');}
   if(!response?.ok||!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')||''))
    fail('ai_provider_unavailable');
   const content=await response.text();
   if(content.length>100000)fail('ai_provider_unavailable');
   let result;
   try{result=JSON.parse(content);}catch{fail('ai_provider_unavailable');}
   if(result?.status!=='completed'||!Array.isArray(result.output))
    fail('ai_provider_unavailable');
   const answer=result.output.flatMap(x=>x.type==='message'&&Array.isArray(x.content)?
       x.content.filter(y=>y.type==='output_text'&&typeof y.text==='string').map(y=>y.text):[])
     .join('\n').trim();
   if(!answer||answer.length>8000)fail('ai_provider_unavailable');
   return {answer,profile,storedByProvider:false,toolsEnabled:false};
  }
 });
}
