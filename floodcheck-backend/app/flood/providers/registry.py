"""The register of councils FloodCheck can assess.

This is the only place that knows which councils exist. Adding a council means
writing its module under `councils/` and adding it to the tuple below — no change
to the resolver, the assessment maths, or the API.
"""

from app.flood.providers.council_provider import CouncilProvider
from app.flood.providers.councils import bellingen, gold_coast, hinchinbrook, tweed

COUNCIL_PROVIDERS: tuple[CouncilProvider, ...] = (
    bellingen.PROVIDER,
    tweed.PROVIDER,
    hinchinbrook.PROVIDER,
    gold_coast.PROVIDER,
)


def find_council_providers(latitude: float, longitude: float) -> list[CouncilProvider]:
    """Every council whose coverage includes this coordinate, in registry order.

    Coverage is a bounding box, so neighbouring councils overlap — Tweed Shire and
    the City of Gold Coast share a box across the state border. More than one
    provider can therefore claim a coordinate, and only the data can settle which
    one actually holds it; the caller tries them in turn.
    """
    return [provider for provider in COUNCIL_PROVIDERS
            if provider.covers(latitude, longitude)]


def find_council_by_identifier(identifier: str) -> CouncilProvider | None:
    for provider in COUNCIL_PROVIDERS:
        if provider.identifier() == identifier:
            return provider
    return None


def describe_council(provider: CouncilProvider) -> dict:
    """One council as the frontend consumes it: identity, coverage and map setup."""
    return {
        "id": provider.identifier(),
        "council": provider.name,
        "state": provider.state,
        "source_url": provider.source_url,
        "attribution": provider.attribution,
        "freeboard_m": provider.freeboard_metres,
        "notes": list(provider.data_notes),
        "bounds": {
            "min_lat": provider.coverage.minimum_latitude,
            "max_lat": provider.coverage.maximum_latitude,
            "min_lon": provider.coverage.minimum_longitude,
            "max_lon": provider.coverage.maximum_longitude,
        },
        "map": provider.map_presentation.to_dict() if provider.map_presentation else None,
    }


def list_registered_councils() -> list[dict]:
    """Describe every registered council, for the API's coverage endpoint."""
    return [describe_council(provider) for provider in COUNCIL_PROVIDERS]


def list_mappable_councils() -> list[dict]:
    """Only councils with precomputed map data, in the order the UI should show them."""
    return [
        describe_council(provider)
        for provider in COUNCIL_PROVIDERS
        if provider.map_presentation is not None
    ]
