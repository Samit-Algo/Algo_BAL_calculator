// NoiseCheck's single screen: the noise map on the left, results on the right.
//   · desktop: the map fills the left and stays put; the results column scrolls
//   · mobile:  the map is pinned at the top and the results scroll below it
//
// This component only composes; the map, the scales and the API client each live in
// their own module.

import { useCallback, useEffect, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { checkAddress, fetchMethod, suggestAddresses } from "../lib/noiseApi.js";
import { useNoiseMap } from "../hooks/useNoiseMap.js";
import LayerToggles from "./LayerToggles.jsx";
import MapLegend from "./MapLegend.jsx";
import MethodPanel from "./MethodPanel.jsx";
import ResultPanel from "./ResultPanel.jsx";
import SearchCard from "./SearchCard.jsx";
import { Card } from "./ui/Primitives.jsx";

const SUGGESTION_DEBOUNCE_MS = 350;
const MINIMUM_SUGGESTION_LENGTH = 3;
const MAXIMUM_SUGGESTIONS = 6;

const ALL_LAYERS_VISIBLE = { aircraft: true, road: true, air: true };

export default function Explorer() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [result, setResult] = useState(null);
  const [method, setMethod] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [basemap, setBasemap] = useState("streets");
  const [layerVisibility, setLayerVisibility] = useState(ALL_LAYERS_VISIBLE);
  const [tappedFeature, setTappedFeature] = useState(null);

  const handleFeatureClick = useCallback((kind, properties) => {
    setTappedFeature({ kind, properties });
  }, []);

  const { containerRef, isMapReady, showResult } = useNoiseMap({
    basemap,
    layerVisibility,
    onFeatureClick: handleFeatureClick,
  });

  // The explainer is served, not hard-coded, so it always matches the backend.
  useEffect(() => {
    fetchMethod().then(setMethod).catch(() => setMethod(null));
  }, []);

  // Draw whenever a new result lands, and again once the map finishes loading —
  // a fast search can resolve before the style is ready.
  useEffect(() => {
    if (result && isMapReady) showResult(result);
  }, [result, isMapReady, showResult]);

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

  const runSearch = useCallback(
    async (text) => {
      const trimmed = (text || "").trim();
      if (!trimmed || isSearching) return;
      setSuggestions([]);
      setIsSearching(true);
      setSearchError(null);
      setTappedFeature(null);
      try {
        setResult(await checkAddress(trimmed));
      } catch (error) {
        setSearchError(String(error.message || error).split("\n")[0]);
      } finally {
        setIsSearching(false);
      }
    },
    [isSearching]
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

  return (
    // 100dvh rather than 100vh so mobile browser chrome does not crop the panel.
    <div className="flex flex-col bg-slate-50" style={{ height: "100dvh" }}>
      <header className="h-11 shrink-0 bg-[#101418] flex items-center px-4 text-slate-300 text-[13px] gap-2 border-b border-slate-800">
        <span className="font-bold text-white">NoiseCheck</span>
        <span className="text-slate-600">›</span>
        <span className="hidden sm:inline">Noise &amp; air quality by address</span>
        <span className="ml-auto text-slate-500 text-[11px]">New South Wales</span>
      </header>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Map: pinned at the top on mobile, fills the left on desktop. */}
        <div className="relative shrink-0 h-[42vh] md:h-auto md:flex-1 md:min-h-0">
          {/*
            Positioned with an inline style, NOT Tailwind's `absolute inset-0`.
            MapLibre adds a `.maplibregl-map` class whose own stylesheet declares
            `position: relative`. That rule has the same specificity as Tailwind's
            `.absolute` but is injected after it, so it wins — the container falls
            back to relative, `inset-0` stops applying, and with only an absolutely
            positioned canvas inside it collapses to zero height and the map
            disappears. An inline style outranks any stylesheet, so it survives.
          */}
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

          <LayerToggles
            basemap={basemap}
            onBasemapChange={setBasemap}
            visibility={layerVisibility}
            onVisibilityChange={setLayerVisibility}
          />

          {/* The legend competes with the results panel for room on small screens,
              so it is desktop-only; the same colours are labelled in the cards. */}
          <div className="hidden md:block">
            <MapLegend result={result} />
          </div>

          {tappedFeature && (
            <button
              type="button"
              onClick={() => setTappedFeature(null)}
              className="absolute left-2.5 bottom-2.5 md:left-auto md:right-2.5 z-[3] max-w-[240px] text-left rounded-xl bg-white/95 border border-slate-200 shadow-lg backdrop-blur px-3 py-2 text-[12px]"
            >
              {tappedFeature.kind === "aircraft" ? (
                <>
                  <div className="font-semibold text-slate-800">
                    ANEF {tappedFeature.properties.anef_band}
                  </div>
                  <div className="text-slate-500">Published contour band</div>
                </>
              ) : (
                <>
                  <div className="font-semibold text-slate-800">
                    {tappedFeature.properties.name}
                  </div>
                  <div className="text-slate-500">
                    {tappedFeature.properties.road_class} ·{" "}
                    {tappedFeature.properties.distance_m} m · adds ~
                    {tappedFeature.properties.contribution_db} dB (modelled)
                  </div>
                </>
              )}
              <div className="text-slate-400 text-[10.5px] mt-1">Tap to dismiss</div>
            </button>
          )}
        </div>

        {/* Results: the scrolling column. */}
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
              errorMessage={searchError}
            />

            {isSearching ? (
              <Card>
                <div className="flex items-center gap-3 text-slate-500 text-sm">
                  <span className="spin" />
                  Checking live noise and air data…
                  <span className="opacity-80">(a few seconds)</span>
                </div>
              </Card>
            ) : (
              <ResultPanel result={result} />
            )}

            <MethodPanel method={method} />
          </div>
        </div>
      </div>
    </div>
  );
}
