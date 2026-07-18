'use client';

export const TABS = [
  { id: 'plan', label: 'Plan a trip' },
  { id: 'photo', label: 'From a photo' },
  { id: 'connect', label: 'Connect' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export function isTabId(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value);
}

export default function Tabs({
  active,
  onSelect,
}: {
  active: TabId;
  onSelect: (tab: TabId) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Trip planner sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
