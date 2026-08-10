// The result column: either a feature tapped on the map, or an assessed address.
//
// Address results arrive from the API already tiered, so this renders whichever
// tier answered. It never presents a missing flood level as "not flooded".

import { formatDepthAboveGround, formatMetres } from "../lib/format.js";
import { STATUS_COLORS, STATUS_LABELS, statusForFeature } from "../lib/floodStatus.js";
import { Badge, Card, Eyebrow, KeyValueRow } from "./ui/Primitives.jsx";

const BAND_COLORS = {
  High: STATUS_COLORS.building,
  Moderate: "#e07817",
  Low: "#c9a227",
  Minimal: STATUS_COLORS.not,
};

const ESTIMATED_STOREY_HEIGHT_M = 3.1;

function EmptyState() {
  return (
    <Card>
      <Eyebrow>Result</Eyebrow>
      <p className="text-sm text-slate-500 m-0">
        Search any Australian address above, or tap a feature on the map, to see its
        flood assessment here.
      </p>
    </Card>
  );
}

function buildFeatureView(properties, council, eventKey, detailEvents, isExtruded) {
  const status = statusForFeature(properties, eventKey);
  const details = [
    ["Ground Elevation", formatMetres(properties.ground_m)],
    ["Area", formatMetres(properties.area_m2, " m²")],
  ];
  if (isExtruded) {
    details.splice(1, 0, ["Estimated Height", formatMetres(properties.height_m)]);
    details.splice(2, 0, [
      "Estimated Levels",
      String(Math.max(1, Math.round(properties.height_m / ESTIMATED_STOREY_HEIGHT_M))),
    ]);
  }
  details.push(["Data Source", "Council flood study"]);

  return {
    title: properties.name || `Feature #${properties.id}`,
    subtitle: council?.map?.short_label || "",
    badge: { text: STATUS_LABELS[status], color: STATUS_COLORS[status] || "#94a3b8" },
    detailTitle: `${council?.map?.datasets?.feature_label || "Feature"} details`,
    detailRows: details,
    floodRows: detailEvents.map((event) => [
      event.label,
      formatDepthAboveGround(properties.levels?.[event.key], properties.ground_m),
    ]),
  };
}

function buildCouncilStudyView(result, detailEvents) {
  const assessment = result.assessment || {};
  const floodValues = result.fetched?.flood_values || {};
  const groundLevel = result.fetched?.ground_level_mAHD;
  return {
    badge: {
      text: assessment.flood_band ? `${assessment.flood_band} flood risk` : "Unknown",
      color: BAND_COLORS[assessment.flood_band] || "#94a3b8",
    },
    detailRows: [
      ["Ground Elevation", formatMetres(groundLevel)],
      ["1% Flood Level", formatMetres(floodValues.level_1pct_aep_mAHD)],
      ["Depth (1% flood)", formatMetres(assessment.depth_1pct_aep_m)],
      ["Flood Planning Level", formatMetres(assessment.flood_planning_level_mAHD)],
      ["Confidence", "High — council flood study"],
    ],
    floodRows: detailEvents
      .map((event) => [event.label, formatDepthAboveGround(floodValues[event.key], groundLevel)])
      .filter(([, value]) => value !== "—"),
  };
}

function buildPlanningDesignationView(result) {
  const detail = result.detail || {};
  return {
    badge: { text: "Flood-controlled land", color: "#c98a00" },
    detailRows: [
      ["Ground Elevation", formatMetres(result.ground_level_mAHD)],
      ["LGA", detail.lga_name || "—"],
      ["Instrument", detail.epi_name || "—"],
      ["Confidence", "Medium — planning designation"],
    ],
    note:
      "No council flood study here — depth per event is unavailable. This designation " +
      "means flood-controlled land under the local planning instrument.",
  };
}

function buildTerrainScreenView(result) {
  const detail = result.detail || {};
  const isLowLying = detail.indicator === "low_lying";
  return {
    badge: {
      text: isLowLying ? "Low-lying terrain" : "Elevated terrain",
      color: isLowLying ? "#4a7fb0" : "#5f8a6b",
    },
    detailRows: [
      ["Ground Elevation", formatMetres(detail.ground_mAHD)],
      ["Local low point (~200 m)", formatMetres(detail.local_min_mAHD)],
      ["Height above local low", formatMetres(detail.relative_elevation_m)],
      ["Confidence", "Low — terrain screening"],
    ],
    note:
      "No flood study and no planning designation here — terrain screening only. " +
      "Risk is UNKNOWN, not zero.",
  };
}

function buildAddressView(result, detailEvents) {
  const base = {
    title: result.matched_address || "Selected point",
    subtitle: `Tier ${result.tier || "—"} · ${result.tier_label || ""}`,
    detailTitle: "Property details",
  };
  if (result.tier === "A") return { ...base, ...buildCouncilStudyView(result, detailEvents) };
  if (result.tier === "B") return { ...base, ...buildPlanningDesignationView(result) };
  if (result.tier === "C") return { ...base, ...buildTerrainScreenView(result) };
  return {
    ...base,
    badge: { text: "Risk UNKNOWN — not zero", color: "#94a3b8" },
    detailRows: [["Ground Elevation", formatMetres(result.ground_level_mAHD)]],
    note: result.headline,
  };
}

// The council can explain why it could not answer even when a lower tier did.
function councilContextNote(result) {
  const context = result?.council_context;
  if (!context?.notes?.length) return null;
  return context.notes.join(" ");
}

export default function ResultPanel({ selection, council, eventKey, isExtruded, onClear }) {
  if (!selection) return <EmptyState />;

  const detailEvents = council?.map?.detail_events || council?.map?.events || [];
  const view =
    selection.kind === "feature"
      ? buildFeatureView(selection.properties, council, eventKey, detailEvents, isExtruded)
      : buildAddressView(selection.result, detailEvents);

  const contextNote = selection.kind === "address" ? councilContextNote(selection.result) : null;
  const attribution = council?.map?.attribution_note;

  return (
    <>
      <Card>
        <div className="flex justify-between items-start gap-2">
          <div>
            <div className="font-bold text-slate-900 leading-snug text-[15px]">{view.title}</div>
            <div className="text-[12px] text-slate-500 mt-0.5">{view.subtitle}</div>
          </div>
          <button
            onClick={onClear}
            aria-label="Clear result"
            className="text-slate-400 hover:text-slate-700 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">
          <Badge {...view.badge} />
        </div>
      </Card>

      <Card>
        <Eyebrow>{view.detailTitle}</Eyebrow>
        {view.detailRows.map(([label, value]) => (
          <KeyValueRow key={label} label={label} value={value} />
        ))}
      </Card>

      {view.floodRows?.length > 0 && (
        <Card>
          <Eyebrow>Flood height (above ground)</Eyebrow>
          {view.floodRows.map(([label, value]) => (
            <KeyValueRow key={label} label={label} value={value} />
          ))}
        </Card>
      )}

      {(view.note || contextNote) && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-[13px] text-amber-800 m-0">{contextNote || view.note}</p>
        </Card>
      )}

      {attribution && (
        <p className="text-[11px] text-slate-400 leading-relaxed px-1">
          {attribution} Indicative only — not a Section 10.7 or council flood certificate.
        </p>
      )}
    </>
  );
}
