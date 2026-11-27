/** Pure pixel work for a 1-bit thermal head. Operates on RGBA buffers (canvas ImageData.data). */

export interface Bitmap {
  width: number;
  height: number;
  /** Rows of ceil(width / 8) bytes, most significant bit leftmost, 1 = burn a dot. */
  data: Uint8Array;
}

/** Perceived brightness 0–255; transparency counts as white paper. */
function luminance(rgba: Uint8ClampedArray, i: number): number {
  const alpha = rgba[i + 3] / 255;
  const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return l * alpha + 255 * (1 - alpha);
}

/** Darker than this prints. Above mid-grey so thin anti-aliased text strokes survive. */
export const TEXT_THRESHOLD = 160;

/** Turns the buffer pure black / white in place (what the preview shows is what prints). */
export function thresholdInPlace(rgba: Uint8ClampedArray, threshold = TEXT_THRESHOLD): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const v = luminance(rgba, i) < threshold ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
}

/**
 * Floyd–Steinberg for logos, so mid and light colours stay visible as a dot pattern instead of
 * vanishing. Levels are stretched first: dark colours print solid, near-white stays clean paper.
 */
export function ditherInPlace(rgba: Uint8ClampedArray, width: number): void {
  const height = rgba.length / 4 / width;
  const grey = new Float32Array(width * height);
  for (let p = 0; p < grey.length; p++) {
    grey[p] = Math.min(255, Math.max(0, ((luminance(rgba, p * 4) - 64) / (224 - 64)) * 255));
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const v = grey[p] < 128 ? 0 : 255;
      const error = grey[p] - v;
      if (x + 1 < width) grey[p + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) grey[p + width - 1] += (error * 3) / 16;
        grey[p + width] += (error * 5) / 16;
        if (x + 1 < width) grey[p + width + 1] += error / 16;
      }
      const i = p * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
}

/** Bounding box of everything that is not blank paper; null when the image is blank. */
export function contentBounds(
  rgba: Uint8ClampedArray,
  width: number,
): { x: number; y: number; width: number; height: number } | null {
  const height = rgba.length / 4 / width;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luminance(rgba, (y * width + x) * 4) >= 245) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function packBitmap(rgba: Uint8ClampedArray, width: number): Bitmap {
  const height = rgba.length / 4 / width;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (luminance(rgba, (y * width + x) * 4) < TEXT_THRESHOLD) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width, height, data };
}
