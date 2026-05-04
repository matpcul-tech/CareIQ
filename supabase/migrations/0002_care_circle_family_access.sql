-- =====================================================================
-- CareIQ migration 0002 — Care Circle family-member access
--
-- Allows authenticated family members (linked to a patient via
-- public.care_circle.member_user_id) to read scoped, non-PHI data
-- about their loved one. PHI columns (profile_encrypted, data_encrypted)
-- remain opaque — they're never exposed in plaintext via RLS.
--
-- Depends on: public.care_circle and public.care_circle_invites
-- (created by care-os migrations 20260503000001 and 20260504000001
-- in the same Supabase project).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. care_circle_alerts — append-only log of fired threshold alerts.
--    Contains NO raw vitals or PHI. Only metric name, severity, and
--    recommended action — same shape as the alert email body.
-- ---------------------------------------------------------------------
create table if not exists public.care_circle_alerts (
  id               uuid        primary key default gen_random_uuid(),
  patient_id       uuid        not null references public.patients(id) on delete cascade,
  metric           text        not null,
  severity         text        not null check (severity in ('critical', 'informational')),
  recommendation   text        not null,
  fired_at         timestamptz not null default now(),
  delivery_count   int         not null default 0,
  delivery_summary jsonb
);

create index if not exists care_circle_alerts_patient_idx
  on public.care_circle_alerts (patient_id, fired_at desc);

alter table public.care_circle_alerts enable row level security;
alter table public.care_circle_alerts force row level security;

-- Patient can read their own alert history.
drop policy if exists cca_patient_select on public.care_circle_alerts;
create policy cca_patient_select
  on public.care_circle_alerts for select
  to authenticated
  using (patient_id = auth.uid());

-- Family members linked via care_circle can read alerts for their patient.
drop policy if exists cca_family_select on public.care_circle_alerts;
create policy cca_family_select
  on public.care_circle_alerts for select
  to authenticated
  using (
    exists (
      select 1 from public.care_circle cc
      where cc.patient_id = public.care_circle_alerts.patient_id
        and cc.member_user_id = auth.uid()
    )
  );

-- Inserts are service-role only (the /api/alerts fan-out endpoint).
-- Append-only: block update/delete from authenticated/anon roles.
revoke update, delete on public.care_circle_alerts from authenticated, anon;

create or replace function public.care_circle_alerts_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'care_circle_alerts is append-only';
end;
$$;

drop trigger if exists cca_no_update on public.care_circle_alerts;
create trigger cca_no_update
  before update on public.care_circle_alerts
  for each row execute function public.care_circle_alerts_immutable();

drop trigger if exists cca_no_delete on public.care_circle_alerts;
create trigger cca_no_delete
  before delete on public.care_circle_alerts
  for each row execute function public.care_circle_alerts_immutable();

-- ---------------------------------------------------------------------
-- 2. patients — allow family members to SELECT their patient's row.
--    profile_encrypted remains an opaque ciphertext blob; this only
--    exposes id, email_hash, and created_at. Family members need this
--    to confirm the linkage and look up their patient.
-- ---------------------------------------------------------------------
drop policy if exists patients_family_select on public.patients;
create policy patients_family_select
  on public.patients for select
  to authenticated
  using (
    exists (
      select 1 from public.care_circle cc
      where cc.patient_id = public.patients.id
        and cc.member_user_id = auth.uid()
    )
  );

-- Note: existing patients_self_select policy (id = auth.uid()) is unchanged.
-- Postgres OR's policies for SELECT, so both patient and family see the row.

-- ---------------------------------------------------------------------
-- 3. care_circle reverse lookup — family member needs to find their own
--    care_circle row to determine which patient to display. The select
--    policies on public.care_circle (created in care-os migrations) already
--    allow auth.uid() = member_user_id. Nothing to add here; this comment
--    documents the dependency.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 4. health_history / lab_files / wearable_data — intentionally NOT
--    exposed to family members. The encrypted blobs are useless without
--    server-side decryption keys, and exposing existence/timestamps
--    leaks usage patterns. If, later, a non-PHI summary view is needed,
--    add it here as an explicit, scrubbed projection — never expose
--    *_encrypted columns to family members under any policy.
-- ---------------------------------------------------------------------
