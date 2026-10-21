-- Tracks the connected account's "transfers" capability (recipient persona),
-- separate from the existing capabilityStatus (which only ever tracked
-- virtual_accounts / merchant persona). Set by EnoughWebhookController on a
-- capability.updated webhook for "transfers".
ALTER TABLE "EnoughAccount" ADD COLUMN "transfersCapabilityStatus" "EnoughAccountStatus";
