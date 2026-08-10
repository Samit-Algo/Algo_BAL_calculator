// Loads a council's precomputed map data from the frontend's own public folder.
//
// Two delivery modes, declared by the backend per council:
//   single   one GeoJSON file, fetched once
//   chunked  a grid of GeoJSON chunks, fetched as the viewport moves
//
// Both are static local assets, so the map keeps working regardless of whether
// any council's own servers are reachable.

import { flattenFeatureLevels } from "./floodStatus.js";

export const DELIVERY_MODES = { SINGLE: "single", CHUNKED: "chunked" };

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

// Chunks and indexes are immutable build artifacts, so once fetched they are
// kept for the life of the page and re-used when panning back.
const datasetCache = new Map();

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url} (HTTP ${response.status})`);
  return response.json();
}

async function fetchCached(url) {
  if (!datasetCache.has(url)) {
    datasetCache.set(
      url,
      fetchJson(url).catch((error) => {
        datasetCache.delete(url); // let a failed fetch be retried
        throw error;
      })
    );
  }
  return datasetCache.get(url);
}

// The index carries feature totals and per-event status counts, so the summary
// figures never require downloading the geometry.
export const loadCouncilIndex = (council) =>
  fetchCached(`/councils/${council.id}/index.json`);

// Flattening writes extra properties onto the cached features. It is idempotent,
// so the cached collection is flattened in place rather than copied — copying a
// dataset of this size on every read would be wasteful.
export const loadSingleFileFeatures = async (council) =>
  flattenFeatureLevels(await fetchCached(council.map.datasets.buildings_url));

function boundsIntersect(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

export function chunksWithinBounds(index, viewportBounds) {
  return (index.chunks || []).filter((chunk) =>
    boundsIntersect(chunk.bounds, viewportBounds)
  );
}

// Fetches every chunk overlapping the viewport and returns them as one
// collection. Already-loaded chunks come from cache, so panning is cheap.
export async function loadChunkedFeatures(index, viewportBounds) {
  const visibleChunks = chunksWithinBounds(index, viewportBounds);
  if (!visibleChunks.length) return EMPTY_COLLECTION;

  const collections = await Promise.all(
    visibleChunks.map((chunk) =>
      fetchCached(chunk.url).catch(() => EMPTY_COLLECTION)
    )
  );
  const features = [];
  for (const collection of collections) features.push(...(collection.features || []));
  return flattenFeatureLevels({ type: "FeatureCollection", features });
}

export function statusCountsForEvent(index, eventKey) {
  return index?.counts_by_event?.[eventKey] || { not: 0, parcel: 0, building: 0 };
}
