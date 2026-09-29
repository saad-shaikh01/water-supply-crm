/**
 * The highlight badge shown wherever a customer with an OPEN flag is
 * displayed — customer list, daily-sheet delivery rows, Communication
 * Center. Colors are admin-chosen per category (`CustomerFlagCategory.color`,
 * a hex string), so this renders an inline swatch rather than a fixed
 * Tailwind color class the way other status badges in this codebase do.
 * Hover (native `title`) shows the "why" message — no dedicated tooltip
 * primitive exists in the shared UI kit yet. Accepts the minimal shape every
 * surface returns (id/message/category name+color) rather than the full
 * `CustomerFlag` type, since the daily-sheet/conversation `select`s only
 * project that much (flags are implicitly OPEN there, no status field).
 */
export function CustomerFlagBadges({
  flags,
  className = '',
}: {
  flags?: { id: string; message: string; category: { name: string; color: string } }[] | null;
  className?: string;
}) {
  if (!flags || flags.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {flags.map((flag) => (
        <span
          key={flag.id}
          title={`${flag.category.name}: ${flag.message}`}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide shrink-0"
          style={{
            backgroundColor: `${flag.category.color}1a`, // ~10% alpha wash, matches the bg-*-500/10 convention used elsewhere
            color: flag.category.color,
            border: `1px solid ${flag.category.color}33`,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: flag.category.color }} />
          {flag.category.name}
        </span>
      ))}
    </div>
  );
}
