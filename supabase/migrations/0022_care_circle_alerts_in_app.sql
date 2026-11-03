-- In-app CareCircle alerts: hardening for public.care_circle_alerts.
--
-- The in-app feature itself needs no schema change. CareIQ writes rows with
-- the service role, and CareCircle members read them through the existing
-- cca_family_select policy (a care_circle row for that patient and auth.uid()).
--
-- Live schema check (catalog only, 2026-11-03): anon and authenticated hold
-- INSERT and TRUNCATE on care_circle_alerts. RLS has no insert policy, so
-- INSERT is already refused, but TRUNCATE is not checked by RLS. This file
-- removes those privileges so only the service role can write or clear rows.
-- Reads are unchanged.
--
-- Idempotent. NOT APPLIED. Needs owner approval before running against
-- komimlqbxekranbijtat.

revoke insert, update, delete, truncate on public.care_circle_alerts from anon, authenticated;

notify pgrst, 'reload schema';
