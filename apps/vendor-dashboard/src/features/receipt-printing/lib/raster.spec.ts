import { contentBounds, ditherInPlace, packBitmap, thresholdInPlace, type Bitmap } from './monochrome';
import { BAND_ROWS, encodeEscPos } from './escpos';
import { DOT_WIDTH, fitLogo, fontFor, layoutReceipt, wrapText, type Measure } from './receipt-canvas';

/** RGBA buffer filled with one grey level (or fully transparent). */
const image = (width: number, height: number, grey: number, alpha = 255) => {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) out.set([grey, grey, grey, alpha], i);
  return out;
};
const setPixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number, grey: number) =>
  rgba.set([grey, grey, grey, 255], (y * width + x) * 4);
const blackShare = (rgba: Uint8ClampedArray) => {
  let black = 0;
  for (let i = 0; i < rgba.length; i += 4) black += rgba[i] === 0 ? 1 : 0;
  return black / (rgba.length / 4);
};

describe('monochrome', () => {
  it('treats transparency as paper and thresholds the rest to pure black / white', () => {
    const transparent = image(2, 2, 0, 0);
    thresholdInPlace(transparent);
    expect(blackShare(transparent)).toBe(0);

    const grey = image(2, 2, 120);
    thresholdInPlace(grey);
    expect(blackShare(grey)).toBe(1);
  });

  it('dithers: dark prints solid, near-white stays clean, mid tones become a pattern', () => {
    const dark = image(16, 16, 40);
    ditherInPlace(dark, 16);
    expect(blackShare(dark)).toBe(1);

    const light = image(16, 16, 240);
    ditherInPlace(light, 16);
    expect(blackShare(light)).toBe(0);

    const mid = image(16, 16, 144);
    ditherInPlace(mid, 16);
    expect(blackShare(mid)).toBeGreaterThan(0.35);
    expect(blackShare(mid)).toBeLessThan(0.65);
  });

  it('finds the non-blank area, and nothing in a blank image', () => {
    const rgba = image(10, 6, 255);
    expect(contentBounds(rgba, 10)).toBeNull();
    setPixel(rgba, 10, 2, 1, 0);
    setPixel(rgba, 10, 7, 4, 0);
    expect(contentBounds(rgba, 10)).toEqual({ x: 2, y: 1, width: 6, height: 4 });
  });

  it('packs MSB-first rows, padding a partial last byte', () => {
    const rgba = image(10, 2, 255);
    setPixel(rgba, 10, 0, 0, 0);
    setPixel(rgba, 10, 7, 0, 0);
    setPixel(rgba, 10, 9, 1, 0);
    expect(Array.from(packBitmap(rgba, 10).data)).toEqual([0x81, 0x00, 0x00, 0x40]);
  });
});

/** Reads a job back the way a printer would. */
function decode(job: Uint8Array) {
  expect([job[0], job[1]]).toEqual([0x1b, 0x40]);
  let at = 2;
  const rows: number[] = [];
  const bands: number[] = [];
  let bytesPerRow = 0;
  while (job[at] === 0x1d) {
    expect(Array.from(job.subarray(at, at + 4))).toEqual([0x1d, 0x76, 0x30, 0x00]);
    bytesPerRow = job[at + 4] + 256 * job[at + 5];
    const height = job[at + 6] + 256 * job[at + 7];
    at += 8;
    rows.push(...job.subarray(at, at + bytesPerRow * height));
    at += bytesPerRow * height;
    bands.push(height);
  }
  expect(Array.from(job.subarray(at))).toEqual([0x1b, 0x64, 4]);
  return { bytesPerRow, bands, data: rows };
}

describe('encodeEscPos', () => {
  it.each([[384, 48], [576, 72]])('sends a %i-dot receipt losslessly in bands', (width, bytesPerRow) => {
    const height = BAND_ROWS * 2 + 44;
    const data = Uint8Array.from({ length: bytesPerRow * height }, (_, i) => (i * 31) % 256);
    const bitmap: Bitmap = { width, height, data };

    const decoded = decode(encodeEscPos(bitmap));

    expect(decoded.bytesPerRow).toBe(bytesPerRow);
    expect(decoded.bands).toEqual([BAND_ROWS, BAND_ROWS, 44]);
    expect(decoded.data).toEqual(Array.from(data));
  });
});

describe('layout', () => {
  const measure: Measure = (text) => text.length * 10; // 10 dots per character

  it('uses the native dot widths of 58mm and 80mm heads', () => {
    expect(DOT_WIDTH).toEqual({ 58: 384, 80: 576 });
  });

  it('wraps on words and breaks a word longer than the line', () => {
    expect(wrapText('one two three', 'f', 70, measure)).toEqual(['one two', 'three']);
    expect(wrapText('abcdefghij', 'f', 40, measure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('   ', 'f', 40, measure)).toEqual([]);
  });

  it('puts a row on one line when it fits and stacks it when it does not', () => {
    const fits = layoutReceipt([{ kind: 'row', label: 'Code', value: 'B1' }], 384, measure, null).ops;
    expect(fits).toMatchObject([{ text: 'Code', align: 'left' }, { text: 'B1', align: 'right' }]);
    expect((fits[0] as { y: number }).y).toBe((fits[1] as { y: number }).y);

    const long = 'A very long customer name that cannot share the line';
    const stacked = layoutReceipt([{ kind: 'row', label: 'Customer', value: long }], 384, measure, null).ops as {
      text: string; y: number; align: string;
    }[];
    expect(stacked[0].text).toBe('Customer');
    expect(stacked[1].y).toBeGreaterThan(stacked[0].y);
    expect(stacked.slice(1).map((o) => o.text).join(' ')).toBe(long);
    expect(stacked.every((o) => measure(o.text, '') <= 384)).toBe(true);
  });

  it('grows with content, skips a missing logo and centres a present one', () => {
    const blocks = [{ kind: 'logo' } as const, { kind: 'text', text: 'x', size: 'sm' } as const];
    const without = layoutReceipt(blocks, 384, measure, null);
    const withLogo = layoutReceipt(blocks, 384, measure, { width: 100, height: 50 });
    expect(without.ops.some((o) => o.kind === 'logo')).toBe(false);
    expect(withLogo.ops[0]).toMatchObject({ kind: 'logo', x: 142 });
    expect(withLogo.height).toBeGreaterThan(without.height + 49);
  });

  it('fits the logo inside its box without enlarging it more than twice', () => {
    expect(fitLogo({ width: 1000, height: 200 }, 384)).toEqual({ width: 269, height: 54 });
    expect(fitLogo({ width: 100, height: 600 }, 384)).toEqual({ width: 25, height: 150 });
    expect(fitLogo({ width: 20, height: 10 }, 384)).toEqual({ width: 40, height: 20 });
  });

  it('builds a canvas font string', () => {
    expect(fontFor(22, true)).toBe('bold 22px Arial, Helvetica, sans-serif');
  });
});
