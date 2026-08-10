// Small presentational building blocks shared across the result column.

import { CONFIDENCE_COLORS, NO_DATA_COLOR } from "../../lib/noiseScales.js";

export function Card({ children, className = "" }) {
  return (
    <div className={"bg-white rounded-2xl border border-slate-200 shadow-sm p-4 " + className}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, className = "" }) {
  return (
    <div
      className={
        "text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 " + className
      }
    >
      {children}
    </div>
  );
}

export function KeyValueRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-[13.5px] py-[3px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-900 text-right">{value}</span>
    </div>
  );
}

// A missing read is shown as "No data", never as a low or safe result.
export function ConfidenceBadge({ grade, compact = false }) {
  const label = grade ? (compact ? grade : `Confidence ${grade}`) : "No data";
  return (
    <span
      className="inline-block shrink-0 text-[10.5px] font-bold uppercase tracking-wide px-2 py-[3px] rounded-md text-white"
      style={{ background: grade ? CONFIDENCE_COLORS[grade] : NO_DATA_COLOR }}
    >
      {label}
    </span>
  );
}

export function Swatch({ color, isLine = false }) {
  return (
    <span
      className="inline-block shrink-0 rounded-[2px]"
      style={{ background: color, width: 16, height: isLine ? 3 : 10 }}
    />
  );
}
