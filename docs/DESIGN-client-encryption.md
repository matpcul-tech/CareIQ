# Design: On-Device Encryption with Clinic-Held Keys (CareIQ + care-os)

Status: DRAFT for owner review. DECISION: custody option (a) passphrase plus printed recovery key, with optional 2 of 3 split, APPROVED by owner Matthew Culwell on 2026-11-02. Step 1 only. No code, env, or database changes.
Author: Grok Bot for Matthew Culwell. Date: 2026-11-02.

## Plain language summary

Today CareIQ encrypts health data on our server with one key that we (the operator) hold in Vercel. That means we, or anyone who steals that key, could read patient data.

This design moves encryption onto the patient's and the clinic's own devices. Each health center gets its own master key that the clinic holds, not us. Each patient's records are locked with a data key, and copies of that data key are locked for the patient, for the clinic care team, and for family members the patient approves. Our server, Supabase, and Vercel only ever store scrambled data.

The cost: the server can no longer read health values, so scores (LE8), lab grades, and care-os alerts must be computed on the device and sent as small signed alerts. Search and AI over raw records move to the browser too.

For v1 we recommend the clinic admin holds a passphrase plus a printed recovery key, with an optional 2 of 3 split of that recovery key for tribal council or clinic leadership. Build time is about 9 to 11 weeks for one person, in 8 PRs.

## 1. Current state (from code audit, main as of 2026-11-02)

- `CareIQ/src/lib/crypto.ts` (server only): AES-256-GCM with `process.env.ENCRYPTION_KEY`, one key for all tenants.
- Called by server routes: `src/app/api/onboard/{profile,health-history,manual-labs,upload}/route.ts`, `src/app/api/shield/decrypt/route.ts`, `src/app/api/wearable/latest/route.ts`.
- Server reads plaintext for: LE8 (`src/lib/le8.ts`), biomarker status and trends (`src/lib/biomarker-ranges`), panel grade in manual-labs, clinical dashboard (`src/app/clinical/page.tsx`).
- `care-os/src/lib/vault-crypto.ts`: AES-256-GCM vault with `VAULT_KEY_HEX` (server env).
- `care-os/src/app/api/alerts/route.ts`: receives vitals (a1c, ldl, bp) and panel grade changes, HMAC verified with `CAREIQ_ALERT_SIGNING_KEY`, sends email and SMS.
- Browser today only does SHA-256 hashing and HMAC; no client-side encryption ever existed.

## 2. Threat model

Assets: patient profile, history, labs, wearable data, uploaded files, CareCircle messages and vault files.

| Party | After v1 CAN see | After v1 CANNOT see |
|---|---|---|
| Server operator (us) | Account emails, clinic membership, row ids, timestamps, sizes, which user accessed which record, minimal alert payloads (patient pseudonym, alert type, severity) | Health values, notes, files, LE8 inputs, lab values |
| DB breach (Supabase dump) | Same metadata plus ciphertext and wrapped keys | Plaintext, unless attacker also gets a clinic passphrase or device |
| Vercel | Request metadata, code we deploy | Plaintext at rest. NOTE: Vercel serves the JavaScript, so a malicious or compromised deploy could ship code that exfiltrates keys in the browser. This is the main residual risk of all web E2E systems. |
| Supabase staff | Same as DB breach | Plaintext |
| Clinic admin | Everything in their clinic | Other clinics |
| Stolen unlocked device | That user's accessible records | Others' records; non-extractable keys cannot be copied off the device |

Mitigations for the code delivery risk: Subresource Integrity on scripts, strict CSP (already in middleware), signed release tags, a published build hash, and optional later a packaged app (PWA pinned or Tauri) for clinic staff.

Out of scope for v1: hiding metadata (who is a patient at which clinic), protection against a fully compromised endpoint.

## 3. Key hierarchy

All crypto uses WebCrypto (`crypto.subtle`). No new crypto library required.

```
Clinic Root Key (CRK)      ECDH P-256 key pair per clinic
  private part: wrapped by clinic custody (section 4), never stored in plaintext anywhere
  public part: stored in DB, used by anyone to wrap keys TO the clinic

User Device Key (UDK)      ECDH P-256 key pair per user per device
  private: generated non-extractable, stored in IndexedDB
  public: stored in DB (device registry)

User Account Key (UAK)     ECDH P-256 key pair per user (patient or staff)
  private: wrapped to each of the user's devices, and to a user recovery code
  lets a user add a new device without the clinic

Record Data Key (DEK)      AES-GCM 256, one per patient record set (per patient per category: profile, labs, history, wearable, files)
  wrapped to: patient UAK, clinic CRK public key, each consented family member UAK
```

- Wrapping: ECDH P-256 ephemeral key agreement, HKDF-SHA-256, then AES-KW or AES-GCM wrap of the DEK. P-256 chosen over X25519 because P-256 ECDH is in every browser's WebCrypto today; X25519 support is newer and uneven.
- Encryption: AES-GCM 256, random 96-bit IV, AAD = `table:row_id:patient_id:version` to stop row swapping (same idea as current server AAD).
- Non-extractable keys: device private keys are created with `extractable: false` and kept in IndexedDB as CryptoKey objects. They cannot be read out by script, only used.
- Ciphertext format: `{v:1, kid, iv, ct}` base64 JSON in existing `*_encrypted` columns, so the column shapes can stay.

New tables (later PR, not now): `clinic_keys(clinic_id, public_jwk, custody_mode, version)`, `user_keys(user_id, public_jwk, wrapped_private_for_recovery)`, `devices(device_id, user_id, public_jwk, revoked_at)`, `key_wraps(dek_id, recipient_type, recipient_id, wrapped_dek, created_by)`. All protected by Supabase RLS.

## 4. Clinic key custody options

(a) Clinic admin passphrase plus recovery key
- CRK private key is wrapped by a key derived from the admin passphrase (PBKDF2-SHA-256, 600k iterations, since Argon2 is not in WebCrypto) and also by a 24-word recovery key printed once.
- Pros: simple, no outside vendor, works offline, one person can build it.
- Cons: if the admin forgets the passphrase and loses the paper, data is gone. Single person trust.

(b) Clinic's own cloud KMS (BYOK)
- Clinic's AWS KMS, Azure Key Vault, or Google KMS wraps the CRK. Staff browser calls the clinic's KMS with the clinic's identity.
- Pros: strongest separation from us, fits larger health systems with IT staff.
- Cons: most FQHCs and tribal clinics have no KMS team; CORS, IAM setup, and support per vendor is heavy for one person.

(c) Multi-holder split (Shamir 2 of 3)
- Recovery key is split into 3 shares (for example clinic director, IT lead, tribal council delegate); any 2 rebuild it.
- Pros: no single person can lose or abuse it; matches tribal governance well.
- Cons: ceremony needed for recovery; Shamir is not in WebCrypto, so needs a small audited library (for example `shamir-secret-sharing` by Privy, audited) or our own GF(256) code.

APPROVED by owner on 2026-11-02. Recommendation for v1: (a) for daily unlock, with the recovery key optionally split 2 of 3 using (c) at clinic onboarding. This keeps daily use simple and gives tribal communities shared control of recovery. Offer (b) as a v2 enterprise add-on.

## 5. Who can decrypt and how sharing works

- Patient: always. DEK wrapped to patient UAK at creation.
- Clinic care team: DEK wrapped to the clinic CRK public key. Staff do not each hold the CRK. Instead the CRK private key, once unlocked by the admin, wraps a Clinic Staff Key (CSK) to each approved staff UAK. Records are wrapped to the CSK. Removing a staff member means rotating the CSK (section 7).
- CareCircle family: only when patient consents. Patient's browser unwraps the DEK and rewraps it to the family member's UAK. Consent row records who, which categories, and expiry. Revoking consent deletes the wrap and rotates that DEK on next write.
- Server never receives an unwrapped DEK.

## 6. The hard tradeoff: server features that read plaintext

| Feature (file) | Today | After v1 | Keep it by |
|---|---|---|---|
| LE8 score (`src/lib/le8.ts`) | Server computes | Breaks on server | `le8.ts` is pure TS; run it in browser, store score encrypted, optionally store a coarse category in plaintext only if patient opts in |
| Biomarker status, trends, panel grade (manual-labs route, `biomarker-ranges`) | Server | Breaks | Run same modules in browser |
| `/api/shield/decrypt` and AI explanations | Server decrypts then sends to model | Breaks | Browser decrypts, runs local template answers (already started in `afac0da`), and sends only shield-scrubbed text to AI with explicit consent |
| Clinical dashboard (`src/app/clinical/page.tsx`) | Server renders | Breaks | Client side render after staff unlock |
| care-os alerts (`care-os/src/app/api/alerts/route.ts`) | Receives raw vitals | Must change | Device computes flags and sends minimal signed payload: `{patient_ref, alert_type, severity, ts}` with no values. Signature: ECDSA P-256 device key, replacing the shared HMAC secret. SMS/email text stays generic ("New critical alert, open CareIQ"). |
| care-os vault (`vault-crypto.ts`) | Server key | Migrate | Same DEK scheme, files encrypted in browser before upload to private bucket |
| Server-side search, cohort reports, exports | Possible | Breaks | Clinic-side care-os decrypts in staff browser with clinic key and builds the report locally |
| Background or scheduled alerts with no device online | Possible in theory | Not possible | Accept, or v2 clinic-run "alert agent" on clinic hardware holding a CSK |
| Password reset | Restores everything | Restores login only | Data needs device, recovery code, or clinic re-wrap |

care-os still works: it keeps auth, circle invites, scheduling, and alert delivery; only content becomes ciphertext plus the minimal alert payload.

## 7. Key loss, recovery, offboarding, rotation

- Patient loses device: log in on new device, then unlock UAK with patient recovery code, or ask clinic to re-wrap (clinic has a wrap of every patient DEK). Old device revoked in `devices`.
- Patient loses everything: clinic re-wraps DEKs to a new UAK after identity check in person. Patients not attached to a clinic (direct users) must keep their recovery code or lose data; state this clearly.
- Clinic admin forgets passphrase: use recovery key (or 2 of 3 shares). If all lost: clinic data is unrecoverable. We cannot help. This must be in the contract.
- Staff offboarding: revoke devices, delete CSK wrap, rotate CSK and rewrap active DEK wraps (cheap: rewrap keys, not data). Offboarded staff may still have cached data on old device; document it.
- Rotation: CRK yearly or on suspected compromise (rewrap CSK); CSK on staff departure; DEK rotated on consent revoke, by re-encrypting that record set on next write. Versions tracked by `kid`.

## 8. Migration of existing server-encrypted rows

Rows are few and mostly synthetic.
1. Ship client crypto behind flag `CLIENT_ENC_V1` (off by default).
2. One-time migration in browser: on login, if a row has the legacy format, server decrypts via a temporary `/api/migrate/legacy-read` route (rate limited, audit logged), browser re-encrypts with new DEK and writes back `v:1`.
3. For synthetic or demo rows: simply delete and reseed with client encryption instead.
4. After 30 days or zero legacy rows, delete the legacy route and remove `ENCRYPTION_KEY` and `VAULT_KEY_HEX` from Vercel. Only then are marketing claims in section 10 true.

## 9. Audit logging without plaintext

- Keep existing `logAudit` / `logPhiAccess`, but log only: actor id, action (read, write, share, revoke, unlock, recovery), record id, key id, device id, timestamp, IP hash.
- Client reports decrypt events (server cannot see them otherwise). Server logs key wrap fetches, which is a reliable proxy for access.
- Make the audit table append-only (insert only RLS, no update/delete) and hash-chain rows so tampering is detectable.

## 10. Marketing claims

Allowed after v1 is live and legacy keys are deleted:
- "Health data is encrypted on your device before it is sent."
- "Your clinic holds the keys. CareIQ cannot read your health records."
- "Family members see your records only when you choose to share."
- "HIPAA-aligned architecture."
- "AES-256-GCM encryption using your browser's built-in WebCrypto."
- "Tribal and clinic leadership can share control of recovery (2 of 3)."

Still NOT allowed:
- Any claim that CareIQ is HIPAA certified or fully HIPAA conforming (compliance depends on the clinic's BAA, policies, and an assessment, not on software alone). Remove the old 100 percent HIPAA claim from `index.html` and `CareIQOS.tsx` now.
- "Zero-knowledge" in the strict sense, while we still see metadata and serve the code. Prefer "end-to-end encrypted health records."
- "PHI never leaves the device" (ciphertext does leave; AI features may send scrubbed text).
- "Unhackable", "military grade", "patent protected encryption".
- Any claim before legacy server keys are removed.

## 11. Phased build plan (one person)

| Phase | PR | Work | Weeks |
|---|---|---|---|
| 0 | PR 1 | This design doc; marketing copy fixes (remove HIPAA overclaims) | 0.5 |
| 1 | PR 2 | `src/lib/e2e/` crypto core: key gen, wrap/unwrap, encrypt/decrypt, IndexedDB store, tests (Vitest + test vectors) | 1.5 |
| 2 | PR 3 | Supabase migrations: clinic_keys, user_keys, devices, key_wraps, consents, RLS; behind flag | 1 |
| 3 | PR 4 | Clinic onboarding: admin passphrase, recovery key, optional 2 of 3 shares, CSK to staff | 1.5 |
| 4 | PR 5 | Patient flows: onboarding writes client-encrypted rows; LE8, biomarkers, panel grade moved to browser | 2 |
| 5 | PR 6 | care-os: browser vault encryption, minimal signed alerts (ECDSA), CareCircle consent sharing | 1.5 |
| 6 | PR 7 | Clinical dashboard client-side decrypt; recovery, device revoke, staff offboarding, rotation | 1.5 |
| 7 | PR 8 | Legacy migration, delete legacy routes and env keys, audit hash chain, external review | 1 |

Total: about 10.5 weeks. Add 1 to 2 weeks buffer, and budget for an outside crypto review (for example a short engagement, a few thousand dollars) before claiming it publicly.

## 12. Open questions for owner decisions

1. Custody v1: approve (a) passphrase + recovery key with optional 2 of 3 split? Who are the default 3 holders for tribal clinics?
   - APPROVED 2026-11-02: option (a) passphrase plus printed recovery key with optional 2 of 3 split.
2. Direct patients with no clinic: allowed? If yes, they alone hold recovery and accept data loss risk.
   - APPROVED 2026-11-02: solo patients allowed, but must save their recovery code before entering any health data.
3. Should the clinic always get a wrap of every patient DEK (needed for recovery and care), or only with patient consent?
   - APPROVED 2026-11-02: clinic gets a wrap of the patient data key only with patient consent at enrollment; patient can withdraw it.
4. AI features: allow sending shield-scrubbed text to the AI provider after on-device decrypt, or local templates only?
   - APPROVED 2026-11-02: local template answers only; optional AI stays off unless the clinic enables it.
5. Accept losing scheduled server-side alerts when no device is online, or plan a clinic-hosted alert agent in v2?
   - APPROVED 2026-11-02: v1 alerts are sent when the device syncs; a clinic-hosted alert helper is planned for v2.
6. Is coarse plaintext (for example LE8 band, alert severity) acceptable for clinic reporting, or must everything be ciphertext?
   - APPROVED 2026-11-02: only LE8 band and alert severity may be unencrypted; no raw values.
7. Budget and timing for an external security review before marketing launch.
   - APPROVED 2026-11-02: outside security review is required before marketing launch.
8. Contract language: clinic accepts that lost keys mean unrecoverable data; we cannot recover.
   - APPROVED 2026-11-02: contract states lost keys are unrecoverable by anyone, including CareIQ.
9. Do we remove the HIPAA overclaim and "Zero-Knowledge" copy now (recommended), before the build?
   - APPROVED 2026-11-02: copy fix done now (PR 33).
10. Shamir library choice: audited third party package or in-house?
   - APPROVED 2026-11-02: use an audited open-source library for the 2 of 3 split.
