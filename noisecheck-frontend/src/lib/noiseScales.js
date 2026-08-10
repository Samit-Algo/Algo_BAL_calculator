// The colour scales shared by the map, the legend and the result cards.
//
// Keeping them in one module is what stops the legend from disagreeing with the
// polygons it claims to describe.

export const CONFIDENCE_COLORS = { A: "#1a7f4b", B: "#b7791f", C: "#8a5a2b" };
export const NO_DATA_COLOR = "#8a8f96";

// ANEF bands arrive as "20 - 25", "25-30" or "35+" depending on the agency, so they
// are ranked by lower bound rather than matched as strings.
//
// Gloucester LEP is the exception: it publishes "High Noise" / "Low Noise" instead of
// numbers. Parsed naively those score 0 and would draw as the *quietest* band, which
// is exactly backwards — so they are mapped explicitly.
const NAMED_BANDS = { "high noise": 35, "low noise": 20 };

export function anefLowerBound(band) {
  const text = String(band ?? "").trim().toLowerCase();
  if (text in NAMED_BANDS) return NAMED_BANDS[text];
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

export const ANEF_SCALE = [
  { min: 35, color: "#7f1d1d", label: "ANEF 35+ / High" },
  { min: 30, color: "#b91c1c", label: "ANEF 30–35" },
  { min: 25, color: "#ea580c", label: "ANEF 25–30" },
  { min: 20, color: "#f59e0b", label: "ANEF 20–25 / Low" },
  { min: 0, color: "#fcd34d", label: "Unclassified" },
];

export const ROAD_SCALE = [
  { min: 65, color: "#6b21a8", label: "65+ dB" },
  { min: 60, color: "#7c3aed", label: "60–65 dB" },
  { min: 55, color: "#a78bfa", label: "55–60 dB" },
  { min: 50, color: "#c4b5fd", label: "50–55 dB" },
  { min: 0, color: "#ddd6fe", label: "<50 dB" },
];

export const AIR_STATION_COLOR = "#0e7490";

export const pickColor = (scale, value) =>
  (scale.find((stop) => value >= stop.min) || scale[scale.length - 1]).color;

export const colorForAnefBand = (band) => pickColor(ANEF_SCALE, anefLowerBound(band));
export const colorForRoadLevel = (decibels) => pickColor(ROAD_SCALE, decibels);

// Bake the colour into each feature rather than expressing it as a MapLibre step
// expression, because band labels are free text from two different agencies.
export function colorAircraftFeatures(collection) {
  return {
    type: "FeatureCollection",
    features: (collection?.features || []).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        color: colorForAnefBand(feature.properties.anef_band),
      },
    })),
  };
}

export function colorRoadFeatures(collection) {
  return {
    type: "FeatureCollection",
    features: (collection?.features || []).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        color: colorForRoadLevel(feature.properties.contribution_db),
      },
    })),
  };
}
