// NoiseCheck API client. Talks to the standalone NoiseCheck backend (:8300).
// Override with VITE_API_BASE if the backend runs elsewhere.

export const API_BASE = (
  import.meta.env.VITE_API_BASE || "http://127.0.0.1:8300"
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
  requestJson(`${API_BASE}/noise/address?q=${encodeURIComponent(query)}`);

export const checkPoint = (latitude, longitude) =>
  requestJson(`${API_BASE}/noise/point?lat=${latitude}&lon=${longitude}`);

// How each read works, and its licence. Served by the backend rather than written
// into the UI, so the explainer cannot drift from what the code actually does.
export const fetchMethod = () => requestJson(`${API_BASE}/noise/method`);

// Address autocomplete. Forgiving on purpose: any failure returns [] so typing
// never breaks the search box.
export const suggestAddresses = async (query) => {
  try {
    return await requestJson(`${API_BASE}/noise/suggest?q=${encodeURIComponent(query)}`);
  } catch {
    return [];
  }
};
