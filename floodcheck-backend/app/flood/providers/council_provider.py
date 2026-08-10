"""What FloodCheck needs to know about one council to assess an address there."""

from dataclasses import dataclass, field

from app.flood.providers.flood_data_source import FloodDataSource
from app.flood.providers.map_presentation import MapPresentation
from app.geography import GeographicBounds

# Freeboard is the safety margin a council adds above the design flood level to
# set a minimum habitable floor level. It differs by council, so it belongs to the
# provider rather than to the assessment maths.
DEFAULT_FREEBOARD_METRES = 0.5


@dataclass(frozen=True)
class CouncilProvider:
    """A council whose flood study FloodCheck can read and assess."""

    name: str
    state: str
    coverage: GeographicBounds
    flood_data_source: FloodDataSource

    # Short, stable machine id used in URLs, dataset paths and by the frontend.
    council_id: str

    # Shown to the user so every number is traceable to its publisher.
    attribution: str
    source_url: str

    # The safety margin to add above the design flood level to obtain the flood
    # planning level. Set to None where the council publishes its own flood
    # planning level, in which case that published value is used as-is and no
    # freeboard is assumed.
    freeboard_metres: float | None = DEFAULT_FREEBOARD_METRES

    # Caveats specific to this council's data, surfaced with the result. Use these
    # for limitations a reader must know about, such as partial coverage.
    data_notes: tuple[str, ...] = field(default_factory=tuple)

    # How the frontend should draw this council. Absent where a council is
    # assessable by address but has no precomputed map data yet.
    map_presentation: MapPresentation | None = None

    def covers(self, latitude: float, longitude: float) -> bool:
        return self.coverage.contains(latitude, longitude)

    def identifier(self) -> str:
        return self.council_id
