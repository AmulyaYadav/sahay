/**
 * Contact-detail redaction for free-text fields (request notes, chat messages).
 * Phone numbers must never flow through Sahay, so any run of 8 or more digits —
 * even when the digits are separated by spaces or dashes ("98765 43210",
 * "12-34-56-78") — is replaced with a placeholder BEFORE storage. Applied
 * server-side regardless of what the client already did.
 */
export const REDACTED = '‹…›';

/** A digit followed by ≥7 more digits, allowing spaces/dashes between them. */
const LONG_DIGIT_RUN = /\d(?:[\s-]*\d){7,}/g;

export function redactContactDetails(text: string): string {
  return text.replace(LONG_DIGIT_RUN, REDACTED);
}
