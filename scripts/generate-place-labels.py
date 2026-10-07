#!/usr/bin/env python3
"""Build dense offline settlement labels from GeoNames extracts.

The base JSON must already contain the Natural Earth country and region labels.
GeoNames' cities500 text file and, optionally, the monthly cities.json package
are build-time inputs only; the generated site never accesses the internet.

Example:
    python scripts/generate-place-labels.py \
      --cities500 /path/to/cities500.txt \
      --cities1000-json /path/to/cities.json \
      --output public/maps/places.json

GeoNames data is licensed CC BY 4.0: https://www.geonames.org/
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

WIDTH = 1600
HEIGHT = 1000
WEST, SOUTH, EAST, NORTH = 14.0, 38.0, 60.0, 61.0
EXCLUDED_FEATURES = {"PPLH", "PPLQ", "PPLW", "PPLCH"}
LOCALITY_FEATURES = {"PPLX", "PPLL", "PPLF", "PPLR", "PPLS"}
NATURAL_EARTH_NAME_FIXES = {
    ("Russia", "Колумбия"): "Буйнакск",
}
GEONAMES_NAME_FIXES = {
    ("MD", "Donduseni"): "Дондюшаны",
    ("MD", "Hincesti"): "Хынчешты",
    ("UA", "Armyansk"): "Армянск",
    ("UA", "Brody"): "Броды",
    ("UA", "Brovary"): "Бровары",
    ("UA", "Cherkasy"): "Черкассы",
    ("UA", "Chornomors'k"): "Черноморск",
    ("UA", "Dolyna"): "Долина",
    ("UA", "Dovzhansk"): "Должанск",
    ("UA", "Enerhodar"): "Энергодар",
    ("UA", "Hlukhiv"): "Глухов",
    ("UA", "Holubivka"): "Голубовка",
    ("UA", "Khartsyzk"): "Харцызск",
    ("UA", "Kherson"): "Херсон",
    ("UA", "Khrustalnyi"): "Хрустальный",
    ("UA", "Kivsharivka"): "Ковшаровка",
    ("UA", "Konotop"): "Конотоп",
    ("UA", "Kremenchuk"): "Кременчуг",
    ("UA", "Kremenets"): "Кременец",
    ("UA", "Mariupol"): "Мариуполь",
    ("UA", "Molodohvardiisk"): "Молодогвардейск",
    ("UA", "Mukachevo"): "Мукачево",
    ("UA", "Novohrad-Volynskyi"): "Новоград-Волынский",
    ("UA", "Odesa"): "Одесса",
    ("UA", "Pereiaslav"): "Переяслав",
    ("UA", "Pervomaisk"): "Первомайск",
    ("UA", "Pokrovsk"): "Покровск",
    ("UA", "Poltava"): "Полтава",
    ("UA", "Sambir"): "Самбор",
    ("UA", "Sarny"): "Сарны",
    ("UA", "Sloviansk"): "Славянск",
    ("UA", "Stryi"): "Стрый",
    ("UA", "Sumy"): "Сумы",
    ("UA", "Synelnykove"): "Синельниково",
    ("UA", "Uzhgorod"): "Ужгород",
    ("UA", "Vynohradiv"): "Виноградов",
    ("UA", "Volodymyr-Volynskyi"): "Владимир-Волынский",
    ("UA", "Yany Kapu"): "Красноперекопск",
    ("UA", "Zhovti Vody"): "Жёлтые Воды",
}
CYRILLIC_RE = re.compile(r"[А-Яа-яЁё]")
NON_NAME_RE = re.compile(r"[^a-zа-яё0-9]+", re.IGNORECASE)
RUSSIAN_ALPHABET = set("абвгдеёжзийклмнопрстуфхцчшщъыьэюя")

CYRILLIC_TO_LATIN = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ё": "yo", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
})


def mercator_y(latitude: float) -> float:
    radians = math.radians(max(-85.0, min(85.0, latitude)))
    return math.log(math.tan(math.pi / 4 + radians / 2))


MERCATOR_NORTH = mercator_y(NORTH)
MERCATOR_SOUTH = mercator_y(SOUTH)


def project(longitude: float, latitude: float) -> tuple[float, float]:
    x = (longitude - WEST) / (EAST - WEST) * WIDTH
    y = (MERCATOR_NORTH - mercator_y(latitude)) / (MERCATOR_NORTH - MERCATOR_SOUTH) * HEIGHT
    return round(x, 2), round(y, 2)


def normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = value.translate(CYRILLIC_TO_LATIN)
    return NON_NAME_RE.sub("", value)


def russianize_ukrainian_spelling(value: str) -> str:
    value = re.sub(r"ськ", "ск", value, flags=re.IGNORECASE)
    value = re.sub(r"ьск", "ск", value, flags=re.IGNORECASE)
    value = re.sub(r"ць", "ц", value, flags=re.IGNORECASE)
    value = re.sub(r"еве$", "ево", value, flags=re.IGNORECASE)
    value = re.sub(r"ове$", "ово", value, flags=re.IGNORECASE)
    return value


def choose_russian_name(primary: str, ascii_name: str, alternate_names: str, country: str) -> str:
    reference = normalized_name(ascii_name or primary)
    candidates: list[tuple[float, str]] = []
    for raw_candidate in alternate_names.split(","):
        candidate = unicodedata.normalize("NFC", raw_candidate.strip())
        candidate = re.sub(r"ськ", "ск", candidate, flags=re.IGNORECASE)
        candidate = re.sub(r"ць", "ц", candidate, flags=re.IGNORECASE)
        if country == "UA":
            candidate = russianize_ukrainian_spelling(candidate)
        if not candidate or len(candidate) > 90 or not CYRILLIC_RE.search(candidate):
            continue
        # The comma-separated field contains names in many languages but no
        # language codes. Characters absent from the Russian alphabet provide
        # a reliable way to discard Ukrainian, Belarusian and South-Slavic
        # variants before comparing transliterations.
        if any(
            "\u0400" <= character <= "\u052f" and character.casefold() not in RUSSIAN_ALPHABET
            for character in candidate
        ):
            continue
        candidate_reference = normalized_name(candidate)
        if not candidate_reference:
            continue
        similarity = difflib.SequenceMatcher(None, reference, candidate_reference).ratio()
        score = similarity * 0.42
        if abs(len(reference) - len(candidate_reference)) <= 2:
            score += 0.025
        if re.search(r"(ий|ый|ой|ая|ое|ье)(?:\b|$)", candidate.casefold()):
            score += 0.18
        if "ь" in candidate.casefold():
            score += 0.07
        if re.search(r"[кгхжчшщ]ы|[жшчщ]я", candidate.casefold()):
            score -= 0.2
        elif re.search(r"(?:ы\b|ые\b|ый\b|ынск)", candidate.casefold()):
            score += 0.06
        if "ё" in candidate.casefold() or candidate.casefold().startswith("э"):
            score += 0.04
        # In Ukrainian records an exact Cyrillic rendering of the Latin source
        # is commonly another transliteration rather than the Russian name.
        if country == "UA" and similarity >= 0.9:
            score -= 0.19
        candidates.append((score, candidate))

    if not candidates:
        return primary.strip()
    score, candidate = max(candidates, key=lambda entry: (entry[0], -len(entry[1])))
    return candidate if score >= 0.2 else primary.strip()


def population_rank(population: int) -> int:
    if population >= 1_000_000:
        return 1
    if population >= 500_000:
        return 2
    if population >= 250_000:
        return 3
    if population >= 100_000:
        return 4
    if population >= 50_000:
        return 5
    if population >= 20_000:
        return 6
    if population >= 10_000:
        return 7
    if population >= 5_000:
        return 8
    if population >= 1_000:
        return 9
    return 10


def label_rank(feature_code: str, population: int, capital: bool = False) -> int:
    administrative_rank = {
        "PPLC": 1,
        "PPLCD": 1,
        "PPLA": 2,
        "PPLA2": 3,
        "PPLA3": 5,
        "PPLA4": 7,
        "PPLA5": 8,
        "PPLG": 4,
        "PPLX": 11,
    }.get(feature_code, 10)
    if capital:
        administrative_rank = 1
    return min(administrative_rank, population_rank(population))


def minimum_zoom(feature_code: str, population: int, capital: bool = False) -> float:
    if capital or feature_code in {"PPLC", "PPLCD"}:
        zoom = -1.0
    elif population >= 1_000_000:
        zoom = -0.2
    elif population >= 500_000:
        zoom = 0.25
    elif population >= 250_000:
        zoom = 0.5
    elif population >= 100_000:
        zoom = 0.75
    elif population >= 50_000:
        zoom = 0.95
    elif population >= 20_000:
        zoom = 1.15
    elif population >= 10_000:
        zoom = 1.3
    elif population >= 5_000:
        zoom = 1.42
    elif population >= 1_000:
        zoom = 1.58
    elif population >= 500:
        zoom = 1.7
    else:
        zoom = 1.9

    administrative_zoom = {
        "PPLA": 0.35,
        "PPLA2": 0.85,
        "PPLA3": 1.28,
        "PPLA4": 1.52,
        "PPLA5": 1.72,
        "PPLG": 1.1,
    }.get(feature_code)
    if administrative_zoom is not None:
        zoom = min(zoom, administrative_zoom)
    if feature_code == "PPLX":
        zoom = max(zoom, 2.5)
    elif feature_code in {"PPLL", "PPLF", "PPLR", "PPLS"}:
        zoom = max(zoom, 2.05)
    return round(zoom, 2)


def place_record(
    name: str,
    longitude: float,
    latitude: float,
    population: int,
    feature_code: str,
    country: str,
    *,
    capital: bool = False,
    world_city: bool = False,
    rank: int | None = None,
) -> dict[str, Any]:
    x, y = project(longitude, latitude)
    capital = capital or feature_code in {"PPLC", "PPLCD"}
    return {
        "name": name.strip(),
        "x": x,
        "y": y,
        "population": max(0, population),
        "capital": capital,
        "worldCity": world_city or population >= 1_000_000,
        "rank": rank if rank is not None else label_rank(feature_code, population, capital),
        "minZoom": minimum_zoom(feature_code, population, capital),
        "country": country,
    }


def iter_cities500(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8") as source:
        for line in source:
            columns = line.rstrip("\n").split("\t")
            if len(columns) < 19:
                continue
            latitude = float(columns[4])
            longitude = float(columns[5])
            feature_code = columns[7]
            if feature_code in EXCLUDED_FEATURES:
                continue
            if not (WEST <= longitude <= EAST and SOUTH <= latitude <= NORTH):
                continue
            population = int(columns[14] or 0)
            yield {
                "geonameId": columns[0],
                "primaryName": columns[1],
                "asciiName": columns[2],
                "name": GEONAMES_NAME_FIXES.get(
                    (columns[8], columns[2]),
                    choose_russian_name(columns[1], columns[2], columns[3], columns[8]),
                ),
                "latitude": latitude,
                "longitude": longitude,
                "featureCode": feature_code,
                "country": columns[8],
                "population": population,
            }


def nearby_cells(latitude: float, longitude: float) -> Iterable[tuple[int, int]]:
    center_latitude = round(latitude * 50)
    center_longitude = round(longitude * 50)
    for latitude_offset in (-1, 0, 1):
        for longitude_offset in (-1, 0, 1):
            yield center_latitude + latitude_offset, center_longitude + longitude_offset


def merge_current_cities(records: list[dict[str, Any]], path: Path) -> int:
    spatial: dict[tuple[str, int, int], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        spatial[(record["country"], round(record["latitude"] * 50), round(record["longitude"] * 50))].append(record)

    additions = 0
    current_cities = json.loads(path.read_text(encoding="utf-8"))
    for city in current_cities:
        latitude = float(city["lat"])
        longitude = float(city["lng"])
        if not (WEST <= longitude <= EAST and SOUTH <= latitude <= NORTH):
            continue
        country = str(city["country"])
        reference = normalized_name(str(city["name"]))
        best: tuple[float, dict[str, Any]] | None = None
        for cell_latitude, cell_longitude in nearby_cells(latitude, longitude):
            for candidate in spatial.get((country, cell_latitude, cell_longitude), []):
                distance = math.hypot(latitude - candidate["latitude"], longitude - candidate["longitude"])
                if distance > 0.035:
                    continue
                similarity = difflib.SequenceMatcher(
                    None,
                    reference,
                    normalized_name(candidate["asciiName"] or candidate["primaryName"]),
                ).ratio()
                if distance < 0.002:
                    similarity = max(similarity, 0.9)
                score = similarity - distance * 3
                if similarity >= 0.56 and (best is None or score > best[0]):
                    best = score, candidate
        if best is not None:
            # Coordinates are refreshed from the monthly extract while the
            # population, feature code and localized name remain available.
            best[1]["latitude"] = latitude
            best[1]["longitude"] = longitude
            continue

        record = {
            "geonameId": "",
            "primaryName": str(city["name"]),
            "asciiName": str(city["name"]),
            "name": str(city["name"]),
            "latitude": latitude,
            "longitude": longitude,
            "featureCode": "PPL",
            "country": country,
            "population": 1_000,
        }
        records.append(record)
        spatial[(country, round(latitude * 50), round(longitude * 50))].append(record)
        additions += 1
    return additions


def duplicates_natural_earth_place(
    candidate: dict[str, Any],
    source_names: Iterable[str],
    places: list[dict[str, Any]],
    buckets: dict[tuple[int, int], list[int]],
) -> bool:
    candidate_names = {
        normalized_name(str(value))
        for value in (candidate["name"], *source_names)
        if str(value).strip()
    }
    center_x = round(float(candidate["x"]) / 4)
    center_y = round(float(candidate["y"]) / 4)
    for offset_x in range(-2, 3):
        for offset_y in range(-2, 3):
            for index in buckets.get((center_x + offset_x, center_y + offset_y), []):
                existing = places[index]
                distance = math.hypot(
                    float(existing["x"]) - float(candidate["x"]),
                    float(existing["y"]) - float(candidate["y"]),
                )
                if distance > 5:
                    continue
                existing_name = normalized_name(str(existing["name"]))
                similarity = max(
                    difflib.SequenceMatcher(None, existing_name, candidate_name).ratio()
                    for candidate_name in candidate_names
                )
                # Natural Earth contains well-localized labels for the larger
                # cities. Match against both the selected label and GeoNames'
                # source/ascii names so forms such as «Одесса» / Odesa merge.
                # A close population match also catches differently transliterated
                # main-city records, while the ratio prevents nearby districts and
                # suburbs from being discarded.
                existing_population = int(existing.get("population") or 0)
                candidate_population = int(candidate.get("population") or 0)
                population_ratio = (
                    min(existing_population, candidate_population)
                    / max(existing_population, candidate_population)
                    if existing_population > 0 and candidate_population > 0
                    else 0
                )
                if (
                    similarity >= 0.9
                    or (distance <= 3 and similarity >= 0.82)
                    or (
                        distance <= 1.5
                        and min(existing_population, candidate_population) >= 10_000
                        and population_ratio >= 0.5
                    )
                ):
                    return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cities500", required=True, type=Path)
    parser.add_argument("--cities1000-json", type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/maps/places.json"))
    args = parser.parse_args()

    payload = json.loads(args.output.read_text(encoding="utf-8"))
    natural_earth_places = [
        place
        for place in payload["places"]
        if isinstance(place, dict) and len(str(place.get("country") or "")) != 2
    ]
    for place in natural_earth_places:
        fixed_name = NATURAL_EARTH_NAME_FIXES.get((str(place.get("country")), str(place.get("name"))))
        if fixed_name:
            place["name"] = fixed_name
        place["minZoom"] = minimum_zoom(
            "PPLC" if place.get("capital") else "",
            int(place.get("population") or 0),
            bool(place.get("capital")),
        )
        place["rank"] = min(
            int(place.get("rank") or 10),
            population_rank(int(place.get("population") or 0)),
        )

    geo_records = list(iter_cities500(args.cities500))
    monthly_additions = 0
    if args.cities1000_json:
        monthly_additions = merge_current_cities(geo_records, args.cities1000_json)

    places = natural_earth_places[:]
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, place in enumerate(places):
        buckets[(round(float(place["x"]) / 4), round(float(place["y"]) / 4))].append(index)

    skipped_duplicates = 0
    for record in geo_records:
        candidate = place_record(
            str(record["name"]),
            float(record["longitude"]),
            float(record["latitude"]),
            int(record["population"]),
            str(record["featureCode"]),
            str(record["country"]),
        )
        feature_code = str(record["featureCode"])
        if feature_code not in LOCALITY_FEATURES and duplicates_natural_earth_place(
            candidate,
            (str(record["primaryName"]), str(record["asciiName"])),
            places,
            buckets,
        ):
            skipped_duplicates += 1
            continue
        places.append(candidate)

    places.sort(key=lambda place: (
        0.0 if bool(place["capital"]) and int(place["population"]) >= 1_000_000
        else 3.0 if bool(place["capital"])
        else max(
            6.0,
            34 - math.log10(max(10, int(place["population"]))) * 3 + int(place["rank"]),
        ),
        -int(place["population"]),
        int(place["rank"]),
        float(place["minZoom"]),
        str(place["name"]).casefold(),
    ))
    payload["places"] = places
    payload["sources"] = {
        "baseMap": "Natural Earth 1:10m, public domain",
        "settlements": "GeoNames cities500 and cities1000, CC BY 4.0",
        "settlementCount": len(places),
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    print(f"Settlements: {len(places):,}")
    print(f"Monthly additions: {monthly_additions:,}")
    print(f"Merged Natural Earth duplicates: {skipped_duplicates:,}")


if __name__ == "__main__":
    main()
