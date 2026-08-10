// Summary of how the council's features fall across the three flood statuses.
// The counts come from the dataset index, so no geometry has to be downloaded to
// show them — which matters for councils whose data loads by viewport.

import { STATUS_COLORS } from "../lib/floodStatus.js";

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function DonutRings({ counts, total }) {
  const segments = [
    ["building", counts.building, STATUS_COLORS.building],
    ["parcel", counts.parcel, STATUS_COLORS.parcel],
    ["not", counts.not, STATUS_COLORS.not],
  ];
  let offset = 0;
  return (
    <g transform="rotate(-90 56 56)">
      {segments.map(([key, value, color]) => {
        const dash = (total ? value / total : 0) * CIRCUMFERENCE;
        const ring = (
          <circle
            key={key}
            cx="56"
            cy="56"
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="15"
            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            strokeDashoffset={-offset}
          />
        );
        offset += dash;
        return ring;
      })}
    </g>
  );
}

export default function StatsDonut({ counts, total, featureLabel }) {
  return (
    <div>
      <div className="flex justify-center">
        <svg width="112" height="112" viewBox="0 0 112 112">
          <DonutRings counts={counts} total={total} />
          <text x="56" y="54" textAnchor="middle" fill="#fff" fontSize="17" fontWeight="800">
            {total.toLocaleString()}
          </text>
          <text x="56" y="69" textAnchor="middle" fill="#94a3b8" fontSize="9">
            {featureLabel}
          </text>
        </svg>
      </div>
      <div className="flex justify-around text-[11px] mt-1">
        <span>
          <b style={{ color: STATUS_COLORS.building }}>{counts.building.toLocaleString()}</b> flooded
        </span>
        <span>
          <b style={{ color: STATUS_COLORS.parcel }}>{counts.parcel.toLocaleString()}</b> parcel
        </span>
        <span>
          <b style={{ color: STATUS_COLORS.not }}>{counts.not.toLocaleString()}</b> dry
        </span>
      </div>
    </div>
  );
}
