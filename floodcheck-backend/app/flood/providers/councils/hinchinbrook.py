"""Hinchinbrook Shire Council (QLD).

Flood Alert Public Model Layers: one layer per flood event over the same 4,487
parcels around Ingham, every level populated. The same shape as Bellingen, so it
needs no special handling.

Field naming: "Q100YH" is the 100 year flood HEIGHT in mAHD, and "Q100YI" is the
council's own inundation depth, computed against surveyed floor levels. Where the
council has done that arithmetic itself it is better than anything derived from a
terrain model, so it is carried through to the report.
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

COUNCIL_ID = "hinchinbrook"
COUNCIL_NAME = "Hinchinbrook Shire Council"

FEATURE_SERVER_URL = (
    "https://services-ap1.arcgis.com/NjDnGlEZKSqtp6VA/arcgis/rest/services/"
    "Flood_Alert_Public_Model_Layers/FeatureServer"
)

# Average recurrence intervals map onto annual exceedance probabilities:
# 20 year ARI is the 5% AEP, and 100 year ARI is treated as the 1% AEP design flood.
LAYER_MAPPINGS = (
    LayerFieldMapping(0, {"Q5YH": FloodValueKeys.LEVEL_5_YEAR_ARI}),
    LayerFieldMapping(1, {"Q10YH": FloodValueKeys.LEVEL_10_PERCENT_AEP}),
    LayerFieldMapping(2, {"Q20YH": FloodValueKeys.LEVEL_5_PERCENT_AEP}),
    LayerFieldMapping(3, {"Q50YH": FloodValueKeys.LEVEL_2_PERCENT_AEP}),
    LayerFieldMapping(
        4,
        {
            "Q100YH": FloodValueKeys.LEVEL_1_PERCENT_AEP,
            "Q100YI": FloodValueKeys.INUNDATION_OVER_FLOOR,
        },
    ),
)

MAP_PRESENTATION = MapPresentation(
    short_label="Hinchinbrook Shire QLD",
    view=MapView(centre_longitude=146.163, centre_latitude=-18.652, zoom=15.2),
    datasets=MapDatasets(
        buildings_url=f"/councils/{COUNCIL_ID}/buildings.geojson",
        delivery_mode=DeliveryModes.SINGLE_FILE,
        boundary_url=f"/councils/{COUNCIL_ID}/boundary.geojson",
        # The council publishes flood levels per land parcel, with no flood extent
        # polygons. The precompute joins OpenStreetMap building
        # footprints to those parcels, so what is drawn here is real buildings
        # carrying their parcel's flood levels.
        feature_label="Buildings",
        geometry_kind=GeometryKinds.BUILDING_FOOTPRINT,
    ),
    events=(
        FloodEventOption(FloodValueKeys.LEVEL_5_YEAR_ARI, "5 yr (ARI)"),
        FloodEventOption(FloodValueKeys.LEVEL_10_PERCENT_AEP, "10 yr (10% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_5_PERCENT_AEP, "20 yr (5% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_2_PERCENT_AEP, "50 yr (2% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "100 yr (1% AEP)"),
    ),
    attribution_note=(
        "Footprints © OpenStreetMap · flood levels from the Hinchinbrook Shire "
        "Flood Alert public model, applied from each building's parcel · ground "
        "from the Queensland DEM."
    ),
)

PROVIDER = CouncilProvider(
    council_id=COUNCIL_ID,
    name=COUNCIL_NAME,
    state="QLD",
    coverage=GeographicBounds(
        minimum_latitude=-18.90,
        maximum_latitude=-18.35,
        minimum_longitude=145.90,
        maximum_longitude=146.45,
    ),
    flood_data_source=ArcGisFloodSource(
        council_name=COUNCIL_NAME,
        feature_server_url=FEATURE_SERVER_URL,
        layer_mappings=LAYER_MAPPINGS,
    ),
    attribution=(
        "Hinchinbrook Shire Council - Flood Alert Public Model Layers "
        "(live ArcGIS FeatureServer)"
    ),
    source_url=FEATURE_SERVER_URL,
    freeboard_metres=0.5,
    data_notes=(
        "Covers mapped parcels in the Ingham urban area, not the whole shire.",
        "This study publishes no probable maximum flood level.",
    ),
    map_presentation=MAP_PRESENTATION,
)
