/* Shared in-page confirmation dialog for DuckBio Workspace preview.
   Never opens a browser confirm/alert, tab or pop-up window. */
(() => {
  "use strict";
  const dialog=document.createElement("dialog");
  dialog.id="duckbio-confirm-dialog";
  dialog.className="launcher-dialog ua-dialog duckbio-confirm-dialog";
  dialog.setAttribute("aria-labelledby","duckbio-confirm-title");
  dialog.setAttribute("aria-describedby","duckbio-confirm-message");

  const content=document.createElement("div");
  content.className="duckbio-confirm-content";
  const heading=document.createElement("h2");
  heading.id="duckbio-confirm-title";
  heading.textContent="Confirm action";
  const message=document.createElement("p");
  message.id="duckbio-confirm-message";
  const actions=document.createElement("div");
  actions.className="ua-modal-footer";
  const cancel=document.createElement("button");
  cancel.type="button";
  cancel.className="ua-secondary";
  cancel.textContent="Cancel";
  const approve=document.createElement("button");
  approve.type="button";
  approve.className="ua-danger";
  approve.textContent="Delete";
  actions.append(cancel,approve);
  content.append(heading,message,actions);
  dialog.append(content);
  document.body.append(dialog);

  let resolvePending=null;
  let outcome=false;
  let priorFocus=null;

  function position(){
    let top=12;
    let available=Math.max(180,window.innerHeight-24);
    try {
      if(window.parent!==window&&window.frameElement){
        const rect=window.frameElement.getBoundingClientRect();
        const viewport=window.parent.visualViewport;
        const start=Math.max(0,(viewport?.offsetTop||0)-rect.top);
        const end=Math.min(rect.height,(viewport?.offsetTop||0)+(viewport?.height||window.parent.innerHeight)-rect.top);
        if(end-start>110){
          top=start+9;
          available=end-start-18;
        }
      }
    }catch(error){ /* Standalone preview keeps the local viewport position. */ }
    dialog.style.setProperty("--launcher-visible-top",top+"px");
    dialog.style.setProperty("--launcher-visible-height",Math.max(140,available)+"px");
  }

  function finish(result){
    if(!dialog.open)return;
    outcome=Boolean(result);
    dialog.close();
  }
  approve.addEventListener("click",()=>finish(true));
  cancel.addEventListener("click",()=>finish(false));
  dialog.addEventListener("click",event=>{
    if(event.target===dialog)finish(false);
  });
  dialog.addEventListener("close",()=>{
    const resolve=resolvePending;
    resolvePending=null;
    if(priorFocus?.isConnected)priorFocus.focus({preventScroll:true});
    priorFocus=null;
    if(resolve)resolve(outcome);
  });
  window.addEventListener("resize",()=>{if(dialog.open)position();},{passive:true});
  if(window.parent!==window){
    try{
      window.parent.addEventListener("scroll",()=>{if(dialog.open)position();},{passive:true});
      window.parent.addEventListener("resize",()=>{if(dialog.open)position();},{passive:true});
    }catch(error){}
  }

  window.DuckBioWorkspaceConfirm=({title="Confirm action",description="",confirmLabel="Delete"}={})=>{
    if(dialog.open || resolvePending)return Promise.resolve(false);
    heading.textContent=String(title);
    message.textContent=String(description);
    approve.textContent=String(confirmLabel);
    outcome=false;
    priorFocus=document.activeElement;
    position();
    return new Promise(resolve=>{
      resolvePending=resolve;
      try {
        dialog.showModal();
        cancel.focus({preventScroll:true});
      } catch(error){
        resolvePending=null;
        priorFocus=null;
        resolve(false);
      }
    });
  };
})();
