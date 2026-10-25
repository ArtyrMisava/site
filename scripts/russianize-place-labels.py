#!/usr/bin/env python3
"""Normalize every bundled settlement label to a Russian display name."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from russian_place_names import is_russian_display_name, russianize_name


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=Path("public/maps/places.json"))
    args = parser.parse_args()

    payload = json.loads(args.path.read_text(encoding="utf-8"))
    changed = 0
    examples: list[tuple[str, str, str]] = []
    for place in payload.get("places", []):
        original = str(place.get("name") or "")
        updated = russianize_name(original, str(place.get("country") or ""))
        if updated != original:
            place["name"] = updated
            changed += 1
            if len(examples) < 20:
                examples.append((str(place.get("country") or ""), original, updated))

    invalid = [
        (str(place.get("country") or ""), str(place.get("name") or ""))
        for place in payload.get("places", [])
        if not is_russian_display_name(str(place.get("name") or ""))
    ]
    if invalid:
        preview = "\n".join(f"{country}: {name}" for country, name in invalid[:30])
        raise SystemExit(f"Russian label validation failed ({len(invalid)} names):\n{preview}")

    args.path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Updated {changed:,} settlement names in {args.path}")
    for country, original, updated in examples:
        print(f"  {country}: {original} -> {updated}")
    print(f"Validated {len(payload.get('places', [])):,} Russian-only settlement labels")


if __name__ == "__main__":
    main()
