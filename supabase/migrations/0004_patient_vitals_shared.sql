-- ============================================================
-- CareIQ migration 0004 -- patient_vitals_shared
--
-- Family-readable mirror of the patient-entered numeric labs and a
-- short list of shareable health-history fields. Populated by
-- /api/onboard/manual-labs (and any future patient-facing edit flow)
-- whenever the patient saves new values. Never contains encrypted
-- blobs and never reads from health_history.data_encrypted on the
-- read side, so a family member with cc-session JWT can SELECT it
-- through Supabase REST + RLS the same way they read
-- care_circle_alerts.
--
-- This solves the "family sees the same numbers as the patient"
-- requirement without exposing the AES-256-GCM ciphertext.
--
-- All values that flow into this table come from the patient's own
-- input on their own session in CareIQ, so writing them in plaintext
-- here is a deliberate user-consented sharing decision (the patient
-- chose to issue an invite via /api/circle/generate-invite). Family
-- access is gated by the existing care_circle linkage.
-- ============================================================

create table if not exists public.patient_vitals_shared (
  patient_id        uuid        primary key references public.patients(id) on delete cascade,

  -- Manual labs (numeric)
  a1c               numeric,
  ldl               numeric,
  hdl               numeric,
  fasting_glucose   numeric,
  bp_systolic       int,
  bp_diastolic      int,
  triglycerides     numeric,
  egfr              numeric,

  -- Health history excerpts the patient explicitly shares with their
  -- family circle. Free-text but PHI-safe in scope (no SSN, MRN, etc.).
  chronic_conditions text[],
  medications        text,
  allergies          text,

  updated_at        timestamptz not null default now()
);

create index if not exists patient_vitals_shared_updated_idx
  on public.patient_vitals_shared (updated_at desc);

alter table public.patient_vitals_shared enable row level security;
alter table public.patient_vitals_shared force row level security;

-- Patient sees their own row.
drop policy if exists patient_vitals_self_select on public.patient_vitals_shared;
create policy patient_vitals_self_select
  on public.patient_vitals_shared for select
  to authenticated
  using (patient_id = auth.uid());

-- Family member linked via care_circle sees the patient's row.
drop policy if exists patient_vitals_family_select on public.patient_vitals_shared;
create policy patient_vitals_family_select
  on public.patient_vitals_shared for select
  to authenticated
  using (
    exists (
      select 1 from public.care_circle cc
      where cc.patient_id = public.patient_vitals_shared.patient_id
        and cc.member_user_id = auth.uid()
    )
  );

-- All writes go through service role (the manual-labs route bypasses RLS).
-- No insert/update policy is added for authenticated, so anon and patient
-- direct writes are denied at the policy layer.

-- Tell PostgREST to refresh its schema cache so the new table is
-- immediately available to the REST API.
notify pgrst, 'reload schema';
