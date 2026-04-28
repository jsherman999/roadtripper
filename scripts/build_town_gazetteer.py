#!/usr/bin/env python3
import argparse
import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional


OUTPUT = Path(__file__).resolve().parent.parent / "storyguide" / "data" / "us_towns.json"
CACHE_DIR = Path(__file__).resolve().parent.parent / "storyguide" / "data" / ".town_build_cache"
CENSUS_2020_PLACES_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_place_national.zip"
CENSUS_2020_PLACE_POPULATION_URL = "https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*"

STATE_ABBR_TO_NAME = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
}

ALIASES = {
    "geoid": ("geoid", "geo_id", "geography_id", "placefp", "id"),
    "name": ("name", "city", "place", "placename", "display_name"),
    "region": ("region", "state", "state_name", "st", "usps", "admin1", "admin_name"),
    "latitude": ("latitude", "lat", "intptlat", "intptlat20", "point_lat"),
    "longitude": ("longitude", "lon", "lng", "intptlong", "intptlon", "intptlong20", "point_lon"),
    "population": ("population", "pop", "pop2020", "pop_2020", "p1_001n", "estimate", "population_total"),
}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build RoadTripper town gazetteer JSON")
    parser.add_argument("--input", action="append", default=[], help="City/town CSV/TSV/JSON file with coordinates and population")
    parser.add_argument("--places-gazetteer", help="Census-style places gazetteer with GEOID/name/state/lat/lon")
    parser.add_argument("--population", help="Population CSV/TSV/JSON keyed by GEOID")
    parser.add_argument(
        "--download-census-2020",
        action="store_true",
        help="Download official Census 2020 place coordinates and population, then build from them",
    )
    parser.add_argument("--cache-dir", default=str(CACHE_DIR), help="Download cache directory")
    parser.add_argument("--output", default=str(OUTPUT), help="Output JSON path")
    parser.add_argument("--min-population", type=int, default=1, help="Minimum population to write")
    parser.add_argument("--source", default="", help="Source label to store in each town record")
    args = parser.parse_args(argv)

    records = []
    for input_path in args.input:
        records.extend(load_direct_towns(Path(input_path), source=args.source or Path(input_path).stem))

    if args.download_census_2020:
        places_path, population_path = download_census_2020_sources(Path(args.cache_dir))
        records.extend(
            load_census_join(
                places_path,
                population_path,
                source=args.source or "census_2020",
            )
        )

    if args.places_gazetteer:
        if not args.population:
            parser.error("--places-gazetteer requires --population")
        records.extend(
            load_census_join(
                Path(args.places_gazetteer),
                Path(args.population),
                source=args.source or "census",
            )
        )

    towns = dedupe_towns(record for record in records if record and record["population"] >= args.min_population)
    payload = {
        "description": "RoadTripper town gazetteer",
        "format_version": 1,
        "town_count": len(towns),
        "towns": towns,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print("Wrote %s towns to %s" % (len(towns), output))
    return 0


def load_direct_towns(path: Path, source: str = "gazetteer") -> List[Dict]:
    towns = []
    for row in read_rows(path):
        town = normalize_town_row(row, source=source)
        if town:
            towns.append(town)
    return towns


def load_census_join(places_path: Path, population_path: Path, source: str = "census") -> List[Dict]:
    populations = {}
    for row in read_rows(population_path):
        geoid = normalize_geoid(get_value(row, "geoid"))
        population = parse_int(get_value(row, "population"))
        if geoid and population is not None:
            populations[geoid] = population

    towns = []
    for row in read_rows(places_path):
        geoid = normalize_geoid(get_value(row, "geoid"))
        if not geoid or geoid not in populations:
            continue
        enriched = dict(row)
        enriched["population"] = populations[geoid]
        enriched["geoid"] = geoid
        town = normalize_town_row(enriched, source=source)
        if town:
            towns.append(town)
    return towns


def download_census_2020_sources(cache_dir: Path = CACHE_DIR) -> tuple:
    cache_dir.mkdir(parents=True, exist_ok=True)
    places_zip = cache_dir / "2020_Gaz_place_national.zip"
    places_tsv = cache_dir / "2020_Gaz_place_national.txt"
    population_json = cache_dir / "2020_place_population.json"
    population_csv = cache_dir / "2020_place_population.csv"

    if not places_zip.exists():
        download_file(CENSUS_2020_PLACES_URL, places_zip)
    if not places_tsv.exists():
        with zipfile.ZipFile(places_zip) as zf:
            txt_names = [name for name in zf.namelist() if name.lower().endswith(".txt")]
            if not txt_names:
                raise ValueError("Census places zip did not contain a text file")
            places_tsv.write_bytes(zf.read(txt_names[0]))

    if not population_json.exists():
        download_file(CENSUS_2020_PLACE_POPULATION_URL, population_json)
    if not population_csv.exists():
        write_census_api_population_csv(population_json, population_csv)

    return places_tsv, population_csv


def download_file(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "RoadTripper/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def write_census_api_population_csv(source_json: Path, output_csv: Path) -> None:
    with open(source_json, encoding="utf-8") as fh:
        rows = json.load(fh)
    if not rows or not isinstance(rows, list):
        raise ValueError("Unexpected Census API population response")
    header = rows[0]
    with open(output_csv, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["geoid", "name", "population"])
        writer.writeheader()
        for values in rows[1:]:
            row = dict(zip(header, values))
            state = str(row.get("state", "")).zfill(2)
            place = str(row.get("place", "")).zfill(5)
            writer.writerow(
                {
                    "geoid": "%s%s" % (state, place),
                    "name": row.get("NAME", ""),
                    "population": row.get("P1_001N", ""),
                }
            )


def read_rows(path: Path) -> List[Dict]:
    suffix = path.suffix.lower()
    if suffix == ".zip":
        with zipfile.ZipFile(path) as zf:
            data_names = [name for name in zf.namelist() if name.lower().endswith((".txt", ".csv", ".tsv"))]
            if not data_names:
                raise ValueError("Zip source must contain a CSV/TSV/TXT file")
            with zf.open(data_names[0]) as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8-sig")
                return read_delimited_rows(text)
    if suffix == ".json":
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        rows = raw.get("towns", raw.get("data", raw)) if isinstance(raw, dict) else raw
        if not isinstance(rows, list):
            raise ValueError("JSON source must contain an array or a towns/data array")
        return [normalize_keys(row) for row in rows if isinstance(row, dict)]

    with open(path, newline="", encoding="utf-8-sig") as fh:
        return read_delimited_rows(fh)


def read_delimited_rows(fh) -> List[Dict]:
    sample = fh.read(4096)
    fh.seek(0)
    if "|" in sample and sample.count("|") >= sample.count("\t") and sample.count("|") >= sample.count(","):
        delimiter = "|"
    elif "\t" in sample and sample.count("\t") >= sample.count(","):
        delimiter = "\t"
    else:
        delimiter = ","
    reader = csv.DictReader(fh, delimiter=delimiter)
    return [normalize_keys(row) for row in reader]


def normalize_town_row(row: Dict, source: str = "gazetteer") -> Optional[Dict]:
    name = clean_name(get_value(row, "name"))
    region_raw = get_value(row, "region")
    region = normalize_region(region_raw)
    latitude = parse_float(get_value(row, "latitude"))
    longitude = parse_float(get_value(row, "longitude"))
    population = parse_int(get_value(row, "population"))
    if not name or not region or latitude is None or longitude is None or population is None:
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    payload = {
        "name": name,
        "region": region,
        "country": "USA",
        "latitude": round(latitude, 6),
        "longitude": round(longitude, 6),
        "population": population,
        "source": source,
    }
    geoid = normalize_geoid(get_value(row, "geoid"))
    if geoid:
        payload["geoid"] = geoid
    state_abbr = normalize_state_abbr(region_raw)
    if state_abbr:
        payload["region_abbr"] = state_abbr
    return payload


def dedupe_towns(records: Iterable[Dict]) -> List[Dict]:
    by_key = {}
    for record in records:
        key = (record["name"].lower(), record["region"].lower())
        existing = by_key.get(key)
        if not existing or record["population"] > existing["population"]:
            by_key[key] = record
    towns = list(by_key.values())
    towns.sort(key=lambda town: (town["region"], town["name"]))
    return towns


def normalize_keys(row: Dict) -> Dict:
    return {normalize_key(key): value for key, value in row.items()}


def normalize_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(key).strip().lower()).strip("_")


def get_value(row: Dict, logical_name: str):
    for alias in ALIASES[logical_name]:
        key = normalize_key(alias)
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def clean_name(value) -> str:
    name = str(value or "").strip()
    for suffix in (" city", " town", " village", " municipality", " CDP", " cdp"):
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    return name


def normalize_region(value) -> str:
    raw = str(value or "").strip()
    abbr = normalize_state_abbr(raw)
    return STATE_ABBR_TO_NAME.get(abbr, raw)


def normalize_state_abbr(value) -> str:
    raw = str(value or "").strip()
    if len(raw) == 2 and raw.upper() in STATE_ABBR_TO_NAME:
        return raw.upper()
    for abbr, name in STATE_ABBR_TO_NAME.items():
        if raw.lower() == name.lower():
            return abbr
    return ""


def normalize_geoid(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "US" in raw:
        raw = raw.split("US", 1)[1]
    return re.sub(r"\D", "", raw)


def parse_float(value) -> Optional[float]:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def parse_int(value) -> Optional[int]:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9-]", "", str(value))
    if cleaned in ("", "-"):
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


if __name__ == "__main__":
    sys.exit(main())
