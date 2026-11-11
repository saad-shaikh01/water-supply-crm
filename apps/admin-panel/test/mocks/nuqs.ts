/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';

/** In-memory stand-in for nuqs (the real hook needs a Next router adapter). */
let initial: Record<string, any> = {};
export const setMockQueryState = (values: Record<string, any>) => {
  initial = values;
};
export const resetMockQueryState = () => {
  initial = {};
};

const make = (kind: string, defaultValue: any = null) => {
  const parser: any = { kind, defaultValue };
  parser.withDefault = (d: any) => make(kind, d);
  parser.withOptions = () => parser;
  return parser;
};

export const nuqsMockFactory = () => ({
  useQueryState: (key: string, parser: any) => {
    const def = parser?.defaultValue ?? null;
    const [value, set] = useState<any>(key in initial ? initial[key] : def);
    return [value, (next: any) => { set(next === null ? def : next); return Promise.resolve(new URLSearchParams()); }];
  },
  parseAsInteger: make('int'),
  parseAsString: make('string'),
  parseAsBoolean: make('bool'),
  parseAsStringLiteral: () => make('literal'),
});
