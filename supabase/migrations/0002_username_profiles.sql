-- Username accounts: the API stores the username (and display name) in auth user metadata.
-- The trigger copies both into public.profiles when the user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, new.raw_user_meta_data ->> 'username', new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;
