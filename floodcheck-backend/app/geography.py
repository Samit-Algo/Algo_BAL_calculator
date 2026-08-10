"""Shared geographic primitives.

Several parts of FloodCheck need to answer "does this coordinate fall inside a
known area?" — a council's flood study, a state's elevation model, a statewide
planning layer. They all use this one type rather than each inventing its own
bounding-box check.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class GeographicBounds:
    """An axis-aligned latitude/longitude box in WGS84 (EPSG:4326)."""

    minimum_latitude: float
    maximum_latitude: float
    minimum_longitude: float
    maximum_longitude: float

    def contains(self, latitude: float, longitude: float) -> bool:
        return (
            self.minimum_latitude <= latitude <= self.maximum_latitude
            and self.minimum_longitude <= longitude <= self.maximum_longitude
        )
