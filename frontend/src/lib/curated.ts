/** Hand-checked places the open datasets are missing or list under another name. */
export interface CPlace { name: string; sub: string; lat: number; lng: number }
const LIST: CPlace[] = [
  { name: 'CMR Technical Campus', sub: 'Kandlakoya, Medchal · Hyderabad', lat: 17.5971, lng: 78.4862 },
]
export function searchCurated(q: string): CPlace[] {
  const t = q.toLowerCase().trim()
  return t.length < 3 ? [] : LIST.filter(p => p.name.toLowerCase().includes(t) || t.includes(p.name.toLowerCase()))
}
