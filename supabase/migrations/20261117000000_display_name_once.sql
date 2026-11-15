-- A display name is chosen once, at sign-up, and never changed afterwards.
-- Insert (id, display_name) stays for the rare account whose sign-up trigger skipped the profile;
-- the primary key on id stops a second insert. Reads are unchanged.
revoke update (display_name) on public.profiles from authenticated;
drop policy if exists profiles_update_own on public.profiles;
