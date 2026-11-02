-- Cancer follow-up, wellness check-in, cognitive and falls screens, and caregiver strain.
-- Screening rates computed by the app are estimates, not validated CMS measures.
-- Wellness texts are skipped when SMS is not configured.

alter table public.clinic_patients add column if not exists sex text;
alter table public.clinic_patients add column if not exists cost_barrier boolean not null default false;
alter table public.clinic_patients add column if not exists transport_barrier boolean not null default false;
alter table public.clinic_patients add column if not exists lives_alone boolean not null default false;
alter table public.clinic_patients add column if not exists wellness_opt_in boolean not null default false;
alter table public.clinic_patients add column if not exists wellness_phone text;
alter table public.clinic_patients add column if not exists wellness_family_phone text;
alter table public.clinic_patients add column if not exists wellness_last_ok timestamptz;
alter table public.clinic_patients add column if not exists wellness_family_notified_at timestamptz;
alter table public.clinic_patients add column if not exists wellness_team_notified_at timestamptz;

create table if not exists public.circle_safety_events (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  kind               text not null check (kind in ('cancer', 'cognitive', 'falls', 'strain')),
  recorded_on        date not null,
  payload            jsonb not null
);

create index if not exists circle_safety_patient_idx
  on public.circle_safety_events (clinic_patient_id, kind, recorded_on);

create table if not exists public.clinic_care_settings (
  clinic_id                 uuid primary key references public.clinics(id) on delete cascade,
  wellness_window_hours     int not null default 26,
  cancer_followup_days      int not null default 30,
  cognitive_interval_days   int not null default 365,
  cognitive_concern_at      int not null default 2,
  strain_high_at            int not null default 7
);

alter table public.circle_safety_events enable row level security;
alter table public.circle_safety_events force row level security;
alter table public.clinic_care_settings enable row level security;
alter table public.clinic_care_settings force row level security;

notify pgrst, 'reload schema';
