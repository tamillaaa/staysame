'use client';

import { useUser } from '@auth0/nextjs-auth0/client';

/** Login/logout control for the topbar. Real routes handled by the Auth0 SDK's proxy. */
export default function AuthStatus() {
  const { user, isLoading } = useUser();

  if (isLoading) return null;

  if (user) {
    return (
      <div className="auth-status">
        <span className="auth-name">{user.name ?? user.email}</span>
        <a className="auth-link" href="/auth/logout">
          Log out
        </a>
      </div>
    );
  }

  return (
    <a className="auth-link" href="/auth/login">
      Log in
    </a>
  );
}
