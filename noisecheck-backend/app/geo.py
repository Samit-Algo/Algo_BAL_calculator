# Small geometry helpers. Deliberately dependency-free — the demo does not pull in
# shapely/geopandas just to answer "is this point inside that contour".

import math

EARTH_RADIUS_METRES = 6_371_000


def haversine_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two WGS84 points, in metres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_METRES * math.asin(math.sqrt(a))


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Standard ray-casting test. `ring` is [[lon, lat], ...]."""
    inside = False
    count = len(ring)
    for i in range(count):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % count]
        # Does the horizontal ray at `lat` cross this edge?
        if (y1 > lat) != (y2 > lat):
            x_at_lat = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_at_lat:
                inside = not inside
    return inside


def point_in_polygon(lon: float, lat: float, rings: list[list[list[float]]]) -> bool:
    """
    GeoJSON Polygon test: inside the outer ring and outside every hole.
    `rings[0]` is the outer boundary; `rings[1:]` are holes.
    """
    if not rings or not point_in_ring(lon, lat, rings[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in rings[1:])


def distance_to_segment_metres(
    lat: float, lon: float, lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """
    Shortest distance from a point to a line segment, in metres.

    Works in a local flat-earth projection around the point. Over the few hundred
    metres this demo cares about, the error is negligible.
    """
    # Metres per degree at this latitude.
    metres_per_deg_lat = 111_320.0
    metres_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))

    px, py = 0.0, 0.0
    ax = (lon1 - lon) * metres_per_deg_lon
    ay = (lat1 - lat) * metres_per_deg_lat
    bx = (lon2 - lon) * metres_per_deg_lon
    by = (lat2 - lat) * metres_per_deg_lat

    dx, dy = bx - ax, by - ay
    segment_length_squared = dx * dx + dy * dy
    if segment_length_squared == 0:
        return math.hypot(ax - px, ay - py)

    # Project the point onto the segment, clamped to its ends.
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / segment_length_squared))
    closest_x, closest_y = ax + t * dx, ay + t * dy
    return math.hypot(closest_x - px, closest_y - py)


def decibel_sum(levels: list[float]) -> float:
    """
    Combine sound pressure levels by energy, not arithmetic.

    Two 60 dB sources make 63 dB, not 120 dB.
    """
    if not levels:
        return 0.0
    return 10 * math.log10(sum(10 ** (level / 10) for level in levels))
