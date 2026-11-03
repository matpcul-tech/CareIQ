# Migration path: patient keys and on-device encrypted entries

Design step: phase 2 (PR 3, tables) together with the first part of phase 4 (PR 5, patient enrollment, recovery code, and encrypting new entries). See `docs/DESIGN-client-encryption.md`, section 11.

## What ships in this PR

- Migration `supabase/migrations/0016_e2e_patient_keys.sql`: `clinic_keys`, `user_keys`, `key_wraps`, `key_consents`, `patient_e2e_entries`. RLS on, direct access revoked, service role only. NOT APPLIED.
- Library: `src/lib/e2e/recovery.ts`, `src/lib/e2e/patient.ts`, `src/lib/e2e/schema.ts`, `src/lib/e2e/flag.ts`.
- Routes `/api/e2e/enroll`, `/api/e2e/entries`, `/api/e2e/consent` and page `/secure-setup`. All return 404 unless the flag is on.
- Flag `NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1`, on only for the exact string `true`. Not set anywhere. No env changes in this PR.

## Order of rollout (each step needs owner approval)

1. Merge with the flag unset. Nothing changes for existing users. `src/lib/crypto.ts`, `ENCRYPTION_KEY`, and all `/api/onboard/*` routes keep working.
2. Apply `0016_e2e_patient_keys.sql` to komimlqbxekranbijtat. It only creates new tables; it does not alter or read existing ones. Rollback: drop the five new tables (they hold no legacy data).
3. Turn the flag on in a Vercel preview only and test with synthetic patients.
4. Turn the flag on in production. New entries for enrolled patients go to `patient_e2e_entries`. Patients who have not enrolled keep using the legacy server-encrypted flow.
5. Later PRs: LE8 and biomarkers in the browser, clinic custody (PR 4), legacy row migration and removal of `ENCRYPTION_KEY` (PR 8). Until PR 8, marketing must not claim that CareIQ cannot read health records.

## Recovery and loss

Solo patients must type their recovery code back before any health entry can be written. If a patient loses every device and the recovery code, and did not consent to a clinic wrap, their encrypted entries cannot be recovered by anyone, including CareIQ. Clinic contracts must state the same for clinic keys.

## PR 8: patient-run move of legacy records (flag off, NOT APPLIED)

Migration `supabase/migrations/0021_e2e_legacy_migration.sql` adds `e2e_legacy_migrations`, a ledger of ids and outcome only. It depends on 0016. Needs owner approval before it runs against komimlqbxekranbijtat.

How it works: the patient opens `/secure-setup/migrate` (only while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is "true"). The page needs a confirmed recovery code and an unlocked device. `POST /api/e2e/migrate` opens only the signed-in patient's own legacy rows (profile, health history, manual labs inside the history row, biomarker_log, wearable_data). The browser re-encrypts each with the patient's active data key, saves it, reads it back, decrypts it, and only then the server records a ledger row. Rerunning is safe. Legacy rows are kept; a later cleanup step needs separate owner approval. Uploaded lab files (Storage objects) are not moved yet.
