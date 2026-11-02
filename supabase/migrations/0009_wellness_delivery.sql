-- Family SMS attempts keep a delivery status so a failed text does not block care-team escalation.
-- Inbound MessageSid rows stop a Twilio retry from applying the same OK twice.

alter table public.clinic_patients add column if not exists wellness_family_delivery text;

create table if not exists public.clinic_inbound_messages (
  message_sid text primary key,
  received_at timestamptz not null default now()
);

alter table public.clinic_inbound_messages enable row level security;
alter table public.clinic_inbound_messages force row level security;

notify pgrst, 'reload schema';
