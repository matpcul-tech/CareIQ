-- UDS patient panel import for CMS165 and CMS122.
-- Logic tested against the measure specs, not certified eCQM software.
-- One row per imported patient, scoped to one clinic. The patient payload
-- (birth date, diagnoses, readings, exclusion flags) is AES-256-GCM encrypted
-- by the CareIQ server (src/lib/crypto.ts) with AAD bound to clinic and patient.
-- Direct table access is denied. The server uses the service role after it
-- checks the caller is active clinic staff (import: clinic admin only).
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

create table if not exists public.clinic_uds_panel (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  external_id        text not null check (char_length(external_id) between 1 and 64),
  payload_encrypted  text not null,
  imported_at        timestamptz not null default now(),
  unique (clinic_id, external_id)
);

create index if not exists clinic_uds_panel_clinic_idx on public.clinic_uds_panel (clinic_id);

alter table public.clinic_uds_panel enable row level security;
alter table public.clinic_uds_panel force row level security;

revoke all on public.clinic_uds_panel from anon, authenticated;

notify pgrst, 'reload schema';
