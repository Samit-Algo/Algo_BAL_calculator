// "How this works", rendered from GET /noise/method.
//
// Nothing here is hard-coded. The search radius, reference levels, station cutoff and
// coverage counts all come from the backend, which derives them from the same
// constants the providers use — so tuning one cannot leave this panel describing
// behaviour the code no longer has.

import { CONFIDENCE_COLORS } from "../lib/noiseScales.js";
import { Card, Eyebrow } from "./ui/Primitives.jsx";

function Section({ title, badge, children, defaultOpen = false }) {
  return (
    <details open={defaultOpen} className="border-t border-slate-200 py-2 group">
      <summary className="cursor-pointer list-none marker:content-[''] flex items-center gap-2 text-[13px] font-semibold text-slate-800">
        <span className="flex-1">{title}</span>
        {badge}
        <span className="text-slate-400 font-normal text-[15px] leading-none">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">–</span>
        </span>
      </summary>
      <div className="mt-2 text-[12.5px] leading-relaxed text-slate-500 space-y-2">
        {children}
      </div>
    </details>
  );
}

function GradeDot({ grade }) {
  return (
    <span
      className="inline-block shrink-0 text-[10px] font-bold text-white px-1.5 py-[1px] rounded-full"
      style={{ background: CONFIDENCE_COLORS[grade] }}
    >
      {grade}
    </span>
  );
}

function ApiList({ apis }) {
  return (
    <div className="space-y-1 pt-1">
      {apis.map((api) => (
        <div key={api.name} className="flex gap-2">
          <a
            href={api.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 hover:underline break-all flex-1"
          >
            {api.name}
          </a>
          <span className="shrink-0 text-slate-400">{api.licence}</span>
        </div>
      ))}
    </div>
  );
}

function ReadSection({ read }) {
  return (
    <Section title={read.title} badge={<GradeDot grade={read.grade} />}>
      <p className="m-0 font-semibold text-slate-700">{read.summary}</p>
      {read.detail.map((paragraph) => (
        <p key={paragraph} className="m-0">
          {paragraph}
        </p>
      ))}

      {read.scale && (
        <ul className="m-0 pl-4 list-disc space-y-0.5">
          {read.scale.map((entry) => (
            <li key={entry.band}>
              <b className="text-slate-700">{entry.band}</b> — {entry.meaning}
            </li>
          ))}
        </ul>
      )}

      {read.steps && (
        <ol className="m-0 pl-4 list-decimal space-y-0.5">
          {read.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {read.formula && (
        <div className="font-mono text-[11px] bg-slate-100 rounded-md px-2 py-1.5 space-y-1">
          <div>{read.formula}</div>
          <div>{read.combine}</div>
        </div>
      )}

      {read.table_note && <p className="m-0">{read.table_note}</p>}

      {read.pollutants && (
        <ul className="m-0 pl-4 list-disc space-y-0.5">
          {read.pollutants.map((pollutant) => (
            <li key={pollutant.code}>
              <b className="text-slate-700">{pollutant.code}</b> — {pollutant.meaning}
            </li>
          ))}
        </ul>
      )}

      {read.coverage && <p className="m-0">{read.coverage}</p>}

      <ApiList apis={read.apis} />
    </Section>
  );
}

export default function MethodPanel({ method }) {
  if (!method) {
    return (
      <Card>
        <Eyebrow>How this works</Eyebrow>
        <p className="text-[12.5px] text-slate-400 m-0">Loading method…</p>
      </Card>
    );
  }

  return (
    <Card>
      <Eyebrow>How this works</Eyebrow>
      <p className="text-[12.5px] text-slate-500 m-0 mb-3">
        Three separate reads on one address. They are not equally trustworthy, so each is
        graded.
      </p>

      <div className="space-y-1.5 mb-3">
        {method.confidence_grades.map((entry) => (
          <div key={entry.grade} className="flex gap-2 items-start text-[12.5px]">
            <GradeDot grade={entry.grade} />
            <span className="text-slate-500">{entry.meaning}</span>
          </div>
        ))}
      </div>

      {method.reads.map((read) => (
        <ReadSection key={read.key} read={read} />
      ))}

      <Section title="Reading the map">
        <p className="m-0">
          <b className="text-slate-700">Filled bands</b> — aircraft contours, darker is
          higher ANEF. Every band is drawn, not just yours, so you can see how close the
          next one sits.
        </p>
        <p className="m-0">
          <b className="text-slate-700">Coloured lines</b> — roads. Thicker and darker
          contributes more. A thin line at the fence often matches a thick one 300 m away.
        </p>
        <p className="m-0">
          <b className="text-slate-700">Dashed line</b> — how far the air quality station
          is from the address.
        </p>
        <p className="m-0">Tap any contour or road for its values.</p>
      </Section>

      <Section title="Address lookup">
        <p className="m-0">
          Geocoded by <b className="text-slate-700">{method.geocoder.provider}</b>.{" "}
          {method.geocoder.note}
        </p>
      </Section>

      <Section title="What this is not">
        {method.limits.map((limit) => (
          <p key={limit} className="m-0">
            {limit}
          </p>
        ))}
      </Section>
    </Card>
  );
}
