"""How a council's flood data is drawn on the map.

The frontend holds no council knowledge of its own. It asks the API which councils
exist and renders whatever they declare here: where to look, which datasets to
load, how those datasets are delivered, and which flood events to offer.

Keeping this beside the provider means registering a council remains a single
backend change, with no matching edit in the frontend.
"""

from dataclasses import dataclass, field

# How a council's building dataset is delivered to the browser. Both modes serve
# static files precomputed into the frontend's public directory, so neither adds a
# runtime dependency on the council's own servers.
class GeometryKinds:
    """What a council's polygons represent on the ground.

    This drives whether 3D extrusion is meaningful. Building footprints sit apart
    from one another and read correctly as blocks. Land parcels tile the ground
    with shared boundaries, so extruding them merges neighbours into one mass.
    """

    BUILDING_FOOTPRINT = "building_footprint"
    LAND_PARCEL = "land_parcel"


class DeliveryModes:
    # One GeoJSON file, fetched once. Suitable up to roughly 20,000 features.
    SINGLE_FILE = "single"

    # A grid of GeoJSON chunks plus an index, loaded as the viewport moves. Used
    # where a single file would be too large to transfer, parse and render.
    CHUNKED = "chunked"


@dataclass(frozen=True)
class FloodEventOption:
    """A flood event the map can be coloured by."""

    # A canonical key from FloodValueKeys, so map and API share one vocabulary.
    key: str
    label: str


@dataclass(frozen=True)
class MapView:
    """Where the map should sit when a council is selected."""

    centre_longitude: float
    centre_latitude: float
    zoom: float
    pitch: float = 58.0
    bearing: float = -22.0


@dataclass(frozen=True)
class MapDatasets:
    """Static assets for a council, relative to the frontend's public directory.

    `buildings_url` points at a GeoJSON file in single mode, or at a chunk index
    in chunked mode. The optional layers are omitted where a council publishes no
    such data — Gold Coast, for example, publishes no flood extent polygons.
    """

    buildings_url: str
    delivery_mode: str = DeliveryModes.SINGLE_FILE
    boundary_url: str | None = None
    flood_extent_url: str | None = None

    # What the features represent, for honest labelling in the legend.
    feature_label: str = "Buildings"

    # What the polygons actually are. This is a fact about the data, not a display
    # preference: only building footprints can meaningfully be extruded into 3D.
    # Land parcels tile the ground, so extruding them produces continuous blocks
    # rather than separate buildings, and they are always drawn flat.
    geometry_kind: str = GeometryKinds.BUILDING_FOOTPRINT


@dataclass(frozen=True)
class MapPresentation:
    """Everything the frontend needs to draw one council."""

    view: MapView
    datasets: MapDatasets
    events: tuple[FloodEventOption, ...]

    # Shown in the header and legend.
    short_label: str

    # Credit line for the data behind the map.
    attribution_note: str = ""

    # Events shown in the per-event depth table, if different from `events`.
    detail_events: tuple[FloodEventOption, ...] = field(default_factory=tuple)

    def detail_event_options(self) -> tuple[FloodEventOption, ...]:
        return self.detail_events or self.events

    def to_dict(self) -> dict:
        return {
            "short_label": self.short_label,
            "attribution_note": self.attribution_note,
            "view": {
                "center": [self.view.centre_longitude, self.view.centre_latitude],
                "zoom": self.view.zoom,
                "pitch": self.view.pitch,
                "bearing": self.view.bearing,
            },
            "datasets": {
                "buildings_url": self.datasets.buildings_url,
                "delivery_mode": self.datasets.delivery_mode,
                "boundary_url": self.datasets.boundary_url,
                "flood_extent_url": self.datasets.flood_extent_url,
                "feature_label": self.datasets.feature_label,
                "geometry_kind": self.datasets.geometry_kind,
                "supports_3d": self.datasets.geometry_kind == GeometryKinds.BUILDING_FOOTPRINT,
            },
            "events": [{"key": e.key, "label": e.label} for e in self.events],
            "detail_events": [
                {"key": e.key, "label": e.label} for e in self.detail_event_options()
            ],
        }
