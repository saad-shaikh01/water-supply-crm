export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
      { headers: { 'Accept-Language': 'en' } },
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data.display_name as string) ?? '';
  } catch {
    return '';
  }
}
