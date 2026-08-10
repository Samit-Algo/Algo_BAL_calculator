// Chooses how features are drawn, for every council.
//
// 3D only applies where a council publishes building footprints. Where it
// publishes land parcels instead, extruding them would merge neighbours into one
// block, so those councils stay flat and the control says so rather than
// silently ignoring the choice.

import { VIEW_MODES } from "../hooks/useFloodMap.js";

const OPTIONS = [
  [VIEW_MODES.STANDARD, "Standard"],
  [VIEW_MODES.THREE_DIMENSIONAL, "3D"],
];

export default function ViewModeToggle({ viewMode, onChange, council }) {
  const supports3d = council?.map?.datasets?.supports_3d;
  const featureLabel = (council?.map?.datasets?.feature_label || "features").toLowerCase();

  return (
    <div className="absolute left-2.5 top-[196px] w-[104px]">
      <div className="rounded-lg overflow-hidden border border-slate-800 shadow-xl text-[11.5px] font-semibold">
        {OPTIONS.map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            aria-pressed={viewMode === mode}
            className={
              "block w-full px-3 py-1.5 text-left " +
              (viewMode === mode
                ? "bg-blue-600 text-white"
                : "bg-[#101418]/90 text-slate-300 hover:text-white")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {viewMode === VIEW_MODES.THREE_DIMENSIONAL && !supports3d && (
        <div className="mt-1 rounded-md bg-[#101418]/90 border border-slate-800 text-slate-300 px-2 py-1.5 text-[10px] leading-snug shadow-xl">
          This council maps {featureLabel}, not building outlines — shown flat.
        </div>
      )}
    </div>
  );
}
