import type { Metadata } from 'next';
import { Auth0Provider } from '@auth0/nextjs-auth0/client';
import { auth0, isAuth0Configured } from '@/lib/auth0';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stay Here',
  description: 'Plan a trip from a vibe: itineraries, real events, and playful side quests.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = isAuth0Configured() ? await auth0.getSession() : null;

  return (
    <html lang="en">
      <body>
        <Auth0Provider user={session?.user}>{children}</Auth0Provider>
      </body>
    </html>
  );
}
