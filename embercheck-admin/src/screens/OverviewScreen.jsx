// The admin Overview dashboard — the platform cockpit.
//
// One fetch to GET /admin/overview drives every widget: KPI counters, an
// activity timeline (cases / sign-offs / sign-ups per day), the BAL-rating pie,
// the case-status bar, a map of assessed properties, assessor breakdowns and a
// recent-admin-activity feed. All styling reuses the app's tokens (.a-card etc.)
// so it sits seamlessly alongside the Applications screens.
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
} from 'recharts'
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { getOverview } from '../lib/adminApi'

// BAL palette: low risk → green, escalating to deep red at Flame Zone. Keyed by
// the substring of the rating so "BAL-12.5", "12.5", etc. all resolve.
const BAL_COLORS = [
  { match: 'FZ', color: '#7a2417' },
  { match: 'FLAME', color: '#7a2417' },
  { match: '40', color: '#b3402c' },
  { match: '29', color: '#cc6b2c' },
  { match: '19', color: '#d99a3c' },
  { match: '12.5', color: '#c9b24a' },
  { match: 'LOW', color: '#5b8c3e' },
]
const UNRATED_COLOR = '#9b9483'

function balColor(rating) {
  const up = String(rating || '').toUpperCase()
  for (const { match, color } of BAL_COLORS) if (up.includes(match)) return color
  return UNRATED_COLOR
}

// Forest / amber series colors for the timeline.
const SERIES = {
  cases: '#3c4733',
  signoffs: '#c28e3f',
  signups: '#7c93b8',
}

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

const NSW_CENTER = [-33.87, 151.21]

function prettyStatus(s) {
  return String(s || '')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeAgo(ts) {
  const then = new Date(ts).getTime()
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export function OverviewScreen({ onNavigate }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    getOverview(days)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [days])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 24, margin: '0 0 4px', color: 'var(--ink)' }}>Overview</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-soft)' }}>Platform activity, assessments and assessor health at a glance.</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className="a-pill"
              style={{
                cursor: 'pointer',
                border: days === r.days ? '1.5px solid var(--euc-deep)' : '1.5px solid var(--line)',
                background: days === r.days ? 'color-mix(in oklab, var(--euc-deep) 12%, var(--card))' : 'var(--card)',
                color: days === r.days ? 'var(--euc-deep)' : 'var(--ink-soft)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="a-card" style={{ padding: 18, color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
      {!data && !error && <div style={{ color: 'var(--ink-soft)' }}>Loading…</div>}
      {data && <Dashboard data={data} days={days} onNavigate={onNavigate} />}
    </div>
  )
}

function Dashboard({ data, days, onNavigate }) {
  const kpis = data.kpis || {}
  const kpiTiles = [
    { label: 'Total assessments', value: kpis.total_cases, accent: 'var(--euc-deep)' },
    { label: 'Signed determinations', value: kpis.signed_cases, accent: '#5b8c3e' },
    { label: 'In assessor review', value: kpis.cases_in_review, accent: 'var(--ochre)' },
    { label: 'Registered users', value: kpis.total_users, accent: '#7c93b8' },
    { label: 'Active assessors', value: kpis.assessors_active, accent: 'var(--euc-deep)' },
    { label: 'Applications pending', value: kpis.applications_pending, accent: '#b3402c', onClick: () => onNavigate('#/applications') },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {kpiTiles.map((k) => (
          <div
            key={k.label}
            className="a-card"
            onClick={k.onClick}
            style={{ padding: '16px 18px', cursor: k.onClick ? 'pointer' : 'default' }}
          >
            <div style={{ fontSize: 30, fontWeight: 800, color: k.accent, lineHeight: 1.1 }}>{k.value ?? 0}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <Panel title="Activity timeline" subtitle={`Assessments, sign-offs and sign-ups over the last ${days} days`}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.timeline || []} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
            <defs>
              {Object.entries(SERIES).map(([k, c]) => (
                <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={c} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} />
            <RTooltip labelFormatter={shortDate} contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="cases" name="Assessments" stroke={SERIES.cases} fill="url(#g-cases)" strokeWidth={2} />
            <Area type="monotone" dataKey="signoffs" name="Sign-offs" stroke={SERIES.signoffs} fill="url(#g-signoffs)" strokeWidth={2} />
            <Area type="monotone" dataKey="signups" name="Sign-ups" stroke={SERIES.signups} fill="url(#g-signups)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* Pie + bar side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Panel title="BAL rating distribution" subtitle="Across all assessments">
          <BalPie buckets={data.bal_distribution || []} />
        </Panel>
        <Panel title="Assessments by status" subtitle="Where cases sit in the workflow">
          <StatusBar buckets={data.cases_by_status || []} />
        </Panel>
      </div>

      {/* Map */}
      <Panel title="Assessed properties" subtitle="Coloured by BAL rating">
        <PropertyMap points={data.map_points || []} />
      </Panel>

      {/* Assessors + activity feed */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Panel title="Assessors" subtitle="By approval status and operating state">
          <AssessorBlock statusBuckets={data.assessor_status || []} stateBuckets={data.assessor_states || []} />
        </Panel>
        <Panel title="Recent admin activity" subtitle="Latest application decisions">
          <ActivityFeed items={data.recent_activity || []} />
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="a-card" style={{ padding: '16px 18px' }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </section>
  )
}

function EmptyNote({ children }) {
  return <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>{children}</div>
}

function BalPie({ buckets }) {
  const total = buckets.reduce((s, b) => s + b.count, 0)
  if (!total) return <EmptyNote>No assessments yet.</EmptyNote>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <ResponsiveContainer width="55%" height={220} minWidth={200}>
        <PieChart>
          <Pie data={buckets} dataKey="count" nameKey="label" innerRadius={50} outerRadius={88} paddingAngle={2}>
            {buckets.map((b) => (
              <Cell key={b.label} fill={balColor(b.label)} stroke="var(--card)" strokeWidth={2} />
            ))}
          </Pie>
          <RTooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {buckets.map((b) => (
          <li key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink)' }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: balColor(b.label), flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{b.label}</span>
            <strong>{b.count}</strong>
            <span style={{ color: 'var(--ink-soft)', width: 38, textAlign: 'right' }}>{Math.round((b.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusBar({ buckets }) {
  const rows = useMemo(() => buckets.map((b) => ({ ...b, name: prettyStatus(b.label) })), [buckets])
  if (!rows.length) return <EmptyNote>No assessments yet.</EmptyNote>
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 34 + 20)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: 'var(--ink)' }} />
        <RTooltip cursor={{ fill: 'color-mix(in oklab, var(--euc-deep) 6%, transparent)' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 12 }} />
        <Bar dataKey="count" name="Assessments" fill="var(--euc-deep)" radius={[0, 6, 6, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Recenters/zooms the map to fit all plotted points whenever they change.
function FitBounds({ points }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const latlngs = points.map((p) => [p.lat, p.lng])
    map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 13 })
  }, [points, map])
  return null
}

function PropertyMap({ points }) {
  const valid = points.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <MapContainer center={NSW_CENTER} zoom={6} scrollWheelZoom={false} style={{ height: 360, width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {valid.map((p, i) => (
          <CircleMarker
            key={i}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: balColor(p.rating), fillOpacity: 0.9 }}
          >
            <LTooltip>
              <div style={{ fontSize: 12 }}>
                <strong>{p.rating || 'Unrated'}</strong>
                {p.address ? <div>{p.address}</div> : null}
                {p.status ? <div style={{ color: '#666' }}>{prettyStatus(p.status)}</div> : null}
              </div>
            </LTooltip>
          </CircleMarker>
        ))}
        <FitBounds points={valid} />
      </MapContainer>
      {!valid.length && <div style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--ink-soft)' }}>No geocoded assessments to plot yet.</div>}
    </div>
  )
}

function AssessorBlock({ statusBuckets, stateBuckets }) {
  const statusColors = {
    APPROVED: '#5b8c3e',
    PENDING: 'var(--ochre)',
    REJECTED: '#b3402c',
    SUSPENDED: '#cc6b2c',
    INACTIVE: '#9b9483',
  }
  const total = statusBuckets.reduce((s, b) => s + b.count, 0)
  if (!total) return <EmptyNote>No assessor profiles yet.</EmptyNote>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {statusBuckets.map((b) => (
          <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{ width: 90, color: 'var(--ink-soft)' }}>{prettyStatus(b.label)}</span>
            <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'color-mix(in oklab, var(--ink) 8%, transparent)', overflow: 'hidden' }}>
              <div style={{ width: `${(b.count / total) * 100}%`, height: '100%', background: statusColors[b.label] || 'var(--euc-deep)' }} />
            </div>
            <strong style={{ width: 28, textAlign: 'right' }}>{b.count}</strong>
          </div>
        ))}
      </div>
      {stateBuckets.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 6 }}>Operating states</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stateBuckets.map((b) => (
              <span key={b.label} className="a-pill" style={{ background: 'color-mix(in oklab, var(--euc-deep) 10%, var(--card))', color: 'var(--euc-deep)' }}>
                {b.label} · {b.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const ACTION_META = {
  approve: { icon: '✓', color: '#5b8c3e', verb: 'approved' },
  reactivate: { icon: '↻', color: '#5b8c3e', verb: 'reactivated' },
  reject: { icon: '✕', color: '#b3402c', verb: 'rejected' },
  suspend: { icon: '⏸', color: '#cc6b2c', verb: 'suspended' },
  deactivate: { icon: '○', color: '#9b9483', verb: 'deactivated' },
  request_info: { icon: '?', color: 'var(--ochre)', verb: 'requested info from' },
}

function ActivityFeed({ items }) {
  if (!items.length) return <EmptyNote>No admin actions recorded yet.</EmptyNote>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, i) => {
        const meta = ACTION_META[it.action] || { icon: '•', color: 'var(--ink-soft)', verb: it.action }
        return (
          <li key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', background: meta.color }}>{meta.icon}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                <strong>{it.admin_email || 'An admin'}</strong> {meta.verb} <strong>{it.target_email || 'an applicant'}</strong>
              </div>
              {it.reason && <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>“{it.reason}”</div>}
              <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{timeAgo(it.timestamp)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
