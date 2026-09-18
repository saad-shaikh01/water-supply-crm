/**
 * Browser-download helpers for the Cash Ledger exports (CSV / PDF).
 * Pure / DOM-only — no React, no app imports — so they are trivially testable.
 */

/** Saves `blob` as `filename` via a transient object URL + hidden `<a download>`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Strips any path component and characters that are illegal in file names on Windows / macOS. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts the file name from a `Content-Disposition` header. Handles
 * `filename*=UTF-8''…` (RFC 5987, preferred), `filename="quoted"` and
 * `filename=bare`. Falls back to `fallback` when the header is missing,
 * unparsable or yields an empty name.
 */
export function filenameFromContentDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;

  // RFC 5987 extended value wins over the plain one: filename*=UTF-8''cash%20ledger.csv
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    let raw = extended[1].trim();
    const quoted = /^"(.*)"$/.exec(raw);
    if (quoted) raw = quoted[1];
    const parts = /^([^']*)'[^']*'(.*)$/.exec(raw);
    const name = sanitizeFilename(safeDecode(parts ? parts[2] : raw));
    if (name) return name;
  }

  // Anchored on start / `;` / whitespace so `filename*=` and `xfilename=` are never picked up here.
  const plain = /(?:^|[;\s])filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(header);
  if (plain) {
    const raw = plain[2] !== undefined ? plain[2].replace(/\\(.)/g, '$1') : plain[1].trim();
    const name = sanitizeFilename(raw);
    if (name) return name;
  }

  return fallback;
}

function readAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const m = (body as { message?: unknown }).message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length) return m.filter((x) => typeof x === 'string').join(', ') || null;
  return null;
}

/**
 * The server message of a failed download. With `responseType: 'blob'` an error
 * body arrives as a Blob, so it is read as text and JSON-parsed; a non-JSON
 * body falls back to a short text excerpt, then to the axios / generic message.
 */
export async function readBlobError(err: unknown): Promise<string> {
  const fallback = 'Export failed. Please try again.';
  const e = err as { response?: { data?: unknown; status?: number }; message?: string } | null;
  const data = e?.response?.data;

  try {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      const text = (await readAsText(data)).trim();
      if (text) {
        try {
          const msg = messageOf(JSON.parse(text));
          if (msg) return msg;
        } catch {
          // Not JSON — a short plain-text body is still more useful than nothing.
          if (text.length <= 200 && !text.startsWith('<')) return text;
        }
      }
    } else {
      const msg = messageOf(data);
      if (msg) return msg;
    }
  } catch {
    /* unreadable body — fall through */
  }

  if (e?.response?.status === 403) return 'You do not have permission to export the cash ledger.';
  return e?.message && !/^Request failed with status code/.test(e.message) ? e.message : fallback;
}
