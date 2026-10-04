#!/usr/bin/env python3
"""Generate the bundled offline regional SVG from Natural Earth shapefiles.

This build helper is not used by the website at runtime. Download Natural Earth
1:10m shapefiles and pass their root directory as the first argument.
Requires the `pyshp` and `shapely` Python packages.
"""

from __future__ import annotations

import html
import math
import sys
from pathlib import Path
from typing import Iterable, Sequence

import shapefile  # type: ignore
from shapely import make_valid  # type: ignore
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, box, shape as geometry_from_shape  # type: ignore

WIDTH = 1600
HEIGHT = 1000
# Geographic extent matched to the reference image: Kyiv/Pripyat in the north,
# the Black Sea coast in the south, Moldova in the west, and Volgograd/Elista
# in the east.
WEST, SOUTH, EAST, NORTH = 26.85, 43.9, 45.05, 51.55


def mercator_y(latitude: float) -> float:
    radians = math.radians(max(-85.0, min(85.0, latitude)))
    return math.log(math.tan(math.pi / 4 + radians / 2))


MERCATOR_NORTH = mercator_y(NORTH)
MERCATOR_SOUTH = mercator_y(SOUTH)
CLIP_BOX = box(WEST, SOUTH, EAST, NORTH)


def project(point: Sequence[float]) -> tuple[float, float]:
    longitude, latitude = point[:2]
    x = (longitude - WEST) / (EAST - WEST) * WIDTH
    y = (MERCATOR_NORTH - mercator_y(latitude)) / (MERCATOR_NORTH - MERCATOR_SOUTH) * HEIGHT
    return x, y


def intersects(shape: object) -> bool:
    bbox = getattr(shape, "bbox", None)
    return bool(
        bbox
        and bbox[2] >= WEST
        and bbox[0] <= EAST
        and bbox[3] >= SOUTH
        and bbox[1] <= NORTH
    )


def coordinates_path(coordinates: Sequence[Sequence[float]], close: bool = False) -> str:
    points = [project(point) for point in coordinates]
    if len(points) < 2:
        return ""
    commands = [f"M{points[0][0]:.1f},{points[0][1]:.1f}"]
    commands.extend(f"L{x:.1f},{y:.1f}" for x, y in points[1:])
    if close:
        commands.append("Z")
    return "".join(commands)


def geometry_path(geometry: object) -> str:
    if isinstance(geometry, Polygon):
        rings = [coordinates_path(geometry.exterior.coords, close=True)]
        rings.extend(coordinates_path(interior.coords, close=True) for interior in geometry.interiors)
        return "".join(rings)
    if isinstance(geometry, MultiPolygon):
        return "".join(geometry_path(part) for part in geometry.geoms)
    if isinstance(geometry, LineString):
        return coordinates_path(geometry.coords)
    if isinstance(geometry, MultiLineString):
        return "".join(coordinates_path(part.coords) for part in geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return "".join(geometry_path(part) for part in geometry.geoms)
    return ""


def shape_path(shape: object, tolerance: float = 0.25, close: bool = False) -> str:
    del close  # Geometry type determines whether an SVG subpath is closed.
    if not getattr(shape, "points", None):
        return ""
    geometry = geometry_from_shape(shape.__geo_interface__)
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    geometry = geometry.intersection(CLIP_BOX)
    if geometry.is_empty:
        return ""
    tolerance_degrees = tolerance * (EAST - WEST) / WIDTH
    geometry = geometry.simplify(tolerance_degrees, preserve_topology=True)
    return geometry_path(geometry)


def records(path: Path) -> Iterable[object]:
    return shapefile.Reader(str(path)).iterShapeRecords()


def paths_for(path: Path, tolerance: float, close: bool = False, predicate=None) -> list[str]:
    output: list[str] = []
    for shape_record in records(path):
        if not intersects(shape_record.shape):
            continue
        properties = shape_record.record.as_dict()
        if predicate is not None and not predicate(properties):
            continue
        path_data = shape_path(shape_record.shape, tolerance=tolerance, close=close)
        if path_data:
            output.append(path_data)
    return output


def path_elements(paths: Iterable[str], class_name: str) -> str:
    return "".join(f'<path class="{class_name}" d="{path_data}"/>' for path_data in paths)


def text_element(x: float, y: float, value: str, class_name: str, anchor: str = "start", rotate: float | None = None) -> str:
    transform = f' transform="rotate({rotate:.1f} {x:.1f} {y:.1f})"' if rotate is not None else ""
    return (
        f'<text class="{class_name}" x="{x:.1f}" y="{y:.1f}" '
        f'text-anchor="{anchor}"{transform}>{html.escape(value)}</text>'
    )


def boxes_overlap(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> bool:
    return not (
        first[2] + 2 < second[0]
        or second[2] + 2 < first[0]
        or first[3] + 2 < second[1]
        or second[3] + 2 < first[1]
    )


def city_layer(path: Path) -> str:
    candidates: list[dict] = []
    for shape_record in records(path):
        if not shape_record.shape.points:
            continue
        longitude, latitude = shape_record.shape.points[0][:2]
        if not (WEST <= longitude <= EAST and SOUTH <= latitude <= NORTH):
            continue
        properties = shape_record.record.as_dict()
        population = max(0, int(properties.get("POP_MAX") or 0))
        minimum_zoom = float(properties.get("MIN_ZOOM") or 99)
        if population < 55_000 or minimum_zoom > 8.0:
            continue
        name = properties.get("NAME_RU") or properties.get("NAME") or ""
        if not name:
            continue
        x, y = project((longitude, latitude))
        candidates.append(
            {
                "name": name,
                "x": x,
                "y": y,
                "population": population,
                "capital": bool(properties.get("ADM0CAP")),
                "label_rank": int(properties.get("LABELRANK") or 9),
                "min_zoom": minimum_zoom,
            }
        )

    candidates.sort(
        key=lambda city: (
            not city["capital"],
            city["label_rank"],
            -city["population"],
            city["min_zoom"],
        )
    )

    occupied: list[tuple[float, float, float, float]] = []
    dots: list[str] = []
    labels: list[str] = []
    for city in candidates:
        population = city["population"]
        if city["capital"] or population >= 800_000:
            font_size, class_name, radius = 12.2, "city-label major", 2.8
        elif population >= 250_000:
            font_size, class_name, radius = 10.4, "city-label medium", 2.2
        else:
            font_size, class_name, radius = 8.6, "city-label small", 1.6

        x, y, name = city["x"], city["y"], city["name"]
        dots.append(f'<circle class="city-dot" cx="{x:.1f}" cy="{y:.1f}" r="{radius:.1f}"/>')
        text_width = max(12.0, len(name) * font_size * 0.56)
        text_height = font_size * 1.25
        positions = [
            (x + 5, y - 4, "start"),
            (x - 5, y - 4, "end"),
            (x + 5, y + text_height, "start"),
            (x - 5, y + text_height, "end"),
        ]
        placed = False
        for label_x, label_y, anchor in positions:
            left = label_x if anchor == "start" else label_x - text_width
            box = (left, label_y - text_height, left + text_width, label_y + 2)
            if box[0] < 3 or box[2] > WIDTH - 3 or box[1] < 3 or box[3] > HEIGHT - 3:
                continue
            if any(boxes_overlap(box, existing) for existing in occupied):
                continue
            occupied.append(box)
            labels.append(text_element(label_x, label_y, name, class_name, anchor=anchor))
            placed = True
            break
        if not placed and (city["capital"] or population >= 800_000):
            labels.append(text_element(x + 5, y - 4, name, class_name))

    return "".join(dots + labels)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: generate-real-region-map.py <natural-earth-root> <output.svg>")
    root = Path(sys.argv[1])
    output = Path(sys.argv[2])
    physical = root / "physical"
    cultural = root / "cultural"

    land = paths_for(physical / "ne_10m_land.shp", 0.45, close=True)
    regions = {
        "mountain": paths_for(
            physical / "ne_10m_geography_regions_polys.shp",
            0.65,
            close=True,
            predicate=lambda props: props.get("FEATURECLA") == "Range/mtn",
        ),
        "lowland": paths_for(
            physical / "ne_10m_geography_regions_polys.shp",
            0.75,
            close=True,
            predicate=lambda props: props.get("FEATURECLA") in {"Plain", "Lowland", "Delta"},
        ),
    }
    urban = paths_for(cultural / "ne_10m_urban_areas.shp", 0.35, close=True)
    lakes = paths_for(physical / "ne_10m_lakes.shp", 0.22, close=True)
    rivers_main = paths_for(physical / "ne_10m_rivers_lake_centerlines.shp", 0.18)
    rivers_europe = paths_for(
        physical / "ne_10m_rivers_europe.shp",
        0.16,
        predicate=lambda props: int(props.get("scalerank") or 99) <= 10,
    )
    admin_one = paths_for(cultural / "ne_10m_admin_1_states_provinces_lines.shp", 0.18)
    countries = paths_for(cultural / "ne_10m_admin_0_boundary_lines_land.shp", 0.15)

    road_path = cultural / "ne_10m_roads.shp"
    road_major = paths_for(
        road_path,
        0.15,
        predicate=lambda props: props.get("type") == "Major Highway" or int(props.get("scalerank") or 99) <= 4,
    )
    road_secondary = paths_for(
        road_path,
        0.15,
        predicate=lambda props: props.get("type") != "Ferry Route" and 5 <= int(props.get("scalerank") or 99) <= 7,
    )
    road_local = paths_for(
        road_path,
        0.14,
        predicate=lambda props: props.get("type") != "Ferry Route" and int(props.get("scalerank") or 99) == 8,
    )

    sea_labels = [
        text_element(*project((32.2, 44.35)), "Чёрное море", "water-label", anchor="middle"),
        text_element(*project((36.3, 46.05)), "Азовское море", "water-label", anchor="middle"),
    ]
    physical_labels = [
        text_element(*project((27.35, 47.7)), "КАРПАТЫ", "terrain-label", anchor="middle", rotate=-32),
        text_element(*project((43.8, 44.15)), "КАВКАЗ", "terrain-label", anchor="middle", rotate=-18),
    ]

    style = """
      .land{fill:#f4f1e7;stroke:none;fill-rule:evenodd}
      .terrain-low{fill:#dfeeda;fill-opacity:.54;stroke:none;fill-rule:evenodd}
      .terrain-mountain{fill:#cae2c5;fill-opacity:.64;stroke:#b3d3ad;stroke-width:.45;fill-rule:evenodd}
      .urban{fill:#d9ddd8;fill-opacity:.72;stroke:#cbd0cb;stroke-width:.25;fill-rule:evenodd}
      .lake{fill:#8fd0f0;stroke:#72bfe7;stroke-width:.6;fill-rule:evenodd}
      .river{fill:none;stroke:#7bc8ee;stroke-width:.65;stroke-linecap:round;stroke-linejoin:round}
      .river-minor{fill:none;stroke:#91d3f1;stroke-width:.4;stroke-linecap:round;stroke-linejoin:round}
      .admin-one{fill:none;stroke:#c7cbc5;stroke-width:.6;stroke-dasharray:2.8 2.1;stroke-linecap:round}
      .country-casing{fill:none;stroke:#fff;stroke-opacity:.92;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
      .country{fill:none;stroke:#84969b;stroke-width:1.05;stroke-linecap:round;stroke-linejoin:round}
      .road-local-casing,.road-secondary-casing,.road-major-casing{fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round}
      .road-local-casing{stroke-width:1.5;stroke-opacity:.88}
      .road-secondary-casing{stroke-width:2.15;stroke-opacity:.94}
      .road-major-casing{stroke-width:3.2}
      .road-local{fill:none;stroke:#b7bec1;stroke-width:.38;stroke-linecap:round;stroke-linejoin:round}
      .road-secondary{fill:none;stroke:#9ea9ae;stroke-width:.68;stroke-linecap:round;stroke-linejoin:round}
      .road-major{fill:none;stroke:#df8b77;stroke-width:1.15;stroke-linecap:round;stroke-linejoin:round}
      .city-dot{fill:#42494a;stroke:#fff;stroke-width:.85}
      text{font-family:Arial,"Segoe UI",sans-serif;user-select:none}
      .city-label{fill:#303638;paint-order:stroke;stroke:#faf9f4;stroke-width:2.8px;stroke-linejoin:round}
      .city-label.major{font-size:12.2px;font-weight:700;stroke-width:3.5px}
      .city-label.medium{font-size:10.4px;font-weight:650}
      .city-label.small{fill:#495052;font-size:8.6px;font-weight:520;stroke-width:2.4px}
      .water-label{fill:#347ba5;font-size:13px;font-style:italic;letter-spacing:2px;opacity:.88;paint-order:stroke;stroke:#a9def5;stroke-width:3px}
      .terrain-label{fill:#71906e;font-size:8px;font-weight:700;letter-spacing:2.4px;opacity:.72;paint-order:stroke;stroke:#eff4e9;stroke-width:2.5px}
      .map-frame{fill:none;stroke:#c6cbc5;stroke-width:1}
    """

    content = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title description">',
        '<title id="title">Офлайн-карта региона Восточной Европы</title>',
        '<desc id="description">Реальная географическая карта на основе общедоступных данных Natural Earth.</desc>',
        '<defs><clipPath id="map-clip"><rect width="1600" height="1000"/></clipPath></defs>',
        f'<style>{style}</style>',
        '<rect width="1600" height="1000" fill="#a9dcf4"/>',
        '<g clip-path="url(#map-clip)">',
        path_elements(land, "land"),
        path_elements(regions["lowland"], "terrain-low"),
        path_elements(regions["mountain"], "terrain-mountain"),
        path_elements(urban, "urban"),
        path_elements(lakes, "lake"),
        path_elements(rivers_main, "river"),
        path_elements(rivers_europe, "river-minor"),
        path_elements(admin_one, "admin-one"),
        path_elements(road_local, "road-local-casing"),
        path_elements(road_local, "road-local"),
        path_elements(road_secondary, "road-secondary-casing"),
        path_elements(road_secondary, "road-secondary"),
        path_elements(road_major, "road-major-casing"),
        path_elements(road_major, "road-major"),
        path_elements(countries, "country-casing"),
        path_elements(countries, "country"),
        "".join(sea_labels + physical_labels),
        city_layer(cultural / "ne_10m_populated_places.shp"),
        '</g><rect class="map-frame" x=".5" y=".5" width="1599" height="999"/>',
        '</svg>',
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("".join(content), encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
