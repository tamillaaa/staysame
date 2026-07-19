'use client';

import { useEffect, useState } from 'react';

type SectionInfo = { id: string; label: string };

// Side-rail dots for the snap sections, plus the one-shot entrance trigger for
// the plan section. Sections are discovered from the DOM ([data-snap-label])
// rather than passed as props because the results section only mounts once a
// trip has been generated.
export default function ScrollDots() {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [active, setActive] = useState('');

  useEffect(() => {
    let sectionObserver: IntersectionObserver | null = null;
    let known = '';

    const collect = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-snap-label]'));
      const key = nodes.map((n) => n.id).join(',');
      if (key === known) return;
      known = key;
      setSections(nodes.map((n) => ({ id: n.id, label: n.dataset.snapLabel ?? n.id })));

      sectionObserver?.disconnect();
      // A section is "active" while it spans the vertical center of the
      // viewport — a plain threshold fails for sections taller than 100vh.
      sectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) setActive(entry.target.id);
          }
        },
        { rootMargin: '-50% 0px -50% 0px' }
      );
      nodes.forEach((n) => sectionObserver?.observe(n));
    };

    collect();
    const mutations = new MutationObserver(collect);
    mutations.observe(document.body, { childList: true, subtree: true });

    // Fire the plan section's staggered entrance once per page load; the class
    // stays on, so scrolling back up and down never replays it.
    const plan = document.getElementById('plan');
    let reveal: IntersectionObserver | null = null;
    if (plan) {
      reveal = new IntersectionObserver((entries, observer) => {
        if (entries.some((e) => e.isIntersecting)) {
          plan.classList.add('is-revealed');
          observer.disconnect();
        }
      }, { threshold: 0.12 });
      reveal.observe(plan);
    }

    return () => {
      sectionObserver?.disconnect();
      mutations.disconnect();
      reveal?.disconnect();
    };
  }, []);

  if (sections.length < 2) return null;

  return (
    <nav className="snap-dots" aria-label="Page sections">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className="snap-dot"
          title={s.label}
          aria-label={s.label}
          aria-current={active === s.id ? 'true' : undefined}
          onClick={() => document.getElementById(s.id)?.scrollIntoView()}
        />
      ))}
    </nav>
  );
}
