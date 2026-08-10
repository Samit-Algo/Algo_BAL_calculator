// How a feature's flood status is decided, and the colours that express it.
// Shared by the map style, the legend, the donut and the result panel so all
// four always agree.

export const STATUS_COLORS = {
  not: "#2ecc71",
  parcel: "#a56cf5",
  building: "#e6455f",
};

export const WATER_COLOR = "#29b6d8";
export const BOUNDARY_COLOR = "#7c9bd9";

// Above this depth the building itself is treated as flooded rather than just
// the land around it. Matches the threshold used when the datasets are built.
const BUILDING_FLOODED_DEPTH_M = 0.2;

export const STATUS_LABELS = {
  not: "Not Flooded",
  parcel: "Parcel Flooded",
  building: "Building Flooded",
};

// Map style expressions cannot read nested objects from GeoJSON properties, so
// each feature's levels.<key> is copied to a flat "lvl_<key>" number on load.
export const levelPropertyName = (eventKey) => `lvl_${eventKey}`;

export function flattenFeatureLevels(featureCollection) {
  for (const feature of featureCollection.features || []) {
    const levels = feature.properties?.levels || {};
    for (const key of Object.keys(levels)) {
      feature.properties[levelPropertyName(key)] = levels[key];
    }
  }
  return featureCollection;
}

export function parseFeatureProperties(properties) {
  return {
    ...properties,
    levels:
      typeof properties.levels === "string"
        ? JSON.parse(properties.levels)
        : properties.levels,
  };
}

export function statusForFeature(properties, eventKey) {
  const level = properties.levels?.[eventKey];
  if (level === null || level === undefined) return "not";
  if (properties.ground_m === null || properties.ground_m === undefined) return "parcel";
  return level - properties.ground_m > BUILDING_FLOODED_DEPTH_M ? "building" : "parcel";
}

// Colours a feature by comparing its flood level for the chosen event against
// the ground beneath it.
export function buildStatusColorExpression(eventKey) {
  const level = ["get", levelPropertyName(eventKey)];
  return [
    "case",
    ["==", ["typeof", level], "number"],
    [
      "case",
      [">", ["-", level, ["get", "ground_m"]], BUILDING_FLOODED_DEPTH_M],
      STATUS_COLORS.building,
      STATUS_COLORS.parcel,
    ],
    STATUS_COLORS.not,
  ];
}
