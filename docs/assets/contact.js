(()=>{
  "use strict";
  const form=document.getElementById("duckbio-contact-form");
  if(!form)return;
  const feedback=document.getElementById("contact-form-status");
  const fallback=document.getElementById("contact-copy-fallback");
  const fallbackText=document.getElementById("contact-draft-text");
  const fields=(name)=>String(form.elements.namedItem(name)?.value||"").trim();
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const name=fields("name"),email=fields("email"),organisation=fields("organisation"),message=fields("message");
    const draft="DuckBio contact enquiry\n\nName: "+name+"\nEmail: "+email+"\nOrganisation: "+(organisation||"Not provided")+"\n\nMessage:\n"+message;
    fallback.hidden=true;
    feedback.textContent="";
    // Static GitHub Pages has no mail server. Do not claim successful submission.
    const recipient=String(form.dataset.recipient||"").trim();
    if(recipient){
      const mailto="mailto:"+encodeURIComponent(recipient)+"?subject="+encodeURIComponent("DuckBio website enquiry")+"&body="+encodeURIComponent(draft);
      window.location.href=mailto;
      feedback.textContent="Your email application was opened. Please press Send there to deliver your enquiry.";
      return;
    }
    try{
      if(!navigator.clipboard?.writeText)throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(draft);
      feedback.textContent="Your message has been copied. It has not been sent to DuckBio.";
    }catch{
      fallback.hidden=false;
      fallbackText.value=draft;
      fallbackText.focus();
      fallbackText.select();
      feedback.textContent="Your message is ready below. Copy it manually. Nothing has been sent.";
    }
  });
})();
