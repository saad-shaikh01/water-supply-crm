'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'expense-center:recent-types';
const MAX_RECENT = 4;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecent(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // ignore — private browsing / storage quota, non-fatal to the wizard
  }
}

/**
 * Remembers the last ~4 distinct expense-type keys used, most-recent-first,
 * so the type picker can surface a "Recently used" row above the full
 * domain-grouped grid. Guarded in try/catch throughout (matches
 * damage-report-form.tsx's localStorage convention) — never throws if
 * storage is unavailable.
 */
export function useRecentExpenseTypes() {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  const recordUse = useCallback((key: string) => {
    setRecent((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, MAX_RECENT);
      writeRecent(next);
      return next;
    });
  }, []);

  return { recent, recordUse };
}
