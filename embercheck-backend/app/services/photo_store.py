# Persists one photo-assessment as a training-data record: the four photos, the
# VLM reads, the final per-side result, and the capture metadata. One folder per
# assessment, with the images written as files and everything else in
# record.json. Best-effort - a storage failure must not break the response.

import base64
import json
import uuid
from datetime import datetime, timezone

from app.config import settings


def save_assessment_record(
    *,
    request_context: dict,
    photos: list[dict],
    reads: list[dict],
    assessment: dict,
) -> str | None:
    """
    Write the training-data record for one /assess/photos call and return its id.

    request_context: {address, latitude, longitude} from the free screen.
    photos: the raw CapturedPhoto dicts (image is a data URL).
    reads: the per-photo VLM reads ({direction, class, confidence, condition, limits}).
    assessment: the final sharpened assessment dict.

    Returns the record id, or None if storage failed (never raises - the caller
    still returns the assessment to the user).
    """

    try:
        record_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
        record_dir = settings.PHOTO_STORAGE_DIR / record_id
        record_dir.mkdir(parents=True, exist_ok=True)

        # Write each photo's JPEG to disk and replace the bulky data URL in the
        # record with the saved filename.
        stored_photos = []
        for index, photo in enumerate(photos):
            direction = (photo.get("intended_direction") or f"photo{index}").lower()
            image_filename = _write_image(record_dir, direction, photo.get("image", ""))
            stored_photos.append(
                {
                    "intended_direction": photo.get("intended_direction"),
                    "compass_heading_at_capture": photo.get("compass_heading_at_capture"),
                    "location": photo.get("location"),
                    "captured_at": photo.get("captured_at"),
                    "direction_source": photo.get("direction_source"),
                    "quality_check_results": photo.get("quality_check_results"),
                    "image_file": image_filename,
                }
            )

        record = {
            "id": record_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "context": request_context,
            "overall": {
                "bal_rating": assessment.get("bal_rating"),
                "governing_direction": assessment.get("governing_direction"),
                "requires_manual_review": assessment.get("requires_manual_review"),
            },
            "per_direction": assessment.get("per_direction"),
            "vlm_reads": reads,
            "photos": stored_photos,
        }

        with open(record_dir / "record.json", "w", encoding="utf-8") as record_file:
            json.dump(record, record_file, indent=2)

        return record_id
    except OSError:
        # Storage is best-effort; never let it break the assessment response.
        return None


def _write_image(record_dir, direction: str, image_data_url: str) -> str | None:
    """Decode a JPEG data URL and write it as <direction>.jpg. Returns the
    filename, or None if the data URL couldn't be decoded."""

    if not image_data_url or "," not in image_data_url:
        return None
    try:
        encoded = image_data_url.split(",", 1)[1]
        image_bytes = base64.b64decode(encoded)
    except (ValueError, base64.binascii.Error):
        return None

    filename = f"{direction}.jpg"
    with open(record_dir / filename, "wb") as image_file:
        image_file.write(image_bytes)
    return filename
