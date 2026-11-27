import type { Bitmap } from './monochrome';

/** Rows per raster command: small enough for the buffers of cheap printers. */
export const BAND_ROWS = 128;

/** Blank lines after the receipt so the last line clears the tear bar. */
const FEED_LINES = 4;

/** ESC/POS job printing the bitmap with `GS v 0` raster bands. */
export function encodeEscPos(bitmap: Bitmap): Uint8Array {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const bands = Math.ceil(bitmap.height / BAND_ROWS);
  const out = new Uint8Array(2 + bands * 8 + bitmap.data.length + 3);
  let at = 0;
  const push = (...bytes: number[]) => {
    out.set(bytes, at);
    at += bytes.length;
  };

  push(0x1b, 0x40); // ESC @ — reset
  for (let top = 0; top < bitmap.height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, bitmap.height - top);
    push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    const band = bitmap.data.subarray(top * bytesPerRow, (top + rows) * bytesPerRow);
    out.set(band, at);
    at += band.length;
  }
  push(0x1b, 0x64, FEED_LINES); // ESC d n — feed
  return out;
}
