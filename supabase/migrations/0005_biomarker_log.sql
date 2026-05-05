-- biomarker_log: append-only time-series of patient biomarker values.
--
-- Used by /api/shield/decrypt to compute trend (improving / stable /
-- declining) per biomarker by comparing the latest two entries against
-- the biomarker's optimal target.
--
-- The numeric value is encrypted at rest with the same AES-256-GCM key
-- used by health_history. The biomarker key + date_collected are stored
-- as plaintext columns so we can index trend lookups without decrypting
-- every row in the table.
--
-- RLS is enabled but no policies are added: the service role bypasses
-- RLS, and patient/family clients never read this table directly. All
-- reads happen server-side from the Shield endpoint after auth.

create extension if not exists "pgcrypto";

create table if not exists public.biomarker_log (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  biomarker_key   text not null,
  date_collected  date not null,
  source          text not null check (source in ('lab', 'wearable', 'self_reported')),
  value_encrypted text not null,
  created_at      timestamptz not null default now()
);

create index if not exists biomarker_log_lookup_idx
  on public.biomarker_log (patient_id, biomarker_key, date_collected desc);

alter table public.biomarker_log enable row level security;

comment on table  public.biomarker_log         is 'Append-only encrypted time-series of patient biomarker values. Source of truth for trend computation. Service-role read only.';
comment on column public.biomarker_log.value_encrypted is 'AES-256-GCM ciphertext of {"value":<number>}, AAD = "biomarker_log:<patient_id>:<biomarker_key>".';
comment on column public.biomarker_log.biomarker_key is 'Canonical key from BIOMARKER_SPECS in src/lib/biomarker-ranges.ts.';
