"""Reads flood measurements from an ArcGIS feature server.

Councils publish flood data in two shapes:

  * one layer per flood event, each carrying a single level field
    (Bellingen, Hinchinbrook)
  * one layer carrying several fields at once
    (Gold Coast)

Both are the same thing viewed differently: a set of layers, each contributing one
or more fields. Describing a council that way lets a single implementation serve
both, so there is no per-shape class to keep in step.
"""

import asyncio
from dataclasses import dataclass
from typing import Mapping

import httpx

from app.flood.flood_values import FloodValueKeys, coerce_measurement
from app.flood.providers.flood_data_source import FloodDataSource, FloodReading
from app.services.arcgis_feature_service import (
    DEFAULT_TIMEOUT_SECONDS,
    query_point_attributes,
)


@dataclass(frozen=True)
class LayerFieldMapping:
    """One layer of a feature server, and the fields to read from it.

    `field_to_canonical_key` maps the council's own field name to a key from
    FloodValueKeys, which is the only vocabulary the rest of the app knows.
    """

    layer_id: int
    field_to_canonical_key: Mapping[str, str]

    def output_fields(self) -> str:
        return ",".join(self.field_to_canonical_key)


class ArcGisFloodSource(FloodDataSource):
    """Point-queries a council's ArcGIS feature server and returns canonical values."""

    def __init__(
        self,
        council_name: str,
        feature_server_url: str,
        layer_mappings: tuple[LayerFieldMapping, ...],
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self.council_name = council_name
        self.feature_server_url = feature_server_url.rstrip("/")
        self.layer_mappings = layer_mappings
        self.timeout_seconds = timeout_seconds

    def canonical_keys(self) -> tuple[str, ...]:
        """Every key this council can produce, whether or not it has a value here."""
        return tuple(
            canonical_key
            for mapping in self.layer_mappings
            for canonical_key in mapping.field_to_canonical_key.values()
        )

    async def read(self, latitude: float, longitude: float) -> FloodReading:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            layer_attributes = await asyncio.gather(
                *(
                    self.read_layer(client, mapping, latitude, longitude)
                    for mapping in self.layer_mappings
                )
            )
        return self.build_reading(layer_attributes)

    async def read_layer(
        self,
        client: httpx.AsyncClient,
        mapping: LayerFieldMapping,
        latitude: float,
        longitude: float,
    ) -> dict | None:
        return await query_point_attributes(
            client=client,
            layer_url=f"{self.feature_server_url}/{mapping.layer_id}",
            latitude=latitude,
            longitude=longitude,
            output_fields=mapping.output_fields(),
            description=f"{self.council_name} flood layer {mapping.layer_id}",
        )

    def build_reading(self, layer_attributes: tuple[dict | None, ...]) -> FloodReading:
        """Translate raw council fields into the canonical vocabulary.

        Every key the council can produce is always present, so a caller can tell
        "this council does not publish PMF" from "PMF is unknown here".
        """
        values: dict = {key: None for key in self.canonical_keys()}
        inside_study_area = False

        for mapping, attributes in zip(self.layer_mappings, layer_attributes):
            if attributes is None:
                continue
            inside_study_area = True
            for field_name, canonical_key in mapping.field_to_canonical_key.items():
                values[canonical_key] = coerce_measurement(
                    canonical_key, attributes.get(field_name))

        # Ground level is reported separately because it is an input to the
        # assessment rather than a flood measurement.
        ground_level = values.pop(FloodValueKeys.GROUND_LEVEL, None)

        return FloodReading(
            flood_values=values,
            inside_study_area=inside_study_area,
            ground_level_mAHD=ground_level,
        )
