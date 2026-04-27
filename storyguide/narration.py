import re

SENSITIVE_WORDS = {
    "murder": "hard history",
    "crime": "serious history",
    "violent": "dramatic",
    "tragedy": "challenging moment",
}

_PLACE_IS_A_RE = re.compile(
    r"^\s*(it\s+)?is\s+a\s+(city|town|village|hamlet|community|census-designated\s+place|unincorporated\s+community)\s+(in|located\s+in)\s+",
    re.IGNORECASE,
)


def sanitize_text(text: str) -> str:
    clean = text or ""
    for source, replacement in SENSITIVE_WORDS.items():
        clean = clean.replace(source, replacement)
        clean = clean.replace(source.capitalize(), replacement.capitalize())
    return clean


def _is_generic_place_description(text: str) -> bool:
    return bool(_PLACE_IS_A_RE.search(text))


class NarrationBuilder:
    def build_current_place_script(self, place, nearby, mode: str = "storyteller", age_band: str = "elementary"):
        if age_band == "adult":
            title = "Now entering %s" % place.name
            bits = ["We are near %s, %s." % (place.name, place.region)]
            if place.population:
                bits.append("The population is about {:,}.".format(place.population))
            if place.known_for and not _is_generic_place_description(place.known_for):
                bits.append("%s is known for %s." % (place.name, sanitize_text(place.known_for)))
            if mode == "history" and place.history and not _is_generic_place_description(place.history):
                bits.append("Historical context: %s." % sanitize_text(place.history))
            elif place.history and not _is_generic_place_description(place.history):
                bits.append("Background: %s." % sanitize_text(place.history))
            if place.high_school_enrollment:
                bits.append("A local high school enrolls roughly {:,} students.".format(place.high_school_enrollment))
            landmark_name = nearby[0].name if nearby else (place.landmarks[0] if place.landmarks else None)
            if landmark_name:
                bits.append("A notable nearby stop is %s." % landmark_name)
            if place.trivia:
                bits.append("Local note: %s." % sanitize_text(place.trivia[0]))
        else:
            title = "Welcome to %s" % place.name
            bits = ["We are near %s, %s." % (place.name, place.region)]
            if place.population:
                bits.append("About {:,} people live here.".format(place.population))
            if place.known_for and not _is_generic_place_description(place.known_for):
                bits.append("%s is known for %s." % (place.name, sanitize_text(place.known_for)))
            if mode == "history" and place.history and not _is_generic_place_description(place.history):
                bits.append("A quick history note: %s." % sanitize_text(place.history))
            elif place.history and not _is_generic_place_description(place.history):
                bits.append("Fun history note: %s." % sanitize_text(place.history))
            if place.high_school_enrollment:
                bits.append("One local high school serves about {:,} students.".format(place.high_school_enrollment))
            landmark_name = nearby[0].name if nearby else (place.landmarks[0] if place.landmarks else None)
            if landmark_name:
                bits.append("Keep an eye out for %s nearby." % landmark_name)
            if place.trivia:
                bits.append("Road trip trivia: %s." % sanitize_text(place.trivia[0]))
        if mode == "quick":
            bits = bits[:3]
        script = " ".join(bits)
        if age_band == "early_elementary":
            script = script.replace("approximately", "about")
        return {
            "title": title,
            "script": script,
            "tags": ["current_place", place.region.lower().replace(" ", "_")],
        }

    def build_upcoming_script(self, place_name: str, region: str, distance_km: float, age_band: str = "elementary"):
        title = "Coming up: %s" % place_name
        if age_band == "adult":
            script = "Up ahead in about %.1f kilometers is %s, %s." % (distance_km, place_name, region)
        else:
            script = "Coming up in about %.1f kilometers is %s, %s." % (distance_km, place_name, region)
        return {
            "title": title,
            "script": script,
            "tags": ["upcoming_place", region.lower().replace(" ", "_")],
        }

    def build_selected_point_script(self, point_name: str, region: str, blurb: str, age_band: str = "elementary"):
        title = "Selected stop: %s" % point_name
        if age_band == "adult":
            script = "%s is a nearby point of interest in %s. %s." % (point_name, region, sanitize_text(blurb))
        else:
            script = "You tapped %s in %s. Here is a quick note: %s." % (point_name, region, sanitize_text(blurb))
        return {
            "title": title,
            "script": script,
            "tags": ["selected_place", region.lower().replace(" ", "_")],
        }
