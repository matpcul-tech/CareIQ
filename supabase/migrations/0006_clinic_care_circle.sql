-- Clinic care circle.
-- Patients and caregivers share a circle with that clinic's care team.
-- Clinic staff roles are provider, ma, and chw.
-- Direct table access is denied. The CareIQ server uses the service role
-- after it checks the caller. PHI text in caregiver messages is stored for
-- the care team. Any model payload is masked first.
-- CMS165 and CMS122 figures computed by the app are estimates, not validated
-- measures. Reading days and minutes are tracking only, not claims.

create extension if not exists "pgcrypto";

create table if not exists public.clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_staff (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  role         text not null check (role in ('provider', 'ma', 'chw')),
  display_name text not null,
  phone        text,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists clinic_staff_clinic_idx on public.clinic_staff (clinic_id);

create table if not exists public.clinic_thresholds (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  metric    text not null check (metric in ('bp_systolic', 'bp_diastolic', 'glucose_high', 'glucose_low', 'a1c')),
  value     numeric not null,
  primary key (clinic_id, metric)
);

create table if not exists public.clinic_patients (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  patient_id        uuid references public.patients(id) on delete set null,
  external_id       text not null,
  age               int,
  has_diabetes      boolean not null default false,
  has_hypertension  boolean not null default false,
  last_a1c          numeric,
  last_a1c_date     date,
  bp_systolic       int,
  bp_diastolic      int,
  last_bp_date      date,
  next_visit_date   date,
  unique (clinic_id, external_id)
);

create index if not exists clinic_patients_clinic_idx on public.clinic_patients (clinic_id);

create table if not exists public.circle_access (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  role               text not null check (role in ('admin', 'caregiver', 'viewer', 'provider', 'ma', 'chw')),
  display_name       text not null,
  staff_id           uuid references public.clinic_staff(id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists circle_access_patient_idx on public.circle_access (clinic_patient_id);

create table if not exists public.home_readings (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  kind               text not null check (kind in ('bp', 'glucose')),
  systolic           int,
  diastolic          int,
  glucose            numeric,
  recorded_on        date not null,
  created_at         timestamptz not null default now()
);

create index if not exists home_readings_patient_day_idx
  on public.home_readings (clinic_patient_id, recorded_on);

create table if not exists public.circle_alerts (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  metric             text not null,
  value_text         text not null,
  created_on         date not null
);

create table if not exists public.circle_messages (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  author_role        text not null,
  body               text not null,
  created_on         date not null
);

create table if not exists public.circle_checkins (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  kind               text not null check (kind in ('medication', 'appointment')),
  status             text not null check (status in ('missed', 'completed')),
  occurred_on        date not null
);

create table if not exists public.outreach_log (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics(id) on delete cascade,
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  staff_role         text not null check (staff_role in ('provider', 'ma', 'chw')),
  outcome            text not null check (outcome in ('contacted', 'scheduled', 'closed', 'no_answer', 'declined')),
  created_on         date not null
);

create table if not exists public.care_minutes (
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  month              text not null,
  minutes            int not null default 0,
  primary key (clinic_patient_id, month)
);

alter table public.clinics enable row level security;
alter table public.clinics force row level security;
alter table public.clinic_staff enable row level security;
alter table public.clinic_staff force row level security;
alter table public.clinic_thresholds enable row level security;
alter table public.clinic_thresholds force row level security;
alter table public.clinic_patients enable row level security;
alter table public.clinic_patients force row level security;
alter table public.circle_access enable row level security;
alter table public.circle_access force row level security;
alter table public.home_readings enable row level security;
alter table public.home_readings force row level security;
alter table public.circle_alerts enable row level security;
alter table public.circle_alerts force row level security;
alter table public.circle_messages enable row level security;
alter table public.circle_messages force row level security;
alter table public.circle_checkins enable row level security;
alter table public.circle_checkins force row level security;
alter table public.outreach_log enable row level security;
alter table public.outreach_log force row level security;
alter table public.care_minutes enable row level security;
alter table public.care_minutes force row level security;

notify pgrst, 'reload schema';
