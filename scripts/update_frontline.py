#!/usr/bin/env python3
"""Build the offline line-of-contact snapshot used by DUS.

The input is a GeoJSON FeatureCollection containing a feature whose
``properties.kind`` is ``contact_line``. Coordinates stay geographic in the
published file; the browser projects them onto the local Mercator map.

Example:
  python scripts/update_frontline.py --input latest.geojson
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "public" / "maps" / "frontline.json"


def point_segment_distance(point: list[float], start: list[float], end: list[float]) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    factor = max(
        0.0,
        min(
            1.0,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy),
        ),
    )
    return math.hypot(
        point[0] - (start[0] + factor * dx),
        point[1] - (start[1] + factor * dy),
    )


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    distances = [point_segment_distance(point, points[0], points[-1]) for point in points[1:-1]]
    if not distances:
        return points
    maximum = max(distances)
    pivot = distances.index(maximum) + 1
    if maximum <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: pivot + 1], tolerance)[:-1] + simplify(points[pivot:], tolerance)


def normalized_point(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) < 2:
        return None
    try:
        longitude = float(value[0])
        latitude = float(value[1])
    except (TypeError, ValueError):
        return None
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        return None
    return [round(longitude, 6), round(latitude, 6)]


def contact_segments(payload: dict[str, Any]) -> list[list[list[float]]]:
    matches = [
        feature
        for feature in payload.get("features", [])
        if isinstance(feature, dict)
        and isinstance(feature.get("properties"), dict)
        and feature["properties"].get("kind") == "contact_line"
    ]
    if not matches:
        raise ValueError("GeoJSON does not contain a contact_line feature")

    segments: list[list[list[float]]] = []
    for feature in matches:
        geometry = feature.get("geometry") or {}
        geometry_type = geometry.get("type")
        coordinates = geometry.get("coordinates")
        candidates = [coordinates] if geometry_type == "LineString" else coordinates
        if geometry_type not in {"LineString", "MultiLineString"} or not isinstance(candidates, list):
            continue
        for candidate in candidates:
            if not isinstance(candidate, list):
                continue
            points = [point for value in candidate if (point := normalized_point(value)) is not None]
            if len(points) >= 2:
                segments.append(points)
    if not segments:
        raise ValueError("contact_line has no valid line segments")
    return segments


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Source GeoJSON file")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--tolerance",
        type=float,
        default=0.015,
        help="Ramer-Douglas-Peucker tolerance in geographic degrees (default: 0.015)",
    )
    parser.add_argument(
        "--source-url",
        default="https://github.com/longlinecode/russo-ukrainian-front-daily",
    )
    arguments = parser.parse_args()

    source = json.loads(arguments.input.read_text(encoding="utf-8"))
    segments = [simplify(segment, max(0.0, arguments.tolerance)) for segment in contact_segments(source)]
    source_properties = source.get("properties") if isinstance(source.get("properties"), dict) else {}
    data_date = str(source_properties.get("data_date") or "").strip()
    generated_at = str(source_properties.get("generated") or "").strip()
    if not data_date:
        raise ValueError("GeoJSON properties.data_date is required")

    output = {
        "format": 1,
        "title": "Линия боевого соприкосновения",
        "dataDate": data_date,
        "generatedAt": generated_at,
        "sourceName": "DeepStateMap.Live — производная линия из открытого ежедневного снимка",
        "sourceUrl": arguments.source_url,
        "license": "Данные источника; использовать с указанием авторства",
        "notice": "Оценочные упрощённые данные из открытого источника, не официальный оперативный документ.",
        "segments": segments,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {arguments.output}: {len(segments)} segments, "
        f"{sum(len(segment) for segment in segments)} points, date {data_date}"
    )


if __name__ == "__main__":
    main()
