import unittest

from storyguide.narration import NarrationBuilder, sanitize_text
from storyguide.providers import DemoPlaceProvider


class Phase3NarrationTests(unittest.TestCase):
    def test_sanitize_text_softens_sensitive_words(self):
        text = sanitize_text("The town has a violent crime story.")
        self.assertNotIn("violent", text)
        self.assertNotIn("crime", text)

    def test_quick_mode_is_shorter_than_storyteller(self):
        builder = NarrationBuilder()
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(30.2672, -97.7431)
        nearby = provider.nearby_places(30.2672, -97.7431)
        quick = builder.build_current_place_script(place, nearby, mode="quick")
        storyteller = builder.build_current_place_script(place, nearby, mode="storyteller")
        self.assertLess(len(quick["script"]), len(storyteller["script"]))

    def test_history_mode_includes_history_language(self):
        builder = NarrationBuilder()
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(31.0982, -97.3428)
        nearby = provider.nearby_places(31.0982, -97.3428)
        script = builder.build_current_place_script(place, nearby, mode="history")
        self.assertIn("history", script["script"].lower())

    def test_adult_mode_uses_more_mature_language(self):
        builder = NarrationBuilder()
        provider = DemoPlaceProvider()
        place = provider.reverse_geocode(30.2672, -97.7431)
        nearby = provider.nearby_places(30.2672, -97.7431)
        script = builder.build_current_place_script(place, nearby, mode="storyteller", age_band="adult")
        self.assertIn("The population is about", script["script"])
        self.assertIn("Background:", script["script"])
        self.assertNotIn("Road trip trivia", script["script"])
