-- Phase 0 scheduling: imported appointments and CareIQ reminders.
-- CareIQ does not book visits. The clinic EHR stays the system of record.
-- Appointment details and phone numbers are AES-256-GCM encrypted by the CareIQ
-- server (src/lib/crypto.ts). The appointment id and phone are stored only as keyed
-- hashes. Direct table access is denied; the server uses the service role after it
-- checks the caller is active clinic staff (import and templates: clinic admin only).
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

create table if not exists public.clinic_appointments (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  appointment_key    text not null,
  payload_encrypted  text not null,
  updated_at         timestamptz not null default now(),
  unique (clinic_id, appointment_key)
);

create table if not exists public.clinic_reminder_log (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  appointment_key  text not null,
  phone_hash       text not null,
  send_on          date not null,
  channel          text not null check (channel in ('sms', 'voice')),
  status           text not null check (status in ('sent', 'failed')),
  created_at       timestamptz not null default now()
);

create index if not exists clinic_reminder_log_phone_idx on public.clinic_reminder_log (phone_hash, send_on);

create table if not exists public.reminder_opt_outs (
  phone_hash    text primary key,
  opted_out_at  timestamptz not null default now()
);

create table if not exists public.clinic_reminder_templates (
  clinic_id  uuid not null references public.clinics(id) on delete cascade,
  language   text not null check (language ~ '^[a-z]{2,3}$'),
  template   jsonb not null,
  primary key (clinic_id, language)
);

alter table public.clinic_appointments enable row level security;
alter table public.clinic_appointments force row level security;
alter table public.clinic_reminder_log enable row level security;
alter table public.clinic_reminder_log force row level security;
alter table public.reminder_opt_outs enable row level security;
alter table public.reminder_opt_outs force row level security;
alter table public.clinic_reminder_templates enable row level security;
alter table public.clinic_reminder_templates force row level security;

revoke all on public.clinic_appointments from anon, authenticated;
revoke all on public.clinic_reminder_log from anon, authenticated;
revoke all on public.reminder_opt_outs from anon, authenticated;
revoke all on public.clinic_reminder_templates from anon, authenticated;

notify pgrst, 'reload schema';
