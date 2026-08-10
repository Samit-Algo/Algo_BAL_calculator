// Owns the MapLibre instance and keeps it in step with the selected council.
//
// The map is created once and never torn down. Changing council swaps the data
// on the existing sources and flies the camera, which is far cheaper than
// rebuilding the map and keeps the transition smooth.

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
  DELIVERY_MODES,
  loadChunkedFeatures,
  loadCouncilIndex,
  loadSingleFileFeatures,
} from "../lib/councilDatasets.js";
import {
  BOUNDARY_COLOR,
  buildStatusColorExpression,
  parseFeatureProperties,
  WATER_COLOR,
} from "../lib/floodStatus.js";

const SOURCE_IDS = { features: "council-features", flood: "flood-extent", boundary: "council-boundary" };
const LAYER_IDS = { features: "council-features", flood: "flood-extent", boundary: "council-boundary" };

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };
const CHUNK_REFRESH_DELAY_MS = 250;

const BASE_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];

export const VIEW_MODES = { STANDARD: "standard", THREE_DIMENSIONAL: "3d" };

// 3D is only drawn where the council's polygons are building footprints. Land
// parcels tile the ground, so extruding them merges neighbours into one block
// rather than showing separate buildings; those councils stay flat in both modes.
export function resolveRenderMode(council, viewMode) {
  const supports3d = council?.map?.datasets?.supports_3d;
  return viewMode === VIEW_MODES.THREE_DIMENSIONAL && supports3d ? "extrusion" : "fill";
}

function buildFeatureLayer(renderMode, eventKey) {
  const color = buildStatusColorExpression(eventKey);
  if (renderMode === "fill") {
    return {
      id: LAYER_IDS.features,
      type: "fill",
      source: SOURCE_IDS.features,
      paint: { "fill-color": color, "fill-opacity": 0.75, "fill-outline-color": "#ffffff" },
    };
  }
  return {
    id: LAYER_IDS.features,
    type: "fill-extrusion",
    source: SOURCE_IDS.features,
    paint: {
      "fill-extrusion-color": color,
      "fill-extrusion-height": ["get", "height_m"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.92,
    },
  };
}

function currentViewportBounds(map) {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

export function useFloodMap({ council, eventKey, basemap, viewMode, onFeatureSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const renderModeRef = useRef(null);
  // The MapLibre layer type currently on the map ("fill" or "fill-extrusion").
  const activeLayerTypeRef = useRef(null);
  const councilIndexRef = useRef(null);
  const refreshTimerRef = useRef(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [isLoadingFeatures, setIsLoadingFeatures] = useState(false);
  const [councilIndex, setCouncilIndex] = useState(null);

  // How this council is actually drawn: the user's choice, narrowed by whether
  // the council's polygons can meaningfully be extruded.
  const renderMode = resolveRenderMode(council, viewMode);
  renderModeRef.current = renderMode;

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: [153.015, -30.492],
      zoom: 15.4,
      pitch: 58,
      bearing: -22,
      attributionControl: false,
      preserveDrawingBuffer: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("satellite", {
        type: "raster",
        tiles: SATELLITE_TILES,
        tileSize: 256,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      });
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } });

      map.addSource(SOURCE_IDS.boundary, { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: LAYER_IDS.boundary,
        type: "line",
        source: SOURCE_IDS.boundary,
        paint: { "line-color": BOUNDARY_COLOR, "line-width": 2.5, "line-opacity": 0.9, "line-dasharray": [3, 2] },
      });

      map.addSource(SOURCE_IDS.flood, { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: LAYER_IDS.flood,
        type: "fill",
        source: SOURCE_IDS.flood,
        paint: { "fill-color": WATER_COLOR, "fill-opacity": 0.45 },
      });

      map.addSource(SOURCE_IDS.features, { type: "geojson", data: EMPTY_COLLECTION });
      map.resize();
      setIsMapReady(true);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const refreshVisibleChunks = useCallback(async () => {
    const map = mapRef.current;
    const index = councilIndexRef.current;
    if (!map || !index || index.delivery_mode !== DELIVERY_MODES.CHUNKED) return;
    const collection = await loadChunkedFeatures(index, currentViewportBounds(map));
    map.getSource(SOURCE_IDS.features)?.setData(collection);
  }, []);

  // Swap every layer's data when the council changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !council?.map) return;
    let cancelled = false;
    const { datasets, view } = council.map;

    async function applyCouncil() {
      setIsLoadingFeatures(true);
      map.getSource(SOURCE_IDS.features)?.setData(EMPTY_COLLECTION);
      map.getSource(SOURCE_IDS.boundary)?.setData(datasets.boundary_url || EMPTY_COLLECTION);
      map.getSource(SOURCE_IDS.flood)?.setData(datasets.flood_extent_url || EMPTY_COLLECTION);
      const isFlat = renderModeRef.current === "fill";
      map.jumpTo({
        center: view.center,
        zoom: view.zoom,
        pitch: isFlat ? 0 : view.pitch,
        bearing: isFlat ? 0 : view.bearing,
      });

      try {
        const index = await loadCouncilIndex(council);
        if (cancelled) return;
        councilIndexRef.current = index;
        setCouncilIndex(index);

        if (datasets.delivery_mode === DELIVERY_MODES.CHUNKED) {
          await refreshVisibleChunks();
        } else {
          const collection = await loadSingleFileFeatures(council);
          if (cancelled) return;
          map.getSource(SOURCE_IDS.features)?.setData(collection);
        }
      } finally {
        if (!cancelled) setIsLoadingFeatures(false);
      }
    }

    applyCouncil();
    return () => {
      cancelled = true;
    };
  }, [council, isMapReady, refreshVisibleChunks]);

  // Chunked councils load more data as the map settles at a new position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    const handleMoveEnd = () => {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(refreshVisibleChunks, CHUNK_REFRESH_DELAY_MS);
    };
    map.on("moveend", handleMoveEnd);
    return () => {
      clearTimeout(refreshTimerRef.current);
      map.off("moveend", handleMoveEnd);
    };
  }, [isMapReady, refreshVisibleChunks]);

  // The layer is rebuilt only on a render-mode change, which can happen before an
  // event key is known, so the latest key is read from a ref at build time.
  const eventKeyRef = useRef(eventKey);
  eventKeyRef.current = eventKey;

  // Repaint when the selected event changes.
  //
  // The paint property comes from the layer actually on the map, tracked when it
  // was added, not from the render mode this render resolved to. On a council
  // switch this effect runs before the layer below is rebuilt, so the two
  // disagree for one commit — and asking a fill-extrusion layer for "fill-color"
  // throws inside MapLibre, which blanks the map.
  useEffect(() => {
    const map = mapRef.current;
    const activeType = activeLayerTypeRef.current;
    if (!map || !eventKey || !activeType || !map.getLayer(LAYER_IDS.features)) return;
    const paintProperty = activeType === "fill" ? "fill-color" : "fill-extrusion-color";
    map.setPaintProperty(LAYER_IDS.features, paintProperty, buildStatusColorExpression(eventKey));
  }, [eventKey, isMapReady, council]);

  // The feature layer and its interaction handlers share a lifecycle: the
  // handlers are delegated to the layer, so they are only registered while it
  // exists, and are torn down with it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !council?.map) return undefined;

    if (map.getLayer(LAYER_IDS.features)) map.removeLayer(LAYER_IDS.features);
    const layer = buildFeatureLayer(renderMode, eventKeyRef.current);
    map.addLayer(layer);
    activeLayerTypeRef.current = layer.type;

    const handleClick = (event) => {
      const feature = event.features?.[0];
      if (feature) onFeatureSelect(parseFeatureProperties(feature.properties));
    };
    const showPointer = () => (map.getCanvas().style.cursor = "pointer");
    const hidePointer = () => (map.getCanvas().style.cursor = "");
    map.on("click", LAYER_IDS.features, handleClick);
    map.on("mouseenter", LAYER_IDS.features, showPointer);
    map.on("mouseleave", LAYER_IDS.features, hidePointer);

    return () => {
      map.off("click", LAYER_IDS.features, handleClick);
      map.off("mouseenter", LAYER_IDS.features, showPointer);
      map.off("mouseleave", LAYER_IDS.features, hidePointer);
    };
    // Keyed on the resolved render mode rather than the council, so switching
    // between two councils drawn the same way does not churn the layer.
  }, [renderMode, isMapReady, onFeatureSelect, council]);

  // Tilt into 3D or flatten when the view mode changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !council?.map) return;
    const view = council.map.view;
    const isFlat = renderMode === "fill";
    map.easeTo({
      pitch: isFlat ? 0 : view.pitch,
      bearing: isFlat ? 0 : view.bearing,
      duration: 400,
    });
  }, [renderMode, isMapReady, council]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("satellite")) {
      map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
    }
  }, [basemap, isMapReady]);

  const focusOnPoint = useCallback((longitude, latitude) => {
    const map = mapRef.current;
    if (!map) return;
    const position = [longitude, latitude];
    if (markerRef.current) markerRef.current.setLngLat(position);
    else markerRef.current = new maplibregl.Marker({ color: "#e6455f" }).setLngLat(position).addTo(map);
    map.flyTo({ center: position, zoom: 16.5 });
  }, []);

  return { containerRef, isMapReady, isLoadingFeatures, councilIndex, renderMode, focusOnPoint };
}
