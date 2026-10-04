#!/usr/bin/env python3
"""Generate the bundled offline regional SVG from Natural Earth shapefiles.

This build helper is not used by the website at runtime. Download Natural Earth
1:10m shapefiles and pass their root directory as the first argument.
Requires the `pyshp` and `shapely` Python packages.
"""

from __future__ import annotations

import html
import json
import math
import sys
from pathlib import Path
from typing import Iterable, Sequence

import shapefile  # type: ignore
from shapely import make_valid  # type: ignore
from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, box, shape as geometry_from_shape  # type: ignore

WIDTH = 1600
HEIGHT = 1000
# Expanded regional extent: all of Ukraine and Moldova, southern Belarus,
# south-western Russia through the Lower Volga, the Black Sea and the Caucasus.
WEST, SOUTH, EAST, NORTH = 21.5, 41.5, 49.0, 54.0


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
    # Group many source features into moderately sized SVG paths. This keeps the
    # detailed layer quick to parse without creating a single multi-megabyte DOM node.
    items = list(paths)
    chunk_size = 200
    return "".join(
        f'<path class="{class_name}" d="{"".join(items[index:index + chunk_size])}"/>'
        for index in range(0, len(items), chunk_size)
    )


def text_element(x: float, y: float, value: str, class_name: str, anchor: str = "start", rotate: float | None = None) -> str:
    transform = f' transform="rotate({rotate:.1f} {x:.1f} {y:.1f})"' if rotate is not None else ""
    return (
        f'<text class="{class_name}" x="{x:.1f}" y="{y:.1f}" '
        f'text-anchor="{anchor}"{transform}>{html.escape(value)}</text>'
    )


def place_data(path: Path) -> list[dict[str, object]]:
    places: list[dict[str, object]] = []
    for shape_record in records(path):
        if not shape_record.shape.points:
            continue
        longitude, latitude = shape_record.shape.points[0][:2]
        if not (WEST <= longitude <= EAST and SOUTH <= latitude <= NORTH):
            continue
        properties = shape_record.record.as_dict()
        name = properties.get("NAME_RU") or properties.get("NAME") or ""
        if not name:
            continue
        x, y = project((longitude, latitude))
        places.append(
            {
                "name": name,
                "x": round(x, 2),
                "y": round(y, 2),
                "population": max(0, int(properties.get("POP_MAX") or 0)),
                "capital": bool(properties.get("ADM0CAP")),
                "rank": int(properties.get("LABELRANK") or 9),
                "minZoom": float(properties.get("MIN_ZOOM") or 99),
            }
        )

    places.sort(
        key=lambda place: (
            not place["capital"],
            place["rank"],
            -int(place["population"]),
            str(place["name"]),
        )
    )
    return places


def svg_document(style: str, layers: list[str], title: str) -> str:
    style = "\n".join(line.rstrip() for line in style.strip().splitlines())
    return "".join(
        [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title description">',
            f'<title id="title">{html.escape(title)}</title>',
            '<desc id="description">Подробная офлайн-карта на основе общедоступных данных Natural Earth.</desc>',
            f'<defs><clipPath id="map-clip"><rect width="{WIDTH}" height="{HEIGHT}"/></clipPath></defs>',
            f'<style>{style}</style>',
            f'<rect width="{WIDTH}" height="{HEIGHT}" fill="#a9dcf4"/>',
            '<g clip-path="url(#map-clip)">',
            *layers,
            '</g>',
            f'<rect class="map-frame" x=".5" y=".5" width="{WIDTH - 1}" height="{HEIGHT - 1}"/>',
            '</svg>',
        ]
    )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: generate-real-region-map.py <natural-earth-root> <output.svg>")
    root = Path(sys.argv[1])
    output = Path(sys.argv[2])
    detail_output = output.with_name(f"{output.stem}-detail.svg")
    places_output = output.with_name("places.json")
    physical = root / "physical"
    cultural = root / "cultural"

    land = paths_for(physical / "ne_10m_land.shp", 0.34, close=True)
    regions = {
        "mountain": paths_for(
            physical / "ne_10m_geography_regions_polys.shp",
            0.45,
            close=True,
            predicate=lambda props: props.get("FEATURECLA") == "Range/mtn",
        ),
        "lowland": paths_for(
            physical / "ne_10m_geography_regions_polys.shp",
            0.55,
            close=True,
            predicate=lambda props: props.get("FEATURECLA") in {"Plain", "Lowland", "Delta"},
        ),
    }
    urban = paths_for(cultural / "ne_10m_urban_areas.shp", 0.22, close=True)
    lakes = paths_for(physical / "ne_10m_lakes.shp", 0.16, close=True)
    rivers_main = paths_for(physical / "ne_10m_rivers_lake_centerlines.shp", 0.12)
    rivers_overview = paths_for(
        physical / "ne_10m_rivers_europe.shp",
        0.12,
        predicate=lambda props: int(props.get("scalerank") or 99) <= 9,
    )
    rivers_detail = paths_for(physical / "ne_10m_rivers_europe.shp", 0.08)
    admin_one = paths_for(cultural / "ne_10m_admin_1_states_provinces_lines.shp", 0.13)
    countries = paths_for(cultural / "ne_10m_admin_0_boundary_lines_land.shp", 0.1)

    road_path = cultural / "ne_10m_roads.shp"
    road_major = paths_for(
        road_path,
        0.09,
        predicate=lambda props: props.get("type") == "Major Highway" or int(props.get("scalerank") or 99) <= 4,
    )
    road_secondary = paths_for(
        road_path,
        0.09,
        predicate=lambda props: props.get("type") != "Ferry Route" and 5 <= int(props.get("scalerank") or 99) <= 7,
    )
    road_local = paths_for(
        road_path,
        0.07,
        predicate=lambda props: props.get("type") != "Ferry Route" and int(props.get("scalerank") or 99) == 8,
    )
    road_minor = paths_for(
        road_path,
        0.05,
        predicate=lambda props: props.get("type") != "Ferry Route" and int(props.get("scalerank") or 99) >= 9,
    )
    railroads = paths_for(cultural / "ne_10m_railroads.shp", 0.07)

    overview_labels = [
        text_element(*project((32.0, 43.45)), "Чёрное море", "water-label", anchor="middle"),
        text_element(*project((36.4, 46.05)), "Азовское море", "water-label", anchor="middle"),
        text_element(*project((48.15, 43.15)), "Каспийское море", "water-label", anchor="middle", rotate=-78),
        text_element(*project((24.8, 48.2)), "КАРПАТЫ", "terrain-label", anchor="middle", rotate=-30),
        text_element(*project((43.7, 43.25)), "КАВКАЗ", "terrain-label", anchor="middle", rotate=-18),
    ]
    detail_labels = [
        text_element(*project((32.0, 43.45)), "Чёрное море", "water-label", anchor="middle"),
        text_element(*project((36.4, 46.05)), "Азовское море", "water-label", anchor="middle"),
        text_element(*project((48.15, 43.15)), "Каспийское море", "water-label", anchor="middle", rotate=-78),
    ]

    common_style = """
      .land{fill:#f4f1e7;stroke:none;fill-rule:evenodd}
      .terrain-low{fill:#dfeeda;fill-opacity:.54;stroke:none;fill-rule:evenodd}
      .terrain-mountain{fill:#cae2c5;fill-opacity:.64;stroke:#b3d3ad;stroke-width:.38;fill-rule:evenodd}
      .urban{fill:#d9ddd8;fill-opacity:.74;stroke:#cbd0cb;stroke-width:.2;fill-rule:evenodd}
      .lake{fill:#8fd0f0;stroke:#72bfe7;stroke-width:.45;fill-rule:evenodd}
      .map-frame{fill:none;stroke:#c6cbc5;stroke-width:1}
      text{font-family:Arial,"Segoe UI",sans-serif;user-select:none}
    """
    overview_style = common_style + """
      .river{fill:none;stroke:#73c5ec;stroke-width:.58;stroke-linecap:round;stroke-linejoin:round}
      .river-minor{fill:none;stroke:#91d3f1;stroke-width:.32;stroke-linecap:round;stroke-linejoin:round}
      .admin-one{fill:none;stroke:#c7cbc5;stroke-width:.5;stroke-dasharray:2.5 2;stroke-linecap:round}
      .country-casing{fill:none;stroke:#fff;stroke-opacity:.92;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
      .country{fill:none;stroke:#84969b;stroke-width:.9;stroke-linecap:round;stroke-linejoin:round}
      .road-local-casing,.road-secondary-casing,.road-major-casing{fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round}
      .road-local-casing{stroke-width:1.1;stroke-opacity:.82}
      .road-secondary-casing{stroke-width:1.7;stroke-opacity:.94}
      .road-major-casing{stroke-width:2.6}
      .road-local{fill:none;stroke:#b7bec1;stroke-width:.26;stroke-linecap:round;stroke-linejoin:round}
      .road-secondary{fill:none;stroke:#9ea9ae;stroke-width:.5;stroke-linecap:round;stroke-linejoin:round}
      .road-major{fill:none;stroke:#df8b77;stroke-width:.9;stroke-linecap:round;stroke-linejoin:round}
      .water-label{fill:#347ba5;font-size:11px;font-style:italic;letter-spacing:1.8px;opacity:.88;paint-order:stroke;stroke:#a9def5;stroke-width:2.6px}
      .terrain-label{fill:#71906e;font-size:7px;font-weight:700;letter-spacing:2px;opacity:.72;paint-order:stroke;stroke:#eff4e9;stroke-width:2.1px}
    """
    detail_style = common_style + """
      .river{fill:none;stroke:#6fc3eb;stroke-width:.2;stroke-linecap:round;stroke-linejoin:round}
      .river-minor{fill:none;stroke:#8bd0ef;stroke-width:.1;stroke-linecap:round;stroke-linejoin:round}
      .admin-one{fill:none;stroke:#bfc5bf;stroke-width:.16;stroke-dasharray:.8 .65;stroke-linecap:round}
      .country-casing{fill:none;stroke:#fff;stroke-opacity:.9;stroke-width:.7;stroke-linecap:round;stroke-linejoin:round}
      .country{fill:none;stroke:#7f9298;stroke-width:.28;stroke-linecap:round;stroke-linejoin:round}
      .road-major-casing,.road-secondary-casing,.road-local-casing,.road-minor-casing{fill:none;stroke:#fff;stroke-linecap:round;stroke-linejoin:round}
      .road-major-casing{stroke-width:.88}.road-secondary-casing{stroke-width:.56}.road-local-casing{stroke-width:.38}.road-minor-casing{stroke-width:.24;stroke-opacity:.8}
      .road-major,.road-secondary,.road-local,.road-minor{fill:none;stroke-linecap:round;stroke-linejoin:round}
      .road-major{stroke:#dc816d;stroke-width:.31}.road-secondary{stroke:#98a5aa;stroke-width:.18}.road-local{stroke:#aeb8bb;stroke-width:.11}.road-minor{stroke:#c0c7c7;stroke-width:.07}
      .railroad{fill:none;stroke:#9ba2a0;stroke-width:.09;stroke-dasharray:.35 .3;stroke-linecap:round;opacity:.9}
      .water-label{fill:#347ba5;font-size:3.3px;font-style:italic;letter-spacing:.55px;opacity:.8;paint-order:stroke;stroke:#a9def5;stroke-width:.75px}
    """

    base_layers = [
        path_elements(land, "land"),
        path_elements(regions["lowland"], "terrain-low"),
        path_elements(regions["mountain"], "terrain-mountain"),
        path_elements(urban, "urban"),
        path_elements(lakes, "lake"),
        path_elements(rivers_main, "river"),
        path_elements(rivers_overview, "river-minor"),
        path_elements(admin_one, "admin-one"),
        path_elements(road_local, "road-local-casing"),
        path_elements(road_local, "road-local"),
        path_elements(road_secondary, "road-secondary-casing"),
        path_elements(road_secondary, "road-secondary"),
        path_elements(road_major, "road-major-casing"),
        path_elements(road_major, "road-major"),
        path_elements(countries, "country-casing"),
        path_elements(countries, "country"),
        "".join(overview_labels),
    ]
    detail_layers = [
        path_elements(land, "land"),
        path_elements(regions["lowland"], "terrain-low"),
        path_elements(regions["mountain"], "terrain-mountain"),
        path_elements(urban, "urban"),
        path_elements(lakes, "lake"),
        path_elements(rivers_main, "river"),
        path_elements(rivers_detail, "river-minor"),
        path_elements(admin_one, "admin-one"),
        path_elements(railroads, "railroad"),
        path_elements(road_minor, "road-minor-casing"),
        path_elements(road_minor, "road-minor"),
        path_elements(road_local, "road-local-casing"),
        path_elements(road_local, "road-local"),
        path_elements(road_secondary, "road-secondary-casing"),
        path_elements(road_secondary, "road-secondary"),
        path_elements(road_major, "road-major-casing"),
        path_elements(road_major, "road-major"),
        path_elements(countries, "country-casing"),
        path_elements(countries, "country"),
        "".join(detail_labels),
    ]

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(svg_document(overview_style, base_layers, "Расширенная офлайн-карта региона"), encoding="utf-8")
    detail_output.write_text(svg_document(detail_style, detail_layers, "Подробная офлайн-карта региона"), encoding="utf-8")
    places = {
        "bounds": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
        "places": place_data(cultural / "ne_10m_populated_places.shp"),
    }
    places_output.write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")
    print(f"Wrote {detail_output} ({detail_output.stat().st_size:,} bytes)")
    print(f"Wrote {places_output} ({places_output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
