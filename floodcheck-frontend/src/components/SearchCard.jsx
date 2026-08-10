// Address search with autocomplete, plus the flood event the map is coloured by.
// The event options come from the selected council, because councils publish
// different sets of events.

import { Card, Eyebrow } from "./ui/Primitives.jsx";

export default function SearchCard({
  query,
  onQueryChange,
  onSubmit,
  suggestions,
  onSuggestionPick,
  onSuggestionsDismiss,
  isBusy,
  errorMessage,
  events,
  selectedEventKey,
  onEventChange,
}) {
  return (
    <Card>
      <Eyebrow>Check a property</Eyebrow>
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
            placeholder="Search any Australian address…"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-blue-500"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
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

      {events.length > 1 && (
        <div className="flex items-center gap-2 mt-3">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">
            Flood event
          </label>
          <select
            value={selectedEventKey}
            onChange={(event) => onEventChange(event.target.value)}
            className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
          >
            {events.map((event) => (
              <option key={event.key} value={event.key}>
                {event.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}
