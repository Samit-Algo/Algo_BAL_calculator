// FloodCheck API client. Talks to the standalone FloodCheck backend (:8200).
// Override with VITE_API_BASE if the backend runs elsewhere.

export const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://127.0.0.1:8200"
).replace(/\/+$/, "");

async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}\n${text}`);
  }
  return response.json();
}

export const checkAddress = (query) =>
  requestJson(`${API_BASE}/flood/address?q=${encodeURIComponent(query)}`);

export const checkPoint = (latitude, longitude) =>
  requestJson(`${API_BASE}/flood/point?lat=${latitude}&lon=${longitude}`);

// The councils the backend can assess, with the map setup each one declares.
// This is the only place the frontend learns which councils exist.
export const fetchCouncils = async () => {
  const payload = await requestJson(`${API_BASE}/flood/councils`);
  return payload.councils || [];
};

// Address autocomplete. Forgiving on purpose: any failure returns [] so typing
// never breaks the search box.
export const suggestAddresses = async (query) => {
  try {
    return await requestJson(`${API_BASE}/flood/suggest?q=${encodeURIComponent(query)}`);
  } catch {
    return [];
  }
};

// Warm the elevation service (slow cold start) so the first real check is fast.
export const warmup = (longitude, latitude) =>
  fetch(`${API_BASE}/flood/point?lat=${latitude}&lon=${longitude}`).catch(() => {});
