'use client';

/**
 * Image-to-destination lives here.
 *
 * Not built in this pass — the route (`/api/vibe-to-destination`), the Gemini
 * call and the upload dropzone all land next. `onDestinationPicked` is the seam:
 * the suggestion cards will call it, which pre-fills the plan form and switches
 * back to that tab.
 */
export default function PhotoTab({
  onDestinationPicked,
}: {
  onDestinationPicked: (destination: string) => void;
}) {
  // Referenced so the wiring contract is explicit and type-checked before the
  // uploader exists.
  void onDestinationPicked;

  return (
    <div className="empty">
      <h2>Coming next: plan from a photo</h2>
      <p>
        Upload a vibe board or a screenshot and we&apos;ll read its aesthetic, then suggest three
        destinations that match. Picking one drops it straight into the trip planner.
      </p>
    </div>
  );
}
