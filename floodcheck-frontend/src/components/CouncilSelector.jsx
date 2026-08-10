// Chooses which council's flood study the map shows. Options come from the
// backend registry, so a newly registered council appears here automatically.

export default function CouncilSelector({ councils, selectedCouncil, onSelect }) {
  if (councils.length < 2) return null;

  return (
    <select
      value={selectedCouncil?.id || ""}
      onChange={(event) => onSelect(event.target.value)}
      aria-label="Council flood study"
      className="bg-[#1b2229] border border-slate-700 text-slate-200 rounded-md px-2 py-1 text-[12px] outline-none hover:border-slate-500 focus:border-blue-500"
    >
      {councils.map((council) => (
        <option key={council.id} value={council.id}>
          {council.map.short_label}
        </option>
      ))}
    </select>
  );
}
