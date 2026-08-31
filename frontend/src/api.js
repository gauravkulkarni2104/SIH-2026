const BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000';

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => get('/api/health'),
  stats: () => get('/api/stats'),
  ulpins: (q) => get('/api/ulpins' + (q ? `?q=${encodeURIComponent(q)}` : '')),
  ulpin: (id) => get(`/api/ulpin/${encodeURIComponent(id)}`),
  geometry: (id, refresh = false) => get(`/api/ulpin/${encodeURIComponent(id)}/geometry${refresh ? '?refresh=true' : ''}`),
  providersStatus: () => get('/api/providers/status'),
  nearby: (id) => get(`/api/ulpin/${encodeURIComponent(id)}/nearby`),
  threeD: (id) => get(`/api/ulpin/${encodeURIComponent(id)}/3d`),
  overlap: (id, withId) => get(`/api/ulpin/${encodeURIComponent(id)}/overlap?with=${encodeURIComponent(withId)}`),
  // Stage 6: real 2D Shapely polygon intersection (separate from the 3D volumetric `overlap` above).
  overlap2D: (parcelAUlpin, parcelBUlpin) => post('/api/overlap/2d', { parcel_a_ulpin: parcelAUlpin, parcel_b_ulpin: parcelBUlpin }),
};

export const API_BASE = BASE;

export async function getSatelliteImageUrl(ulpin) {
  return `${API_BASE}/api/ulpin/${encodeURIComponent(ulpin)}/satellite/image`;
}