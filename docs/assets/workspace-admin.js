
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
      const edit=el("button","ua-secondary","Edit permissions");
      edit.type="button";
      edit.setAttribute("aria-label","Edit " + member.name + "'s account and app permissions");
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
    if(!member)return;
    state.editId=member.id;
    fields.reset();
    buildRoles(); // Refresh dropdowns after custom roles are defined in Permission matrix.
    byId("ua-account-heading").textContent="Edit app permissions";
    action.textContent="Save permissions";
    for(const key of ["name","nickname","email"]) {
      const input=fields.elements.namedItem(key);
      input.value=member[key];input.readOnly=true;
    }
    fields.elements.namedItem("organisationAdmin").checked=member.admin;
    selectMap.forEach((select,app)=>{select.value=member.roles[app]||"";});
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
    const original=state.members.find(x=>x.id===state.editId);
    if(!original) {setMessage(message,"Select an existing user.",true);return;}
    const admin=fields.elements.namedItem("organisationAdmin").checked;
    const roles={};
    selectMap.forEach((select,app)=>{if(select.value)roles[app]=select.value;});
    for(const [app,role] of Object.entries(roles)){
      const catalog=window.DuckBioPreviewRoles;
      const valid=catalog?Boolean(catalog.getRole(app,role)):Boolean(appRoles.find(x=>x.name===app)?.roles.includes(role));
      if(!valid){setMessage(message,"Unknown role for "+app+". Please reselect the app role.",true);return;}
    }
    if(original.admin&&!admin&&state.members.filter(x=>x.admin).length===1){
      setMessage(message,"The organisation must retain at least one administrator.",true);return;
    }
    const blocked=checkCapacity(roles,original);
    if(blocked){setMessage(message,"No available "+blocked+" licence. Choose Buy users before granting access to this app.",true);return;}
    Object.assign(original,{admin,roles});
    showPanel("list");
    setMessage(byId("ua-list-message"),"Example role assignments updated. No real app access was changed.",false);
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
    listUsers:()=>state.members.map(member=>({...member,roles:{...member.roles}})),
    isRoleAssigned:(app,role)=>state.members.some(member=>member.roles[app]===role),
    createUser:({name,nickname,email,admin=false})=>{
      name=String(name||"").trim();nickname=String(nickname||"").trim();
      email=String(email||"").trim().toLowerCase();
      if(!name||!nickname||!email||!email.includes("@"))return {error:"Name, nickname and a valid email are required."};
      if(state.members.some(member=>member.email===email))return {error:"A user with this email already exists."};
      const member={id:state.nextId++,name,nickname,email,admin:Boolean(admin),roles:{}};
      state.members.push(member);renderList();
      window.dispatchEvent(new Event("duckbio-preview-users-changed"));
      return {userId:member.id};
    },
    deleteUser:id=>{
      const user=state.members.find(member=>member.id===id);
      if(!user)return {error:"User not found."};
      if(user.admin&&state.members.filter(member=>member.admin).length<=1)return {error:"The last organisation administrator cannot be deleted."};
      state.members=state.members.filter(member=>member.id!==id);
      renderList();window.dispatchEvent(new Event("duckbio-preview-users-changed"));
      return {deleted:true};
    }
  });
  buildRoles();buildBuy();renderList();
  document.querySelectorAll("[data-open-user-admin]").forEach(button=>button.addEventListener("click",openAdmin));
  dialog.querySelectorAll("[data-ua-nav]").forEach(button=>button.addEventListener("click",()=>{
    const next=button.dataset.uaNav;
    showPanel(next);
  }));
  byId("ua-close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  fields.addEventListener("submit",saveAccount);
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
