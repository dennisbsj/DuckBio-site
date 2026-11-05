/* DuckBio Workspace preview: app-scoped role definitions and account creation.
 * All changes are in memory only. No real auth, payment, or role provisioning.
 * Standard role names and permissions mirror the shared suite policy snapshot. */
(() => {
  "use strict";
  const POLICY = {"LabDuck":{"capabilities":["audit.view","data.export","inventory.edit","sample.create","sample.edit","sample.sign.analyst","sample.sign.reviewer","workspace.view"],"roles":{"Analyst":{"permissions":["workspace.view","sample.create","sample.edit","inventory.edit","sample.sign.analyst","audit.view","data.export"]},"QC":{"permissions":["workspace.view","sample.sign.reviewer","audit.view","data.export"]},"QA":{"permissions":"*"},"Admin":{"permissions":"*"}}},"CytoDuck":{"capabilities":["analysis.edit","analysis.review","batch.run","data.export","gating.edit","report.create","report.review","workspace.view"],"roles":{"Analyst":{"permissions":["workspace.view","analysis.edit","gating.edit","batch.run","report.create","data.export"]},"Reviewer":{"permissions":["workspace.view","analysis.review","report.review","data.export"]},"QA":{"permissions":"*"},"Admin":{"permissions":"*"},"ReadOnly":{"permissions":["workspace.view","data.export"]}}},"DuckPipe":{"capabilities":["audit.view","data.export","experiment.execute","method.edit","plan.edit","result.edit","result.review","result.sign.analyst","result.sign.reviewer","workspace.view"],"roles":{"Analyst":{"permissions":["workspace.view","method.edit","plan.edit","experiment.execute","result.edit","result.sign.analyst","audit.view","data.export"]},"Reviewer":{"permissions":["workspace.view","result.review","result.sign.reviewer","audit.view","data.export"]},"QA":{"permissions":"*"},"Admin":{"permissions":"*"},"ReadOnly":{"permissions":["workspace.view","audit.view","data.export"]}}},"DuckNote":{"capabilities":["attachment.manage","audit.view","data.export","document.approve","document.author_sign","document.create","document.edit","document.review","document.submit","template.use","workspace.view"],"roles":{"scientist":{"permissions":["workspace.view","document.create","document.edit","document.author_sign","document.submit","attachment.manage","template.use","audit.view","data.export"]},"reviewer":{"permissions":["workspace.view","document.review","document.approve","audit.view","data.export"]},"read_only":{"permissions":["workspace.view","audit.view","data.export"]},"admin":{"permissions":"*"},"owner":{"permissions":"*"}}},"DuckMan":{"capabilities":["approval.withdraw","audit.view","authoring_task.complete","controlled_copy.issue","data.export","document.approve","document.create","document.download","document.edit","document.make_effective","document.reject","document.review","document.revise","periodic_review.manage","review_task.complete","workflow.start","workspace.view"],"roles":{"editor":{"permissions":["workspace.view","document.create","document.edit","document.revise","workflow.start","controlled_copy.issue","authoring_task.complete","audit.view","data.export"]},"reviewer":{"permissions":["workspace.view","document.review","document.approve","document.reject","approval.withdraw","document.make_effective","periodic_review.manage","review_task.complete","audit.view","data.export"]},"read_only":{"permissions":["workspace.view","document.download","audit.view","data.export"]},"admin":{"permissions":"*"}}},"DuckTrain":{"capabilities":["audit.view","qualification.manage","report.view","training.assign","training.complete","training.signoff","training.view","training.view_assigned","workspace.view"],"roles":{"Learner":{"permissions":["workspace.view","training.view_assigned","training.complete"]},"Trainer":{"permissions":["workspace.view","training.view","training.assign","training.signoff","qualification.manage","report.view","audit.view"]},"QA":{"permissions":"*"},"Admin":{"permissions":"*"},"ReadOnly":{"permissions":["workspace.view","report.view","audit.view"]}}}};
  const byId = id => document.getElementById(id);
  const apps = Object.keys(POLICY);
  const custom = Object.fromEntries(apps.map(app=>[app,new Map()]));
  const friendly = {scientist:"Scientist",read_only:"Read only",ReadOnly:"Read only",admin:"Admin",owner:"Owner",editor:"Editor",reviewer:"Reviewer"};
  const roleName = value => friendly[value] || value;
  const textNode = (tag,text,className) => {
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  };
  const listRoles = app => {
    if(!POLICY[app])return [];
    const defaults=Object.entries(POLICY[app].roles).map(([name,data])=>({
      name,standard:true,all:data.permissions==="*",
      permissions:data.permissions==="*"?[...POLICY[app].capabilities]:[...data.permissions]
    }));
    return defaults.concat([...custom[app].values()].map(data=>({...data,standard:false,all:false,permissions:[...data.permissions]})));
  };
  const getRole = (app,name) => listRoles(app).find(role=>role.name===name);
  window.DuckBioPreviewRoles=Object.freeze({apps:[...apps],listRoles,getRole});
  const matrix=byId("perm-matrix"), members=byId("perm-org");
  if(!matrix || !members)return;

  matrix.replaceChildren();
  const titleRow=textNode("div",undefined,"role-head");
  const header=textNode("div");
  header.append(textNode("h3","Permission matrix"),textNode("p","Standard roles are read-only. Add app-specific custom roles with the + button.","perm-caption"));
  const add=textNode("button","+ Create role","ua-primary");
  add.type="button";add.id="role-create";
  titleRow.append(header,add);matrix.append(titleRow);
  const selector=textNode("label",undefined,"ua-field");
  selector.append(textNode("span","Application"));
  const appSelect=document.createElement("select");
  appSelect.id="role-matrix-app";appSelect.setAttribute("aria-label","Application for permission matrix");
  for(const app of apps){const opt=textNode("option",app);opt.value=app;appSelect.append(opt);}
  selector.append(appSelect);matrix.append(selector);
  const matrixNote=textNode("p","Select a role to inspect its permissions. Assign roles to users in User administration.","ua-hint");
  matrix.append(matrixNote);
  const roleList=textNode("div",undefined,"role-catalogue");roleList.id="role-catalogue";matrix.append(roleList);
  const status=textNode("p",undefined,"ua-message");status.id="role-matrix-status";status.setAttribute("role","status");matrix.append(status);

  members.replaceChildren();
  members.append(textNode("h3","Create or delete users"),textNode("p","Manage organisation identities here. App access and role assignments are managed separately in User administration.","perm-caption"));
  const memberToolbar=textNode("div",undefined,"ua-toolbar");
  memberToolbar.append(textNode("strong","Organisation accounts"));
  const memberCreate=textNode("button","+ Create user","ua-primary");memberCreate.type="button";memberToolbar.append(memberCreate);
  members.append(memberToolbar);
  const membersTable=textNode("div",undefined,"ua-table-wrap");
  membersTable.innerHTML='<table class="ua-table"><thead><tr><th>Name / email</th><th>Nickname</th><th>Workspace role</th><th>Actions</th></tr></thead><tbody id="role-member-rows"></tbody></table>';
  members.append(membersTable);
  const memberStatus=textNode("p",undefined,"ua-message");memberStatus.id="role-member-status";memberStatus.setAttribute("role","status");members.append(memberStatus);

  function buildDialog(id,title) {
    const dlg=document.createElement("dialog");dlg.className="launcher-dialog ua-dialog ua-role-dialog";dlg.id=id;dlg.setAttribute("aria-labelledby",id+"-title");
    const head=textNode("div",undefined,"modal-head");
    const text=textNode("div");text.append(textNode("p","Organisation administration · preview","modal-eyebrow"),textNode("h2",title));text.querySelector("h2").id=id+"-title";
    const close=textNode("button","×","modal-close");close.type="button";close.setAttribute("aria-label","Close dialog");close.addEventListener("click",()=>dlg.close());
    head.append(text,close);dlg.append(head);
    dlg.addEventListener("click",evt=>{if(evt.target===dlg)dlg.close();});
    document.body.append(dlg);
    return dlg;
  }
  const editor=buildDialog("role-editor","Create custom role");
  const form=document.createElement("form");form.id="role-editor-form";
  const formGrid=textNode("div",undefined,"ua-grid");
  const appField=textNode("label",undefined,"ua-field");appField.append(textNode("span","Application"));
  const editorApp=document.createElement("select");editorApp.name="app";editorApp.required=true;
  for(const app of apps){const opt=textNode("option",app);opt.value=app;editorApp.append(opt);}
  appField.append(editorApp);
  const nameField=textNode("label",undefined,"ua-field");nameField.append(textNode("span","Role name"));
  const roleInput=document.createElement("input");roleInput.name="roleName";roleInput.required=true;roleInput.maxLength=80;roleInput.minLength=2;roleInput.placeholder="e.g. Laboratory supervisor";
  nameField.append(roleInput);formGrid.append(appField,nameField);form.append(formGrid);
  form.append(textNode("h3","Permissions","ua-section-title"),textNode("p","Select the exact capabilities for this role. Unchecked capabilities remain denied.","ua-hint"));
  const checkList=textNode("div",undefined,"role-checkbox-grid");checkList.id="role-permission-options";form.append(checkList);
  const msg=textNode("p",undefined,"ua-message");msg.id="role-editor-message";msg.setAttribute("role","status");form.append(msg);
  const footer=textNode("div",undefined,"ua-modal-footer");
  const cancel=textNode("button","Cancel","ua-secondary");cancel.type="button";cancel.addEventListener("click",()=>editor.close());
  const save=textNode("button","Create role","ua-primary");save.type="submit";
  footer.append(cancel,save);form.append(footer);editor.append(form);

  const userDialog=buildDialog("role-user-dialog","Create user");
  userDialog.append(textNode("p","Create an account here; grant app access in User administration.","ua-hint"));
  const userForm=document.createElement("form");userForm.id="role-create-user-form";userForm.autocomplete="off";
  const userGrid=textNode("div",undefined,"ua-grid");
  for(const [field,label,type,placeholder] of [["name","Name","text","Full name"],["nickname","Nickname","text","Display name"],["email","Email","email","name@organisation.com"]]){
    const wrap=textNode("label",undefined,"ua-field");wrap.append(textNode("span",label));
    const input=document.createElement("input");input.name=field;input.type=type;input.maxLength=field==="email"?254:field==="nickname"?80:120;input.required=true;input.placeholder=placeholder;
    wrap.append(input);userGrid.append(wrap);
  }
  userForm.append(userGrid);
  const adminLine=textNode("label",undefined,"ua-checkline");
  const adminBox=document.createElement("input");adminBox.type="checkbox";adminBox.name="admin";adminLine.append(adminBox,textNode("span","Organisation administrator (also a normal user)"));userForm.append(adminLine);
  const userMsg=textNode("p",undefined,"ua-message");userMsg.id="role-create-user-message";userMsg.setAttribute("role","status");userForm.append(userMsg);
  const userFooter=textNode("div",undefined,"ua-modal-footer");
  const userCancel=textNode("button","Cancel","ua-secondary");userCancel.type="button";userCancel.addEventListener("click",()=>userDialog.close());
  const create=textNode("button","Create user","ua-primary");create.type="submit";userFooter.append(userCancel,create);userForm.append(userFooter);userDialog.append(userForm);

  let editing=null;
  let currentApp=apps[0];
  function permissionLabel(permission){
    return permission.replaceAll("_"," ").split(".").map((part,i)=>i===0?part.charAt(0).toUpperCase()+part.slice(1):part).join(" · ");
  }
  function populateChecks(app,checked){
    checkList.replaceChildren();
    const grouped=new Map();
    for(const permission of POLICY[app].capabilities){
      const group=permission.split(".")[0];
      if(!grouped.has(group))grouped.set(group,[]);
      grouped.get(group).push(permission);
    }
    for(const [group,values] of grouped){
      const block=textNode("fieldset",undefined,"role-check-group");
      block.append(textNode("legend",group.charAt(0).toUpperCase()+group.slice(1)));
      for(const permission of values){
        const label=textNode("label",undefined,"ua-checkline");
        const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.name="permission";checkbox.value=permission;checkbox.checked=checked.has(permission);
        const part=textNode("span",permissionLabel(permission));
        const code=textNode("small",permission,"role-perm-key");part.append(code);
        label.append(checkbox,part);block.append(label);
      }
      checkList.append(block);
    }
  }
  editorApp.addEventListener("change",()=>populateChecks(editorApp.value,new Set()));
  function positionModal(dlg){
    let top=12,available=Math.max(200,window.innerHeight-24);
    try{
      if(window.parent!==window&&window.frameElement){
        const rect=window.frameElement.getBoundingClientRect();
        const pv=window.parent.visualViewport;
        const start=Math.max(0,(pv?.offsetTop||0)-rect.top);
        const end=Math.min(rect.height,(pv?.offsetTop||0)+(pv?.height||window.parent.innerHeight)-rect.top);
        if(end-start>110){top=start+8;available=end-start-16;}
      }
    }catch(error){}
    dlg.style.setProperty("--launcher-visible-top",top+"px");
    dlg.style.setProperty("--launcher-visible-height",Math.max(140,available)+"px");
  }
  function openModal(dlg){
    positionModal(dlg);dlg.showModal();dlg.querySelector("input:not([type=hidden]),select")?.focus({preventScroll:true});
  }
  function openEditor(app,role){
    editing=role&& !role.standard?{app,name:role.name}:null;
    form.reset();
    editor.querySelector("h2").textContent=editing?"Edit custom role":"Create custom role";
    save.textContent=editing?"Save role":"Create role";
    editorApp.value=app;editorApp.disabled=Boolean(editing);
    roleInput.value=editing?role.name:"";
    populateChecks(app,new Set(role?role.permissions:[]));
    msg.textContent="";
    openModal(editor);
  }
  function isAssigned(app,roleName){
    const api=window.DuckBioWorkspacePreviewAdmin;
    return Boolean(api?.isRoleAssigned(app,roleName));
  }
  function issueError(node,text){node.textContent=text;node.dataset.error="true";}
  function clearError(node,text){node.textContent=text||"";node.dataset.error="false";}
  function saveRole(event){
    event.preventDefault();
    if(!form.reportValidity())return;
    const app=editorApp.value;
    const name=roleInput.value.trim();
    if(!POLICY[app])return issueError(msg,"Select a valid application.");
    if(name.length<2||name.length>80)return issueError(msg,"Role name must be 2–80 characters.");
    if(name.includes("<")||name.includes(">"))return issueError(msg,"Please use a plain-text role name.");
    const perms=[...checkList.querySelectorAll('input[name="permission"]:checked')].map(item=>item.value);
    if(!perms.length)return issueError(msg,"Select at least one permission.");
    if(editing&&isAssigned(editing.app,editing.name)&&name!==editing.name)return issueError(msg,"A role in use cannot be renamed.");
    const duplicate=listRoles(app).some(role=>role.name.toLocaleLowerCase()===name.toLocaleLowerCase()&&(!editing||role.name!==editing.name));
    if(duplicate)return issueError(msg,"A role with this name already exists for that app.");
    if(editing && name!==editing.name)custom[app].delete(editing.name);
    custom[app].set(name,{name,permissions:perms});
    editor.close();currentApp=app;appSelect.value=app;renderRoles();
    clearError(status,(editing?"Updated":"Created")+" custom role “"+name+"” in the preview.");
    window.dispatchEvent(new Event("duckbio-preview-roles-changed"));
  }
  form.addEventListener("submit",saveRole);

  function renderRoles(){
    roleList.replaceChildren();
    const definitions=listRoles(currentApp);
    for(const role of definitions){
      const card=textNode("div",undefined,"role-definition");
      const top=textNode("div",undefined,"role-definition-top");
      const identity=textNode("div");
      identity.append(textNode("strong",roleName(role.name)),textNode("span",role.standard?"Standard":"Custom","ua-tag"+(role.standard?"":" admin")));
      if(role.all)identity.append(textNode("small","Full access (standard wildcard role)","role-meta"));
      else identity.append(textNode("small",role.permissions.length+" / "+POLICY[currentApp].capabilities.length+" permissions","role-meta"));
      top.append(identity);
      const buttons=textNode("div",undefined,"ua-actions");
      const detail=textNode("button","View permissions","ua-secondary");detail.type="button";
      buttons.append(detail);
      if(!role.standard){
        const edit=textNode("button","Edit","ua-secondary");edit.type="button";edit.addEventListener("click",()=>openEditor(currentApp,role));
        const remove=textNode("button","Delete","ua-secondary");remove.type="button";remove.addEventListener("click",()=>{
          if(isAssigned(currentApp,role.name)){issueError(status,"Cannot delete “"+role.name+"” while it is assigned to a user. Remove the assignment in User administration first.");return;}
          if(!window.confirm("Delete custom role “"+role.name+"” from "+currentApp+"?"))return;
          custom[currentApp].delete(role.name);renderRoles();clearError(status,"Custom role deleted from this preview.");
          window.dispatchEvent(new Event("duckbio-preview-roles-changed"));
        });
        buttons.append(edit,remove);
      }
      top.append(buttons);card.append(top);
      const details=textNode("div",undefined,"role-definition-details");details.hidden=true;
      const set=new Set(role.permissions);
      for(const permission of POLICY[currentApp].capabilities){
        const label=textNode("label",undefined,"role-readonly-item");
        const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.disabled=true;checkbox.checked=set.has(permission);
        label.append(checkbox,textNode("span",permissionLabel(permission)));details.append(label);
      }
      card.append(details);
      detail.addEventListener("click",()=>{details.hidden=!details.hidden;detail.textContent=details.hidden?"View permissions":"Hide permissions";detail.setAttribute("aria-expanded",String(!details.hidden));});
      roleList.append(card);
    }
  }
  add.addEventListener("click",()=>openEditor(currentApp,null));
  appSelect.addEventListener("change",()=>{currentApp=appSelect.value;renderRoles();clearError(status,"");});
  renderRoles();

  function renderMembers(){
    const body=byId("role-member-rows");body.replaceChildren();
    const api=window.DuckBioWorkspacePreviewAdmin;
    if(!api)return;
    for(const user of api.listUsers()){
      const row=textNode("tr");
      const person=textNode("td");person.append(textNode("strong",user.name),textNode("small",user.email));
      row.append(person,textNode("td",user.nickname),textNode("td",user.admin?"Admin + user":"User"));
      const actions=textNode("td");
      const remove=textNode("button","Delete user","ua-secondary");remove.type="button";
      remove.setAttribute("aria-label","Delete "+user.name);
      remove.addEventListener("click",()=>{
        if(!window.confirm("Delete "+user.name+" and revoke their app assignments in this preview?"))return;
        const result=api.deleteUser(user.id);
        if(result.error)issueError(memberStatus,result.error);
        else{renderMembers();clearError(memberStatus,"Example user deleted. No real accounts were changed.");}
      });
      actions.append(remove);row.append(actions);body.append(row);
    }
  }
  memberCreate.addEventListener("click",()=>{
    userForm.reset();clearError(userMsg,"");openModal(userDialog);
  });
  userForm.addEventListener("submit",event=>{
    event.preventDefault();if(!userForm.reportValidity())return;
    const api=window.DuckBioWorkspacePreviewAdmin;
    if(!api)return issueError(userMsg,"User administration preview is unavailable.");
    const result=api.createUser({
      name:userForm.elements.namedItem("name").value,
      nickname:userForm.elements.namedItem("nickname").value,
      email:userForm.elements.namedItem("email").value,
      admin:userForm.elements.namedItem("admin").checked
    });
    if(result.error)return issueError(userMsg,result.error);
    userDialog.close();renderMembers();
    clearError(memberStatus,"User created without app access. Assign a role in User administration.");
  });
  window.addEventListener("duckbio-preview-users-changed",renderMembers);
  renderMembers();
  window.addEventListener("resize",()=>{for(const dlg of [editor,userDialog])if(dlg.open)positionModal(dlg);},{passive:true});
  if(window.parent!==window){
    try{
      window.parent.addEventListener("scroll",()=>{for(const dlg of [editor,userDialog])if(dlg.open)positionModal(dlg);},{passive:true});
      window.parent.addEventListener("resize",()=>{for(const dlg of [editor,userDialog])if(dlg.open)positionModal(dlg);},{passive:true});
    }catch(error){}
  }
})();
