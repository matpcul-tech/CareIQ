# CareIQ v3.0 with Sovereign Prompt Shield

**Clinical intelligence for the safety net.**

CareIQ is the FQHC-focused build of the Sovereign Health OS platform, tailored
for federally qualified health centers and the community health workforce.

## What the Shield does

- Intercepts AI insight requests at `/api/shield`.
- Scans the typed question and any client context for identifier patterns.
- Blocks the model call when the scan is CRITICAL (for example a Social Security number or a labeled medical record number).
- Does not send the typed question to the model.
- Builds a reduced summary from server data: age as a decade, a location placeholder, allow-listed condition and vital names, and wearable numbers with shifted dates.
- Replaces the stored patient name and detected identifiers before the call.
- Writes an audit row without the raw question.

This reduces identifiers. It does not prove that every possible identifier was removed. The scanner is a set of patterns for Safe Harbor categories, not a guarantee that all 18 identifier types were found. It is not a certification of regulatory compliance.

Stored PHI is encrypted at rest with AES-256-GCM on the application server. The key is in the server environment. Encryption is not on the device, and the key is not held by the community.

The model call is Anthropic inference. This repository does not train a model on patient data.

## Architecture

```
Typed question is scanned and is not forwarded.
Reduced summary -> /api/shield -> Anthropic API -> response
```

## Deploy

1. Push to GitHub.
2. Import the repository on vercel.com (leave all settings default).
3. Settings, then Environment Variables, then add the variables in `.env.example`.
4. Redeploy.

## Clinic staff

Patients sign in at `/onboard`. Clinic staff sign in at `/clinic`. A staff session is created only when the email matches a `clinic_staff` row. Patient profile data and Supabase user metadata cannot grant a provider, care manager, or front desk role.

The first clinic admin is created with a one-time script, not from the patient app:

```
CLINIC_BOOTSTRAP_ENABLED=1 \
CLINIC_BOOTSTRAP_EMAIL=admin@example.org \
CLINIC_BOOTSTRAP_CLINIC_NAME="Example FQHC" \
CLINIC_BOOTSTRAP_DISPLAY_NAME="Clinic Admin" \
npm run bootstrap:clinic-admin
```

The script reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, and `NEXT_PUBLIC_SITE_URL` from the environment. `SUPABASE_SERVICE_KEY` still works and logs a warning. Apply migrations `0010` and `0011` before the first run. The script prints the clinic id. It does not print the service key.

Set `RESEND_API_KEY` if staff invite mail should be sent by Resend. Without it, Supabase Auth sends the invite email, so the project's email provider has to be enabled. Add the site origin and `/auth/callback` to the Supabase redirect allow list.

After the admin signs in, they can invite a provider, care manager, or front desk teammate from `/clinic`. Each staff session is limited to that person's clinic. MA and CHW roster rows from the existing care team action do not create a sign-in by themselves.

## Demo the Shield

In the AI tab, try these prompts:

- "My SSN is 123-45-6789" flags CRITICAL and blocks the model call.
- "Call Dr. Smith at 555-123-4567" flags HIGH. The typed text is not sent. The summary is still reduced.
- "Explain my LDL risk" passes the scan. The model sees the reduced summary, not the sentence you typed.

Then open Clinical, then Shield, to view hashes and scores. The raw question is not shown.

## Tests

`npm test` sends synthetic identifiers through the Shield and fails if a forbidden compliance phrase returns in the tree.

*Sovereign Shield Technologies LLC, Project CareIQ*
