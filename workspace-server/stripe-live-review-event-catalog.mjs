/**
 * Private, metadata-only Stripe LIVE event type catalog.
 * Types are explicitly allowlisted to prevent unreviewed webhook surfaces.
 * The review flag is a request for operator reconciliation, not a payment
 * status, a tenant link, a seat grant, or an authorization source.
 */
export const STRIPE_LIVE_EVENT_PREFIXES=Object.freeze({
 'invoice.paid':'in_',
 'invoice.payment_succeeded':'in_',
 'invoice.payment_failed':'in_',
 'invoice.finalization_failed':'in_',
 'customer.subscription.created':'sub_',
 'customer.subscription.updated':'sub_',
 'customer.subscription.deleted':'sub_',
 'checkout.session.completed':'cs_live_',
 // Stripe LIVE financial reversals / post-payment review triggers.
 'charge.refunded':'ch_',
 'charge.dispute.created':'dp_',
 'charge.dispute.updated':'dp_',
 'charge.dispute.closed':'dp_',
 'charge.dispute.funds_withdrawn':'dp_',
 'charge.dispute.funds_reinstated':'dp_',
 'refund.created':'re_',
 'refund.updated':'re_',
 'refund.failed':'re_',
 'credit_note.created':'cn_',
 'credit_note.updated':'cn_',
 'credit_note.voided':'cn_',
 'invoice.voided':'in_'
});
const REVIEW_CATEGORIES=Object.freeze({
 'charge.refunded':'refund_review',
 'charge.dispute.created':'dispute_review',
 'charge.dispute.updated':'dispute_review',
 'charge.dispute.closed':'dispute_review',
 'charge.dispute.funds_withdrawn':'dispute_review',
 'charge.dispute.funds_reinstated':'dispute_review',
 'refund.created':'refund_review',
 'refund.updated':'refund_review',
 'refund.failed':'refund_review',
 'credit_note.created':'credit_note_review',
 'credit_note.updated':'credit_note_review',
 'credit_note.voided':'credit_note_review',
 'invoice.voided':'invoice_void_review'
});
const REVIEW_OBJECT_TYPES=Object.freeze({
 'charge.refunded':'charge',
 'charge.dispute.created':'dispute',
 'charge.dispute.updated':'dispute',
 'charge.dispute.closed':'dispute',
 'charge.dispute.funds_withdrawn':'dispute',
 'charge.dispute.funds_reinstated':'dispute',
 'refund.created':'refund',
 'refund.updated':'refund',
 'refund.failed':'refund',
 'credit_note.created':'credit_note',
 'credit_note.updated':'credit_note',
 'credit_note.voided':'credit_note',
 'invoice.voided':'invoice'
});
export const stripeLiveReviewCategory=type=>
 Object.hasOwn(REVIEW_CATEGORIES,type)?REVIEW_CATEGORIES[type]:null;
export const stripeLiveReviewObjectType=type=>
 Object.hasOwn(REVIEW_OBJECT_TYPES,type)?REVIEW_OBJECT_TYPES[type]:null;
