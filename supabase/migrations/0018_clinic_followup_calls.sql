-- Staff follow-up call log for the Telehealth tab call list (who was called, when, outcome).
-- Patient id and the outcome note are AES-256-GCM encrypted by the CareIQ server; patient_key is
-- a keyed hash. No video, no booking. Direct table access is denied; the server uses the service role.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.
-- Numbered 0018: 0016 is e2e patient keys (PR 44), 0017 is clinic time zone (PR 45), 0019 is onboarding (PR 43).

create table if not exists public.clinic_followup_calls (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  patient_key        text not null,
  staff_id           uuid not null references public.clinic_staff(id) on delete cascade,
  called_at          timestamptz not null default now(),
  outcome            text not null check (outcome in ('reached', 'left_message', 'no_answer', 'wrong_number', 'declined', 'other')),
  payload_encrypted  text not null
);

create index if not exists clinic_followup_calls_clinic_idx on public.clinic_followup_calls (clinic_id, called_at desc);

alter table public.clinic_followup_calls enable row level security;
alter table public.clinic_followup_calls force row level security;
revoke all on public.clinic_followup_calls from anon, authenticated;

notify pgrst, 'reload schema';
