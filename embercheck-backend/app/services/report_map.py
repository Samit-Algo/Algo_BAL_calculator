# Static aerial site map for the BAL report (Figure 1).
#
# Builds a single aerial figure from the case's stored boundary geometry — the
# SAME geometry the Console's Leaflet map draws (Esri World Imagery basemap,
# key-free) — by stitching the Web-Mercator tiles that cover the site + its 100 m
# assessment buffer and drawing the boundary, buffer ring, distance line and
# photo/property points on top with Pillow. Returns a base64 PNG data URI so the
# report HTML stays self-contained (preview iframe AND the eventual PDF render it
# with no auth round-trip, nothing to drift).
#
# Network-tolerant by design: any failure (offline, tile timeout, missing
# geometry) returns None and the template falls back to its Figure 1 placeholder,
# so the report is never blocked on the basemap.

from __future__ import annotations

import base64
import math
from io import BytesIO

import httpx
from PIL import Image, ImageDraw

TILE_SIZE = 256
# Esri World Imagery — the same provider the Console map uses (attribution shown).
_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
_TARGET_W, _TARGET_H = 760, 520
_MAX_ZOOM = 19

# Ember palette overlays (RGBA).
_SITE = (220, 70, 50, 255)        # subject boundary — red
_BUFFER = (62, 180, 220, 235)     # 100 m assessment buffer — cyan
_DISTANCE = (242, 200, 60, 255)   # governing distance line — amber
_VEG = (120, 190, 90, 90)         # vegetation polygons — translucent green
_POINT = (255, 255, 255, 255)


def _lonlat_to_pixel(lon: float, lat: float, z: int) -> tuple[float, float]:
    """Web-Mercator lon/lat → global pixel coords at zoom z."""
    n = TILE_SIZE * (2 ** z)
    x = (lon + 180.0) / 360.0 * n
    siny = math.sin(math.radians(lat))
    siny = min(max(siny, -0.9999), 0.9999)
    y = (0.5 - math.log((1 + siny) / (1 - siny)) / (4 * math.pi)) * n
    return x, y


def _collect_points(geometry: dict) -> list[tuple[float, float]]:
    """The SUBJECT points used to frame the figure — the site boundary, the
    governing distance line and the property point. Vegetation polygons are
    deliberately excluded: they can sprawl far beyond the site and would force the
    figure to zoom right out. The 100 m assessment buffer (added in _render) keeps
    the frame tight on the property."""
    pts: list[tuple[float, float]] = []

    def add_ring(coords):
        for c in coords:
            if isinstance(c, (list, tuple)) and len(c) >= 2 and isinstance(c[0], (int, float)):
                pts.append((c[0], c[1]))
            elif isinstance(c, (list, tuple)):
                add_ring(c)

    poly = geometry.get("site_polygon") or {}
    add_ring(poly.get("coordinates") or [])
    line = geometry.get("distance_line") or {}
    add_ring(line.get("coordinates") or [])
    pp = geometry.get("property_point") or {}
    if pp.get("coordinates"):
        pts.append((pp["coordinates"][0], pp["coordinates"][1]))
    return pts


def _meters_to_deg(meters: float, lat: float) -> tuple[float, float]:
    dlat = meters / 111_320.0
    dlon = meters / (111_320.0 * max(math.cos(math.radians(lat)), 1e-6))
    return dlon, dlat


def _ring_pixels(coords, off_x, off_y, z):
    out = []
    for c in coords:
        px, py = _lonlat_to_pixel(c[0], c[1], z)
        out.append((px - off_x, py - off_y))
    return out


def render_site_map(geometry: dict | None, *, timeout: float = 6.0) -> str | None:
    """Stitch the aerial basemap for `geometry` and overlay the site boundary,
    100 m buffer, distance line and points. Returns a PNG data URI, or None on
    any failure (the report then shows its Figure 1 placeholder)."""
    if not geometry:
        return None
    try:
        return _render(geometry, timeout)
    except Exception:
        return None


def _render(geometry: dict, timeout: float) -> str | None:
    pts = _collect_points(geometry)
    pp = (geometry.get("property_point") or {}).get("coordinates")
    if not pts and not pp:
        return None
    center_lon, center_lat = (pp[0], pp[1]) if pp else (
        sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    )

    # Frame tight on the property: the 100 m assessment buffer plus a small
    # margin, and the subject points (boundary / distance line). Vegetation is not
    # included in the frame, so the figure stays zoomed in on the site rather than
    # the whole neighbourhood.
    buffer_m = float(geometry.get("assessment_ring_m") or 100) * 1.12
    dlon, dlat = _meters_to_deg(buffer_m, center_lat)
    lons = [center_lon - dlon, center_lon + dlon] + [p[0] for p in pts]
    lats = [center_lat - dlat, center_lat + dlat] + [p[1] for p in pts]
    min_lon, max_lon, min_lat, max_lat = min(lons), max(lons), min(lats), max(lats)

    # Largest zoom at which the framed bbox still fits the target canvas.
    z = _MAX_ZOOM
    while z > 1:
        x0, y1 = _lonlat_to_pixel(min_lon, max_lat, z)  # top-left
        x1, y0 = _lonlat_to_pixel(max_lon, min_lat, z)  # bottom-right
        if (x1 - x0) <= _TARGET_W and (y0 - y1) <= _TARGET_H:
            break
        z -= 1

    tl_x, tl_y = _lonlat_to_pixel(min_lon, max_lat, z)
    br_x, br_y = _lonlat_to_pixel(max_lon, min_lat, z)
    # Centre the bbox in the target canvas.
    off_x = (tl_x + br_x) / 2 - _TARGET_W / 2
    off_y = (tl_y + br_y) / 2 - _TARGET_H / 2

    canvas = Image.new("RGBA", (_TARGET_W, _TARGET_H), (32, 34, 28, 255))
    tx0, tx1 = int(off_x // TILE_SIZE), int((off_x + _TARGET_W) // TILE_SIZE)
    ty0, ty1 = int(off_y // TILE_SIZE), int((off_y + _TARGET_H) // TILE_SIZE)
    n_tiles = 2 ** z

    fetched = 0
    with httpx.Client(timeout=timeout, headers={"User-Agent": "EmberCheck/1.0"}) as client:
        for tx in range(tx0, tx1 + 1):
            for ty in range(ty0, ty1 + 1):
                if not (0 <= ty < n_tiles):
                    continue
                url = _TILE_URL.format(z=z, x=tx % n_tiles, y=ty)
                r = client.get(url)
                if r.status_code != 200:
                    continue
                tile = Image.open(BytesIO(r.content)).convert("RGBA")
                canvas.paste(tile, (int(tx * TILE_SIZE - off_x), int(ty * TILE_SIZE - off_y)))
                fetched += 1
    if fetched == 0:
        return None

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 100 m assessment buffer (circle around the property point).
    if pp:
        cx, cy = _lonlat_to_pixel(pp[0], pp[1], z)
        cx, cy = cx - off_x, cy - off_y
        edge_x, _ = _lonlat_to_pixel(pp[0] + _meters_to_deg(100, pp[1])[0], pp[1], z)
        r_px = abs(edge_x - off_x - cx)
        draw.ellipse([cx - r_px, cy - r_px, cx + r_px, cy + r_px], outline=_BUFFER, width=2)

    # Vegetation polygons (translucent green fill).
    for f in (geometry.get("vegetation") or {}).get("features", []):
        g = f.get("geometry") or {}
        if g.get("type") == "Polygon":
            for ring in g.get("coordinates") or []:
                px = _ring_pixels(ring, off_x, off_y, z)
                if len(px) >= 3:
                    draw.polygon(px, fill=_VEG)

    # Subject boundary (red, thick).
    poly = geometry.get("site_polygon") or {}
    for ring in poly.get("coordinates") or []:
        px = _ring_pixels(ring, off_x, off_y, z)
        if len(px) >= 2:
            draw.line(px + [px[0]], fill=_SITE, width=4)

    # Governing distance line (amber).
    line = geometry.get("distance_line") or {}
    if line.get("coordinates"):
        px = _ring_pixels(line["coordinates"], off_x, off_y, z)
        if len(px) >= 2:
            draw.line(px, fill=_DISTANCE, width=3)

    # Property point marker.
    if pp:
        cx, cy = _lonlat_to_pixel(pp[0], pp[1], z)
        cx, cy = cx - off_x, cy - off_y
        draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=_POINT, outline=_SITE, width=2)

    out = Image.alpha_composite(canvas, overlay).convert("RGB")
    buf = BytesIO()
    out.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
