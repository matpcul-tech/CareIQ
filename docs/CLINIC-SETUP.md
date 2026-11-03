# Clinic setup: first admin and staff invites

No manual SQL is needed to start a clinic.

## Before the first clinic

1. Apply migration `supabase/migrations/0016_clinic_onboarding_tokens.sql` (owner approval required).

## Operator: make a setup link

1. On a trusted machine with the production env values (never commit them):

   ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SITE_URL=https://care-iq-os.vercel.app \
   SETUP_TOKEN_HOURS=24 SETUP_TOKEN_NOTE="pilot clinic" \
   npx tsx scripts/create-clinic-setup-token.ts
   ```

2. The script prints one link: `https://.../clinic/setup#token=...`. It is shown once.
   The database stores only the SHA-256 hash, so a lost link cannot be recovered; make a new one.
3. Send the link to the clinic's first admin over a channel you trust (a phone call reading it out,
   or a secure message). It expires after `SETUP_TOKEN_HOURS` (default 24, max 72).

## First admin: redeem the link

1. Open the link. Enter the clinic name, your name, your work email, and your role.
2. The link is used up. CareIQ creates the clinic record and your staff account with clinic admin rights.
3. Sign in on `/clinic` with that email (magic link).

If the email is already on a clinic staff list, the form says so and the link stays unused.

## Clinic admin: invite staff

1. On `/clinic`, after signing in, use **Invite links**. Pick the role (provider, care manager,
   front desk) and tick **Clinic admin** for another admin.
2. Copy the link. It is shown once, works once, and expires in 7 days. Open links can be revoked.
3. The teammate opens the link, enters their name and work email, then signs in on `/clinic`.

The existing email invite on `/clinic` still works too.

## Safety

- Tokens are 256 bit random values in the URL fragment, which browsers do not send to the server.
  The pages set `Referrer-Policy: no-referrer` and clear the fragment from the address bar.
- Redemption is atomic: one database update succeeds only if the token is unused and unexpired.
- `/api/clinic/setup` and `/api/clinic/join` are limited to 5 requests per minute per IP and need the CSRF header.
- Audit log entries record the action, success, and role kind only. No token, email, name, or clinic name.
- Unknown, used, and expired links all get the same error message.
- Revoke a staff member in the clinic store as before; invite links do not bypass revocation.
