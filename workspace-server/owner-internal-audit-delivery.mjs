// Private owner-notification bridge from the existing transactional org audit
// to DuckBio-only bill mailbox and security chat. No external mail is involved.
// Called on a bounded server cadence; never exposed as a browser action.
export function deliverOwnerInternalAudit({organizationStore,communicationsStore,limit=100}={}){
 if(typeof organizationStore?.ownerCommunicationEvents!=='function'||
    typeof communicationsStore?.ownerAuditCursor!=='function'||
    typeof communicationsStore?.advanceOwnerAuditCursor!=='function'||
    !Number.isSafeInteger(limit)||limit<1||limit>100)
  throw Error('Invalid owner internal audit bridge');
 const after=communicationsStore.ownerAuditCursor();
 const events=organizationStore.ownerCommunicationEvents(after,limit);
 let billing=0,security=0;
 for(const event of events){
  if(!Number.isSafeInteger(event.auditId)||event.auditId<=after)
   throw Error('Invalid ordered owner audit event');
  if(event.category==='billing'){
   communicationsStore.postSubscriptionNotice({
    reference:'audit-'+event.auditId,
    organizationName:event.organizationName,
    description:event.description
   });
   billing++;
  }else if(event.category==='security'){
   communicationsStore.postSecurityAlert({
    reference:'audit-'+event.auditId,
    description:event.description
   });
   security++;
  }else if(event.category!==null)throw Error('Invalid owner event category');
  // After delivery (or an irrelevant audit item) only. Delivery is idempotent:
  // if we crash between SQLite databases, replay cannot create a duplicate.
  communicationsStore.advanceOwnerAuditCursor(event.auditId);
 }
 return {processed:events.length,billing,security,cursor:communicationsStore.ownerAuditCursor()};
}
