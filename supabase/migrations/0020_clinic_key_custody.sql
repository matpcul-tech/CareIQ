-- Clinic key custody (design: docs/DESIGN-client-encryption.md section 4, option (a) with optional 2 of 3 split).
-- Adds the two sealed copies of the clinic root private key: one under the admin passphrase and one
-- under the printed 24-word recovery key. The server never stores the passphrase, the words, or shares.
-- Used only while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is "true" (default off). Requires 0016.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

alter table public.clinic_keys add column if not exists passphrase_sealed jsonb;
alter table public.clinic_keys add column if not exists recovery_sealed jsonb;
alter table public.clinic_keys add column if not exists created_by_staff uuid references public.clinic_staff(id) on delete set null;

-- Sealed blobs must be ciphertext envelopes, never a raw JWK.
alter table public.clinic_keys drop constraint if exists clinic_keys_sealed_shape;
alter table public.clinic_keys add constraint clinic_keys_sealed_shape check (
  (passphrase_sealed is null or (passphrase_sealed ? 'sealed' and not (passphrase_sealed ? 'd')))
  and (recovery_sealed is null or (recovery_sealed ? 'sealed' and not (recovery_sealed ? 'd')))
);

-- Still locked: RLS forced in 0016, no policies, service role only after the server checks the staff session.
revoke all on public.clinic_keys from anon, authenticated;
