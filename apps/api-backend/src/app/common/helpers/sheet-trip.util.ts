/**
 * Which trip (DailySheetLoad) a money record added to a sheet belongs to —
 * inferred server-side, never an API param. The trip currently running wins;
 * if every trip has already ended (sheet still open, or closed), the most
 * recently ended trip is used so late expenses still land in a trip's numbers
 * instead of going unassigned. Null only when the sheet has no trips at all.
 */
export async function resolveSheetTripId(
  db: { dailySheetLoad: { findFirst: (args: any) => Promise<{ id: string } | null> } },
  dailySheetId: string,
): Promise<string | null> {
  const active = await db.dailySheetLoad.findFirst({
    where: { dailySheetId, endedAt: null },
    select: { id: true },
  });
  if (active) return active.id;

  const last = await db.dailySheetLoad.findFirst({
    where: { dailySheetId, endedAt: { not: null } },
    orderBy: { endedAt: 'desc' },
    select: { id: true },
  });
  return last?.id ?? null;
}
