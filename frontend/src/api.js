const isDev = import.meta.env.DEV;

let rawBase = import.meta.env.VITE_API_BASE_URL || (isDev ? 'http://127.0.0.1:8000' : '');

if (!rawBase) {
  throw new Error(
    'VITE_API_BASE_URL is not configured. Add the public HTTPS backend URL in Vercel Environment Variables.'
  );
}

const API_BASE_URL = rawBase.replace(/\/+$/, '');

const _CLIENT_CACHE = new Map();

async function get(path, options = {}) {
  const { signal, refresh = false } = options;
  if (!refresh && _CLIENT_CACHE.has(path)) {
    return _CLIENT_CACHE.get(path);
  }

  const res = await fetch(API_BASE_URL + path, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  _CLIENT_CACHE.set(path, data);
  return data;
}

async function post(path, body, options = {}) {
  const { signal, refresh = false } = options;
  const cacheKey = path + ':' + JSON.stringify(body);
  if (!refresh && _CLIENT_CACHE.has(cacheKey)) {
    return _CLIENT_CACHE.get(cacheKey);
  }

  const res = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || `Request failed: ${errBody.detail || res.status}`);
  }
  const data = await res.json();
  _CLIENT_CACHE.set(cacheKey, data);
  return data;
}

export const api = {
  health: (options) => get('/api/health', options),
  stats: (options) => get('/api/stats', options),
  ulpins: (q, options) => get('/api/ulpins' + (q ? `?q=${encodeURIComponent(q)}` : ''), options),
  ulpin: (id, options) => get(`/api/ulpin/${encodeURIComponent(id)}`, options),
  geometry: (id, refresh = false, options = {}) => get(`/api/ulpin/${encodeURIComponent(id)}/geometry${refresh ? '?refresh=true' : ''}`, { ...options, refresh }),
  providersStatus: (options) => get('/api/providers/status', options),
  nearby: (id, options) => get(`/api/ulpin/${encodeURIComponent(id)}/nearby`, options),
  threeD: (id, options) => get(`/api/ulpin/${encodeURIComponent(id)}/3d`, options),
  overlap: (id, withId, options) => get(`/api/ulpin/${encodeURIComponent(id)}/overlap?with=${encodeURIComponent(withId)}`, options),
  overlap2D: (parcelAUlpin, parcelBUlpin, options) => post('/api/overlap/2d', { parcel_a_ulpin: parcelAUlpin, parcel_b_ulpin: parcelBUlpin }, options),
  clearCache: () => _CLIENT_CACHE.clear(),
};

export const API_BASE = API_BASE_URL;

export async function getSatelliteImageUrl(ulpin) {
  return `${API_BASE}/api/ulpin/${encodeURIComponent(ulpin)}/satellite/image`;
}