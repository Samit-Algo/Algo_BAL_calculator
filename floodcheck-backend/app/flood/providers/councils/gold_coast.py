"""City of Gold Coast (QLD).

Designated Flood Level for Residential Buildings: 298,410 building polygons, each
carrying the council's own ground level, and — where council has modelled it — the
designated flood level.

Two things about this dataset shape the mapping below.

Designated flood level is the defined flood event (1% AEP) level in mAHD and does
NOT include freeboard; council adds 300 mm on top to set a minimum habitable floor
level. So it maps to the design flood level key, and the freeboard here is 0.3 m
rather than the 0.5 m used elsewhere.

The council publishes its own surveyed ground level, which is preferred over the
terrain model. A query therefore succeeds for Gold Coast even if no elevation model
covers the point.
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

COUNCIL_ID = "gold-coast"
COUNCIL_NAME = "City of Gold Coast"

FEATURE_SERVER_URL = (
    "https://services.arcgis.com/3vStCH7NDoBOZ5zn/arcgis/rest/services/"
    "Designated_Flood_Level_for_Residential_Buildings/FeatureServer"
)

BUILDING_LAYER_ID = 0

# One layer carries every field, so a single query answers the whole request.
LAYER_MAPPINGS = (
    LayerFieldMapping(
        BUILDING_LAYER_ID,
        {
            "FLOODLVLDES": FloodValueKeys.LEVEL_1_PERCENT_AEP,
            "GROUNDCENTRE": FloodValueKeys.GROUND_LEVEL,
            "SURVEYFLOOR": FloodValueKeys.FLOOR_LEVEL,
        },
    ),
)

# Council applies 300 mm freeboard to residential development, not the 500 mm used
# by the New South Wales councils registered here.
RESIDENTIAL_FREEBOARD_METRES = 0.3

# 298,410 buildings is far too many to transfer, parse or render as one file, so
# this council's data is precomputed into a grid of local chunks and loaded as the
# viewport moves. The chunks are still static local assets, so the map has no
# runtime dependency on the council's servers.
MAP_PRESENTATION = MapPresentation(
    short_label="City of Gold Coast QLD",
    view=MapView(centre_longitude=153.412, centre_latitude=-28.020, zoom=14.6),
    datasets=MapDatasets(
        buildings_url=f"/councils/{COUNCIL_ID}/index.json",
        delivery_mode=DeliveryModes.CHUNKED,
        boundary_url=f"/councils/{COUNCIL_ID}/boundary.geojson",
        # Despite the dataset's name, the polygons are cadastral property lots,
        # not building outlines: they tile the ground and average ~3,700 m². They
        # are therefore drawn flat, since extruding them would merge neighbouring
        # lots into one continuous block. OpenStreetMap has footprints for only
        # about 7% of these properties, so it cannot supply real outlines either.
        feature_label="Properties",
        geometry_kind=GeometryKinds.LAND_PARCEL,
    ),
    events=(
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "Designated flood level"),
    ),
    attribution_note=(
        "Building footprints, ground level and designated flood level from the "
        "City of Gold Coast open data."
    ),
)

PROVIDER = CouncilProvider(
    council_id=COUNCIL_ID,
    name=COUNCIL_NAME,
    state="QLD",
    coverage=GeographicBounds(
        minimum_latitude=-28.20,
        maximum_latitude=-27.70,
        minimum_longitude=153.15,
        maximum_longitude=153.55,
    ),
    flood_data_source=ArcGisFloodSource(
        council_name=COUNCIL_NAME,
        feature_server_url=FEATURE_SERVER_URL,
        layer_mappings=LAYER_MAPPINGS,
    ),
    attribution=(
        "City of Gold Coast - Designated Flood Level for Residential Buildings "
        "(live ArcGIS FeatureServer)"
    ),
    source_url=FEATURE_SERVER_URL,
    freeboard_metres=RESIDENTIAL_FREEBOARD_METRES,
    data_notes=(
        "Residential buildings only.",
        "A designated flood level is published for about 23% of buildings; the rest "
        "carry a ground level but no modelled flood level.",
        "Indicative only - engage a licensed surveyor for an accurate floor level.",
    ),
    map_presentation=MAP_PRESENTATION,
)
