-- =====================================================================
-- CareIQ (Sovereign Health OS) - Patient onboarding schema
-- All PHI stored encrypted (AES-256-GCM, server-side only).
-- All tables RLS-enabled. Patients can only access their own rows.
-- audit_log is append-only and never readable by patients.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------
create table if not exists public.patients (
  id              uuid primary key default gen_random_uuid(),
  email_hash      text not null unique,
  profile_encrypted text,
  created_at      timestamptz not null default now()
);

create index if not exists patients_email_hash_idx on public.patients (email_hash);

alter table public.patients enable row level security;
alter table public.patients force row level security;

-- Patients see only their own row (matched via auth.uid())
drop policy if exists patients_self_select on public.patients;
create policy patients_self_select
  on public.patients for select
  to authenticated
  using (id = auth.uid());

drop policy if exists patients_self_update on public.patients;
create policy patients_self_update
  on public.patients for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Inserts only via service-role (no insert policy = denied to authenticated)
-- Deletes never permitted to anyone except service-role.

-- ---------------------------------------------------------------------
-- health_history
-- ---------------------------------------------------------------------
create table if not exists public.health_history (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients(id) on delete cascade,
  data_encrypted text not null,
  updated_at     timestamptz not null default now()
);

create index if not exists health_history_patient_idx on public.health_history (patient_id);

alter table public.health_history enable row level security;
alter table public.health_history force row level security;

drop policy if exists hh_self_select on public.health_history;
create policy hh_self_select
  on public.health_history for select
  to authenticated
  using (patient_id = auth.uid());

drop policy if exists hh_self_insert on public.health_history;
create policy hh_self_insert
  on public.health_history for insert
  to authenticated
  with check (patient_id = auth.uid());

drop policy if exists hh_self_update on public.health_history;
create policy hh_self_update
  on public.health_history for update
  to authenticated
  using (patient_id = auth.uid())
  with check (patient_id = auth.uid());

-- ---------------------------------------------------------------------
-- lab_files
-- ---------------------------------------------------------------------
create table if not exists public.lab_files (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  file_ref     text not null,            -- storage path of encrypted blob
  file_type    text not null check (file_type in ('pdf','png','jpg','heic')),
  uploaded_at  timestamptz not null default now()
);

create index if not exists lab_files_patient_idx on public.lab_files (patient_id);

alter table public.lab_files enable row level security;
alter table public.lab_files force row level security;

drop policy if exists lf_self_select on public.lab_files;
create policy lf_self_select
  on public.lab_files for select
  to authenticated
  using (patient_id = auth.uid());

drop policy if exists lf_self_insert on public.lab_files;
create policy lf_self_insert
  on public.lab_files for insert
  to authenticated
  with check (patient_id = auth.uid());

-- ---------------------------------------------------------------------
-- wearable_data
-- ---------------------------------------------------------------------
create table if not exists public.wearable_data (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  data_encrypted  text not null,
  device_type     text not null check (device_type in
                    ('fitbit','apple_watch','garmin','samsung','google_fit','generic')),
  uploaded_at     timestamptz not null default now()
);

create index if not exists wearable_patient_idx on public.wearable_data (patient_id);

alter table public.wearable_data enable row level security;
alter table public.wearable_data force row level security;

drop policy if exists wd_self_select on public.wearable_data;
create policy wd_self_select
  on public.wearable_data for select
  to authenticated
  using (patient_id = auth.uid());

drop policy if exists wd_self_insert on public.wearable_data;
create policy wd_self_insert
  on public.wearable_data for insert
  to authenticated
  with check (patient_id = auth.uid());

-- ---------------------------------------------------------------------
-- audit_log (append-only, opaque to patients)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  session_id  text not null,
  action      text not null,
  data_type   text not null,
  success     boolean not null,
  metadata    jsonb,
  ts          timestamptz not null default now()
);

create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
create index if not exists audit_log_action_idx on public.audit_log (action, ts desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- No SELECT/UPDATE/DELETE policy means denied for everyone.
-- Service role bypasses RLS, so server-side code (lib/audit.ts) inserts
-- and admins can read with service credentials. Patients cannot.

-- Block UPDATE and DELETE at the schema level for additional defense.
revoke update, delete on public.audit_log from authenticated, anon;

-- Trigger to forbid updates/deletes even via service-role accidents.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_immutable();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ---------------------------------------------------------------------
-- Retention helper: never auto-delete; HIPAA minimum 7 years.
-- A scheduled job (out of scope for this migration) may later move
-- rows older than 7 years to cold storage. By default, audit_log keeps
-- everything indefinitely.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Storage bucket policy notes (configure in Supabase dashboard):
--   Bucket name: lab-files
--   Public: false
--   File access: only via signed URLs generated server-side.
--   Files are AES-256-GCM-encrypted before upload.
-- ---------------------------------------------------------------------
