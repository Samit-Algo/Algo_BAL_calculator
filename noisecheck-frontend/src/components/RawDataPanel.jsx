// The real upstream calls behind a result card, and the untouched response each
// returned — so the tidy numbers above can be checked rather than trusted.
//
// Everything here is generated from the request that was actually just made, so
// unlike written documentation it cannot drift from the code's behaviour.

const VERB_STYLES = {
  CALCULATED: "bg-amber-100 text-amber-800",
  LOCAL: "bg-emerald-100 text-emerald-800",
};

function Block({ caption, value }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mt-2 mb-1">
        {caption}
      </div>
      <pre className="m-0 p-2.5 bg-slate-800 text-slate-200 rounded-lg overflow-x-auto max-h-60 text-[11px] leading-relaxed">
        {text}
      </pre>
    </>
  );
}

export default function RawDataPanel({ provenance }) {
  if (!provenance) return null;

  return (
    <details className="mt-3 border-t border-slate-200 pt-2.5">
      <summary className="cursor-pointer text-[12px] font-semibold text-blue-700 list-none marker:content-['']">
        Show the raw API data — {provenance.api}
      </summary>

      {(provenance.steps || []).map((step, index) => (
        <div key={index} className="mt-3">
          <div className="flex items-center gap-2 flex-wrap text-[12px] font-semibold text-slate-700">
            <span
              className={
                "px-1.5 py-[1px] rounded text-[10px] font-mono font-bold " +
                (VERB_STYLES[step.method] || "bg-slate-200 text-slate-600")
              }
            >
              {step.method}
            </span>
            {step.label}
          </div>
          <div className="text-[11px] font-mono text-slate-400 break-all mt-1">{step.url}</div>
          <div className="text-[12px] text-slate-500 mt-1">{step.note}</div>
          {step.body != null && <Block caption="Request sent" value={step.body} />}
          {step.raw != null && (
            <Block
              caption={
                step.method === "CALCULATED" ? "How it is worked out" : "Raw response (one record)"
              }
              value={step.raw}
            />
          )}
        </div>
      ))}

      {(provenance.mapping || []).length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mt-3 mb-1">
            What the screen shows, and where it came from
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
                  <th className="text-left font-semibold py-1 pr-2">Shown as</th>
                  <th className="text-left font-semibold py-1 pr-2">Comes from</th>
                  <th className="text-left font-semibold py-1">Handling</th>
                </tr>
              </thead>
              <tbody>
                {provenance.mapping.map((row) => (
                  <tr key={row.ui} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-slate-700">{row.ui}</td>
                    <td className="py-1 pr-2">
                      <code className="text-[11px] text-slate-500">{row.from}</code>
                    </td>
                    <td
                      className={
                        "py-1 " +
                        (/CALCULATED/.test(row.via)
                          ? "text-amber-700 font-semibold"
                          : "text-slate-500")
                      }
                    >
                      {row.via}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
