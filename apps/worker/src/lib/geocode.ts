// 国土地理院の住所検索API (APIキー不要・商用利用可) を使った住所→緯度経度変換。
// https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>

interface GsiAddressSearchResult {
  geometry: { coordinates: [number, number] }; // [経度, 緯度]
  properties: { title: string };
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export async function geocodeJapaneseAddress(address: string): Promise<GeocodeResult | null> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const results = (await res.json()) as GsiAddressSearchResult[];
    const first = results[0];
    if (!first) return null;
    const [longitude, latitude] = first.geometry.coordinates;
    return { latitude, longitude };
  } catch (err) {
    console.error('[geocode] GSI address search failed', err);
    return null;
  }
}
