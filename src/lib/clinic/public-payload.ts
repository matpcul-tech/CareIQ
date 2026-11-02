/**
 * Clinic HTTP responses must not carry a staff session.
 * A previous bug signed a staff token whenever a response included
 * staff_id, clinic_id, and a staff role, which let a patient grant
 * themselves provider access. Strip those fields and never add a token.
 */
export function toPublicClinicPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.staff_token;
  delete copy.sign_in;
  delete copy.staff_id;
  delete copy.email_hash;
  delete copy.auth_user_id;
  return copy;
}
