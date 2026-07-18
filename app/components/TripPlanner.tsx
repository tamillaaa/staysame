'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Tabs, { isTabId, type TabId } from './Tabs';
import PlanTab from './PlanTab';
import PhotoTab from './PhotoTab';
import ConnectTab from './ConnectTab';
import type { ConfirmedStay, GenerateItineraryResponse } from '@/lib/types';

export default function TripPlanner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'plan';

  // Lifted so the photo tab can hand a destination to the plan form, and so a
  // generated trip can unlock the connect tab.
  const [destination, setDestination] = useState('');
  const [trip, setTrip] = useState<GenerateItineraryResponse | null>(null);
  // Confirming a stay is what unlocks the Connect tab.
  const [confirmedStay, setConfirmedStay] = useState<ConfirmedStay | null>(null);

  // A new itinerary invalidates the stay picked for the previous one.
  const handleTripGenerated = useCallback((next: GenerateItineraryResponse) => {
    setTrip(next);
    setConfirmedStay(null);
  }, []);

  // Tab lives in the URL so a tab is linkable; replace() keeps it out of history
  // and does not reload the page.
  const selectTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'plan') params.delete('tab');
      else params.set('tab', tab);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleDestinationPicked = useCallback(
    (picked: string) => {
      setDestination(picked);
      selectTab('plan');
    },
    [selectTab]
  );

  return (
    <>
      <Tabs active={activeTab} onSelect={selectTab} />

      {activeTab === 'plan' && (
        <PlanTab
          destination={destination}
          onDestinationChange={setDestination}
          trip={trip}
          onTripGenerated={handleTripGenerated}
          confirmedStay={confirmedStay}
          onConfirmStay={setConfirmedStay}
        />
      )}
      {activeTab === 'photo' && (
        <PhotoTab
          onDestinationPicked={handleDestinationPicked}
          onConfirmStay={setConfirmedStay}
          confirmedStay={confirmedStay}
        />
      )}
      {activeTab === 'connect' && <ConnectTab
          trip={trip}
          confirmedStay={confirmedStay}
          onGoToPlan={() => selectTab('plan')}
        />}
    </>
  );
}
