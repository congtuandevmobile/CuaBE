-- Public short code for every user (e.g. ABC314) and the username/display name copied from sign-up metadata.
-- The UUID stays the internal primary key; `code` is what people see and share. Safe to run more than once.

-- 3 letters (no I / O, so they are never mistaken for 1 / 0) + 3 digits: 24^3 * 10^3 ≈ 13.8 million codes.
create or replace function public.generate_user_code()
returns text
language plpgsql
volatile
as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
begin
  loop
    candidate :=
      substr(letters, 1 + floor(random() * 24)::int, 1) ||
      substr(letters, 1 + floor(random() * 24)::int, 1) ||
      substr(letters, 1 + floor(random() * 24)::int, 1) ||
      lpad(floor(random() * 1000)::int::text, 3, '0');
    -- Retry on the (rare) collision; the unique index below is the real guarantee.
    exit when not exists (select 1 from public.profiles where code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public.profiles add column if not exists code text;
update public.profiles set code = public.generate_user_code() where code is null;
alter table public.profiles alter column code set not null;
alter table public.profiles alter column code set default public.generate_user_code();
create unique index if not exists profiles_code_key on public.profiles (code);

-- Usernames are case-insensitive: the API stores them lowercase; this keeps the database honest too.
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

-- New user → profile with username, display name (from the API's sign-up metadata) and a fresh code.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'), new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;
