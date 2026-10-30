import { createHash } from 'crypto';

/**
 * PLAN.md "Paga integration" — confirmed against Paga's real published
 * docs (developer-docs.paga.com, pasted into chat 2026-10-30).
 *
 * Paga's "Hashing" page: concatenate the documented fields IN ORDER,
 * append the HMAC secret key (the dashboard calls it "hashkey") at the
 * end of the string, then SHA-512 the whole thing and hex-encode it — a
 * PLAIN hash of (data + secret), NOT a keyed HMAC construction, despite
 * some pages calling it "HMAC SHA-512". Two independent worked examples
 * agree exactly on this plain-concatenation mechanism: the general
 * Hashing page's own Deposit To Bank walkthrough, and the Deposit To
 * Bank operation page itself (same fields, same formula, matching
 * example output). The Persistent Payment Identifier page's own JS
 * sample contradicts this — it lists different/extra fields AND calls
 * `crypto.createHmac("sha512")` with no key argument, which would throw
 * at runtime — treated as a documentation bug, not followed here. Going
 * with the TABLE on that page (its explicit hashIndex-1..6 ordering),
 * not its prose or its broken code sample, since the table is the most
 * structured/authoritative of the three conflicting statements.
 *
 * "Omit any empty/null fields but do not change the order" (the
 * Persistent Payment Identifier page's own instruction) — applied here
 * for every endpoint, not just that one, since it can't hurt the
 * endpoints whose hash fields are all mandatory anyway.
 */
export function pagaHash(orderedFields: Array<string | number | null | undefined>, hashKey: string): string {
  const concatenated = orderedFields
    .filter((f) => f !== null && f !== undefined && f !== '')
    .map((f) => String(f))
    .join('');
  return createHash('sha512').update(concatenated + hashKey).digest('hex');
}
