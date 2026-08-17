import type { DeliveryItem } from '@water-supply-crm/types';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "Sheet Order" reflects the ACTUAL order deliveries happened in, not the
// static planned route sequence — a driver who does stop #4 before #2/#3
// (traffic, customer availability, whatever) should see the list settle into
// 1, 4, 2, 3, 5 once recorded, matching the printed sheet/PDF. Items already
// recorded (deliveredAt set) sort chronologically by that timestamp; items
// still PENDING have no deliveredAt yet, so they fall back to the planned
// `sequence` and stay grouped at the end, in their original relative order.
export function sortBySequence(items: DeliveryItem[]): DeliveryItem[] {
  return [...items].sort((a, b) => {
    if (a.deliveredAt && b.deliveredAt) {
      return new Date(a.deliveredAt).getTime() - new Date(b.deliveredAt).getTime();
    }
    if (a.deliveredAt) return -1;
    if (b.deliveredAt) return 1;
    return a.sequence - b.sequence;
  });
}

// Customer codes are generated as "L" + an un-padded number (L1, L2, ... L23),
// so a plain string sort would put "L10" before "L2". Numeric codes are sorted
// numerically; anything not matching that pattern falls back to string sort at the end.
export function sortByCustomerCode(items: DeliveryItem[]): DeliveryItem[] {
  const codeNum = (code: string | undefined): number | null => {
    if (!code) return null;
    const match = /^L(\d+)$/i.exec(code);
    return match ? parseInt(match[1], 10) : null;
  };

  const numbered: DeliveryItem[] = [];
  const other: DeliveryItem[] = [];

  for (const item of items) {
    if (codeNum(item.customer?.customerCode) != null) {
      numbered.push(item);
    } else {
      other.push(item);
    }
  }

  numbered.sort((a, b) => codeNum(a.customer?.customerCode)! - codeNum(b.customer?.customerCode)!);
  other.sort((a, b) => (a.customer?.customerCode ?? '').localeCompare(b.customer?.customerCode ?? ''));

  return [...numbered, ...other];
}

export function sortByNearest(
  items: DeliveryItem[],
  driverLat: number,
  driverLng: number,
): DeliveryItem[] {
  const withCoords: DeliveryItem[] = [];
  const withoutCoords: DeliveryItem[] = [];

  for (const item of items) {
    const lat = item.customer?.latitude;
    const lng = item.customer?.longitude;
    if (lat != null && lng != null) {
      withCoords.push(item);
    } else {
      withoutCoords.push(item);
    }
  }

  const result: DeliveryItem[] = [];
  let curLat = driverLat;
  let curLng = driverLng;
  const pool = [...withCoords];

  while (pool.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i].customer!;
      const dist = haversineKm(curLat, curLng, c.latitude!, c.longitude!);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const [picked] = pool.splice(nearestIdx, 1);
    result.push(picked);
    curLat = picked.customer!.latitude!;
    curLng = picked.customer!.longitude!;
  }

  return [...result, ...withoutCoords];
}
