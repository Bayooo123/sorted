/**
 * Shared between main.ts (a normal long-running process, e.g. local dev or
 * a non-serverless host) and api/index.ts (Vercel's serverless entry) so
 * the two bootstrap paths can't drift on which origins are allowed.
 */
export function corsOrigins(): string[] {
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  if (configured) return configured.split(',').map((o) => o.trim());
  return ['https://sorted.com.ng', 'https://www.sorted.com.ng', 'http://localhost:3000', 'http://localhost:5173'];
}
