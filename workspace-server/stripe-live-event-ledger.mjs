// Private, metadata-only persistence for events already checked by the
// detached cryptographic Stripe LIVE webhook verifier.
// Not a payment attestation or entitlement source.
const types=new Map([
 ['invoice.paid','in_'],
 ['invoice.payment_succeeded','in_'],
 ['invoice.payment_failed','in_'],
 ['invoice.finalization_failed','in_'],
 ['customer.subscription.created','sub_'],
 ['customer.subscription.updated','sub_'],
 ['customer.subscription.deleted','sub_'],
 ['checkout.session.completed','cs_live_']
]);
const fail=code=>{throw Error(code);};
export function createStripeLiveEventLedger({db,clock=Date.now}={}){
 if(typeof db?.prepare!=='function'||typeof clock!=='function')
  fail('invalid_stripe_live_event_ledger');
 return Object.freeze({
  record(event){
   const prefix=types.get(event?.type);
   if(!event||typeof event!=='object'||Array.isArray(event)||
      event.mode!=='live'||event.licensesGranted!==false||
      event.authorizesSeatChanges!==false||
      typeof event.id!=='string'||!/^evt_[A-Za-z0-9_]{4,128}$/.test(event.id)||
      !prefix||typeof event.objectId!=='string'||
      !event.objectId.startsWith(prefix)||
      !/^[A-Za-z0-9_]{4,128}$/.test(event.objectId.slice(prefix.length))||
      !Number.isSafeInteger(event.created)||event.created<1||
      typeof event.digest!=='string'||!/^[a-f0-9]{64}$/.test(event.digest))
    fail('invalid_stripe_live_event');
   const existing=db.prepare('SELECT event_type,object_id,event_created,raw_digest FROM stripe_live_event_log WHERE event_id=?')
     .get(event.id);
   if(existing){
    if(existing.event_type!==event.type||existing.object_id!==event.objectId||
       existing.event_created!==event.created||existing.raw_digest!==event.digest)
      fail('stripe_live_event_conflict');
    return {recorded:false,duplicate:true,licensesGranted:false};
   }
   db.prepare('INSERT INTO stripe_live_event_log VALUES(?,?,?,?,?,?)')
     .run(event.id,event.type,event.objectId,event.created,event.digest,clock());
   return {recorded:true,duplicate:false,licensesGranted:false};
  },
  count(){return db.prepare('SELECT count(*) AS n FROM stripe_live_event_log').get().n;},
  latest(limit=101){
   if(!Number.isSafeInteger(limit)||limit<1||limit>101)fail('invalid_stripe_live_event_limit');
   return db.prepare('SELECT event_type,event_created,received_at FROM stripe_live_event_log ORDER BY received_at DESC,event_id DESC LIMIT ?')
     .all(limit).map(x=>({type:x.event_type,occurredAt:x.event_created*1000,
       receivedAt:x.received_at,linkage:'unassigned',licensesGranted:false}));
  }
 });
}
