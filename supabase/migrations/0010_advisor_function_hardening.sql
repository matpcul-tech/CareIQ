-- Advisor fixes for functions.
-- Does not drop medications, medication_logs, appointments, care_tasks,
-- or vault_files. Those tables may exist on a live database and are not
-- created by migrations 0001 through 0009.
--
-- Leaked password protection is a Supabase Auth dashboard setting.
-- It is not changed here. See the pull request notes.

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

revoke all on function public.audit_log_immutable() from public, anon, authenticated;

-- is_patient_or_member(uuid) is a SECURITY DEFINER helper that may exist
-- on the live database even though migrations 0001 through 0009 do not
-- create it. If a policy or another function calls it, keep it in public
-- and allow only authenticated. Otherwise move it out of the exposed API
-- schema. A fresh database with no such function is unchanged.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
declare
  used boolean;
begin
  if to_regprocedure('public.is_patient_or_member(uuid)') is null then
    raise notice 'is_patient_or_member(uuid) is not present';
    return;
  end if;

  select exists (
    select 1
    from pg_policy pol
    where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%is_patient_or_member%'
       or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%is_patient_or_member%'
  ) or exists (
    select 1
    from pg_proc proc
    join pg_namespace nsp on nsp.oid = proc.pronamespace
    where nsp.nspname = 'public'
      and proc.proname <> 'is_patient_or_member'
      and proc.prosrc ilike '%is_patient_or_member%'
  ) into used;

  if used then
    revoke all on function public.is_patient_or_member(uuid) from public, anon;
    grant execute on function public.is_patient_or_member(uuid) to authenticated;
  else
    alter function public.is_patient_or_member(uuid) set schema private;
    revoke all on function private.is_patient_or_member(uuid) from public, anon, authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
