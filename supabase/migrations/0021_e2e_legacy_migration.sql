-- On-device encryption PR 8: ledger for the patient-run move of server-encrypted legacy rows into
-- patient_e2e_entries (design: docs/DESIGN-client-encryption.md, section 8 migration plan).
-- One row per legacy source row that the patient's own device re-encrypted, read back, and verified.
-- Legacy rows are NOT deleted or changed. A later cleanup step needs separate owner approval.
-- Holds ids and outcome only. No health values.
-- Used only while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is "true" (default off). Depends on 0016.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

create table if not exists public.e2e_legacy_migrations (
  patient_id   uuid not null references public.patients(id) on delete cascade,
  source       text not null check (source in ('profile', 'health_history', 'health_history_labs', 'biomarker_log', 'wearable_data')),
  source_id    uuid not null,
  entry_id     uuid not null,
  outcome      text not null check (outcome in ('migrated', 'superseded')),
  migrated_at  timestamptz not null default now(),
  primary key (patient_id, source, source_id)
);

alter table public.e2e_legacy_migrations enable row level security;
alter table public.e2e_legacy_migrations force row level security;
revoke all on public.e2e_legacy_migrations from anon, authenticated;
