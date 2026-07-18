'use client';

import type { HotelPickPublic } from '@/lib/types';

/**
 * A single stay, in the same card style the Plan tab uses.
 *
 * Presentational only. `HotelPicks` still renders its own copy of this markup —
 * it wasn't refactored onto this component so the Plan tab stays untouched.
 */
export default function StayCard({
  pick,
  confirmed,
  onConfirm,
}: {
  pick: HotelPickPublic;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  return (
    <article className={`stay${confirmed ? ' confirmed' : ''}`}>
      {pick.imageUrl ? (
        <img className="stay-img" src={pick.imageUrl} alt={pick.name} loading="lazy" />
      ) : (
        <div className="stay-img stay-img-empty">No photo</div>
      )}
      <div className="stay-body">
        <h4 className="stay-name">{pick.name}</h4>
        <p className="stay-loc">{pick.location}</p>
        {pick.blurb && <p className="stay-blurb">{pick.blurb}</p>}
        <p className="stay-desc">{pick.description}</p>
        <p className="stay-price">{pick.priceLabel}</p>

        <div className="stay-actions">
          {pick.allezDeeplink && (
            <a
              className="stay-book"
              href={pick.allezDeeplink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Book{pick.provider ? ` on ${pick.provider}` : ''}
            </a>
          )}
          <button type="button" className="stay-confirm" aria-pressed={confirmed} onClick={onConfirm}>
            {confirmed ? 'Staying here ✓' : "I'm staying here"}
          </button>
        </div>
      </div>
    </article>
  );
}
