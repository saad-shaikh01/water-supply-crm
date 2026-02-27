# Vendor Dashboard UI/UX Task Board

Last Updated: February 27, 2026
App: `apps/vendor-dashboard`
Primary Owner: Agent A
Scope: UI/UX and responsiveness only

## Guardrails

1. Do not change backend APIs, DTO contracts, permissions logic, or query semantics.
2. Do not change hook business rules unless explicitly approved.
3. Keep visual changes within vendor dashboard only.

## Status Legend

- `READY`: can start now
- `IN_PROGRESS`: currently being implemented
- `DONE`: merged to integration branch
- `BLOCKED`: waiting dependency/decision

## Task Queue

| ID | Area | Type | Task | Priority | Owner | Status | Acceptance |
|---|---|---|---|---|---|---|---|
| VD-UX-001 | Dashboard shell (`/dashboard/layout`) | Visual System | Standardize page container widths, section spacing, heading hierarchy, and sticky toolbar behavior. | High | Agent A | READY | All dashboard pages share consistent top rhythm and spacing scale. |
| VD-UX-002 | Global filter patterns | UX Pattern | Unify list-page filter UX: inline essentials + `More Filters` drawer + active chips + clear-all. | High | Agent A | READY | Customers/Sheets/Products/Vans/Routes/Orders/Tickets feel consistent. |
| VD-UX-003 | Tables (all list pages) | Responsive UX | Add mobile-friendly table fallback (card/list mode) where horizontal table is unusable. | High | Agent A | READY | No critical table content overflows on 360px width. |
| VD-UX-004 | Status badges | Visual Consistency | Normalize status color mapping and badge sizes across modules. | Medium | Agent A | READY | Same status uses same tone and label style everywhere. |
| VD-UX-005 | Loading/empty/error states | UX Consistency | Replace mixed placeholders with shared skeletons, empty cards, and recoverable error actions. | High | Agent A | READY | Every major page has coherent loading, empty, and retry behavior. |
| VD-UX-006 | Customers list/detail | Data UX | Improve readability of delivery schedule, payment type, and balances; tighten filter and table hierarchy. | High | Agent A | READY | Customer screen is scannable without dense visual noise. |
| VD-UX-007 | Daily sheets list/detail | Workflow UX | Improve action grouping for sheet operations, item statuses, issue markers, and summary cards. | High | Agent A | READY | Driver/staff/admin actions are obvious and do not compete visually. |
| VD-UX-008 | Products/Vans/Routes forms | Form UX | Standardize labels, helper text, validation messages, and action button placement. | Medium | Agent A | READY | Form interactions are predictable across all CRUD screens. |
| VD-UX-009 | Orders + Tickets | Triage UX | Improve ticket/order triage layouts: key metadata prominence, urgency cues, and quick actions. | High | Agent A | READY | Critical queues can be scanned within 5 seconds. |
| VD-UX-010 | Overview + Analytics | Information UX | Refine KPI card hierarchy, chart spacing, and breakdown readability. | Medium | Agent A | READY | KPIs and charts are readable on both desktop and tablet widths. |
| VD-UX-011 | Tracking page | Map UX | Improve map panel balance, info cards, and small-screen behavior (drawer/sheet strategy). | Medium | Agent A | READY | Tracking remains usable on laptop and mobile viewports. |
| VD-UX-012 | Accessibility baseline | A11y | Fix obvious keyboard/focus/contrast issues in vendor dashboard interactive controls. | Medium | Agent A | READY | No hidden focus states, no low-contrast critical text. |
| VD-UX-013 | Dashboard visual system | Design System | Apply the approved Premium Dark design system across vendor dashboard using static glassmorphism, strict dark tokens, and responsive Shadcn/Tailwind styling. | High | Agent A | DONE | Implemented strict dark tokens, glassmorphism surfaces, mesh background, noise overlay, and removed non-compliant motion. |
| VD-UX-014 | Final responsive pass | QA UX | Run viewport sweep (`360`, `390`, `768`, `1024`, `1440`) and patch remaining clipping/overflow. | High | Agent A | READY | No clipped controls or overlapping text in primary screens. |

## Premium Dark Spec (VD-UX-013)

Use this as the implementation brief for `VD-UX-013`.

### Core Theme

- Dark mode first with a premium glassmorphism aesthetic.
- Use Shadcn UI + Tailwind CSS v4 patterns only.
- Keep components static and responsive; do not add motion beyond simple color-state changes.

### Color Tokens

| Variable | Value | Usage |
|---|---|---|
| `background` | `#030303` | App background |
| `foreground` | `#ffffff` | Primary text |
| `primary` | `#6366f1` | Primary actions and highlights |
| `primary-foreground` | `#ffffff` | Text on primary buttons |
| `card` | `rgba(10, 10, 15, 0.7)` | Translucent card surface |
| `secondary` | `rgba(30, 30, 45, 0.6)` | Secondary surfaces |
| `muted-foreground` | `#94a3b8` | Secondary text |
| `border` | `rgba(255, 255, 255, 0.08)` | Subtle borders |
| `input` | `rgba(255, 255, 255, 0.05)` | Input backgrounds |
| `accent` | `rgba(99, 102, 241, 0.15)` | Low-opacity primary accent |
| `destructive` | `#ef4444` | Error and danger |

### Typography

- Font family: `Inter`, sans-serif.
- Keep text antialiased.
- Selection state: `bg-primary` with `text-white`.

### Glass Effects

- Basic glass: `rgba(255, 255, 255, 0.03)` background, `blur(12px) saturate(180%)`, `1px solid rgba(255, 255, 255, 0.08)`.
- Glass card: `linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)`, `blur(20px) saturate(180%)`, shadow `0 8px 32px 0 rgba(0, 0, 0, 0.37)`, inner glow `inset 0 0 0 1px rgba(255, 255, 255, 0.1)`.

### Global Background

- Add a fixed mesh-gradient layer using blurred radial indigo and violet glows.
- Add a subtle full-screen noise overlay at `0.015` opacity.

### Component Rules

- Buttons: `rounded-lg` or `rounded-xl`; primary uses `bg-primary`; outline uses `border-white/10`, `bg-white/5`, `backdrop-blur-md`; allow indigo glow shadow.
- Cards: `rounded-2xl`, `p-6`, `border-white/10`, `bg-white/[0.03]`, `backdrop-blur-2xl`; titles use `text-2xl font-semibold`.
- Tables: `rounded-2xl`, `bg-white/[0.03]`, `border-white/10`, `overflow-hidden`; headers use `bg-white/[0.02]`; cells use `px-6 py-4`; rows use `hover:bg-white/[0.04]`.
- Inputs: `bg-white/[0.03]`, `border-white/10`, focus `border-primary` with `ring-primary/10`, backdrop blur.
- Status badges: use bold uppercase micro-label styling with semantic success, warning, primary, and destructive color variants.

### Spacing and Radius

- Radius scale: `sm=0.5rem`, `md=0.75rem`, `lg=1rem`, `xl=1.5rem`.
- Prefer `p-6` inside cards and `px-6 py-4` for table rows.

### Hard Constraint

- Do not use `transition-all`, translate/scale hover motion, custom keyframe animations, infinite animated backgrounds, or `framer-motion`.

## Execution Rule (Agent A)

1. One task per commit.
2. Commit message format: `feat(VD-UX-XXX): <summary>` or `fix(VD-UX-XXX): <summary>`.
3. Push after each commit.
4. Update this board status after each completed task.
