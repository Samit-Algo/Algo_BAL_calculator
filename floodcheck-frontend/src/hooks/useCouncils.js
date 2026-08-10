// Loads the councils the backend can map, and tracks which one is selected.
//
// The list is never hardcoded here: registering a council in the backend is all
// it takes for it to appear in the UI.

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchCouncils } from "../lib/floodApi.js";

export function useCouncils() {
  const [councils, setCouncils] = useState([]);
  const [selectedCouncilId, setSelectedCouncilId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchCouncils()
      .then((list) => {
        if (cancelled) return;
        // Only councils with precomputed map data can be shown on the map.
        const mappable = list.filter((council) => council.map);
        setCouncils(mappable);
        setSelectedCouncilId((current) => current ?? mappable[0]?.id ?? null);
      })
      .catch((error) => !cancelled && setLoadError(String(error.message || error)));
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCouncil = useMemo(
    () => councils.find((council) => council.id === selectedCouncilId) || null,
    [councils, selectedCouncilId]
  );

  // Used when an address result lands in a different council's area.
  const selectCouncilById = useCallback((councilId) => {
    if (councilId) setSelectedCouncilId(councilId);
  }, []);

  return { councils, selectedCouncil, selectCouncilById, loadError };
}
