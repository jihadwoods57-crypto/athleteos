-- OnStandard — persist the onboarding role at signup (routing fix 2026-07-04).
--
-- THE BUG: handle_new_user (0001) created every profile with the DEFAULT primary_role
-- 'athlete', and the app never wrote it afterward. Combined with email-confirm ON (no
-- session at signup, so no post-hoc write) and the enum-vs-flowForRole mismatch, a coach,
-- trainer, or parent who signed in on a fresh device / after reinstall landed in the ATHLETE
-- app with no path to their roster. The app-side fixes: signUp now passes the role in
-- metadata, flowForRole handles the DB enum, and pushProfile writes primary_role. This
-- migration closes the loop server-side: the trigger reads the role from signup metadata at
-- account creation, which is the ONLY moment guaranteed to run even with email-confirm on.
--
-- Safe cast: only the four valid user_role values are honored; anything else (or absent)
-- falls back to 'athlete', exactly as before.

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, primary_role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email,
    coalesce(
      case
        when new.raw_user_meta_data->>'role' in ('athlete', 'coach', 'trainer', 'parent')
          then (new.raw_user_meta_data->>'role')::user_role
        else null
      end,
      'athlete'
    )
  )
  on conflict (id) do nothing;
  return new;
end; $$;
