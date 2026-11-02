-- Bind clinic staff to an invited email without storing the plaintext address.
-- care_manager and front_desk are invite roles. provider, ma, and chw stay valid.
-- Does not drop medications, medication_logs, appointments, care_tasks, or vault_files.

alter table public.clinic_staff
  add column if not exists email_hash text,
  add column if not exists auth_user_id uuid,
  add column if not exists is_admin boolean not null default false;

create unique index if not exists clinic_staff_email_hash_idx
  on public.clinic_staff (email_hash)
  where email_hash is not null;

create unique index if not exists clinic_staff_auth_user_idx
  on public.clinic_staff (auth_user_id)
  where auth_user_id is not null;

do $$
declare
  r record;
begin
  for r in
    select cls.relname as table_name, con.conname as constraint_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname in ('clinic_staff', 'circle_access', 'outreach_log')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%chw%'
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.constraint_name);
  end loop;
end;
$$;

alter table public.clinic_staff
  add constraint clinic_staff_role_check
  check (role in ('provider', 'ma', 'chw', 'care_manager', 'front_desk'));

alter table public.circle_access
  add constraint circle_access_role_check
  check (role in ('admin', 'caregiver', 'viewer', 'provider', 'ma', 'chw', 'care_manager', 'front_desk'));

alter table public.outreach_log
  add constraint outreach_log_staff_role_check
  check (staff_role in ('provider', 'ma', 'chw', 'care_manager', 'front_desk'));

notify pgrst, 'reload schema';
