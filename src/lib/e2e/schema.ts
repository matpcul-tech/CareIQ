/** Shape checks for e2e API bodies. The server stores ciphertext and wrapped keys only. */
import { z } from "zod";

const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(200_000);
const jwk = z.object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string().max(64), y: z.string().max(64) }).passthrough()
  .refine((k) => !("d" in k), "private key material is not allowed");
export const envelopeSchema = z.object({ v: z.literal(1), kid: z.string().min(1).max(64), iv: b64, ct: b64 }).strict();
const wrappedSchema = z.object({ v: z.literal(1), epk: jwk, salt: b64, iv: b64, wk: b64 }).strict();
const uuid = z.string().uuid();
export const keyWrapSchema = z.object({
  dek_id: uuid,
  recipient_type: z.enum(["patient", "clinic", "family"]),
  recipient_id: z.string().min(1).max(64),
  wrapped_dek: wrappedSchema,
}).strict();

export const enrollSchema = z.object({
  public_jwk: jwk,
  recovery: z.object({ v: z.literal(1), salt: b64, iterations: z.number().int().min(100_000), sealed: envelopeSchema }).strict(),
  dek_id: uuid,
  wraps: z.array(keyWrapSchema).min(1).max(20),
  clinic_consent: z.object({ clinic_id: uuid, granted: z.boolean() }).strict().nullable(),
  recovery_confirmed_at: z.string().datetime(),
}).strict();

export const entrySchema = z.object({
  id: uuid,
  category: z.string().regex(/^[a-z_]{2,32}$/),
  dek_id: uuid,
  envelope: envelopeSchema,
  le8_band: z.enum(["high", "moderate", "low"]).nullable(),
  alert_severity: z.enum(["critical", "high", "informational"]).nullable(),
}).strict();

export const withdrawSchema = z.object({
  clinic_id: uuid,
  new_dek_id: uuid,
  old_dek_id: uuid,
  wraps: z.array(keyWrapSchema).min(1).max(20),
  entries: z.array(entrySchema).max(500),
}).strict();

export const clinicKeySchema = z.object({
  version: z.number().int().min(1).max(1000),
  public_jwk: jwk,
  custody_mode: z.enum(["passphrase", "passphrase_split_2of3"]),
  passphrase_sealed: z.object({ v: z.literal(1), salt: b64, iterations: z.number().int().min(100_000), sealed: envelopeSchema }).strict(),
  recovery_sealed: z.object({ v: z.literal(1), salt: b64, sealed: envelopeSchema }).strict(),
  recovery_confirmed: z.literal(true),
}).strict();
