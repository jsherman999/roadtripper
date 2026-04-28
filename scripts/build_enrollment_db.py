#!/usr/bin/env python3
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / "storyguide" / "data" / ".build_cache"
OUTPUT = Path(__file__).resolve().parent.parent / "storyguide" / "data" / "enrollment.json"

TARGET_STATES = {"MN", "IA", "MO", "KS", "AR", "OK", "TX"}


def find_zip(cache: Path, pattern: str) -> Path:
    for name in sorted(cache.iterdir()):
        if pattern in name.name:
            return name
    raise FileNotFoundError(f"No {pattern} found in {cache}")


def parse_edge(target_nces: set) -> dict:
    edge_zip = find_zip(CACHE_DIR, "edge_geocode_")
    print(f"Parsing EDGE: {edge_zip.name}")
    schools = {}
    with zipfile.ZipFile(edge_zip) as zf:
        txt_names = [n for n in zf.namelist() if n.endswith(".TXT")]
        for line_bytes in zf.open(txt_names[0]):
            line = line_bytes.decode("latin-1").strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) < 14:
                continue
            nces_id = parts[0].strip()
            state = parts[6].strip().upper()
            if state not in TARGET_STATES:
                continue
            target_nces.add(nces_id)
            try:
                lat = float(parts[12])
                lon = float(parts[13])
            except (ValueError, IndexError):
                lat, lon = 0.0, 0.0
            schools[nces_id] = {
                "nces_id": nces_id,
                "name": parts[2].strip(),
                "city": parts[5].strip(),
                "state": state,
                "lat": lat,
                "lon": lon,
            }
    print(f"  {len(schools):,} edge entries in target states")
    return schools


def parse_directory(target_nces: set) -> dict:
    dir_zip = find_zip(CACHE_DIR, "ccd_sch_dir_")
    print(f"Parsing CCD directory: {dir_zip.name}")
    info = {}
    with zipfile.ZipFile(dir_zip) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
        with zf.open(csv_names[0]) as fh:
            reader = csv.reader(io.TextIOWrapper(fh, encoding="latin-1"))
            header = next(reader)
            col_map = {name.strip(): i for i, name in enumerate(header)}

            nces_col = col_map.get("NCESSCH", 10)
            st_col = col_map.get("ST", 3)
            gslo_col = col_map.get("GSLO", 61)
            gshi_col = col_map.get("GSHI", 62)

            for row in reader:
                if len(row) <= max(nces_col, st_col, gslo_col, gshi_col):
                    continue
                nces_id = row[nces_col].strip()
                st = row[st_col].strip().upper()
                if st not in TARGET_STATES:
                    continue
                if nces_id not in target_nces:
                    continue
                gslo = row[gslo_col].strip()
                gshi = row[gshi_col].strip()
                info[nces_id] = {"gslo": gslo, "gshi": gshi}
    print(f"  {len(info):,} directory records")
    return info


def is_high_school(dir_rec: dict) -> bool:
    gslo = dir_rec.get("gslo", "")
    gshi = dir_rec.get("gshi", "")
    if not gshi or gshi == "":
        return False
    try:
        lo = int(gslo)
        hi = int(gshi)
    except ValueError:
        return gshi in ("12", "13")
    return hi >= 12 and lo >= 9


def parse_membership(target_nces: set) -> dict:
    member_zip = find_zip(CACHE_DIR, "ccd_sch_member_")
    print(f"Parsing CCD membership: {member_zip.name}")

    nces_remaining = set(target_nces)
    enrollment = {}

    with zipfile.ZipFile(member_zip) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
        fh = zf.open(csv_names[0])
        reader = csv.reader(io.TextIOWrapper(fh, encoding="latin-1"))

        header = next(reader)
        col_map = {name.strip(): i for i, name in enumerate(header)}
        nces_col = col_map.get("NCESSCH", 10)
        tot_col = col_map.get("TOTAL_INDICATOR", 16)
        grade_col = col_map.get("GRADE", 12)
        race_col = col_map.get("RACE_ETHNICITY", 13)
        sex_col = col_map.get("SEX", 14)
        count_col = col_map.get("STUDENT_COUNT", 15)

        count = 0
        for row in reader:
            if len(row) <= max(nces_col, tot_col, grade_col, race_col, sex_col, count_col):
                continue

            if row[tot_col].strip() != "Education Unit Total":
                continue
            if row[grade_col].strip() != "No Category Codes":
                continue
            if row[race_col].strip() != "No Category Codes":
                continue
            if row[sex_col].strip() != "No Category Codes":
                continue

            nces_id = row[nces_col].strip()
            if nces_id not in nces_remaining:
                continue

            try:
                enrollment[nces_id] = int(row[count_col].strip())
            except ValueError:
                enrollment[nces_id] = 0
            nces_remaining.discard(nces_id)

            count += 1
            if count % 5000 == 0:
                sys.stdout.write(f"\r  found {count:,} enrollment records, {len(nces_remaining):,} remaining  ")
                sys.stdout.flush()

        fh.close()

    print(f"\r  {len(enrollment):,} enrollment totals matched              ")
    return enrollment


def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    target_nces = set()
    edge_schools = parse_edge(target_nces)
    if not edge_schools:
        print("ERROR: No EDGE data", file=sys.stderr)
        sys.exit(1)

    dir_info = parse_directory(target_nces)
    member_enum = parse_membership(target_nces)

    print("\nMerging data …")
    output_schools = []
    skipped_grade = 0
    skipped_enroll = 0
    for nces_id, edge in edge_schools.items():
        di = dir_info.get(nces_id)
        if di and not is_high_school(di):
            skipped_grade += 1
            continue
        enrollment = member_enum.get(nces_id, 0)
        if enrollment <= 0:
            skipped_enroll += 1
            continue
        output_schools.append({
            "nces_id": edge["nces_id"],
            "name": edge["name"],
            "city": edge["city"],
            "state": edge["state"],
            "lat": edge["lat"],
            "lon": edge["lon"],
            "enrollment": enrollment,
        })

    print(f"  {len(output_schools):,} high schools with enrollment")
    print(f"  skipped (grade): {skipped_grade:,} | (no enrollment): {skipped_enroll:,}")

    by_state = {}
    for s in output_schools:
        by_state.setdefault(s["state"], []).append(s)

    print("\nSchools per state:")
    for st in sorted(TARGET_STATES):
        count = len(by_state.get(st, []))
        total = sum(s["enrollment"] for s in by_state.get(st, []))
        print(f"  {st}: {count:>5,} schools")

    payload = {
        "description": "High school enrollment data for MN, IA, MO, KS, AR, OK, TX",
        "source": "NCES Common Core of Data + NCES EDGE Geocodes",
        "school_year": "2023-2024",
        "school_count": len(output_schools),
        "schools": output_schools,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"\nWritten {OUTPUT} ({size_kb:,.0f} KB)")
    print("Build complete.")


if __name__ == "__main__":
    main()
