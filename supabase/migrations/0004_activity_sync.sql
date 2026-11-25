-- Activities synced from the app: phone recordings and Apple Health workouts, idempotent per (user, source, external_id).
-- See docs/activities.md for the rules. Safe to run more than once.

alter table public.activities add column if not exists source text not null default 'phone';
alter table public.activities add column if not exists external_id text;
alter table public.activities add column if not exists duration_sec numeric not null default 0;
alter table public.activities add column if not exists distance_m numeric;
alter table public.activities add column if not exists energy_kcal numeric;
alter table public.activities add column if not exists source_name text;

-- Rows from the first schema may have no end: use the start (zero-length) so the column can be required.
update public.activities set ended_at = started_at where ended_at is null;
alter table public.activities alter column ended_at set not null;
-- Rows from the first schema have no idempotency key: their own id is unique, so it is a valid one.
update public.activities set external_id = id::text where source = 'phone' and external_id is null;

alter table public.activities drop constraint if exists activities_source_check;
alter table public.activities add constraint activities_source_check check (source in ('phone', 'apple_health'));
alter table public.activities drop constraint if exists activities_time_check;
alter table public.activities add constraint activities_time_check check (ended_at >= started_at and duration_sec >= 0);
alter table public.activities drop constraint if exists activities_phone_external_id_check;
alter table public.activities add constraint activities_phone_external_id_check check (source <> 'phone' or external_id is not null);

-- The idempotency key. NOT partial on purpose: `insert ... on conflict (user_id, source, external_id) do nothing` needs a
-- plain unique index; NULL external ids never collide (Postgres treats NULLs as distinct), which is what a workout
-- without a UUID needs.
create unique index if not exists activities_user_source_external_key
  on public.activities (user_id, source, external_id);

-- Newest-first keyset pagination: (started_at desc, id desc) per user.
drop index if exists public.activities_user_created_idx;
create index if not exists activities_user_started_idx on public.activities (user_id, started_at desc, id desc);
-- Time-window dedup lookups: same user and source, start in a range.
create index if not exists activities_user_source_started_idx on public.activities (user_id, source, started_at);
