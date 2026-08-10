// Legend for the map. Entries follow the council's actual data: a council with no
// flood extent polygons or no boundary does not get a key for them.

import { BOUNDARY_COLOR, STATUS_COLORS, STATUS_LABELS, WATER_COLOR } from "../lib/floodStatus.js";

function buildLegendEntries(council) {
  const datasets = council?.map?.datasets;
  const entries = [
    [STATUS_COLORS.not, STATUS_LABELS.not],
    [STATUS_COLORS.building, STATUS_LABELS.building],
    [STATUS_COLORS.parcel, STATUS_LABELS.parcel],
  ];
  if (datasets?.flood_extent_url) entries.push([WATER_COLOR, "1% flood extent"]);
  if (datasets?.boundary_url) entries.push([BOUNDARY_COLOR, `${council.council} boundary`]);
  return entries;
}

export default function MapLegend({ council }) {
  return (
    <div className="absolute right-2 top-2 md:right-auto md:left-[224px] md:top-auto md:bottom-3 rounded-lg bg-[#101418]/90 border border-slate-800 text-white px-2.5 py-2 text-[10.5px] space-y-1 shadow-xl backdrop-blur">
      {buildLegendEntries(council).map(([color, label]) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}
