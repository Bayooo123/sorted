import * as crypto from 'crypto';

/**
 * PLAN.md "Nomba integration" — Nomba's own documented HMAC scheme
 * (developer.nomba.com/docs/api-basics/webhook.md, pasted into chat
 * 2026-10-27, not inferred). The hashing payload is NOT the raw body — it's
 * a fixed, colon-joined string built from nine specific fields inside the
 * parsed payload, HMAC-SHA256'd with the dashboard-configured signature
 * key and base64-encoded. Compared case-insensitively, matching every
 * reference implementation Nomba publishes (Go/Python/JS/Java/C#/PHP all
 * do `EqualFold`/`casecmp`/`toLowerCase()`, unusual for base64 but
 * deliberately matched here rather than "corrected").
 *
 * Shared between NombaConnectAccountProvider and NombaPayoutProvider —
 * both verify against the same single Nomba webhook secret/endpoint,
 * unlike Bachs' three separately-registered webhooks.
 */
export function verifyNombaWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string>,
  secret: string | undefined,
): { valid: boolean; payload: unknown } {
  if (!secret || !rawBody || rawBody.length === 0) return { valid: false, payload: null };

  const signatureHeader = headers['nomba-signature'];
  const timestamp = headers['nomba-timestamp'];
  if (!signatureHeader || !timestamp) return { valid: false, payload: null };

  let payload: {
    event_type?: string;
    requestId?: string;
    data?: {
      merchant?: { userId?: string; walletId?: string };
      transaction?: { transactionId?: string; type?: string; time?: string; responseCode?: string };
    };
  };
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { valid: false, payload: null };
  }

  const merchant = payload.data?.merchant ?? {};
  const transaction = payload.data?.transaction ?? {};
  const responseCode = transaction.responseCode === 'null' ? '' : (transaction.responseCode ?? '');

  const hashingPayload = [
    payload.event_type ?? '',
    payload.requestId ?? '',
    merchant.userId ?? '',
    merchant.walletId ?? '',
    transaction.transactionId ?? '',
    transaction.type ?? '',
    transaction.time ?? '',
    responseCode,
    timestamp,
  ].join(':');

  const expected = crypto.createHmac('sha256', secret).update(hashingPayload).digest('base64');
  const valid = expected.toLowerCase() === signatureHeader.toLowerCase();
  return { valid, payload };
}
