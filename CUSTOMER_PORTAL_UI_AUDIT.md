# Customer Portal UI Audit

Scope: `apps/customer-portal` (all auth + portal pages/components) plus the shared UI primitives it consumes from `libs/shared/ui/src/lib/components/ui/`. Produced by reading every page/feature component in the app, every shared UI primitive, the Tailwind/theme config, and by reproducing the reported `/payments` dialog bug back to its root cause.

Goal of this document: catalogue every inconsistency found, in the categories requested, with concrete file/line evidence — then hand off to `CUSTOMER_PORTAL_UI_IMPLEMENTATION.md` (written after the fix pass) for what was actually changed.

---

## 1. Existing Bug — `/payments` "Make Payment" dialog overflow (root cause)

**Symptom**: on smaller screens, the Make Payment modal's content (especially the Manual-payment tab, which stacks a Raast-ID box, a 4-button method grid, a reference input, a file input, a textarea, and a submit button) exceeds the viewport height, and the dialog cannot be scrolled to reach the rest of the form.

**Root cause**: `libs/shared/ui/src/lib/components/ui/dialog.tsx:37` — `DialogContent`'s base class string already includes `max-h-[90dvh] overflow-y-auto` (added in a prior partial fix, commit `55e4aab`). This caps dialog height correctly. But `cn()` (`libs/shared/ui/src/lib/utils.ts`) merges classes via `tailwind-merge`, and `tailwind-merge`'s conflict table treats Tailwind's `overflow` (shorthand, e.g. `overflow-hidden`) and `overflow-y` (e.g. `overflow-y-auto`) as **the same conflict group**. So any consumer that passes `overflow-hidden` in its own `className` — typically to clip a rounded header banner's corners — silently **deletes** the base component's `overflow-y-auto` while `max-h-[90dvh]` survives untouched. The dialog is still height-capped, but can no longer scroll: content past the cap is invisible and unreachable. This exactly matches the reported symptom.

Confirmed hit:
```tsx
// apps/customer-portal/src/features/payments/components/payment-dialog.tsx:174
<DialogContent className="rounded-[2.5rem] max-w-lg p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
```

**This is not an isolated mistake** — it's a shared-component footgun. A second, independent instance of the identical pattern exists in a completely different app sharing the same `Dialog`:
```tsx
// apps/vendor-dashboard/src/features/customers/components/dialogs/edit-location-dialog.tsx:88
<DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50 p-0 overflow-hidden">
```
Two different authors, two different apps, same shared primitive, same footgun — strong evidence the fix belongs in the component, not the call sites.

**The correct pattern already exists in-repo**, documented with a comment, in `apps/vendor-dashboard/src/features/daily-sheets/components/dialogs/reconcile-dialog.tsx:56-74`:
```tsx
{/*
 * flex flex-col + overflow-hidden: sticky header/footer with scrollable body.
 * p-0: removes base p-6 so each zone controls its own padding.
 * max-h-[90dvh]: caps at 90% dynamic viewport height (handles mobile chrome).
 */}
<DialogContent className="rounded-3xl max-w-lg flex flex-col overflow-hidden p-0 max-h-[90dvh]">
  <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border/40">...</DialogHeader>
  <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
    {/* scrollable body */}
  </div>
</DialogContent>
```
Here `overflow-hidden` on `DialogContent` is *intentional* (clips at the flex boundary), while the actual scroll affordance lives on a separate inner wrapper. The bug in `payment-dialog.tsx`/`edit-location-dialog.tsx` is using `overflow-hidden` **without** that inner wrapper.

**Fix direction (implemented in this pass)**: move scroll responsibility into `DialogContent` structurally so a consumer's `className` can never disable it again — `DialogContent` renders its own always-present inner `flex-1 min-h-0 overflow-y-auto` wrapper around `children`, with the outer node keeping `flex flex-col max-h-[90dvh] overflow-hidden` unconditionally. `DialogHeader`/`DialogFooter` get `shrink-0` by default. No new public API; existing consumers (including `payment-dialog.tsx` and `edit-location-dialog.tsx`) need zero changes to start working correctly. `Sheet` (`sheet.tsx`) has the identical missing-safety-net problem (no `max-h`/scroll guard at all on any `side` variant) and gets the same treatment, since it's the same Radix-dialog-derived primitive and customer-portal's mobile "More" sheet uses it.

---

## 2. Theme Audit (light/dark)

**Source of truth**: `apps/customer-portal/src/app/global.css:5-58` defines the `:root` (light) and `.dark` CSS variables consumed by `tailwind.config.base.js`'s token mapping (`background/foreground/primary/card/muted/border/...`).

**Verdict: light and dark are a genuinely hand-tuned pair, not a naive inversion.** Evidence:
- Light `--background: 230 50% 98%` (cool near-white) vs. dark `--background: 0 0% 1.17%` (`#030303`, achromatic near-black) — different hues entirely, not a mechanical lightness flip.
- Dark mode carries explicit human-tuning comments: `/* Softened border from 0.08 */`, `/* Softer text */`, `/* Softened input background */` (global.css:47,55,56).
- Dark mode gets its own mesh-gradient (`global.css:78-93`) and noise-texture (`global.css:95-107`) background layers with no light-mode equivalent — a deliberate, theme-specific embellishment, not symmetry-for-symmetry's-sake.
- `--primary` is intentionally identical in both themes (`239 84% 67%` / `#6366f1`) — a brand-consistency choice.

**But three `!important` overrides in the same file fight the component layer instead of being reconciled with it** (component says one thing, this file silently wins with a different value):

| Override | Location | Component's own value | Effect |
|---|---|---|---|
| Button radius | `global.css:136-138` — `.inline-flex.items-center.justify-center.whitespace-nowrap.rounded-2xl { border-radius: 0.5rem !important; }` | `button.tsx:7` declares `rounded-2xl` (16px) | Any default-radius button silently renders at 8px instead of the 16px the component source says, purely because this class-string-matching selector happens to match the button's exact base classes. Extremely fragile — breaks invisibly if `buttonVariants()`'s base string ever changes. |
| Input font-weight | `global.css:153` — `.dark input:not(...), .dark textarea, .dark select { ... font-weight: 500 !important; }` | `input.tsx:13` declares `font-semibold` (600) | Dark-mode form fields render one weight lighter than what the component declares and what light mode actually shows. |
| Table header color | `global.css:171-176` — `.dark th { color: rgb(255 255 255/0.4) !important; font-weight:700 !important; ...}` | `table.tsx:43` (`TableHead`) declares `dark:text-white/60` | The component's own dark-mode header opacity (60%) is dead code — this global rule always wins, actually rendering headers at 40% opacity. |

These aren't "wrong" per se (the rendered result — 8px buttons, 500-weight inputs, 40%-opacity headers — may well be the *intended* look), but the intent is currently expressed as an app-wide CSS ambush rather than in the component, so the component source lies about its own dark-mode behavior. **Fixed in this pass** by deleting the three overrides and making the components state their real, intended values directly (see Implementation doc).

**Also found**: `libs/shared/ui/src/lib/components/ui/sonner.tsx:10` hardcodes `theme="light"` on the `Toaster`. This is a genuine, concrete light/dark bug (not just an inconsistency) — toast notifications will show light-theme chrome (default icons, contrast assumptions) even when the app is in dark mode, regardless of the theme-aware `classNames` overrides already present in the same file. **Fixed in this pass.**

**Hover/active/focus/disabled states**: mostly expressed as opacity modifiers on the *same* token in both themes (`hover:bg-primary/90`, `disabled:opacity-50`, `focus-visible:ring-primary/30`) — meaning there's rarely a "wrong for dark mode" bug here, but also rarely an intentionally *different* treatment per theme (the one clear exception is `table.tsx:36`'s row hover, `hover:bg-muted dark:hover:bg-primary/5`, which genuinely differs per theme — a good pattern that isn't applied elsewhere).

---

## 3. Typography Audit

**Font family**: single family throughout (Tailwind's default sans stack via Next.js font loading) — no inconsistency found, no unnecessary additional families in use. Not changed.

**Heading hierarchy — portal pages vs. auth pages disagree:**
- All 9 `(portal)/*` pages use an identical, good pattern: `h-12 w-12 rounded-2xl bg-primary/10` icon box + `h1.text-2xl.font-black.tracking-tight` + subtitle.
- **Bug**: 3 of those 9 pages carry a copy-paste artifact in the subtitle — both `text-sm` and `text-[10px]` in the same static class string (`home/page.tsx:14`, `profile/page.tsx:17`, `transactions/page.tsx:32`), vs. the other 6 pages which correctly have only `text-[10px]`. Since neither class wins deterministically via `cn()`/`twMerge` (these are static strings, not merged), the rendered size depends on Tailwind's stylesheet generation order rather than intent.
- Auth pages don't share the portal pattern at all: `login-form.tsx:36` uses `text-3xl font-black` (one size larger) inside a custom oversized colored banner; `activation-flow.tsx:242`/`reset-password/page.tsx:102` use `text-2xl font-black` (matches portal) inside a smaller `Droplets`-in-box motif; `forgot-password-form.tsx:33` uses a bare `CardTitle` at `text-2xl font-bold` (not `font-black`) with no icon at all, inside an otherwise-unstyled `Card` — visually looks like it belongs to a different, unstyled app.

**Font-weight usage** is heavily skewed toward `font-black`/`font-bold` (235 occurrences across 28 files) but applied unevenly for equivalent roles — e.g. dialog titles are `font-black` in `payment-dialog.tsx`, `change-password-form.tsx`, `place-order-dialog.tsx`, `create-ticket-dialog.tsx`, `ticket-detail-dialog.tsx`, even though the base `DialogTitle` primitive ships `font-semibold` — while `forgot-password-form.tsx`'s heading never reaches `font-black` at all.

**Labels**: three different treatments in active use for the identical "form field label" role:
1. `text-xs font-black uppercase tracking-widest` — `login-form.tsx`, `change-password-form.tsx`, `payment-dialog.tsx` (majority pattern, used across the most-trafficked dialogs).
2. `text-xs font-bold uppercase tracking-wider` (note: `wider` not `widest`, `bold` not `black`) — `place-order-dialog.tsx`, `create-ticket-dialog.tsx`.
3. Plain `text-sm font-semibold`, no uppercase treatment — `reset-password/page.tsx`, `activation-flow.tsx`, `forgot-password-form.tsx`.

**Form validation error text**: four different sizes/weights for the same role — `text-[10px] font-bold` (login/activation), `text-sm` (forgot-password), `text-xs` (change-password), `text-[11px]` (create-ticket-dialog).

**Table typography**: `table.tsx`'s own `dark:text-white/60` header color is dead code (see §2 — overridden by `global.css`'s `!important` rule). Header/footer chrome uses two different opacity pairs (`bg-muted/80 dark:bg-card/40` for header vs `bg-muted/90 dark:bg-card/80` for footer, `table.tsx:15,29`) without a stated rationale.

**Modal typography**: covered under Dialogs (§9) and Labels above — dialog titles are inconsistently weighted between "premium" dialogs (`font-black`) and default-styled ones (`font-semibold` from the primitive, untouched).

---

## 4. Spacing Audit

- **Page-root vertical rhythm**: `space-y-8` (`home`, `profile`) vs `space-y-6` (`deliveries`, `orders`, `payments`, `schedule`, `statement`, `support`, `transactions`) — defensible per-page (home/profile have visually heavier sections) but not documented as a rule anywhere; reads as an ad hoc choice per page author.
- **Card content padding** varies with no consistent tiering: `p-3` (deliveries stat cards), `p-4` (most list-row cards across deliveries/orders/payments/schedule/support), `p-4 sm:p-6` (transactions filter bar), `p-6` (statement card, default `CardContent`), `p-8` (wallet balance hero, login banner, payment-dialog header, change-password header), `pt-8`/`p-10` (login form body). No documented tiering like "list-row = p-4, section = p-6, hero = p-8" — it's close to that in practice but not consistently applied (e.g. the statement page's solo content card is `p-6` while a similarly solo-purpose "Recurring Pattern" card on schedule wraps `CardHeader`+`CardContent` in a way no other single-purpose card does).
- **Grid/list gaps**: `gap-3` (deliveries stat grid, most list `space-y-3`), `gap-4` (wallet grids, transactions filter row), `gap-2` (filter/tab rows), `gap-6` (profile grid) — each individually reasonable, no unifying scale applied.
- **Dialog padding models diverge**: `place-order-dialog.tsx`/`create-ticket-dialog.tsx` rely on the default `DialogContent` padding (`p-6` from `dialog.tsx:37`), while `payment-dialog.tsx`/`change-password-form.tsx` strip it (`p-0`) and hand-build `p-8` header/body sections — two different padding models for the same modal family.
- Note: an 8px-multiple scale (Tailwind's default spacing scale) is already what's being used everywhere (`p-3`=12px, `p-4`=16px, `p-6`=24px, `p-8`=32px, all multiples of 4/8) — the issue is *tier assignment*, not the underlying unit. Not a raw-pixel-drift problem.

---

## 5. Component Audit

### Buttons
`button.tsx` variants: `default`/`primary` are byte-for-byte duplicate strings (dead duplication). Radius varies by size/variant: `rounded-2xl` (default), `rounded-xl` (ghost, sm), `rounded-3xl` (lg), `rounded-full` (icon) — four radii on one component, compounded by the global `!important` clawback (§2) forcing the default down to `0.5rem` regardless. Only `outline` gets `backdrop-blur-sm` — no stated rule for which variant is "glassy."

### Inputs / Textarea
Both hardcode a literal hex dark background (`dark:bg-[#080a0f]`) instead of a token — bypasses the theme system for this one value. Six raw `<select>`/`<textarea>` elements across the app (`place-order-dialog.tsx`, `create-ticket-dialog.tsx`, `payment-dialog.tsx`, `ticket-detail-dialog.tsx`, `deliveries/page.tsx`) hand-roll the same `rounded-xl border ... focus:ring-2` styling instead of importing the shared `Select`/`Textarea` primitives that already exist — any future focus-ring/border tweak to the real primitives won't reach these six.

### Badges
The shared `Badge` primitive (`badge.tsx`) already defines `success`/`warning`/`info` semantic variants with a fixed shape (`rounded-full`, `px-2.5 py-0.5`, `text-[10px]`, `uppercase tracking-wider`). **Only `transaction-list.tsx` uses them.** Every other status display hand-rolls a local color map instead, and they disagree with each other for the same real-world state:
- "Success" (paid/delivered/resolved): `bg-emerald-500/10 text-emerald-500` (deliveries, payments, schedule) vs `bg-emerald-500/10 text-emerald-600` (orders, tickets) — `-500` vs `-600`.
- "Pending/warning": `bg-amber-500/10 text-amber-600` (orders, tickets) vs `bg-yellow-500/10 text-yellow-600` (payments, deliveries) — `amber` and `yellow` are different Tailwind color families entirely, so these render visibly different hues for the same concept depending on the page.
- `support/page.tsx:13-24` and `ticket-detail-dialog.tsx:26-38` duplicate the exact same `STATUS_COLOR`/`PRIORITY_COLOR` map verbatim — a real maintenance risk (already proven to drift, per the amber/yellow split above).
- Hand-rolled badges also use different padding (`px-2 py-0` vs the primitive's `px-2.5 py-0.5`) and don't declare `uppercase` (relying on already-capitalized source strings) — so a primitive-rendered badge (transaction-list) looks visibly different (uppercase, wider tracking, slightly taller) from every hand-rolled one sitting right next to it conceptually.

### Cards
Base `Card` primitive is `rounded-3xl`. In practice, at least **five different radii** are used across customer-portal for the same "container card" role: `rounded-2xl` (majority — most list-item cards), `rounded-3xl` (dialogs, un-overridden default), arbitrary `rounded-[2rem]` (profile-card's 4 cards, schedule pattern card, change-password header), arbitrary `rounded-[2.5rem]` (login banner, payment-dialog shell). A `rounded-4xl` (2rem) token already exists in `tailwind.config.base.js:53` and is used by none of the `rounded-[2rem]` call sites — they all reach for the arbitrary bracket syntax instead of the named token that already means the same thing.

Background opacity for "the card background" also varies with no evident semantic distinction: `bg-card/30`, `/40`, `/50`, `/60`, `/90`, and plain `bg-card` all appear across otherwise-similar cards.

### Dialogs
Covered in depth in §1 and §9. Additional finding: two different "dialog title" idioms coexist — a colored `bg-primary/5` banner strip with an icon chip (`payment-dialog.tsx`, `change-password-form.tsx`) vs. a plain default `DialogHeader` with an inline icon next to the title text (`place-order-dialog.tsx`, `create-ticket-dialog.tsx`, `ticket-detail-dialog.tsx`) — same modal family, two visual idioms.

### Tables
Only one real table in customer-portal (`transaction-list.tsx`'s desktop view). Its wrapper uses `overflow-hidden` (`transaction-list.tsx:93`) instead of `overflow-x-auto` — long transaction descriptions (no `truncate`/`max-w` on the cell) get silently clipped rather than scrollable or truncated with an ellipsis. This is the one place in the app that actually needed the "tables overflowing" responsive check called out in the brief, and it currently fails it.

### Empty / Loading states
`components/shared/list-states.tsx` (`ListLoadingState`/`ListEmptyState`/`ListErrorState`) is a clean, reusable, well-designed shared pattern. Adoption is inconsistent:
- **Uses it correctly**: `orders/page.tsx`, `payments/page.tsx`, `support/page.tsx`, `transaction-list.tsx`.
- **Hand-rolls a near-but-not-quite duplicate**: `deliveries/page.tsx` (own skeleton at `bg-accent/30` vs. the shared component's `bg-accent/10`; own empty state; **no error state at all** — a real fetch failure silently renders as "no deliveries found"), `schedule/page.tsx` (same issue, plus `h-16` skeletons instead of `h-20`, no error state), `recent-transactions.tsx` (per-row `Skeleton` idiom, different empty-state icon treatment), `notification-center.tsx` (yet another bespoke trio, `bg-accent/40`, `h-16`).

Net: 5 different loading-skeleton opacity/height combinations exist for what is conceptually one "list is loading" state, and 2 real surfaces (deliveries, schedule) mask genuine fetch errors as empty results.

### Forms
Covered under Typography (§3, labels/errors) and Inputs above. Additional finding: `change-password-form.tsx` is the only form with a password-visibility (`Eye`/`EyeOff`) toggle — `login-form.tsx`, `reset-password/page.tsx`, `activation-flow.tsx` all lack it despite being the identical "type a password" task.

### Alerts / Toasts
No shared `Alert`/`AlertDialog` primitive exists in the library at all — every "are you sure?" confirmation across the codebase is hand-rolled on top of the base `Dialog` per call site (e.g. `orders/page.tsx:246-271`'s inline cancel-order confirmation). This is a real gap but adding a new shared primitive is explicitly out of scope for this pass (see Implementation doc's "not attempted" section) since the brief asks to refine existing components, not introduce new ones. Toast notifications (Sonner) — covered in §2 (hardcoded light theme, fixed in this pass).

### Navigation
`components/layout/header.tsx` renders 9 flat desktop nav items in one non-wrapping, non-scrolling flex row that first appears at the `sm:` breakpoint (≥640px) — 9 items plus the logo and the account/notification/theme-toggle cluster will not fit in that width, causing overflow right at the breakpoint where the nav switches on, well before `md`/`lg`. The account dropdown (`w-64`) and notification popover (`w-[22rem]`, 352px) are both fixed-pixel-width Radix popovers anchored `align="end"` with no viewport-relative cap — the notification popover alone is wider than a 320px viewport, guaranteeing it gets clipped or forces horizontal scroll when opened on the smallest supported width. `components/layout/mobile-nav.tsx` (the bottom bar + "More" sheet), by contrast, has no hardcoded widths and scales cleanly to 320px.

---

## 6. Icon Sizing Audit

Reasonably systematic in the dominant contexts, with named exceptions:
- Page-header icon-in-box: always `h-6 w-6` inside `h-12 w-12` (9/9 portal pages — consistent).
- List-row status icon (in `h-10 w-10 rounded-xl` box): always `h-5 w-5` (orders, payments, schedule, support — consistent).
- Button/action icons: `h-4 w-4` dominant default (consistent).
- Empty/error state icons: `h-12 w-12` (consistent between the shared `list-states.tsx` and the hand-rolled equivalents).
- **Outliers**: the auth flow's brand `Droplets` icon uses three different container/icon size pairs across four pages — `h-12 w-12`/`h-7 w-7` (login), `h-14 w-14`/`h-7 w-7` (activate, reset-with-code, reset-password) — no single "brand mark" size is used twice with the same ratio.

---

## 7. Responsive Audit (320 / 375 / 390 / 768 / 1024 / 1280 / 1536)

Concrete, fixable issues found (all addressed in the implementation pass except where noted as deferred):
1. **`transaction-list.tsx`** desktop table: `overflow-hidden` instead of `overflow-x-auto`; unconstrained description cell. *(Fixed.)*
2. **`notification-preferences-panel.tsx`**: hardcoded `text-white`/`bg-white/5` instead of theme tokens — plausible light-mode legibility bug (white text on a light card), not just an inconsistency; also a hardcoded `grid-cols-[1fr_repeat(2,60px)]` pixel grid. *(Fixed.)*
3. **`header.tsx`**: 9-item nav overflow risk at the `sm:` breakpoint; fixed-width popovers (`w-64` account menu, `w-[22rem]` notifications) exceeding a 320px viewport. *(Fixed — nav + notification popover; account menu width is modest enough at `w-64`/256px to fit even 320px viewports with margin, left as-is.)*
4. **`reset-password/page.tsx`, `activation-flow.tsx`**: duplicate the outer centering wrapper `auth/layout.tsx` already provides — redundant, not currently broken, but fragile (nested flex-center wrappers). *(Fixed as part of the auth header reconciliation pass.)*
5. **`deliveries/page.tsx`, `orders/page.tsx`**: non-responsive fixed grids (`grid-cols-3`, `grid-cols-4`) for stat/step strips with short text content — currently usable even at 320px given short labels, lower priority than the above; left as-is (not broken, just structurally inconsistent with the app's otherwise-responsive grids elsewhere — noted as a minor "would be nice" rather than fixed in this pass, to keep the fix list scoped to genuine breakage).

No `overflow-y` scroll-locking issues were found outside the dialog bug already covered in §1. Mobile bottom-nav (`mobile-nav.tsx`) audited clean at all breakpoints down to 320px.

---

## 8. Accessibility Notes

- Focus states are consistently expressed via `focus-visible:ring-2 focus-visible:ring-ring`/`ring-primary` tokens across `Button`/`Input`/`Select`/`Textarea` — token-driven, so they remain visible in both themes; no changes needed here.
- Disabled states are a consistent `disabled:opacity-50 disabled:pointer-events-none` pattern — acceptable contrast-wise in both themes (verified against the token pairs in §2), no changes needed.
- The `notification-preferences-panel.tsx` hardcoded white text (§7, item 2) is as much an accessibility/contrast defect as a consistency one in light mode — fixed as part of this pass.
- No `aria-label`s were found missing on any icon-only button touched by this pass; existing icon-only buttons (dialog close, dropdown triggers) already carry Radix's built-in `sr-only` labels or explicit `aria-label`s. No broad ARIA audit was performed beyond the files actually touched by the fix list below (out of scope to re-audit every file in the app for ARIA coverage in this pass).

---

## 9. Dialog-Specific Audit (all modal/dialog usages)

| Dialog | DialogContent classes | Risk before this pass |
|---|---|---|
| `payment-dialog.tsx` | `rounded-[2.5rem] max-w-lg p-0 overflow-hidden ...` | **Confirmed bug** — scroll disabled, tallest/most conditional content |
| `edit-location-dialog.tsx` (vendor-dashboard) | `rounded-3xl max-w-sm ... p-0 overflow-hidden` | **Confirmed bug**, same root cause, conditional embedded map iframe |
| `create-ticket-dialog.tsx` | `sm:max-w-md rounded-3xl` (no override) | Low — base scroll intact |
| `place-order-dialog.tsx` | `sm:max-w-md rounded-3xl` (no override) | Low — base scroll intact |
| `ticket-detail-dialog.tsx` | `sm:max-w-2xl rounded-3xl` (no override) | Low/Medium — base scroll intact, has its own nested `max-h-[22rem] overflow-y-auto` conversation list, still reachable |
| All warehouse/daily-sheet confirm-style dialogs (vendor-dashboard) | no conflicting overflow classes | Low — inherit base scroll safely already |

After the structural fix (§1), every row in this table gets the scroll-safety guarantee unconditionally, whether or not the consumer's `className` includes `overflow-hidden`.

**Keyboard/focus trapping**: Radix's `Dialog` primitive already provides focus trapping and `Escape`-to-close out of the box (nothing in this codebase overrides or disables that behavior) — verified by inspecting `dialog.tsx` for any `onOpenAutoFocus`/`onEscapeKeyDown` overrides (none found).

---

## Summary: what's fixed in this pass vs. recommended for later

See `CUSTOMER_PORTAL_UI_IMPLEMENTATION.md` for the authoritative "what changed" list. In short: the dialog/sheet scroll-safety fix, the Sonner theme bug, the notification-preferences contrast/grid bug, the transactions table overflow, the page-header subtitle typo, the three `global.css` `!important` clawbacks, badge adoption, card-radius standardization, label/error typography, auth-page header reconciliation, empty/loading/error state consolidation, password-visibility toggles, and the header nav responsive fix are all addressed. Reconciling `Select`/`DropdownMenu`/`Tabs` into one visual language, adding new shared `AlertDialog`/`Tooltip` primitives, and any admin-panel token unification are **not** attempted here — each would ripple well beyond customer-portal or add new components where the brief asks to refine existing ones instead.
