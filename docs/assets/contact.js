(()=>{
  "use strict";

  // This static site does not provide a mail server.
  // Set data-endpoint to a verified HTTPS contact-form service before enabling delivery.
  // The UI must never report a successful send without a successful server response.
  const form=document.getElementById("duckbio-contact-form");
  if(!form)return;
  const feedback=document.getElementById("contact-form-status");
  const sendButton=document.getElementById("contact-send-button");

  function announce(message){feedback.textContent=message;}

  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    if(!form.reportValidity())return;

    const endpoint=String(form.dataset.endpoint||"").trim();
    if(!endpoint){
      announce("Message sending is not configured yet. Your message has NOT been sent.");
      return;
    }
    let url;
    try{url=new URL(endpoint,window.location.href);}
    catch{announce("Contact service configuration is invalid. Nothing was sent.");return;}
    if(url.protocol!=="https:"){
      announce("The contact service must use a secure HTTPS address. Nothing was sent.");
      return;
    }
    sendButton.disabled=true;
    sendButton.setAttribute("aria-busy","true");
    announce("Sending your message…");
    try{
      const response=await fetch(url.href,{
        method:"POST",
        headers:{"Accept":"application/json"},
        body:new FormData(form),
        mode:"cors",
        cache:"no-store",
        credentials:"omit"
      });
      if(!response.ok)throw Error("Contact provider returned HTTP "+response.status);
      const type=response.headers.get("content-type")||"";
      if(!type.includes("application/json"))throw Error("Contact provider did not confirm acceptance");
      const result=await response.json();
      if(result.ok===false||result.success===false||result.error)throw Error("Contact provider rejected message");
      announce("Message sent successfully. Thank you for contacting DuckBio.");
      form.reset();
    }catch(error){
      announce("The message could not be sent. Please try again later. Your text remains in the form.");
    }finally{
      sendButton.disabled=false;
      sendButton.removeAttribute("aria-busy");
    }
  });
})();
