export const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export function formatDayLabel(dayOfWeek: number) {
  return DAY_LABELS[dayOfWeek] ?? `Day ${dayOfWeek}`;
}
