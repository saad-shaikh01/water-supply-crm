import { Flag } from 'lucide-react';

/**
 * Minimal shape every surface returns for an OPEN flag (id/message/category
 * name+color) — not the full `CustomerFlag` type, since the daily-sheet/
 * conversation `select`s only project that much (flags are implicitly OPEN
 * there, no status field).
 */
export type FlagLike = { id: string; message: string; category: { name: string; color: string } };

/** The first (oldest) flag's color — used to accent an avatar or row. */
export function flagAccentColor(flags?: FlagLike[] | null): string | undefined {
  return flags?.[0]?.category.color;
}

/** Inline style for a colored ring around an avatar with an active flag. */
export function flagRingStyle(flags?: FlagLike[] | null): React.CSSProperties | undefined {
  const color = flagAccentColor(flags);
  return color ? { boxShadow: `0 0 0 2px ${color}` } : undefined;
}

/** Inline style for a thin colored left-edge stripe on a flagged row/card. */
export function flagRowStripeStyle(flags?: FlagLike[] | null): React.CSSProperties | undefined {
  const color = flagAccentColor(flags);
  return color ? { boxShadow: `inset 3px 0 0 0 ${color}` } : undefined;
}

/**
 * The highlight shown wherever a customer with an OPEN flag is displayed —
 * customer list, daily-sheet delivery rows, Communication Center, customer
 * detail. Two variants:
 *  - 'icon' (default): compact colored flag icons, capped at `maxVisible`
 *    with a "+N" overflow chip — for tight list/table rows, paired with
 *    `flagRingStyle`/`flagRowStripeStyle` on the avatar/row so the row stays
 *    the same height it was before flags existed.
 *  - 'label': full colored pill with the category name — for a spacious
 *    context (e.g. the customer detail header) where reading the category
 *    without hovering is worth the extra width.
 * Colors are admin-chosen per category (`CustomerFlagCategory.color`, a hex
 * string), so this renders inline styles rather than a fixed Tailwind color
 * class the way other status badges in this codebase do. Hover (native
 * `title`) shows the "why" message — no dedicated tooltip primitive exists
 * in the shared UI kit yet.
 */
export function CustomerFlagIcons({
  flags,
  className = '',
  variant = 'icon',
  maxVisible = 2,
}: {
  flags?: FlagLike[] | null;
  className?: string;
  variant?: 'icon' | 'label';
  maxVisible?: number;
}) {
  if (!flags || flags.length === 0) return null;

  if (variant === 'label') {
    return (
      <div className={`flex flex-wrap items-center gap-1 ${className}`}>
        {flags.map((flag) => (
          <span
            key={flag.id}
            title={`${flag.category.name}: ${flag.message}`}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide shrink-0"
            style={{
              backgroundColor: `${flag.category.color}1a`,
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

  const visible = flags.slice(0, maxVisible);
  const overflow = flags.slice(maxVisible);

  return (
    <div className={`inline-flex items-center gap-0.5 shrink-0 ${className}`}>
      {visible.map((flag) => (
        <span
          key={flag.id}
          title={`${flag.category.name}: ${flag.message}`}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full shrink-0"
          style={{ backgroundColor: `${flag.category.color}22` }}
        >
          <Flag className="h-2.5 w-2.5" style={{ color: flag.category.color }} fill={flag.category.color} />
        </span>
      ))}
      {overflow.length > 0 && (
        <span
          title={overflow.map((f) => `${f.category.name}: ${f.message}`).join('\n')}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[8px] font-bold text-muted-foreground shrink-0"
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}
