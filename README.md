# CareIQ v3.0 with Sovereign Prompt Shield

**Clinical intelligence for the safety net.**

CareIQ is the FQHC-focused build of the Sovereign Health OS platform, tailored
for federally qualified health centers and the community health workforce.

## What's New in v3.0
- **Sovereign Prompt Shield v5** fully integrated. Intercepts every AI query.
- **Live PII detection** for SSN, DOB, phone, email, MRN, and other identifiers.
- **HIPAA PHI scanner** as a second layer detecting all 18 HIPAA identifiers.
- **Real-time audit log** with every interaction timestamped and classified.
- **Shield Dashboard** showing every protected query in real time.
- **Risk scoring** from 0 to 100 per query with severity levels.
- **Elder Mode** scales typography, spacing, and touch targets across the entire app.

## Architecture
```
User Query -> /api/shield (Shield + HIPAA scan + log) -> Anthropic API -> Response
```

## Deploy
1. Push to GitHub.
2. Import the repository on vercel.com (leave all settings default).
3. Settings, then Environment Variables, then add the variables in `.env.example`.
4. Redeploy.

## Demo the Shield
In the AI tab, try these prompts:
- "My SSN is 123-45-6789" flags CRITICAL.
- "Call Dr. Smith at 555-123-4567" flags HIGH.
- "Explain my LDL risk" passes CLEAN.

Then open Clinical, then Shield, to view the live audit log.

*Sovereign Shield Technologies LLC, Project CareIQ*
