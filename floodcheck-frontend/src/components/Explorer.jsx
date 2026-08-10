// FloodCheck's single screen: a 3D flood map on the left, results on the right.
//   · desktop: the map fills the left and stays put; the results column scrolls
//   · mobile: the map is pinned at the top and the results scroll below it
//
// This component only composes; the council registry, the map and the datasets
// each live in their own module.

import { useCallback, useEffect, useMemo, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { statusCountsForEvent } from "../lib/councilDatasets.js";
import { checkAddress, suggestAddresses, warmup } from "../lib/floodApi.js";
import { useCouncils } from "../hooks/useCouncils.js";
import { useFloodMap, VIEW_MODES } from "../hooks/useFloodMap.js";
import CouncilSelector from "./CouncilSelector.jsx";
import MapLegend from "./MapLegend.jsx";
import ResultPanel from "./ResultPanel.jsx";
import SearchCard from "./SearchCard.jsx";
import StatsDonut from "./StatsDonut.jsx";
import ViewModeToggle from "./ViewModeToggle.jsx";
import { Card } from "./ui/Primitives.jsx";

const SUGGESTION_DEBOUNCE_MS = 300;
const MINIMUM_SUGGESTION_LENGTH = 3;
const MAXIMUM_SUGGESTIONS = 6;

const BASEMAPS = [
  ["streets", "Map"],
  ["satellite", "Satellite"],
];

export default function Explorer() {
  const { councils, selectedCouncil, selectCouncilById, loadError } = useCouncils();

  const [selectedEventKey, setSelectedEventKey] = useState(null);
  const [basemap, setBasemap] = useState("streets");
  const [viewMode, setViewMode] = useState(VIEW_MODES.THREE_DIMENSIONAL);
  const [selection, setSelection] = useState(null);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  const events = useMemo(() => selectedCouncil?.map?.events || [], [selectedCouncil]);

  // Each council publishes its own events, so the selected one is reset to that
  // council's design flood whenever the council changes.
  useEffect(() => {
    if (!events.length) return;
    setSelectedEventKey((current) =>
      events.some((event) => event.key === current) ? current : events[events.length - 1].key
    );
  }, [events]);

  const handleFeatureSelect = useCallback((properties) => {
    setSelection({ kind: "feature", properties });
  }, []);

  const { containerRef, isLoadingFeatures, councilIndex, renderMode, focusOnPoint } =
    useFloodMap({
      council: selectedCouncil,
      eventKey: selectedEventKey,
      basemap,
      viewMode,
      onFeatureSelect: handleFeatureSelect,
    });

  // Warm the elevation service for the selected council so the first check is fast.
  useEffect(() => {
    const centre = selectedCouncil?.map?.view?.center;
    if (centre) warmup(centre[0], centre[1]);
  }, [selectedCouncil]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MINIMUM_SUGGESTION_LENGTH) {
      setSuggestions([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      const list = await suggestAddresses(trimmed);
      setSuggestions(Array.isArray(list) ? list.slice(0, MAXIMUM_SUGGESTIONS) : []);
    }, SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const showAddressResult = useCallback(
    (result) => {
      setSelection({ kind: "address", result });
      // An address in another council's area switches the map to that council.
      if (result.council_id && result.council_id !== selectedCouncil?.id) {
        selectCouncilById(result.council_id);
      }
      if (result.point) focusOnPoint(result.point.lon, result.point.lat);
    },
    [focusOnPoint, selectCouncilById, selectedCouncil]
  );

  const runSearch = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || isSearching) return;
      setSuggestions([]);
      setIsSearching(true);
      setSearchError(null);
      try {
        showAddressResult(await checkAddress(trimmed));
      } catch (error) {
        setSearchError(String(error.message || error).split("\n")[0]);
      } finally {
        setIsSearching(false);
      }
    },
    [isSearching, showAddressResult]
  );

  const handleSuggestionPick = useCallback(
    (suggestion) => {
      setQuery(suggestion);
      setSuggestions([]);
      runSearch(suggestion);
    },
    [runSearch]
  );

  const dismissSuggestions = useCallback(() => setSuggestions([]), []);

  const counts = statusCountsForEvent(councilIndex, selectedEventKey);
  const totalFeatures = councilIndex?.feature_count || 0;
  const featureLabel = selectedCouncil?.map?.datasets?.feature_label || "Features";

  return (
    <div className="flex flex-col bg-slate-50" style={{ height: "100dvh" }}>
      <header className="h-11 shrink-0 bg-[#101418] flex items-center px-4 text-slate-300 text-[13px] gap-2 border-b border-slate-800">
        <span className="font-bold text-white">FloodCheck</span>
        <span className="text-slate-600">›</span>
        <span className="hidden sm:inline">Demos &amp; Prototypes</span>
        <span className="hidden sm:inline text-slate-600">›</span>
        <CouncilSelector
          councils={councils}
          selectedCouncil={selectedCouncil}
          onSelect={selectCouncilById}
        />
        {isLoadingFeatures && <span className="text-slate-500 text-[11px]">loading map data…</span>}
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="relative shrink-0 h-[45vh] md:h-auto md:flex-1 md:min-h-0">
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

          <div className="absolute left-2.5 top-[130px] rounded-lg overflow-hidden border border-slate-800 shadow-xl text-[11.5px] font-semibold">
            {BASEMAPS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setBasemap(id)}
                className={
                  "block w-full px-3 py-1.5 text-left " +
                  (basemap === id
                    ? "bg-blue-600 text-white"
                    : "bg-[#101418]/90 text-slate-300 hover:text-white")
                }
              >
                {label}
              </button>
            ))}
          </div>

          <ViewModeToggle
            viewMode={viewMode}
            onChange={setViewMode}
            council={selectedCouncil}
          />

          {totalFeatures > 0 && (
            <div className="hidden md:block absolute left-3 bottom-3 w-52 rounded-xl bg-[#101418]/95 border border-slate-800 text-white p-3 shadow-2xl backdrop-blur">
              <StatsDonut counts={counts} total={totalFeatures} featureLabel={featureLabel} />
            </div>
          )}

          <MapLegend council={selectedCouncil} />
        </div>

        <div className="flex-1 md:flex-none w-full md:w-[440px] min-h-0 overflow-y-auto border-t md:border-t-0 md:border-l border-slate-200 bg-slate-50">
          <div className="p-4 space-y-4">
            <SearchCard
              query={query}
              onQueryChange={setQuery}
              onSubmit={() => runSearch(query)}
              suggestions={suggestions}
              onSuggestionPick={handleSuggestionPick}
              onSuggestionsDismiss={dismissSuggestions}
              isBusy={isSearching}
              errorMessage={searchError || loadError}
              events={events}
              selectedEventKey={selectedEventKey || ""}
              onEventChange={setSelectedEventKey}
            />

            {isSearching ? (
              <Card>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                  <span className="spin" />
                  Checking live flood data…{" "}
                  <span className="opacity-80">(first check can take a few seconds)</span>
                </div>
              </Card>
            ) : (
              <ResultPanel
                selection={selection}
                council={selectedCouncil}
                eventKey={selectedEventKey}
                isExtruded={renderMode === "extrusion"}
                onClear={() => setSelection(null)}
              />
            )}

            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold">
              Talk to an expert
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
