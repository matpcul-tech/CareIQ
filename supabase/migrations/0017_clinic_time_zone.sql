-- Clinic time zone (IANA name). Reminder send days, the 8 AM to 9 PM send window, and the
-- panel's "today" use it. The app validates the name; the check only bounds its shape.
-- Existing clinics get America/Chicago.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

alter table public.clinics
  add column if not exists time_zone text not null default 'America/Chicago'
  check (char_length(time_zone) between 3 and 64 and time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$');

notify pgrst, 'reload schema';
