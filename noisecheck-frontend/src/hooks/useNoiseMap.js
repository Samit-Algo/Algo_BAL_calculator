// Owns the MapLibre instance and keeps it in step with the current result.
//
// The map is created once and never torn down. A new result swaps the data on the
// existing sources and refits the camera, which is cheaper than rebuilding the map
// and keeps the transition smooth.

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

import {
  AIR_STATION_COLOR,
  colorAircraftFeatures,
  colorRoadFeatures,
} from "../lib/noiseScales.js";

const SOURCES = { aircraft: "aircraft-contours", road: "road-lines", link: "station-link" };
const LAYERS = {
  aircraftFill: "aircraft-fill",
  aircraftLine: "aircraft-line",
  road: "road-line",
  link: "station-link-line",
};

const EMPTY = { type: "FeatureCollection", features: [] };

// Roughly the Sydney basin, so the map opens somewhere meaningful before a search.
const INITIAL_VIEW = { center: [150.9, -33.87], zoom: 8.4 };

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
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "carto", type: "raster", source: "carto" },
    { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
  ],
};

function collectBounds(collections, points) {
  const bounds = new maplibregl.LngLatBounds();
  let hasAny = false;
  const walk = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      bounds.extend(coordinates);
      hasAny = true;
      return;
    }
    coordinates.forEach(walk);
  };
  collections.forEach((collection) =>
    (collection?.features || []).forEach((feature) => walk(feature.geometry.coordinates))
  );
  points.forEach((point) => {
    if (point) {
      bounds.extend(point);
      hasAny = true;
    }
  });
  return hasAny ? bounds : null;
}

export function useNoiseMap({ basemap, layerVisibility, onFeatureClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const addressMarkerRef = useRef(null);
  const stationMarkerRef = useRef(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Read from a ref inside map handlers so they never capture a stale callback.
  const featureClickRef = useRef(onFeatureClick);
  featureClickRef.current = onFeatureClick;

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      ...INITIAL_VIEW,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // Drawn first so it sits beneath the data layers.
      map.addSource(SOURCES.link, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: LAYERS.link,
        type: "line",
        source: SOURCES.link,
        paint: {
          "line-color": AIR_STATION_COLOR,
          "line-width": 1.5,
          "line-dasharray": [2, 2],
          "line-opacity": 0.8,
        },
      });

      map.addSource(SOURCES.aircraft, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: LAYERS.aircraftFill,
        type: "fill",
        source: SOURCES.aircraft,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: LAYERS.aircraftLine,
        type: "line",
        source: SOURCES.aircraft,
        paint: { "line-color": ["get", "color"], "line-width": 1.4, "line-opacity": 0.9 },
      });

      map.addSource(SOURCES.road, { type: "geojson", data: EMPTY });
      map.addLayer({
        id: LAYERS.road,
        type: "line",
        source: SOURCES.road,
        paint: {
          "line-color": ["get", "color"],
          // Louder roads draw thicker, so the dominant source reads at a glance.
          "line-width": [
            "interpolate", ["linear"], ["get", "contribution_db"], 45, 1.5, 75, 6,
          ],
          "line-opacity": 0.95,
        },
      });

      const bind = (layerId, kind) => {
        map.on("click", layerId, (event) => {
          const feature = event.features?.[0];
          if (feature) featureClickRef.current?.(kind, feature.properties, event.lngLat);
        });
        map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
      };
      bind(LAYERS.aircraftFill, "aircraft");
      bind(LAYERS.road, "road");

      map.resize();
      setIsMapReady(true);
    });

    // The map shares its row with a panel that changes height on mobile, so it has
    // to be told when its container resizes rather than only on window resize.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    map.setLayoutProperty("satellite", "visibility", basemap === "satellite" ? "visible" : "none");
  }, [basemap, isMapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    const apply = (ids, visible) =>
      ids.forEach((id) => {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      });
    apply([LAYERS.aircraftFill, LAYERS.aircraftLine], layerVisibility.aircraft);
    apply([LAYERS.road], layerVisibility.road);
    apply([LAYERS.link], layerVisibility.air);
    const stationElement = stationMarkerRef.current?.getElement();
    if (stationElement) stationElement.style.display = layerVisibility.air ? "" : "none";
  }, [layerVisibility, isMapReady]);

  const showResult = useCallback(
    (result) => {
      const map = mapRef.current;
      if (!map || !isMapReady || !result) return;

      const aircraft = colorAircraftFeatures(result.noise.aircraft.geojson);
      const roads = colorRoadFeatures(result.noise.road.geojson);
      const point = [result.point.lon, result.point.lat];
      const station = result.air_quality.station;
      const stationPoint =
        station && station.longitude != null ? [station.longitude, station.latitude] : null;

      map.getSource(SOURCES.aircraft)?.setData(aircraft);
      map.getSource(SOURCES.road)?.setData(roads);
      map.getSource(SOURCES.link)?.setData(
        stationPoint
          ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: [point, stationPoint] },
                },
              ],
            }
          : EMPTY
      );

      addressMarkerRef.current?.remove();
      addressMarkerRef.current = new maplibregl.Marker({ color: "#e6455f" })
        .setLngLat(point)
        .addTo(map);

      stationMarkerRef.current?.remove();
      stationMarkerRef.current = null;
      if (stationPoint) {
        stationMarkerRef.current = new maplibregl.Marker({
          color: AIR_STATION_COLOR,
          scale: 0.75,
        })
          .setLngLat(stationPoint)
          .addTo(map);
      }

      const bounds = collectBounds([aircraft, roads], [point, stationPoint]);
      if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 700 });
      else map.flyTo({ center: point, zoom: 15 });
    },
    [isMapReady]
  );

  return { containerRef, isMapReady, showResult };
}
