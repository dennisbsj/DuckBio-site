import {STRIPE_LIVE_EVENT_PREFIXES,stripeLiveReviewCategory,stripeLiveEventIdMatches} from './stripe-live-review-event-catalog.mjs';
// Private, metadata-only persistence for events already checked by the
// detached cryptographic Stripe LIVE webhook verifier.
// Not a payment attestation or entitlement source.

const fail=code=>{throw Error(code);};
export function createStripeLiveEventLedger({db,clock=Date.now}={}){
 if(typeof db?.prepare!=='function'||typeof clock!=='function')
  fail('invalid_stripe_live_event_ledger');
 return Object.freeze({
  record(event){
   const reviewRequired=stripeLiveReviewCategory(event?.type)!==null;
   if(!event||typeof event!=='object'||Array.isArray(event)||
      event.mode!=='live'||event.licensesGranted!==false||
      event.authorizesSeatChanges!==false||
      // Preserve legacy verified non-review metadata (which had no flag).
      // All NEW reversal signals must explicitly carry a true review flag.
      (reviewRequired?event.financialReviewRequired!==true:
        event.financialReviewRequired!==undefined&&
        event.financialReviewRequired!==false)||
      typeof event.id!=='string'||!/^evt_[A-Za-z0-9_]{4,128}$/.test(event.id)||
      !stripeLiveEventIdMatches(event.type,event.objectId)||
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
  // Private internal worker API: source IDs needed for independent Stripe
  // lookups must never be included in owner/browser diagnostic snapshots.
  readPrivate(eventId){
   if(typeof eventId!=='string'||!/^evt_[A-Za-z0-9_]{4,128}$/.test(eventId))
    return null;
   const row=db.prepare('SELECT event_id,event_type,object_id,event_created,raw_digest FROM stripe_live_event_log WHERE event_id=?')
    .get(eventId);
   if(!row||!stripeLiveEventIdMatches(row.event_type,row.object_id)||
      stripeLiveReviewCategory(row.event_type)===null||
      typeof row.raw_digest!=='string'||!/^[a-f0-9]{64}$/.test(row.raw_digest))
    return null;
   return Object.freeze({
    eventId:row.event_id,eventType:row.event_type,
    objectId:row.object_id,created:row.event_created,
    rawDigest:row.raw_digest,
    reviewCategory:stripeLiveReviewCategory(row.event_type),
    licensesGranted:false,authorizesSeatChanges:false
   });
  },
  count(){return db.prepare('SELECT count(*) AS n FROM stripe_live_event_log').get().n;},
  latest(limit=101){
   if(!Number.isSafeInteger(limit)||limit<1||limit>101)fail('invalid_stripe_live_event_limit');
   return db.prepare('SELECT event_type,event_created,received_at FROM stripe_live_event_log ORDER BY received_at DESC,event_id DESC LIMIT ?')
     .all(limit).map(x=>({type:x.event_type,occurredAt:x.event_created*1000,
       receivedAt:x.received_at,linkage:'unassigned',licensesGranted:false,
       financialReviewRequired:stripeLiveReviewCategory(x.event_type)!==null,
       reviewCategory:stripeLiveReviewCategory(x.event_type)}));
  }
 });
}
