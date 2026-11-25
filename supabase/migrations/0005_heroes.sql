-- The user's hero (3D character): body, skin tone and equipment, one row per user. Written only through the API
-- (service role); RLS lets a signed-in user read their own row directly. Safe to run more than once.

create table if not exists public.heroes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  gender text not null check (gender in ('male', 'female')),
  skin_tone smallint not null check (skin_tone between 0 and 5),
  -- { top, bottom, shoes, sandals, watch, hat, hair } -> accessory id (`none` when empty). The catalog lives in the app.
  equipment jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.heroes enable row level security;
drop policy if exists "users can read own hero" on public.heroes;
create policy "users can read own hero" on public.heroes for select using (auth.uid() = user_id);
