const PIXELS = [true, true, true, false, true, true, true, false, true];

/**
 * Family logo: the Open Data Project pixel grid, echoing the family
 * mark used by the launcher hub and each product's og image and app
 * icon. Filled cells use the primary token so the mark stays brand
 * green in both themes.
 * Decorative: the header's launcher link provides the accessible name.
 */
export function FamilyLogo() {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 grid-cols-3 gap-[4px]"
    >
      {PIXELS.map((filled, index) => (
        <span
          key={index}
          className={filled ? "rounded-full bg-primary" : "rounded-full"}
        />
      ))}
    </span>
  );
}
