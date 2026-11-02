(()=>{
  "use strict";

  // DuckBio marketing runs on GitHub Pages, not on the private server.
  // No real delivery until BOTH the reviewed HTTPS endpoint and a public
  // Cloudflare Turnstile site key are explicitly configured on the form.
  const form=document.getElementById("duckbio-contact-form");
  if(!form)return;
  const feedback=document.getElementById("contact-form-status");
  const sendButton=document.getElementById("contact-send-button");
  const endpoint=String(form.dataset.endpoint||"").trim();
  const siteKey=String(form.dataset.turnstileSitekey||"").trim();
  let widgetId=null,submissionId=null;
  const announce=text=>{if(feedback)feedback.textContent=text;};
  let destination=null;
  try{
    if(endpoint){
      const url=new URL(endpoint);
      if(url.protocol!=="https:"||url.username||url.password||url.hash||
         url.pathname!=="/api/suite/public/contact")
        throw Error("Invalid DuckBio contact endpoint");
      destination=url.href;
    }
  }catch{destination=null;}
  if(destination&&siteKey){
    const container=document.createElement("div");
    container.className="duckbio-turnstile";
    container.setAttribute("aria-label","Verify that you are human");
    form.querySelector(".contact-fields")?.after(container);
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;
    script.onload=()=>{
      try{
        if(typeof window.turnstile?.render==="function")
          widgetId=window.turnstile.render(container,{
            sitekey:siteKey,action:"contact",theme:"auto"
          });
      }catch{announce("Contact verification is unavailable. No message was sent.");}
    };
    script.onerror=()=>announce("Contact verification could not load. No message was sent.");
    document.head.append(script);
  }

  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    if(!destination||!siteKey){
      announce("Message sending is not configured yet. Your message has NOT been sent.");
      return;
    }
    const verification=widgetId!==null?window.turnstile?.getResponse?.(widgetId):null;
    if(!verification){
      announce("Please complete the human verification before sending.");
      return;
    }
    if(!submissionId)submissionId=crypto.randomUUID();
    const values=new FormData(form);
    const payload={
      name:String(values.get("name")||"").trim(),
      email:String(values.get("email")||"").trim(),
      organisation:String(values.get("organisation")||"").trim(),
      subject:String(values.get("subject")||"").trim(),
      message:String(values.get("message")||"").trim(),
      submissionId,turnstileToken:verification
    };
    sendButton.disabled=true;
    sendButton.setAttribute("aria-busy","true");
    announce("Submitting your message securely…");
    try{
      const response=await fetch(destination,{
        method:"POST",mode:"cors",cache:"no-store",credentials:"omit",
        redirect:"error",headers:{"Accept":"application/json",
          "Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const type=response.headers.get("content-type")||"";
      if(response.status!==202||!type.includes("application/json"))
        throw Error("Contact request not accepted");
      const result=await response.json();
      if(result.accepted!==true||result.internalDelivered!==true||
         result.externalStatus!=="queued")
        throw Error("Contact delivery not confirmed");
      announce("Your message has been received by DuckBio. An email copy is queued for delivery.");
      submissionId=null;
      form.reset();
    }catch{
      announce("The message could not be confirmed. Please try again after completing verification. Your text remains here.");
    }finally{
      sendButton.disabled=false;
      sendButton.removeAttribute("aria-busy");
      if(widgetId!==null)try{window.turnstile?.reset?.(widgetId);}catch{}
    }
  });
})();
