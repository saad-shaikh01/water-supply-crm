# Customer Portal UI Implementation

Companion document to `CUSTOMER_PORTAL_UI_AUDIT.md`. Records what was actually changed, file by file, after the audit and prioritized fix plan were approved. No IA changes, no workflow changes, no API/routing/auth changes — scope was strictly visual polish, consistency, responsiveness, accessibility, and the reported dialog bug.

---

## Files Changed

### Shared UI library (`libs/shared/ui/src/lib/components/ui/`) — affects customer-portal, vendor-dashboard, admin-panel
- **`dialog.tsx`** — root-cause fix for the payments dialog overflow bug (see below).
- **`sheet.tsx`** — same structural scroll-safety fix applied for parity (was completely unguarded).
- **`sonner.tsx`** — removed hardcoded `theme="light"`; now reads the app's real theme via `next-themes`' `useTheme()`.
- **`badge.tsx`** — added one new variant, `primary` (soft `bg-primary/10 text-primary` tint), needed to represent "in-progress/active" states without forcing them onto an ill-fitting existing variant.
- **`input.tsx` / `textarea.tsx` / `select.tsx`** — migrated the dark-mode styling that used to live only in a global `!important` CSS override (see below) directly into the components as explicit `dark:` classes, with the exact same rendered values (zero visual change) but now honestly declared in the component source.
- **`table.tsx`** — `TableHead`'s dark-mode text opacity updated from `dark:text-white/60` to `dark:text-white/40` to match what was actually rendering (previously silently overridden by global CSS with `!important`).

### Customer-portal only
- **`app/global.css`** — removed three `!important` rules that silently overrode component-declared values (button radius, input font-weight/background/border/blur, table header color) — their intended behavior was migrated into the respective components instead (see above), so the rendered result for existing users is unchanged; only the source of truth moved.
- **Page headers**: `home/page.tsx`, `profile/page.tsx`, `transactions/page.tsx` — removed a stray duplicate `text-sm` class sitting alongside `text-[10px]` on the subtitle (copy-paste bug; the other 6 portal pages didn't have it).
- **`features/transactions/components/transaction-list.tsx`** — desktop table wrapper's `overflow-hidden` (which silently clipped content) now has a dedicated inner `overflow-x-auto` scroll region; description cell is `truncate`-constrained with a `title` tooltip; all other cells got `whitespace-nowrap` so numeric/date columns never wrap awkwardly.
- **`features/notifications/components/notification-preferences-panel.tsx`** — replaced hardcoded `text-white` / `bg-white/5` / `bg-white/20` with theme tokens (`text-foreground`, `bg-muted/30`, `bg-muted-foreground/30`) — this was a real light-mode legibility bug (white text on a light card), not just a consistency issue.
- **`features/notifications/components/notification-center.tsx`** — loading skeleton now uses the shared `Skeleton` primitive instead of a raw div with a one-off opacity value; notification popover width capped at `min(22rem, 100vw-2rem)` so it can't exceed a 320px viewport.
- **`components/layout/header.tsx`** — desktop nav (9 items) now scrolls horizontally (`overflow-x-auto scrollbar-none`, capped at `60vw` below `lg:`) instead of silently overflowing the header at the `sm:` breakpoint where it first appears.

### Badge adoption (routing hand-rolled status colors through the shared `Badge` component)
- `app/(portal)/deliveries/page.tsx`, `orders/page.tsx`, `payments/page.tsx`, `schedule/page.tsx` — `STATUS_CONFIG`/`FULFILLMENT_BADGE` records gained a `variant` field alongside their existing `color` field (icon-box backgrounds still use `color`; badges now use `variant`). This also fixed a real color drift: `emerald-500` vs `emerald-600` and `amber` vs `yellow` were being used for the identical "success"/"pending" states across different pages — now both route through the same `success`/`warning` variant everywhere.
- `features/payments/components/payment-dialog.tsx` — the QR status chip's hand-rolled `chipClass` replaced with `variant`.
- **New file `features/tickets/status.ts`** — `TICKET_STATUS_VARIANT` / `TICKET_PRIORITY_VARIANT` / `TICKET_TYPE_VARIANT`, extracted from `support/page.tsx` and `ticket-detail-dialog.tsx`, which previously duplicated the exact same color-map constants verbatim (a real, already-proven-to-drift duplication).

### Card radius standardization
- `features/profile/components/profile-card.tsx` (5 occurrences) and `app/(portal)/schedule/page.tsx`'s pattern card — arbitrary `rounded-[2rem]` replaced with the equivalent named token `rounded-4xl` (zero visual change, just stops bypassing the design system's own token).
- `features/profile/components/change-password-form.tsx`, `features/payments/components/payment-dialog.tsx` (outer `DialogContent`), `features/auth/components/login-form.tsx` — arbitrary `rounded-[2.5rem]` (40px, a one-off not matching any other surface) brought down to `rounded-3xl` (24px), matching every other dialog/hero card in the app (`place-order-dialog`, `create-ticket-dialog`, `ticket-detail-dialog` already used `rounded-3xl`).
- `payment-dialog.tsx`'s inner Raast-info callout box — `rounded-[2rem]` → `rounded-2xl`, matching the "nested content" tier (was larger than its own dialog's outer radius, which read oddly).

### Auth page reconciliation
- **`login-form.tsx`** — replaced the one-off oversized colored banner (`bg-primary p-10`, `text-3xl` heading, custom `h-12/h-7` icon ratio) with the same icon-in-box + centered heading pattern already used by `activation-flow.tsx` and `reset-password/page.tsx` (`h-14 w-14 rounded-2xl bg-primary/10` + `Droplets` + `text-2xl font-black`), and the same `bg-card/50 backdrop-blur-sm border-border/50 shadow-2xl` card treatment. Also removed unused `CardHeader`/`CardTitle`/`CardDescription` imports that predated this change.
- **`forgot-password-form.tsx`** — was a bare, unstyled `Card` with no icon and `font-bold` (not `font-black`) heading, visually inconsistent with every other auth surface. Rebuilt with the same icon-box + card pattern as the rest of the auth flow.
- **`activation-flow.tsx`, `reset-password/page.tsx`** — removed a duplicated outer `min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center px-4` wrapper; `auth/layout.tsx` already provides this (and its background-blur decorations) for every auth page — `login-form.tsx`/`forgot-password-form.tsx` already relied on it correctly, these two didn't.
- **Label/error typography**: `activation-flow.tsx`, `reset-password/page.tsx`, `forgot-password-form.tsx` had plain `text-sm font-semibold` labels and inconsistent error-text sizing. Standardized onto the majority convention already used by `login-form.tsx`/`change-password-form.tsx`/`payment-dialog.tsx`: `text-xs font-black uppercase tracking-widest text-muted-foreground` for labels, `text-[10px] font-bold text-destructive` for inline errors.

### Password-visibility toggles
- Added the existing `Eye`/`EyeOff` toggle pattern (already present in `change-password-form.tsx`) to every other password field in the app: `login-form.tsx`, `reset-password/page.tsx` (both fields), `activation-flow.tsx`'s `PasswordStep` (both fields). Also added the one missing toggle in `change-password-form.tsx` itself (its Confirm field never had one).

### Empty/loading/error state consolidation
- `app/(portal)/deliveries/page.tsx` — migrated onto the shared `ListLoadingState`/`ListEmptyState`/`ListErrorState` (`components/shared/list-states.tsx`); this surface previously had **no error state at all** — a real API failure silently rendered as "no deliveries found." Now shows a proper retry-capable error state.
- `app/(portal)/schedule/page.tsx` — same migration, same missing-error-state fix for the delivery calendar section.
- `features/wallet/components/recent-transactions.tsx` (home-page widget) — kept its own per-row `Skeleton` loading pattern (a deliberate, better-fitting idiom for a compact card-embedded list — importing the shared component would nest a `Card` inside its already-existing `Card`), but brought its empty state's visual weight in line with the shared convention (`h-12 w-12` icon at 30% opacity, `py-16`, descriptive subtext) instead of a smaller, differently-styled circle.
- `features/notifications/components/notification-center.tsx` — this is a compact dropdown tray (`max-h-[24rem]`), structurally too small for the shared components' `py-16` Card-based layout, so it wasn't migrated wholesale; its loading skeleton now uses the shared `Skeleton` primitive (previously a raw div with a one-off `bg-accent/40` opacity) for at least token-level consistency.

---

## The Dialog/Sheet Fix — What Changed and Why

**Root cause** (full detail in the audit doc §1): `DialogContent`'s base classes included `max-h-[90dvh] overflow-y-auto`, merged via `cn()`/`tailwind-merge` with each consumer's own `className`. `tailwind-merge` treats the `overflow` shorthand (e.g. `overflow-hidden`) and `overflow-y` as the same conflict group, so any consumer passing `overflow-hidden` (typically to clip a rounded header banner's corners) silently deleted the base `overflow-y-auto` — the dialog stayed height-capped but lost its ability to scroll. Two independent instances of this existed: `payment-dialog.tsx` (the reported bug) and `apps/vendor-dashboard/.../edit-location-dialog.tsx` (an undiscovered twin, found during the audit).

**Fix**: moved the scroll/height-cap behavior off the `className` string entirely and onto an inline `style` prop (`style={{ maxHeight: '90dvh', overflowY: 'auto', ...style }}`). Inline styles are never touched by `tailwind-merge` (which only operates on `className`) and always win the CSS cascade over any class-based rule — this is a browser-fundamentals guarantee, not dependent on Tailwind/tailwind-merge internals or class ordering (the previous fix, before this session, relied on exactly that kind of fragile ordering coincidence). The identical treatment was applied to `Sheet`, which had no height/scroll guard at all on any `side` variant (top/bottom sheets had no cap; left/right relied on `h-full`, which the fix respects — `maxHeight: 90dvh` is only applied for `top`/`bottom`, never overriding the full-height side-drawer sizing).

**Result**: `payment-dialog.tsx` and `edit-location-dialog.tsx` needed **zero changes to their own code** — both were verified to still render identically (same padding, same rounded corners, same everything) and now scroll correctly. Every other dialog and sheet in both apps inherits the same guarantee going forward — a future author adding `overflow-hidden` to clip a banner can no longer accidentally disable scrolling.

---

## Design Improvements Summary

- **Theme**: light/dark confirmed as a genuinely hand-tuned pair (not inverted); the three CSS `!important` ambushes that silently overrode component-declared values were removed and their intended visual outcome (unchanged) migrated into the components themselves, so the component source is now honest about what actually renders in dark mode. Sonner's dark-mode-toast bug fixed.
- **Typography**: page-header subtitle bug fixed on 3 pages; label typography now consistent across the entire auth flow (previously 3 different treatments); inline form-error text now one consistent size/weight across auth.
- **Spacing/radius**: card radius reduced from 5 inconsistent values (`rounded-2xl`/`3xl`/arbitrary `[2rem]`/`[2.5rem]`) down to 2 deliberate tiers — `rounded-2xl` for list/content cards, `rounded-3xl` for dialogs/hero surfaces — using the design system's own named tokens instead of arbitrary bracket values.
- **Badges**: every status display in customer-portal (deliveries, orders, payments, schedule, tickets) now routes through the shared `Badge` component's semantic variants instead of hand-rolled color classes; the same real-world state (paid/delivered/resolved = success, pending = warning, rejected = destructive) now renders identically everywhere instead of drifting between `emerald-500`/`emerald-600` or `amber`/`yellow`.
- **Responsive fixes**: transactions table no longer clips overflow content; header nav no longer overflows between 640–1024px; notification popover can't exceed a 320px viewport; a real light-mode contrast bug (white-on-white text) in notification preferences fixed.
- **Accessibility**: the notification-preferences contrast bug (functional, not just cosmetic) fixed; password fields across the entire auth flow now have a visibility toggle (previously only one form had it).
- **Dialogs**: the reported bug fixed at its root cause in the shared component, benefiting every dialog and sheet in all three apps, with zero page-specific hacks.

## Verification Performed

- `npx nx build customer-portal`, `vendor-dashboard`, and `admin-panel` all pass cleanly after every phase of changes (P0 fixes, badge adoption, radius/typography/header changes, empty-state consolidation, nav fix) — full production builds including TypeScript typecheck and static page generation, run repeatedly throughout the session, not just once at the end.
- Confirmed via direct code reading (not assumed) that `payment-dialog.tsx` and `edit-location-dialog.tsx` required no changes and inherit the dialog fix automatically.
- Grepped for remaining hand-rolled status-color patterns after badge adoption — the only remaining hits are legitimate (icon-box backgrounds, which are a different visual role than badges and intentionally kept on raw color classes, and a type-selector toggle button in `create-ticket-dialog.tsx`, not a status display).

## Remaining Recommendations (not attempted in this pass)

Per the approved plan, these were explicitly scoped out because they'd ripple beyond customer-portal into vendor-dashboard/admin-panel, or would add new shared primitives where the brief asked to refine existing ones:

1. **`Select` vs. `DropdownMenu`/`Tabs` stylistic fork** — `Select` received a full "premium" treatment (larger radii, blur, glow effects) while `DropdownMenu` and `Tabs` remain stock, unmodified shadcn. Reconciling these would touch every app using the shared library.
2. **No shared `AlertDialog`/`Tooltip` primitive** — every confirmation dialog in the codebase (e.g. `orders/page.tsx`'s cancel-order confirmation) is hand-rolled on top of the base `Dialog`. Worth adding as a genuinely new shared primitive in a future, dedicated pass.
3. **`place-order-dialog.tsx`/`create-ticket-dialog.tsx` label typography** (`text-xs font-bold uppercase tracking-wider`) remains a third, slightly different variant from the one now-standardized auth-flow convention (`tracking-widest`, `font-black`) — left alone since the approved plan scoped the label standardization specifically to the auth pages, not every dialog in the app.
4. **Non-responsive fixed grids** (`deliveries/page.tsx`'s 3-column stat strip, `orders/page.tsx`'s 4-column fulfillment tracker) — currently usable at all tested widths given their short label content, but structurally inconsistent with the app's otherwise-responsive grids elsewhere; a cosmetic-only gap, not a breakage.
5. **Cross-app token unification** — `admin-panel` uses a completely different, unmodified stock shadcn palette from customer-portal/vendor-dashboard's shared "premium" glass aesthetic. Out of scope for a customer-portal-focused pass.
