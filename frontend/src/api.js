const API_BASE = import.meta.env.VITE_API_BASE || '';

export async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `API error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export { API_BASE };
