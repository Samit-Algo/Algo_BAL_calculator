// Map overlay controls: basemap switch and per-layer visibility.
//
// Sits top-right so it clears MapLibre's navigation control on the left, on both
// desktop and mobile.

const LAYERS = [
  { key: "aircraft", label: "Aircraft", color: "#c2410c" },
  { key: "road", label: "Roads", color: "#7c3aed" },
  { key: "air", label: "Air station", color: "#0e7490" },
];

function Chip({ children, isOn, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-[11.5px] font-semibold shadow-sm backdrop-blur " +
        (isOn ? "bg-white/95 text-slate-800" : "bg-white/70 text-slate-400")
      }
    >
      {children}
    </button>
  );
}

export default function LayerToggles({ basemap, onBasemapChange, visibility, onVisibilityChange }) {
  return (
    <div className="absolute right-2.5 top-2.5 z-[2] flex flex-col items-end gap-1.5">
      <Chip
        isOn
        onClick={() => onBasemapChange(basemap === "satellite" ? "streets" : "satellite")}
      >
        {basemap === "satellite" ? "Street map" : "Satellite"}
      </Chip>

      {LAYERS.map((layer) => (
        <Chip
          key={layer.key}
          isOn={visibility[layer.key]}
          onClick={() =>
            onVisibilityChange({ ...visibility, [layer.key]: !visibility[layer.key] })
          }
        >
          <span
            className="inline-block w-2 h-2 rounded-[2px] shrink-0"
            style={{ background: visibility[layer.key] ? layer.color : "#cbd5e1" }}
          />
          {layer.label}
        </Chip>
      ))}
    </div>
  );
}
