"""Bellingen Shire Council (NSW).

Lower Bellinger and Kalang Rivers Floodplain Risk Management Study, published as a
public ArcGIS feature server with one layer per flood event. The richest event
coverage of any council currently registered: five events plus hydraulic category.
"""

from app.flood.flood_values import FloodValueKeys
from app.flood.providers.arcgis_flood_source import ArcGisFloodSource, LayerFieldMapping
from app.flood.providers.council_provider import CouncilProvider
from app.flood.providers.map_presentation import (
    DeliveryModes,
    FloodEventOption,
    MapDatasets,
    MapPresentation,
    MapView,
)
from app.geography import GeographicBounds

COUNCIL_ID = "bellingen"
COUNCIL_NAME = "Bellingen Shire Council"

FEATURE_SERVER_URL = (
    "https://services7.arcgis.com/kkiBaYsUIhK1wEpz/arcgis/rest/services/"
    "Lower_Bellinger_and_Kalang_Rivers_Floodplain_Risk_Management_Study/FeatureServer"
)

# Layer ids and field names verified against the live feature server.
LAYER_MAPPINGS = (
    LayerFieldMapping(2, {"Level_5ARI": FloodValueKeys.LEVEL_5_YEAR_ARI}),
    LayerFieldMapping(3, {"Level_5AEP": FloodValueKeys.LEVEL_5_PERCENT_AEP}),
    LayerFieldMapping(4, {"Level_1AEP": FloodValueKeys.LEVEL_1_PERCENT_AEP}),
    LayerFieldMapping(6, {"Level_FPA": FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA}),
    LayerFieldMapping(7, {"Level_PMF": FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD}),
    LayerFieldMapping(
        5, {"Hydraulic_Category": FloodValueKeys.HYDRAULIC_CATEGORY_1_PERCENT_AEP}
    ),
)

MAP_PRESENTATION = MapPresentation(
    short_label="Bellingen Shire NSW",
    view=MapView(centre_longitude=153.015, centre_latitude=-30.492, zoom=15.4),
    datasets=MapDatasets(
        buildings_url=f"/councils/{COUNCIL_ID}/buildings.geojson",
        delivery_mode=DeliveryModes.SINGLE_FILE,
        boundary_url=f"/councils/{COUNCIL_ID}/boundary.geojson",
        flood_extent_url=f"/councils/{COUNCIL_ID}/flood_extent.geojson",
        feature_label="Buildings",
    ),
    events=(
        FloodEventOption(FloodValueKeys.LEVEL_5_YEAR_ARI, "5 yr (ARI)"),
        FloodEventOption(FloodValueKeys.LEVEL_5_PERCENT_AEP, "20 yr (5% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "100 yr (1% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD, "PMF (extreme)"),
    ),
    detail_events=(
        FloodEventOption(FloodValueKeys.LEVEL_5_YEAR_ARI, "5 Year (ARI)"),
        FloodEventOption(FloodValueKeys.LEVEL_5_PERCENT_AEP, "20 Year (5% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_1_PERCENT_AEP, "100 Year (1% AEP)"),
        FloodEventOption(FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA, "Flood Planning Area"),
        FloodEventOption(FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD, "PMF (extreme)"),
    ),
    attribution_note=(
        "Footprints © OpenStreetMap · ground from the NSW 5 m DEM · flood levels "
        "from the Bellingen Shire flood study."
    ),
)

PROVIDER = CouncilProvider(
    council_id=COUNCIL_ID,
    name=COUNCIL_NAME,
    state="NSW",
    coverage=GeographicBounds(
        minimum_latitude=-30.75,
        maximum_latitude=-30.15,
        minimum_longitude=152.50,
        maximum_longitude=153.12,
    ),
    flood_data_source=ArcGisFloodSource(
        council_name=COUNCIL_NAME,
        feature_server_url=FEATURE_SERVER_URL,
        layer_mappings=LAYER_MAPPINGS,
    ),
    attribution=(
        "Bellingen Shire Council - Lower Bellinger and Kalang Rivers Floodplain "
        "Risk Management Study (live ArcGIS FeatureServer)"
    ),
    source_url=FEATURE_SERVER_URL,
    freeboard_metres=0.5,
    data_notes=(
        "Covers the Lower Bellinger and Kalang floodplain only, not the whole shire.",
    ),
    map_presentation=MAP_PRESENTATION,
)
