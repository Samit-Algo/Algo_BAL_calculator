"""The contract every council flood source implements.

The resolver depends on this interface, never on a specific council or a specific
upstream technology. A future council published over WFS, or from a local
database, only has to satisfy `FloodDataSource` to slot into the cascade.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class FloodReading:
    """What a council's flood service says about one coordinate."""

    # Canonical keys from FloodValueKeys to values. A key with a value of None
    # means the council publishes that measurement but not for this location.
    flood_values: dict = field(default_factory=dict)

    # True when the coordinate fell inside the council's mapped area. False means
    # "outside the study" — which is unknown risk, never "no risk".
    inside_study_area: bool = False

    # Set only when the council publishes its own ground level for this location.
    ground_level_mAHD: float | None = None

    def has_any_flood_value(self) -> bool:
        return any(value is not None for value in self.flood_values.values())


class FloodDataSource(ABC):
    """Reads flood measurements for a coordinate from one council's data."""

    @abstractmethod
    async def read(self, latitude: float, longitude: float) -> FloodReading:
        """Return the flood reading at this coordinate."""
