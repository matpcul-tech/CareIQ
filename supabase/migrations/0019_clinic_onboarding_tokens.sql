-- First clinic admin setup and staff invite links, without manual SQL.
-- Tokens are random 256 bit values shown once; only their SHA-256 hash is stored.
-- Redemption is a single UPDATE ... WHERE used_at is null and expires_at > now(), so a token works once.
-- Direct table access is denied; the CareIQ server uses the service role.
-- Numbered 0019: 0016 is e2e patient keys (PR 44), 0017 and 0018 are used by open PRs 45 and 47.
-- NOT APPLIED. Needs owner approval before running against komimlqbxekranbijtat.

create table if not exists public.clinic_setup_tokens (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  note        text check (note is null or char_length(note) <= 80),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.clinic_invite_links (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role        text not null check (role in ('provider', 'care_manager', 'front_desk')),
  is_admin    boolean not null default false,
  created_by  uuid not null references public.clinic_staff(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists clinic_invite_links_clinic_idx on public.clinic_invite_links (clinic_id, created_at desc);

alter table public.clinic_setup_tokens enable row level security;
alter table public.clinic_setup_tokens force row level security;
alter table public.clinic_invite_links enable row level security;
alter table public.clinic_invite_links force row level security;

revoke all on public.clinic_setup_tokens from anon, authenticated;
revoke all on public.clinic_invite_links from anon, authenticated;

notify pgrst, 'reload schema';
