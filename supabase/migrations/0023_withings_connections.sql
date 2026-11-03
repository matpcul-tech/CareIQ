-- Withings Notify integration (feature flag WITHINGS_ENABLED, default off).
-- This file is in the repo only. It has not been applied to any database.
-- Matthew must approve applying it.
--
-- One row per patient with a linked Withings account. OAuth tokens are
-- stored only as AES-256-GCM ciphertext (src/lib/crypto.ts, AAD
-- "withings:<patient_id>"). No measurement values are stored here;
-- readings go to wearable_data as encrypted daily summaries.
-- Service role only: RLS is on and forced with no policies, so
-- anon and authenticated clients cannot read or write this table.

create table if not exists public.withings_connections (
  patient_id           uuid primary key references public.patients(id) on delete cascade,
  withings_userid      text not null unique,
  tokens_encrypted     text not null,
  scope                text not null default '',
  access_expires_at    timestamptz not null,
  status               text not null default 'active'
                         check (status in ('active', 'revoked', 'error')),
  last_measure_update  bigint,
  last_synced_at       timestamptz,
  last_notified_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.withings_connections enable row level security;
alter table public.withings_connections force row level security;

revoke all on public.withings_connections from anon, authenticated;
