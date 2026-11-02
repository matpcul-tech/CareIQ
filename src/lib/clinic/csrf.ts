/**
 * Clinic POST requests must send the same CSRF token the browser stored.
 * Middleware also checks this. The route checks again so a skipped middleware
 * hop cannot mint or change clinic data.
 */

export function clinicCsrfFailure(header: string, cookie: string): "missing" | "mismatch" | null {
  if (!header || !cookie) return "missing";
  const token = cookie.split(".")[0];
  if (!token || token !== header) return "mismatch";
  return null;
}
