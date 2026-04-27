export interface ZmanimRequest { city: string; source: 'manual' | 'gps'; }
export function getZmanimMock(_req: ZmanimRequest) {
  return { alot: '05:12', sunrise: '06:05', shemaGra: '09:48', sunset: '19:52', tzeit: '20:16' };
}
