import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client using the service-role key.
 *
 * Returns null when Supabase isn't configured — the itinerary generator works
 * without persistence, so a missing database degrades the feature (the trip
 * isn't saved) rather than breaking it. Never import this from a client
 * component: the service-role key bypasses row-level security.
 */
export function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * A Supabase client scoped to a signed-in user, via Supabase's Third-Party
 * Auth (Auth0) integration rather than Supabase's own auth.users.
 *
 * Unlike getServiceClient(), this respects row-level security: auth.uid() in
 * every RLS policy resolves from the Auth0 access token's `sub` claim, so
 * this client can only read or write rows that belong to that user. Use it
 * wherever an action should be attributed to the person actually signed in,
 * not the server's own service-role privileges.
 */
export function getUserScopedClient(accessToken: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => accessToken,
  });
}
