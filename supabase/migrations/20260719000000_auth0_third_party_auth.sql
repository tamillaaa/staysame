-- Switch user_id from Supabase's own auth.users to Auth0 via Supabase's
-- Third-Party Auth integration.
--
-- Third-party-authenticated users never get a row in Supabase's own
-- auth.users table, so the original `references auth.users(id)` foreign
-- keys reject every insert from a real, signed-in user. auth.uid() still
-- resolves correctly from the Auth0 access token's `sub` claim under
-- Third-Party Auth, so the existing RLS policies (auth.uid() = user_id)
-- keep working unchanged. Only the foreign key needs dropping.
--
-- This requires Auth0 to be added as a Third-Party Auth provider in the
-- Supabase dashboard (Authentication -> Sign In / Providers -> Third-Party
-- Auth) before auth.uid() will resolve for Auth0-issued tokens at all.

alter table trips drop constraint if exists trips_user_id_fkey;
alter table traveler_codes drop constraint if exists traveler_codes_user_id_fkey;
