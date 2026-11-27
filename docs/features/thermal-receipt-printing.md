# Thermal receipt printing

Status: **code complete; not yet verified on a physical printer or in a real browser** (see "Verification").

## Goal

A driver (or counter staff) records a delivery and can hand the customer a printed 58mm / 80mm
receipt on the spot. Multi-vendor: identity, logo and payment accounts come from each vendor's
company profile. The WhatsApp receipt flow is unchanged.

## Bugs fixed alongside

- `GET /daily-sheets/items/:id/receipt` rendered the PDF without the vendor's branding, so every
  vendor's download carried the legacy default identity. The controller now resolves the branding and
  the service requires it.
- Re-rendered receipts (download / resend) of walk-in deliveries printed the placeholder van's
  internal plate (`WALK-IN-<vendorId>`). They now print `Self Pickup`.

## Design

```
record delivery ──> (device setting on) print dialog opens
row "Print" button ─┘
        │
        ├─ GET /daily-sheets/items/:id/receipt-data     frozen figures (same builder as the PDF)
        ├─ GET /daily-sheets/receipt-print/branding     vendor identity, logo inline as data URL
        │
   layout (pure) ──> canvas, 384px (58mm) / 576px (80mm), black & white
        │
        ├─ RawBT (Android)   ESC/POS raster (GS v 0) via intent: URL
        ├─ System print      the image, through the browser's print dialog
        └─ Share image       PNG via the share sheet (download where unsupported)
```

Decisions:

- **The receipt is printed as an image.** No printer code pages, so logo and non-Latin names do not
  depend on the printer's fonts.
- **Printer settings are per device** (localStorage): method, paper width, "open after delivery".
  Different drivers carry different printers.
- **"Open after delivery" is off by default**, so nothing changes for vendors without printers.
- **Printing never affects recording.** The dialog opens only after the save succeeded.
- **A tap is always needed to print.** Browsers only allow share / app hand-off from a user gesture.
- Only `COMPLETED` deliveries have a receipt (same rule as the PDF).
- Both endpoints need `daily_sheets:view` and are vendor-scoped.

## Out of scope

Direct Bluetooth from the browser (Web Serial / Web Bluetooth), label printers (TSPL/ZPL), paper
cutter commands, offline printing, closed-sheet corrections opening the dialog automatically.

## Files

| Area | Path |
|---|---|
| Shared types | `libs/shared/types/src/lib/receipt-print.ts` |
| API | `daily-sheet.controller.ts`, `daily-sheet.service.ts`, `vendor-branding.service.ts`, `delivery-receipt-pdf.service.ts` |
| Web | `apps/vendor-dashboard/src/features/receipt-printing/` |

## Vendor identity: deployment note

A vendor **without** a saved company profile gets the legacy default identity unless
`WHATSAPP_GUARD_MODE=enforce` (see `multi-vendor-branding-and-whatsapp.md`). The print dialog warns
in that case. Complete every vendor's company profile before rollout.

## Verification

Done (2026-11-27):

| Check | Result |
|---|---|
| Dashboard Jest suite | 284 / 284 pass |
| Dashboard type check and `next build` (PWA disabled) | pass |
| Backend receipt + branding specs | pass, including HTTP routing of both new endpoints |
| Backend full suite | 40 suites / 94 tests fail identically on the untouched previous commit (missing `otplib`, `qrcode` in `node_modules`, a stale salary-slip golden, and others) |
| Renderer on a Node canvas, 58mm and 80mm | output inspected; ESC/POS job decodes to exactly the previewed pixels |

**Not done — needed before calling the feature release-ready:**

1. Physical print from an Android phone through RawBT (the intent URL format follows escpos-php's
   `RawbtPrintConnector`; RawBT's own docs could not be fetched, and its free-version limits are unchecked).
2. System print and image share on real devices.
3. A click-through in a real browser: dialog layout on a phone, opening after route / ad-hoc /
   walk-in deliveries.
4. Running the API against a database with these endpoints.
