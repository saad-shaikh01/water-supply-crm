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

export function sortBySequence(items: DeliveryItem[]): DeliveryItem[] {
  return [...items].sort((a, b) => a.sequence - b.sequence);
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
