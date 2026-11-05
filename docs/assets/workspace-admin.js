
/* Interactive Workspace administration preview. No account, payment or access
   changes leave this browser; live authorisation belongs on the server. */
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const dialog = byId("ua-dialog");
  if (!dialog) return;
  const appRoles = [
    {name:"LabDuck", roles:["Analyst","QC","QA","Admin"]},
    {name:"CytoDuck", roles:["Analyst","Reviewer","QA","Admin","ReadOnly"]},
    {name:"DuckPipe", roles:["Analyst","Reviewer","QA","Admin","ReadOnly"]},
    {name:"DuckNote", roles:["scientist","reviewer","read_only","admin","owner"]},
    {name:"DuckMan", roles:["editor","reviewer","read_only","admin"]},
    {name:"DuckTrain", roles:["Learner","Trainer","QA","Admin","ReadOnly"]}
  ];
  const licenceCount = {
    LabDuck:3, CytoDuck:2, DuckPipe:2, DuckNote:4, DuckMan:2, DuckTrain:3
  };
  const example = [
    {id:1, name:"Jane Smith", nickname:"Jane", email:"jane@example.com", admin:true,
      roles:{LabDuck:"Analyst",DuckNote:"scientist",DuckTrain:"Learner"}},
    {id:2, name:"Alex Jensen", nickname:"Alex", email:"alex@example.com", admin:false,
      roles:{LabDuck:"QC",DuckMan:"reviewer",DuckTrain:"Trainer"}},
    {id:3, name:"Mikkel Sørensen", nickname:"Mikkel", email:"mikkel@example.com", admin:false,
      roles:{CytoDuck:"Analyst",DuckPipe:"Analyst",DuckNote:"scientist"}}
  ];
  const state = {members:example, nextId:4, editId:null, buyStep:1};
  const roleLabels = {read_only:"Read only",ReadOnly:"Read only",scientist:"Scientist",reviewer:"Reviewer",
    editor:"Editor",admin:"Admin",owner:"Owner"};
  const root = byId("ua-main");
  const fields = byId("ua-account-form");
  const action = byId("ua-account-action");
  const message = byId("ua-account-message");
  const buyForm = byId("ua-buy-form");
  const buyMessage = byId("ua-buy-message");
  const selectMap = new Map();

  const label = role => roleLabels[role] || role;
  const assigned = app => state.members.filter(member => Boolean(member.roles[app])).length;
  const summary = member => Object.entries(member.roles).map(pair => pair[0] + " (" + label(pair[1]) + ")").join(", ");
  function el(tag, className, text) {
    const node=document.createElement(tag);
    if (className) node.className=className;
    if (text !== undefined) node.textContent=text;
    return node;
  }
  function setMessage(node,text,isError) {
    node.textContent=text || "";
    node.dataset.error=String(Boolean(isError));
  }
  function showPanel(panel) {
    dialog.querySelectorAll("[data-ua-panel]").forEach(node => {
      node.hidden=node.dataset.uaPanel!==panel;
    });
    if (panel==="list") renderList();
    if (panel==="buy") {state.buyStep=1;refreshBuy();}
    if (panel==="account") setMessage(message,"",false);
    root.dataset.currentPanel=panel;
    dialog.scrollTop=0;
  }
  function renderList() {
    const body=byId("ua-user-rows");
    body.replaceChildren();
    state.members.forEach(member => {
      const tr=el("tr");
      const name=el("td");
      name.append(el("strong","",member.name),el("small","",member.email));
      const nickname=el("td","",member.nickname);
      const roleCell=el("td");
      roleCell.append(el("span","ua-tag" + (member.admin?" admin":""),member.admin?"Admin + user":"User"));
      const apps=el("td");
      const summaryText=summary(member);
      apps.textContent=summaryText || "No app access";
      const controls=el("td");
      const edit=el("button","ua-secondary","Edit");
      edit.type="button";
      edit.setAttribute("aria-label","Edit " + member.name);
      edit.addEventListener("click",()=>openAccount(member));
      controls.append(edit);
      tr.append(name,nickname,roleCell,apps,controls);
      body.append(tr);
    });
    byId("ua-organisation-count").textContent=String(state.members.length);
    byId("ua-admin-count").textContent=String(state.members.filter(x=>x.admin).length);
    const appRows=byId("ua-licence-totals");
    appRows.replaceChildren();
    appRoles.forEach(app => {
      const tr=el("tr");
      const appName=el("td","",app.name);
      const used=el("td","",String(assigned(app.name)) + " assigned");
      const licensed=el("td","",String(licenceCount[app.name]) + " purchased");
      tr.append(appName,used,licensed);
      appRows.append(tr);
    });
  }
  function buildRoles() {
    const container=byId("ua-role-fields");
    container.replaceChildren();
    selectMap.clear();
    appRoles.forEach(app => {
      const card=el("div","ua-app-role");
      const labelNode=el("label","ua-field",app.name);
      const select=el("select");
      select.name=app.name;
      select.setAttribute("aria-label",app.name + " application role");
      const none=el("option","", "No access");
      none.value="";
      select.append(none);
      const roles=window.DuckBioPreviewRoles?.listRoles(app.name).map(role=>role.name)||app.roles;
      roles.forEach(role => {
        const option=el("option","",label(role));
        option.value=role;
        select.append(option);
      });
      labelNode.append(select);
      const description=el("small","", "Select a role to grant access to this app.");
      card.append(labelNode,description);
      container.append(card);
      selectMap.set(app.name,select);
    });
  }
  function openAccount(member) {
    state.editId=member?.id ?? null;
    fields.reset();
    // Include the latest custom roles created in Permission matrix.
    buildRoles();
    const isEdit=Boolean(member);
    byId("ua-account-heading").textContent=isEdit?"Edit user":"Create account";
    action.textContent=isEdit?"Save changes":"Create account";
    const deleteButton=byId("ua-delete-user");
    deleteButton.hidden=!isEdit;
    for(const key of ["name","nickname","email"]){
      const input=fields.elements.namedItem(key);
      input.readOnly=false;
      input.value=isEdit?member[key]:"";
    }
    fields.elements.namedItem("organisationAdmin").checked=isEdit?member.admin:false;
    selectMap.forEach((select,app)=>{select.value=isEdit?(member.roles[app]||""):"";});
    showPanel("account");
  }
  function checkCapacity(roles,original) {
    for (const app of appRoles) {
      if (!roles[app.name] || (original && original.roles[app.name])) continue;
      if (assigned(app.name) >= licenceCount[app.name]) return app.name;
    }
    return null;
  }
  function saveAccount(event) {
    event.preventDefault();
    if(!fields.reportValidity())return;
    const original=state.editId===null?null:state.members.find(x=>x.id===state.editId);
    if(state.editId!==null&&!original){
      setMessage(message,"This user no longer exists. Return to the user list.",true);return;
    }
    const name=fields.elements.namedItem("name").value.trim();
    const nickname=fields.elements.namedItem("nickname").value.trim();
    const email=fields.elements.namedItem("email").value.trim().toLowerCase();
    const admin=fields.elements.namedItem("organisationAdmin").checked;
    const roles={};
    selectMap.forEach((select,app)=>{if(select.value)roles[app]=select.value;});
    if(!name||!nickname||!email){
      setMessage(message,"Name, nickname and email are required.",true);return;
    }
    if(state.members.some(user=>user.email===email&&user.id!==state.editId)){
      setMessage(message,"An account with this email already exists.",true);return;
    }
    // New users need at least one licensed app; editing can revoke every app.
    if(!original&&Object.keys(roles).length===0){
      setMessage(message,"Select at least one app role, then create the account.",true);return;
    }
    for(const [app,role] of Object.entries(roles)){
      const catalog=window.DuckBioPreviewRoles;
      const valid=catalog?Boolean(catalog.getRole(app,role)):Boolean(appRoles.find(x=>x.name===app)?.roles.includes(role));
      if(!valid){
        setMessage(message,"Unknown role for "+app+". Please reselect the app role.",true);return;
      }
    }
    if(original?.admin&&!admin&&state.members.filter(user=>user.admin).length===1){
      setMessage(message,"The organisation must retain at least one administrator.",true);return;
    }
    const blocked=checkCapacity(roles,original);
    if(blocked){
      setMessage(message,"No unassigned "+blocked+" licence. Use Buy users before granting this app access.",true);return;
    }
    if(original)Object.assign(original,{name,nickname,email,admin,roles});
    else state.members.push({id:state.nextId++,name,nickname,email,admin,roles});
    showPanel("list");
    setMessage(byId("ua-list-message"),original?"Example user updated.":"Example account created. No real account was created.",false);
    window.dispatchEvent(new Event("duckbio-preview-users-changed"));
  }
  async function deleteEditedUser() {
    const member=state.members.find(user=>user.id===state.editId);
    if(!member){
      setMessage(message,"This user is no longer available.",true);return;
    }
    if(member.admin&&state.members.filter(user=>user.admin).length<=1){
      setMessage(message,"You cannot delete the organisation's last administrator.",true);return;
    }
    const confirmed=await window.DuckBioWorkspaceConfirm({
      title:"Delete user?",
      description:"Delete "+member.name+" and remove all their app access? This cannot be undone in this preview.",
      confirmLabel:"Delete user"
    });
    if(!confirmed)return;
    const latest=state.members.find(user=>user.id===member.id);
    if(!latest){
      setMessage(message,"This user is no longer available.",true);return;
    }
    if(latest.admin&&state.members.filter(user=>user.admin).length<=1){
      setMessage(message,"You cannot delete the organisation's last administrator.",true);return;
    }
    state.members=state.members.filter(user=>user.id!==member.id);
    state.editId=null;
    showPanel("list");
    setMessage(byId("ua-list-message"),"Example user deleted. No real account was changed.",false);
    window.dispatchEvent(new Event("duckbio-preview-users-changed"));
  }
  function buildBuy() {
    const rows=byId("ua-buy-rows");
    rows.replaceChildren();
    appRoles.forEach(app => {
      const row=el("div","ua-licence-row");
      const name=el("label","",app.name);
      const input=el("input");
      input.id="ua-buy-"+app.name.toLowerCase();
      input.name=app.name;
      input.type="number";input.min="0";input.max="100";input.step="1";input.value="0";input.inputMode="numeric";
      name.htmlFor=input.id;
      const current=el("span","",String(licenceCount[app.name])+" purchased · "+String(assigned(app.name))+" assigned");
      row.append(name,current,input);
      rows.append(row);
      input.addEventListener("input",()=>{state.buyStep=1;refreshBuy();});
    });
  }
  function selectedBuy() {
    const values={};
    let total=0;
    for(const app of appRoles) {
      const input=buyForm.elements.namedItem(app.name);
      const value=Number(input.value);
      if(!Number.isInteger(value) || value<0 || value>100) return null;
      if(value) {values[app.name]=value;total+=value;}
    }
    return {values,total};
  }
  function refreshBuy() {
    const value=selectedBuy();
    const review=state.buyStep===2;
    const reviewBox=byId("ua-buy-review");
    const continueButton=byId("ua-buy-review-action");
    reviewBox.hidden=!review;
    continueButton.hidden=review;
    continueButton.disabled=!value||value.total===0;
    byId("ua-buy-apply").hidden=!review;
    if(!review) {setMessage(buyMessage,"",false);return;}
    if(!value) {setMessage(buyMessage,"Enter whole numbers from 0 to 100.",true);return;}
    const parts=Object.entries(value.values).map(entry=>entry[0]+" +"+entry[1]);
    byId("ua-buy-selection").textContent=parts.join(" · ");
    byId("ua-buy-total").textContent=String(value.total)+" user licence"+(value.total===1?"":"s");
    setMessage(buyMessage,"",false);
  }
  function reviewBuy(event) {
    event.preventDefault();
    const value=selectedBuy();
    if (!value||value.total===0) {
      setMessage(buyMessage,"Select at least one user licence.",true);return;
    }
    state.buyStep=2;refreshBuy();
  }
  function applyPreviewPurchase() {
    const value=selectedBuy();
    if(!value||value.total===0)return;
    Object.entries(value.values).forEach(entry=>{licenceCount[entry[0]]+=entry[1];});
    buyForm.reset();showPanel("list");
    setMessage(byId("ua-list-message"),"Demo licence numbers changed. No payment was made and no real licences were purchased.",false);
  }
  function positionAdminDialog() {
    let top=12,available=Math.max(180,window.innerHeight-24);
    try {
      if (window.parent!==window && window.frameElement) {
        const rect=window.frameElement.getBoundingClientRect();
        const viewport=window.parent.visualViewport;
        const start=Math.max(0,(viewport?.offsetTop||0)-rect.top);
        const end=Math.min(rect.height,(viewport?.offsetTop||0)+(viewport?.height||window.parent.innerHeight)-rect.top);
        if (end-start>100) {top=start+9;available=end-start-18;}
      }
    } catch(error) {}
    dialog.style.setProperty("--launcher-visible-top",top+"px");
    dialog.style.setProperty("--launcher-visible-height",Math.max(140,available)+"px");
  }
  function openAdmin() {
    byId("launcher-settings-menu").open=false;
    showPanel("list");
    setMessage(byId("ua-list-message"),"",false);
    positionAdminDialog();
    if(!dialog.open)dialog.showModal();
    byId("ua-buy-start")?.focus({preventScroll:true});
  }

  window.DuckBioWorkspacePreviewAdmin=Object.freeze({
    listUsers:()=>state.members.map(user=>({...user,roles:{...user.roles}})),
    isRoleAssigned:(app,role)=>state.members.some(user=>user.roles[app]===role)
  });
  buildRoles();buildBuy();renderList();
  document.querySelectorAll("[data-open-user-admin]").forEach(button=>button.addEventListener("click",openAdmin));
  dialog.querySelectorAll("[data-ua-nav]").forEach(button=>button.addEventListener("click",()=>{
    const next=button.dataset.uaNav;
    if(next==="account")openAccount(null);
    else showPanel(next);
  }));
  byId("ua-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  fields.addEventListener("submit",saveAccount);
  byId("ua-delete-user").addEventListener("click",deleteEditedUser);
  buyForm.addEventListener("submit",reviewBuy);
  byId("ua-buy-apply").addEventListener("click",applyPreviewPurchase);
  if(window.parent!==window) {
    try {
      window.parent.addEventListener("scroll",()=>{if(dialog.open)positionAdminDialog();},{passive:true});
      window.parent.addEventListener("resize",()=>{if(dialog.open)positionAdminDialog();},{passive:true});
    }catch(error){}
  }
  window.addEventListener("resize",()=>{if(dialog.open)positionAdminDialog();},{passive:true});
})();
