// Address search with autocomplete, plus the worked examples that make the data
// gaps discoverable without having to know where to look.

import { Card, Eyebrow } from "./ui/Primitives.jsx";

const EXAMPLES = [
  { label: "Badgerys Creek", query: "Badgerys Creek NSW 2555", hint: "airport contour" },
  { label: "Williamtown", query: "Williamtown NSW 2318", hint: "Defence ANEF" },
  { label: "Marrickville", query: "Marrickville NSW 2204", hint: "the data gap" },
];

export default function SearchCard({
  query,
  onQueryChange,
  onSubmit,
  suggestions,
  onSuggestionPick,
  onSuggestionsDismiss,
  isBusy,
  errorMessage,
}) {
  return (
    <Card>
      <Eyebrow>Check an address</Eyebrow>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1 min-w-0">
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onSuggestionsDismiss();
            }}
            onBlur={() => setTimeout(onSuggestionsDismiss, 150)}
            placeholder="Search any NSW address…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-blue-500"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  {/* onMouseDown so the click wins over the input's blur */}
                  <button
                    type="button"
                    onMouseDown={() => onSuggestionPick(suggestion)}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 text-slate-700"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          disabled={isBusy}
          className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-xl"
        >
          {isBusy ? "…" : "Check"}
        </button>
      </form>
      {errorMessage && <div className="text-red-600 text-[12px] mt-2">{errorMessage}</div>}

      <div className="flex flex-wrap gap-1.5 mt-3">
        {EXAMPLES.map((example) => (
          <button
            key={example.query}
            type="button"
            onClick={() => onSuggestionPick(example.query)}
            className="text-[11.5px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-700"
          >
            {example.label}
            <span className="text-slate-400"> · {example.hint}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
