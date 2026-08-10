// The result column: one card per read, each carrying its own confidence grade,
// caveat, sources and raw-API panel.
//
// A read that could not answer renders as "No data" with the reason. It is never
// presented as a low or safe result.

import RawDataPanel from "./RawDataPanel.jsx";
import { Card, ConfidenceBadge, Eyebrow } from "./ui/Primitives.jsx";

function EmptyState() {
  return (
    <Card>
      <Eyebrow>Result</Eyebrow>
      <p className="text-sm text-slate-500 m-0">
        Search a NSW address above to see its aircraft noise, road noise and air quality
        assessment here, drawn on the map.
      </p>
    </Card>
  );
}

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-3 text-[11.5px] text-slate-400 space-y-0.5">
      {sources.map((source) => (
        <div key={source.name}>
          Source:{" "}
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline"
          >
            {source.name}
          </a>{" "}
          — {source.licence}
        </div>
      ))}
    </div>
  );
}

function ReadCard({ title, section, children }) {
  const answered = Boolean(section.confidence);
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <Eyebrow className="mb-0 flex-1">{title}</Eyebrow>
        <ConfidenceBadge grade={section.confidence} />
      </div>
      <div
        className={
          answered
            ? "text-[19px] font-semibold text-slate-900 leading-snug"
            : "text-[15px] font-medium text-slate-400 leading-snug"
        }
      >
        {section.headline}
      </div>
      {children}
      <div className="text-[12.5px] text-slate-500 mt-2">{section.caveat}</div>
      <Sources sources={section.sources} />
      <RawDataPanel provenance={section.provenance} />
    </Card>
  );
}

function RoadTable({ road }) {
  if (!road.contributors?.length) return null;
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left font-semibold py-1 pr-2">Road</th>
            <th className="text-left font-semibold py-1 pr-2">Class</th>
            <th className="text-right font-semibold py-1 pr-2">Distance</th>
            <th className="text-right font-semibold py-1">Adds</th>
          </tr>
        </thead>
        <tbody>
          {road.contributors.map((contributor) => (
            <tr
              key={`${contributor.name}-${contributor.road_class}-${contributor.distance_m}`}
              className="border-t border-slate-100"
            >
              <td className="py-1 pr-2 text-slate-700">{contributor.name}</td>
              <td className="py-1 pr-2 text-slate-500">{contributor.road_class}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{contributor.distance_m} m</td>
              <td className="py-1 text-right tabular-nums font-semibold">
                {contributor.contribution_db} dB
              </td>
            </tr>
          ))}
          {/* The headline sums every road, not just the listed ones — so the
              remainder is shown rather than leaving the rows unable to add up. */}
          {road.roads_hidden > 0 && (
            <tr className="border-t border-slate-100 text-slate-400">
              <td className="py-1 pr-2" colSpan={3}>
                + {road.roads_hidden} quieter roads ({road.roads_modelled} modelled in total)
              </td>
              <td className="py-1 text-right tabular-nums">{road.hidden_contribution_db} dB</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AirTable({ air }) {
  if (!air.readings?.length) return null;
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="text-slate-400 text-[10px] uppercase tracking-wider">
            <th className="text-left font-semibold py-1 pr-2">Pollutant</th>
            <th className="text-right font-semibold py-1 pr-2">Latest</th>
            <th className="text-left font-semibold py-1">Category</th>
          </tr>
        </thead>
        <tbody>
          {air.readings.map((reading) => (
            <tr key={reading.code} className="border-t border-slate-100">
              <td className="py-1 pr-2 text-slate-700">{reading.label}</td>
              <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                {reading.value} {reading.unit}
              </td>
              <td className="py-1 text-slate-500">{reading.category || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {air.readings[0]?.observed && (
        <div className="text-[11.5px] text-slate-400 mt-1.5">
          Observed {air.readings[0].observed}
        </div>
      )}
    </div>
  );
}

export default function ResultPanel({ result }) {
  if (!result) return <EmptyState />;

  const { aircraft, road } = result.noise;
  const air = result.air_quality;

  return (
    <>
      <Card>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 text-[14px] break-words">
              {result.location?.matched_address || result.query || "Selected point"}
            </div>
            <div className="text-[12px] text-slate-400 mt-0.5 tabular-nums">
              {result.point.lat.toFixed(5)}, {result.point.lon.toFixed(5)}
              {result.location?.geocoder ? ` · ${result.location.geocoder}` : ""}
            </div>
          </div>
          <ConfidenceBadge grade={result.confidence} />
        </div>
        <div className="text-[12.5px] text-slate-500 mt-2">{result.confidence_note}</div>
        {result.unanswered?.length > 0 && (
          <div className="text-[12.5px] text-slate-500 mt-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
            <span className="font-semibold text-slate-700">
              No data for: {result.unanswered.join(", ")}.
            </span>{" "}
            Missing is not the same as low — NSW publishes nothing for those at this address.
          </div>
        )}
      </Card>

      <ReadCard title="Aircraft noise" section={aircraft} />
      <ReadCard title="Road traffic noise" section={road}>
        <RoadTable road={road} />
      </ReadCard>
      <ReadCard title="Air quality" section={air}>
        <AirTable air={air} />
      </ReadCard>

      <div className="text-[12px] leading-relaxed text-slate-500 bg-slate-100 rounded-xl p-3.5">
        {result.disclaimer}
      </div>
    </>
  );
}
