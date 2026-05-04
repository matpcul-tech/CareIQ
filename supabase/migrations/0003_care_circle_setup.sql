-- ============================================================
-- CareIQ migration 0003 — CareCircle setup
--
-- Creates the public.care_circle, public.care_circle_invites, and
-- public.care_circle_alerts tables that the "+ Invite Family Member"
-- flow needs. The original care-os migrations referenced auth.users(id)
-- for patient_id, but CareIQ patients live in public.patients with
-- random UUIDs (no Supabase Auth row), so the FK target had to switch
-- to public.patients(id) for the integration to work end-to-end.
--
-- Idempotent: uses CREATE IF NOT EXISTS / DROP POLICY IF EXISTS so it
-- can be re-applied safely.
--
-- Member-side FKs (member_user_id, used_by) keep referencing
-- auth.users(id) because family members DO sign up via Supabase Auth
-- when they redeem an invite at care-os/signup.
-- ============================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------
-- 1. care_circle: links a CareCircle (family member auth.users) to a
--    CareIQ patient (public.patients).
-- ----------------------------------------------------------------
create table if not exists public.care_circle (
  id              uuid        primary key default gen_random_uuid(),
  patient_id      uuid        not null references public.patients(id) on delete cascade,
  member_email    text        not null,
  member_name     text        not null,
  relationship    text        not null,
  alert_level     text        not null check (alert_level in ('critical', 'informational')),
  member_user_id  uuid        references auth.users(id) on delete cascade,
  member_phone    text,
  invite_id       uuid,
  created_at      timestamptz not null default now()
);

create index if not exists care_circle_patient_id_idx
  on public.care_circle (patient_id);
create index if not exists care_circle_member_email_idx
  on public.care_circle (member_email);
create index if not exists care_circle_member_user_id_idx
  on public.care_circle (member_user_id);
create unique index if not exists care_circle_patient_member_unique_idx
  on public.care_circle (patient_id, lower(member_email));

alter table public.care_circle enable row level security;

-- Family member can SELECT and UPDATE their own row.
drop policy if exists care_circle_member_select_own on public.care_circle;
create policy care_circle_member_select_own
  on public.care_circle for select
  using (auth.uid() = member_user_id);

drop policy if exists care_circle_member_update_own on public.care_circle;
create policy care_circle_member_update_own
  on public.care_circle for update
  using (auth.uid() = member_user_id)
  with check (auth.uid() = member_user_id);

-- Service role bypasses RLS, used by /api/circle/redeem (care-os) for
-- inserts on behalf of the un-authenticated family member during signup.

-- ----------------------------------------------------------------
-- 2. care_circle_invites: patient-issued one-time invite codes
-- ----------------------------------------------------------------
create table if not exists public.care_circle_invites (
  id                     uuid        primary key default gen_random_uuid(),
  code                   text        not null unique,
  patient_id             uuid        not null references public.patients(id) on delete cascade,
  patient_name           text,
  suggested_relationship text,
  suggested_alert_level  text        check (suggested_alert_level in ('critical', 'informational')),
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null default (now() + interval '7 days'),
  used_at                timestamptz,
  used_by                uuid        references auth.users(id) on delete set null,
  revoked_at             timestamptz
);

create index if not exists care_circle_invites_code_idx
  on public.care_circle_invites (code);
create index if not exists care_circle_invites_patient_idx
  on public.care_circle_invites (patient_id);

alter table public.care_circle_invites enable row level security;

-- All redemption flows go through service role (un-authenticated family
-- member), so no anon SELECT policy is added. Patients query their own
-- invite history via service-role server routes too.

-- ----------------------------------------------------------------
-- 3. care_circle_alerts: append-only log of fired threshold alerts.
--    Non-PHI: metric name, severity, recommendation only.
-- ----------------------------------------------------------------
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

-- Family members linked via care_circle can read alerts for their patient.
drop policy if exists cca_family_select on public.care_circle_alerts;
create policy cca_family_select
  on public.care_circle_alerts for select
  using (
    exists (
      select 1 from public.care_circle cc
      where cc.patient_id = public.care_circle_alerts.patient_id
        and cc.member_user_id = auth.uid()
    )
  );

-- Append-only: block update/delete from authenticated/anon roles.
revoke update, delete on public.care_circle_alerts from authenticated, anon;

-- ----------------------------------------------------------------
-- 4. Tell PostgREST to reload its schema cache so the API serves the
--    new tables without waiting for the next periodic reload.
-- ----------------------------------------------------------------
notify pgrst, 'reload schema';
