// Legend for whatever the map is currently showing.
//
// The aircraft rows are filtered to the bands actually present, so the legend never
// advertises a band the map is not drawing. Colours come from the same scales module
// the map paints from, so the two cannot disagree.

import {
  AIR_STATION_COLOR,
  ANEF_SCALE,
  ROAD_SCALE,
  colorForAnefBand,
} from "../lib/noiseScales.js";

function Row({ color, label, isLine = false, isDot = false }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block shrink-0"
        style={{
          background: color,
          width: isDot ? 9 : 16,
          height: isDot ? 9 : isLine ? 3 : 9,
          borderRadius: isDot ? "50%" : 2,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
        {title}
      </div>
      <div className="space-y-[3px]">{children}</div>
    </div>
  );
}

export default function MapLegend({ result }) {
  if (!result) return null;

  const aircraftFeatures = result.noise.aircraft.geojson?.features || [];
  const roadFeatures = result.noise.road.geojson?.features || [];
  const station = result.air_quality.station;

  const presentColors = new Set(
    aircraftFeatures.map((feature) => colorForAnefBand(feature.properties.anef_band))
  );
  const anefRows = ANEF_SCALE.filter((stop) => presentColors.has(stop.color));

  if (!anefRows.length && !roadFeatures.length && !station?.longitude) return null;

  return (
    <div className="absolute left-2.5 bottom-2.5 z-[2] rounded-xl bg-white/95 border border-slate-200 shadow-lg backdrop-blur px-3 py-2.5 text-[11px] text-slate-600 space-y-2.5 max-w-[210px]">
      {anefRows.length > 0 && (
        <Group title="Aircraft (ANEF units)">
          {anefRows.map((stop) => (
            <Row key={stop.color} color={stop.color} label={stop.label} />
          ))}
        </Group>
      )}

      {roadFeatures.length > 0 && (
        <Group title="Road noise — modelled">
          {ROAD_SCALE.map((stop) => (
            <Row key={stop.color} color={stop.color} label={stop.label} isLine />
          ))}
        </Group>
      )}

      {station?.longitude != null && (
        <Group title="Air quality">
          <Row
            color={AIR_STATION_COLOR}
            label={`Station, ${station.distance_km} km away`}
            isDot
          />
        </Group>
      )}
    </div>
  );
}
