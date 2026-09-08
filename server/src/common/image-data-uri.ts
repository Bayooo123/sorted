/**
 * Shared by every module storing a photo as base64-in-Postgres (a
 * deliberate pilot-scale choice, not the long-term one — see PLAN.md
 * "Profile photo + KYC apply flow"). Originally lived only in
 * identity.service.ts (avatarBase64/KycRequest.documentBase64); pulled out
 * here once Gigs needed the same check for gig submission proof photos.
 */

// ~2.6MB raw image, ~3.5MB once base64-encoded — leaves headroom under
// Vercel's serverless request body ceiling (see main.ts/api/index.ts's
// bodyParser limit) after JSON envelope overhead.
export const MAX_IMAGE_DATA_URI_LENGTH = 3_500_000;
const IMAGE_DATA_URI_RE = /^data:image\/(png|jpe?g|webp);base64,/i;

export function isValidImageDataUri(value: string): boolean {
  return IMAGE_DATA_URI_RE.test(value) && value.length <= MAX_IMAGE_DATA_URI_LENGTH;
}
