
(()=>{"use strict";
const themeButton=document.querySelector("[data-theme-toggle]");
const themeIcon=document.querySelector("[data-theme-icon]");
function applyTheme(mode){
 const actual=mode==="dark"?"dark":"light";
 document.documentElement.setAttribute("data-theme",actual);
 if(themeIcon)themeIcon.textContent=actual==="dark"?"☀":"☾";
 if(themeButton){
  themeButton.setAttribute("aria-label",actual==="dark"?"Switch to day mode":"Switch to night mode");
  themeButton.setAttribute("title",actual==="dark"?"Switch to day mode":"Switch to night mode");
  themeButton.setAttribute("aria-pressed",String(actual==="dark"));
 }
}
let saved="light";try{saved=localStorage.getItem("duckbio-theme")||"light"}catch(e){}
applyTheme(saved);
themeButton?.addEventListener("click",()=>{
 const next=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";
 applyTheme(next);
 try{localStorage.setItem("duckbio-theme",next)}catch(e){}
});
const nav=document.getElementById("nav"),toggle=document.querySelector("[data-menu]");toggle?.addEventListener("click",()=>{const next=toggle.getAttribute("aria-expanded")!=="true";toggle.setAttribute("aria-expanded",String(next));nav?.classList.toggle("open",next)});nav?.addEventListener("click",e=>{if(e.target.closest("a")){nav.classList.remove("open");toggle?.setAttribute("aria-expanded","false")}});document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{const filter=button.dataset.filter;document.querySelectorAll("[data-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b===button)));document.querySelectorAll("[data-categories]").forEach(card=>{card.hidden=filter!=="all"&&!card.dataset.categories.split(" ").includes(filter)})}));document.querySelectorAll("[data-year]").forEach(n=>{n.textContent=String(new Date().getFullYear())});async function prices(){const els=document.querySelectorAll("[data-price-for]");if(!els.length)return;try{const r=await fetch("assets/pricing.json",{cache:"no-store"});if(!r.ok)throw Error("missing pricing configuration");const data=await r.json();for(const el of els){const p=data.products?.[el.dataset.priceFor];if(p&&typeof p.monthly==="number"&&p.monthly>=0&&typeof p.currency==="string"){const fmt=new Intl.NumberFormat("da-DK",{style:"currency",currency:p.currency,maximumFractionDigits:0});el.textContent=(data.pricesTentative?"Planned ":"")+fmt.format(p.monthly)+" / user / month";el.classList.remove("price-unset")}else{el.textContent="Pricing to be confirmed";el.classList.add("price-unset")}}}catch{els.forEach(x=>{x.textContent="Pricing to be confirmed";x.classList.add("price-unset")})}}prices();
/* Contact form: retain the subject in FormData for the eventual secure endpoint.
   Never imply a message was sent while no endpoint is configured. */
const contactForm=document.getElementById("duckbio-contact-form");
contactForm?.addEventListener("submit",async event=>{
 event.preventDefault();
 const status=document.getElementById("contact-form-status");
 const sendButton=document.getElementById("contact-send-button");
 if(!status||!sendButton)return;
 const endpoint=contactForm.dataset.endpoint?.trim();
 if(!endpoint){
  status.textContent="Message delivery is not active yet. No email was sent.";
  return;
 }
 const payload=new FormData(contactForm);
 sendButton.disabled=true;
 status.textContent="Sending your message…";
 try{
  const result=await fetch(endpoint,{method:"POST",body:payload,headers:{Accept:"application/json"}});
  if(!result.ok)throw new Error("Contact delivery did not succeed");
  status.textContent="Your message has been submitted.";
  contactForm.reset();
 }catch(error){
  status.textContent="Your message could not be sent. Please try again later.";
 }finally{
  sendButton.disabled=false;
 }
});
})();
