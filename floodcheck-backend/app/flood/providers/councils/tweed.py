"""Tweed Shire Council (NSW).

FloodStudyAdopted2025, published as a public ArcGIS feature server. The richest
council flood data currently registered: the defined flood event, the flood
planning level and the probable maximum flood are all published as levels in
mAHD, alongside the hydraulic category.

Two things distinguish it from the other councils here.

The council publishes its own **flood planning level** as a surface, so no
freeboard is assumed. `freeboard_metres` is None, which tells the assessment to
take the published value rather than adding a margin to the design flood level.
Tweed's own freeboard happens to be 0.5 m, but that is the council's decision to
state, not this codebase's to infer.

The polygons are **contour bands**, so each carries a `MIN_LEVEL` and a
`MAX_LEVEL` bracketing a range rather than one value per property. `MAX_LEVEL` is
used throughout, which is the conservative reading — it never understates a flood
level, in keeping with never reporting a false low.
"""

from app.flood.flood_values import FloodValueKeys
from app.flood.providers.arcgis_flood_source import ArcGisFloodSource, LayerFieldMapping
from app.flood.providers.council_provider import CouncilProvider
from app.flood.providers.map_presentation import (
    DeliveryModes,
    FloodEventOption,
    GeometryKinds,
    MapDatasets,
    MapPresentation,
    MapView,
)
from app.geography import GeographicBounds

COUNCIL_ID = "tweed"
COUNCIL_NAME = "Tweed Shire Council"

FEATURE_SERVER_URL = (
    "https://services1.arcgis.com/KURAxOhGWn5RdCPg/arcgis/rest/services/"
    "FloodStudyAdopted2025/FeatureServer"
)

# Layer ids and field names verified against the live feature server.
LAYER_MAPPINGS = (
    LayerFieldMapping(14, {"MAX_LEVEL": FloodValueKeys.LEVEL_1_PERCENT_AEP}),
    LayerFieldMapping(59, {"MAX_LEVEL": FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA}),
    LayerFieldMapping(1, {"Value": FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD}),
    LayerFieldMapping(22, {"HAZCAT": FloodValueKeys.HYDRAULIC_CATEGORY_1_PERCENT_AEP}),
)

MAP_PRESENTATION = MapPresentation(
    short_label="Tweed Shire NSW",
    view=MapView(centre_longitude=153.392, centre_latitude=-28.328, zoom=14.6),
    datasets=MapDatasets(
        buildings_url=f"/councils/{COUNCIL_ID}/buildings.geojson",
        delivery_mode=DeliveryModes.SINGLE_FILE,
        boundary_url=f"/councils/{COUNCIL_ID}/boundary.geojson",
        feature_label="Buildings",
        geometry_kind=GeometryKinds.BUILDING_FOOTPRINT,
    ),
    # Only real flood events colour the map. The flood planning level is a
    # planning threshold rather than an event, so it appears in the detail table
    # alongside them but is not offered as a map colouring.
    events=(
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "Defined flood event (1% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD, "PMF (extreme)"),
    ),
    detail_events=(
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "Defined flood event (1% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA, "Flood planning level"),
        FloodEventOption(FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD, "PMF (extreme)"),
    ),
    attribution_note=(
        "Footprints © OpenStreetMap · flood levels and hydraulic category from the "
        "Tweed Shire Council adopted flood study · ground from the NSW 5 m DEM."
    ),
)

PROVIDER = CouncilProvider(
    council_id=COUNCIL_ID,
    name=COUNCIL_NAME,
    state="NSW",
    coverage=GeographicBounds(
        minimum_latitude=-28.62,
        maximum_latitude=-28.15,
        minimum_longitude=153.17,
        maximum_longitude=153.60,
    ),
    flood_data_source=ArcGisFloodSource(
        council_name=COUNCIL_NAME,
        feature_server_url=FEATURE_SERVER_URL,
        layer_mappings=LAYER_MAPPINGS,
    ),
    attribution=(
        "Tweed Shire Council - FloodStudyAdopted2025 (live ArcGIS FeatureServer)"
    ),
    source_url=FEATURE_SERVER_URL,
    # The council publishes its flood planning level, so none is derived.
    freeboard_metres=None,
    data_notes=(
        "Flood levels come from the Tweed Valley Flood Study Update and Expansion "
        "2024 and the Tweed-Byron Coastal Creeks Flood Study 2009.",
        "Levels are published as contour bands; the upper bound of the band is "
        "reported, which never understates the flood level.",
        "This study publishes no 5% or 20% AEP event.",
    ),
    map_presentation=MAP_PRESENTATION,
)
