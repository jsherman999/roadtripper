import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_town_gazetteer import dedupe_towns, load_census_join, load_direct_towns, main


class Phase8TownGazetteerTests(unittest.TestCase):
    def test_load_direct_towns_accepts_simplemaps_style_csv(self):
        with tempfile.TemporaryDirectory() as tempdir:
            source = Path(tempdir) / "cities.csv"
            source.write_text(
                "city,state_name,lat,lng,population\n"
                "Waco,Texas,31.5493,-97.1467,144816\n"
                "Tiny,Texas,31.0,-97.0,199\n",
                encoding="utf-8",
            )
            towns = load_direct_towns(source, source="test")
        self.assertEqual(towns[0]["name"], "Waco")
        self.assertEqual(towns[0]["region"], "Texas")
        self.assertEqual(towns[0]["population"], 144816)
        self.assertEqual(towns[0]["source"], "test")

    def test_load_census_join_matches_population_by_geoid(self):
        with tempfile.TemporaryDirectory() as tempdir:
            places = Path(tempdir) / "places.tsv"
            population = Path(tempdir) / "population.csv"
            places.write_text(
                "GEOID\tNAME\tST\tINTPTLAT\tINTPTLONG\n"
                "4845000\tAustin city\tTX\t30.2672\t-97.7431\n",
                encoding="utf-8",
            )
            population.write_text(
                "GEO_ID,NAME,P1_001N\n"
                "1600000US4845000,Austin city,974447\n",
                encoding="utf-8",
            )
            towns = load_census_join(places, population)
        self.assertEqual(len(towns), 1)
        self.assertEqual(towns[0]["name"], "Austin")
        self.assertEqual(towns[0]["region"], "Texas")
        self.assertEqual(towns[0]["geoid"], "4845000")
        self.assertEqual(towns[0]["population"], 974447)

    def test_dedupe_keeps_largest_population_for_same_name_region(self):
        towns = dedupe_towns(
            [
                {"name": "Austin", "region": "Texas", "population": 10},
                {"name": "Austin", "region": "Texas", "population": 20},
            ]
        )
        self.assertEqual(len(towns), 1)
        self.assertEqual(towns[0]["population"], 20)

    def test_main_writes_expected_json_shape(self):
        with tempfile.TemporaryDirectory() as tempdir:
            source = Path(tempdir) / "cities.csv"
            output = Path(tempdir) / "us_towns.json"
            source.write_text(
                "city,state,lat,lon,population\n"
                "Waco,TX,31.5493,-97.1467,144816\n"
                "Tiny,TX,31.0,-97.0,199\n",
                encoding="utf-8",
            )
            exit_code = main(["--input", str(source), "--output", str(output), "--min-population", "200"])
            payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["town_count"], 1)
        self.assertEqual(payload["towns"][0]["name"], "Waco")


if __name__ == "__main__":
    unittest.main()
