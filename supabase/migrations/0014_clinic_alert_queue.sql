-- Clinic alert queue for home readings from linked patients.
-- General guidance for the care team, not a diagnosis.
-- Only severity and le8_band are health fields stored in plain text. Reading values,
-- reading type, rule, patient id, and staff notes are AES-256-GCM encrypted by the
-- CareIQ server (src/lib/crypto.ts). Status, staff ids, and timestamps are workflow
-- fields kept plain so the queue can be sorted and filtered.
-- Direct table access is denied. The server uses the service role after it checks
-- the caller is active clinic staff for that clinic.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

create table if not exists public.clinic_alert_queue (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  severity           text not null check (severity in ('critical', 'high', 'informational')),
  le8_band           text check (le8_band is null or le8_band in ('low', 'moderate', 'high')),
  status             text not null default 'new' check (status in ('new', 'acknowledged', 'resolved')),
  created_at         timestamptz not null default now(),
  acknowledged_by    uuid references public.clinic_staff(id) on delete set null,
  acknowledged_at    timestamptz,
  resolved_by        uuid references public.clinic_staff(id) on delete set null,
  resolved_at        timestamptz,
  payload_encrypted  text not null,
  notes_encrypted    text
);

create index if not exists clinic_alert_queue_clinic_idx
  on public.clinic_alert_queue (clinic_id, status, severity, created_at);

alter table public.clinic_alert_queue enable row level security;
alter table public.clinic_alert_queue force row level security;

revoke all on public.clinic_alert_queue from anon, authenticated;

notify pgrst, 'reload schema';
