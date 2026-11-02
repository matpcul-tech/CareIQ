-- PHQ check-ins for CMS2 and CMS159 estimates, and per-clinic measure targets.
-- Targets are rates from 0 to 1. Missing rows use the scorecard defaults in code.
-- These tables do not submit claims.

create table if not exists public.circle_screens (
  id                 uuid primary key default gen_random_uuid(),
  clinic_patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  instrument         text not null check (instrument in ('phq2', 'phq9')),
  score              int not null,
  follow_up          boolean not null default false,
  recorded_on        date not null
);

create index if not exists circle_screens_patient_idx
  on public.circle_screens (clinic_patient_id, recorded_on);

create table if not exists public.clinic_measure_targets (
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  measure_id  text not null,
  target      numeric not null,
  primary key (clinic_id, measure_id)
);

alter table public.circle_screens enable row level security;
alter table public.circle_screens force row level security;
alter table public.clinic_measure_targets enable row level security;
alter table public.clinic_measure_targets force row level security;

notify pgrst, 'reload schema';
