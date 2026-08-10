// Small presentational building blocks shared across the result column.

export function Card({ children, className = "" }) {
  return (
    <div className={"bg-white rounded-2xl border border-slate-200 shadow-sm p-4 " + className}>
      {children}
    </div>
  );
}

export function Eyebrow({ children }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
      {children}
    </div>
  );
}

export function KeyValueRow({ label, value }) {
  return (
    <div className="flex justify-between text-[13.5px] py-[3px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

export function Badge({ text, color }) {
  return (
    <span
      className="inline-block text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-md text-white"
      style={{ background: color }}
    >
      {text}
    </span>
  );
}
