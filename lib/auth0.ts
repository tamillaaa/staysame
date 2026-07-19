import { Auth0Client } from '@auth0/nextjs-auth0/server';

/**
 * The audience is set globally so the session's own access token already
 * carries it, not just tokens fetched via a one-off getAccessToken() call.
 * That token is what Supabase verifies for auth.uid() under Third-Party Auth
 * (Auth0). Without a configured audience, Auth0 issues an opaque token
 * Supabase can't read.
 */
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
  },
});

/**
 * Unlike every other integration in this app, the Auth0 SDK throws instead of
 * degrading when unconfigured — a missing env var would otherwise take down
 * every page, not just sign-in. Check this before touching auth0.middleware()
 * or auth0.getSession().
 */
export function isAuth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET
  );
}
