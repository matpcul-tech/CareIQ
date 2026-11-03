-- Widen wearable_data.device_type.
-- This file is in the repo only. It has not been applied to the live database.
-- Matthew must approve applying it before the new labels can be stored
-- in the device_type column. Until then the upload route keeps the real
-- device name in the encrypted summary and stores generic in the column
-- when the current check rejects the label.

do $$
declare
  r record;
begin
  for r in
    select con.conname as constraint_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'wearable_data'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%device_type%'
  loop
    execute format('alter table public.wearable_data drop constraint %I', r.constraint_name);
  end loop;
end $$;

alter table public.wearable_data
  add constraint wearable_data_device_type_check
  check (device_type in (
    'fitbit',
    'apple_watch',
    'garmin',
    'samsung',
    'google_fit',
    'generic',
    'withings',
    'omron',
    'dexcom',
    'libre',
    'health_connect',
    'oura',
    'polar',
    'other'
  ));
