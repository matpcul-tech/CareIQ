-- On-device encryption, phase 2 tables plus patient enrollment (design: docs/DESIGN-client-encryption.md).
-- The server stores only public keys, keys sealed under a patient recovery code, wrapped data keys,
-- ciphertext envelopes, and two coarse fields: LE8 band and alert severity. No raw health values.
-- Used only while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is "true" (default off). Legacy tables and the
-- server-side encryption in src/lib/crypto.ts are untouched.
-- Direct table access is denied; the server uses the service role after it checks the session.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

-- Clinic root public key. The private part never reaches the server (clinic custody lands in a later PR).
create table if not exists public.clinic_keys (
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  version       int  not null default 1,
  public_jwk    jsonb not null,
  custody_mode  text not null default 'passphrase' check (custody_mode in ('passphrase', 'passphrase_split_2of3')),
  created_at    timestamptz not null default now(),
  primary key (clinic_id, version),
  check (not (public_jwk ? 'd'))
);

-- Patient account key: public key plus the private key sealed under the recovery code.
create table if not exists public.user_keys (
  patient_id             uuid primary key references public.patients(id) on delete cascade,
  public_jwk             jsonb not null,
  recovery_sealed        jsonb not null,
  recovery_confirmed_at  timestamptz not null,
  active_dek_id          uuid not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (not (public_jwk ? 'd'))
);

-- Data key wraps. One row per (data key, recipient).
create table if not exists public.key_wraps (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  dek_id          uuid not null,
  recipient_type  text not null check (recipient_type in ('patient', 'clinic', 'family')),
  recipient_id    text not null,
  wrapped_dek     jsonb not null,
  created_at      timestamptz not null default now(),
  unique (dek_id, recipient_type, recipient_id)
);
create index if not exists key_wraps_patient_idx on public.key_wraps (patient_id, dek_id);

-- Patient consent for the clinic to hold a wrap. Withdrawal is a timestamp, never a delete.
create table if not exists public.key_consents (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  granted_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  unique (patient_id, clinic_id)
);

-- Health entries encrypted on the device.
create table if not exists public.patient_e2e_entries (
  id              uuid primary key,
  patient_id      uuid not null references public.patients(id) on delete cascade,
  category        text not null check (category ~ '^[a-z_]{2,32}$'),
  dek_id          uuid not null,
  envelope        jsonb not null,
  le8_band        text check (le8_band in ('high', 'moderate', 'low')),
  alert_severity  text check (alert_severity in ('critical', 'high', 'informational')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists patient_e2e_entries_patient_idx on public.patient_e2e_entries (patient_id, category);

alter table public.clinic_keys enable row level security;
alter table public.clinic_keys force row level security;
alter table public.user_keys enable row level security;
alter table public.user_keys force row level security;
alter table public.key_wraps enable row level security;
alter table public.key_wraps force row level security;
alter table public.key_consents enable row level security;
alter table public.key_consents force row level security;
alter table public.patient_e2e_entries enable row level security;
alter table public.patient_e2e_entries force row level security;

revoke all on public.clinic_keys from anon, authenticated;
revoke all on public.user_keys from anon, authenticated;
revoke all on public.key_wraps from anon, authenticated;
revoke all on public.key_consents from anon, authenticated;
revoke all on public.patient_e2e_entries from anon, authenticated;
